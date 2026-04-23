# 점수·랭킹 알고리즘 감사 보고서 (2026-04-22)

> **Subtask B · Worker 2 산출물** — `realtime-ai-trend-news` 파이프라인의 키워드 스코어링 / 랭킹 / 딜레이어 로직을 바이브코딩(Vibe Coding) 사용자 관점에서 감사하고, 개선안을 권고한다.
> **범위**: 분석·권고만, 코드 변경 금지. 의사코드·diff 스니펫은 허용.
> **검토 대상 코드**: `src/lib/pipeline/scoring.ts`, `ranking_policy.ts`, `dynamic_query.ts`, `manual_priority.ts`, `snapshot.ts`, `ranking_candidate_debug.ts`, `keyword_exclusions.ts`, `src/config/keyword-exclusions.json`, 대응 테스트 파일 5종.

---

## 0. 요약 (Executive Summary)

| 항목 | 현재 점수 | 핵심 이슈 | 권고 난이도 |
|---|---|---|---|
| 현행 모델 정상 동작 | ✅ | 6축(recency/frequency/authority/velocity/engagement/internal) + 3단 delta(policy/stability/manual) 파이프라인이 일관되게 구성됨 | — |
| **한국어 사용자 만족** | **2/5** | TIER_AUTHORITY에 언어 고려 없음. 한국어 매체는 대부분 P2_RAW 혹은 COMMUNITY로 저평가 | 중 |
| **바이브코딩 신호 커버리지** | **2/5** | GitHub stars 변동, Product Hunt upvote velocity, X/Threads 언급량 등 "바이브코딩의 심장 신호"가 score에 직접 반영되지 않음 (engagement에 흡수되기는 하나 정규화가 뭉뚱그림) | 중상 |
| **중복 억제** | **3/5** | `suppressVersionFamilyDuplicates`가 버전 family만 잡음. 의미적 클러스터(예: "Claude Code" ↔ "claude-code CLI", "Cursor Composer" ↔ "Composer 2 by Cursor")는 누락 | 중 |
| **영문 편향** | **2/5** | dynamic_query의 BASE_TERMS 8종이 전부 영문, frequency가 도메인 수 기반 → 영문 기사 8개 vs 한국어 2개일 때 한국어가 구조적으로 밀림 | 중 |
| **신선도 편향** | **3/5** | `recencyHalfLifeHours=9`는 실시간엔 OK지만, 24h 이상 꾸준히 뜨는 "체류형" 트렌드(예: 장기 모델 런칭 후폭풍)가 과소 평가됨 | 하 |
| **Manual priority의 덮어쓰기** | **2/5** | `MANUAL_KEYWORD_TOTAL_BONUS=6`이 자연 점수(≈0~1 범위) 대비 5~6배. 수동 키워드가 무조건 상위를 점유 → A/B 비교 불가 | 중 |

**최우선 조치 3가지**
1. **언어·지역 시그널 분리**: `languageBonus` (한국 사용자 기준 한국어 매체 +α) 및 `languageBalance` penalty(언어 단일 편향 방지) 도입.
2. **"바이브 신호" 복합 축** 신설: `vibe` 축 = GitHub stars Δ7d + Product Hunt upvote rate + X/Threads mention rate의 정규화 합.
3. **Manual bonus를 additive가 아닌 multiplicative slot-reserve로 재설계**: 고정 슬롯 N개만 수동 삽입, 나머지는 유기 랭킹 유지.

---

## 1. 현행 모델 한 페이지 요약

### 1.1 6축 점수 구조 (정규화 0~1)

| 축 | 가중치(기본) | 산식 요약 | 소스 | 근거 |
|---|---|---|---|---|
| `recency` | **0.28** | `0.5 ^ (ageHours / 9h)` (반감기 9시간) | `keyword.candidates.latestAt` | `scoring.ts:160-163` |
| `frequency` | **0.12** | `min(1, (uniqueDomains + domainBonus) / 10)` | `candidates.domains.size`, `domainBonus` | `scoring.ts:166-169` |
| `authority` | **0.08** | `max(TIER_AUTHORITY[tier], authorityOverride)` — P0=1.0, P1=0.6, P2=0.3, COMMUNITY=0.2 | 소스 티어 분류 | `scoring.ts:40-45, 172-175` |
| `velocity` | **0.30** | `centered = (ratio-1)/(ratio+1)`, `ratio = (recent6h+1)/(baseline18h_scaled+1)`, 이후 `max(0,min(1,…))` | 매칭 RSS item의 publishedAt | `scoring.ts:70-105` |
| `engagement` | **0.22** | `min(1, log10(ΣScore + 2×ΣComments + 1) / 4)` | HN/Reddit/PH/GitHub release upvotes·comments | `scoring.ts:110-133` |
| `internal` | **0.00** | 기본 0. **runtime에서 policy/stability/manual delta가 누적** | 아래 §1.2 참조 | `scoring.ts:15-22, 189-198` |

> **중요**: `DEFAULT_WEIGHTS.internal = 0`이지만 `manual_priority`, `ranking_policy`는 `applyInternalDelta()`로 **total에 직접 가산**한다(가중치 미적용). 즉 delta는 internal 가중치를 우회해 항상 total에 1:1 반영된다. `manual_priority.ts:78-92`, `snapshot.ts:866-924` 참조.

### 1.2 파이프라인 단계별 점수 변형 경로 (`snapshot.ts:853-946`)

```
1. rankKeywords(normalizedKeywords, {limit: candidateLimit})
     └─ calculateScore() 로 6축 산정 → total 초기값

2. buildKeywordPolicyMap() + calculateKeywordPolicyDelta()
     └─ incident +0.08, feature_event +0.06, version_release +0.01
        major +0.04, patch -0.06, build -0.12
        weakVersionOnly -0.04
     → applyInternalDelta() 로 total 가산
     → 재정렬

3. suppressVersionFamilyDuplicates()
     └─ 같은 repo/stem family 안에서 feature_event·incident 가 있으면
        version_only 제거, 없으면 best versioned 1개만 남김

4. calculateStabilityDelta()
     └─ 신규 + strongBreakout +0.03, 신규 + 약함 -0.03
        기존 Top10 +0.04, appearances≥2 최대 +0.03
        stale -0.05
     → applyInternalDelta() → 재정렬

5. applyManualKeywordPriority()
     └─ match 된 키워드에 totalBonus(=6), internalBonus(=3) 가산
     └─ 매칭 없는 수동 키워드는 totalScore=10 + bonus 로 삽입
     └─ prioritized 배열 상단에 수동 키워드 먼저 배치

6. slice(0, rankingLimit), rank 재부여, prev_rank 비교
```

### 1.3 수동 priority & dynamic query

- **Manual priority** — DB `manual_keywords` 테이블에서 활성 항목 조회. `applyManualKeywordPriority()` 가 **매칭/삽입 두 모드**로 동작하며, 매칭 실패 시 `createManualRankedItem()`이 **total=10 + 6 = 16** 짜리 "유령 아이템"을 랭킹 상단에 찍어 넣음(`manual_priority.ts:38-76`). 자연 점수의 정상 분포가 ~0.5 이하인 것을 감안하면 **16은 사실상 절대 상위 슬롯 확정**이다.
- **Dynamic query** — `dynamic_query.ts`는 최근 3 스냅샷의 Top10 키워드 중 **2회 이상 등장한 키워드를 제외**하여 echo chamber 방지. BASE 8 + dynamic 최대 7 = 15개 OR-쿼리. 다만 BASE_TERMS는 전부 영문.
- **Keyword exclusions** — `src/config/keyword-exclusions.json`은 소문자 exact match만 지원(`keyword_exclusions.ts:11-21`). prefix/suffix/regex 는 미지원. 예시: `"claude"`는 제외되지만 `"claude 4.7"`은 통과.

---

## 2. 약점 진단 (항목별 증거)

### 2.1 한국어/지역 편향 — 영문 소스 과적합

| # | 증상 | 증거 | 영향 |
|---|---|---|---|
| 2.1.1 | `frequency`는 unique domain 수 기반이지만 실제 크롤링 피드(`doc/pipeline.md` 기반 + HN/GDELT/GitHub/PH/Reddit)가 영문 중심. 한국 매체는 소수 + `P2_RAW`로 티어 낮음 | `scoring.ts:166-169`, `_pipeline_reference/workflow/resources/rss.json` 한국어 피드 부재 가능성 (별도 확인 필요) | 동일 주제 기사도 영문 도메인이 우세해 frequency 점수 구조적 상향 |
| 2.1.2 | `TIER_AUTHORITY`에 언어 차원 없음 → 한국 사용자 타깃이지만 한국어 매체는 기본 P2_RAW 0.3 | `scoring.ts:40-45` | authority 가중치 0.08이라 직접 영향은 약하지만, 누적되면 한국어 키워드가 상위에 안 뜸 |
| 2.1.3 | `dynamic_query.BASE_TERMS`는 `["AI","LLM","GPT","Claude","Gemini","OpenAI","Anthropic","DeepSeek"]` — 전부 영문 | `dynamic_query.ts:3-6` | GDELT 쿼리 diversification이 항상 영문 중심 → 영문 기사가 먼저 도착 |
| 2.1.4 | `ensureLocalizedKeyword()`가 LLM으로 ko/en 양면 생성하지만, **원본 언어 가중치 자체는 변하지 않음** | `snapshot.ts:419-455` | 번역만 보강되고 "한국어 실시간성"은 랭킹에 반영 안 됨 |

### 2.1.5 갭 지표 (추정치, 검증 필요)
- 수집 피드 중 한국어 매체 비중: **추정 ≤ 10%** (`docs/audit/2026-04-22-source-catalog-audit.md` (Subtask A) 에서 정량 수치 확인 예정).
- 한국어 기사가 P0_CURATED 티어로 잡히는 경우: 매우 드물 것. Subtask A 보고서에서 화이트리스트 업그레이드 권고가 제시될 것으로 전제.

### 2.2 신선도 편향 — 반감기 9시간의 과잉 단기화

| # | 증상 | 증거 | 영향 |
|---|---|---|---|
| 2.2.1 | `recencyHalfLifeHours = 9` (기본) → 24h 경과 키워드는 `0.5^(24/9) = 0.159` | `scoring.ts:32`, `snapshot.ts:226-230` | 모델 런칭 후 2~3일 여파가 큰 바이브코딩 트렌드(예: "Claude Opus 4.7")가 빠르게 사라짐 |
| 2.2.2 | `velocityBaselineWindowHours = 18` (최대 24h 범위). `totalWindow = 6+18 = 24h` → 24h 초과 아이템은 velocity 계산에서 버려짐 | `scoring.ts:80-98` | 2일 이상 꾸준한 관심도(stars 증가, PR 개수 등)가 velocity에 반영 안 됨 |
| 2.2.3 | `calculateVelocityScore`는 `centered = (ratio-1)/(ratio+1)`를 `max(0,…)` 으로 clamp → **침체 키워드의 음의 신호 상실** | `scoring.ts:103-104` | Top10에서 이미 식은 키워드가 높은 recency 때문에 잔존 가능 |

### 2.3 중복/클러스터링 — version family 이외는 미커버

| # | 증상 | 증거 | 영향 |
|---|---|---|---|
| 2.3.1 | `suppressVersionFamilyDuplicates()`는 `repo:xxx` 혹은 `stem:first-2-3-tokens` 단위로만 가족 판단 | `ranking_policy.ts:220-253, 361-421` | "Claude Opus 4.7", "Claude 4.7", "Anthropic Claude 4.7" — 같은 주제 3종이 개별 랭크. stem 토큰 2개 기준이라 "anthropic claude" vs "claude opus"는 다른 family |
| 2.3.2 | 별칭 정규화는 `ensureLocalizedKeyword` 시점에 LLM으로만 수행, 스코어링 시점엔 `candidates.text` 그대로 사용 | `snapshot.ts:836-840, keywords.ts`(간접) | 동의어/약어가 다른 keywordId를 가지면 frequency/engagement 중복 집계 |
| 2.3.3 | `keyword_exclusions.json`은 exact. `"artificial intelligence"` 제외되나 `"artificial intelligence research"`는 통과 | `keyword_exclusions.ts:23-27` | 광범위 키워드가 긴 형태로 우회됨 (실제 예: `"ai agents"` 제외, `"ai agents framework"` 통과 가능) |

### 2.4 노이즈 과적합 — 릴리스 트레인 vs 수기 feature_event 구분 취약

| # | 증상 | 증거 | 영향 |
|---|---|---|---|
| 2.4.1 | `FEATURE_HINTS`가 키워드 텍스트 기반 단순 부분일치 (`"memory"`, `"plugin"` 등) | `ranking_policy.ts:105-139` | "Memory Bank Plugin" 같은 SaaS 공지가 feature_event +0.06 받음 (과도 보상) |
| 2.4.2 | `INCIDENT_HINTS`에 `"bug"`, `"issue"` 포함 → "GitHub issues API" 류 기술 블로그가 incident로 분류 | `ranking_policy.ts:77-103` | +0.08 부스트가 소규모 블로그 기사에 적용 |
| 2.4.3 | Manual priority의 `createManualRankedItem` — 소스 0개로 total 10+6=16 삽입 | `manual_priority.ts:38-76` | "빈 껍데기" 수동 키워드가 무조건 1위 |

### 2.5 Stability — 기득권 편향(Echo Chamber) & 신규 진입 장벽

| # | 증상 | 증거 | 영향 |
|---|---|---|---|
| 2.5.1 | `calculateStabilityDelta`가 `previousRank<=10 ⇒ +0.04` + appearances 최대 +0.03 = 최대 +0.07 | `ranking_policy.ts:423-464` | 이미 상위였던 키워드가 계속 상위. 신규 진입은 strongBreakout 만족 못하면 -0.03 |
| 2.5.2 | `strongBreakout` 조건 중 하나라도 만족하면 신규 +0.03. 하지만 `engagement>=0.45` 는 engagement 정규화가 log10(1e4)=4 기준이어서 매우 드물게 달성 | `ranking_policy.ts:438-442` | 실질적으로 authority≥0.84 (P0_CURATED 근접) 또는 domains≥3 아니면 대부분 신규는 -0.03 |
| 2.5.3 | `dynamic_query`의 "2회 이상 제외" 정책과 stability의 "기존 Top10 +0.04"가 **역방향 구조**. 수집 단계에서 빠지는 키워드를 랭킹 단계에서 기득권 부스팅 | `dynamic_query.ts:38-45` vs `ranking_policy.ts:446-448` | 수집/랭킹 간 전략 불일치: 수집은 신선, 랭킹은 기득권. 결과적으로 "GDELT broad가 잡아준 키워드만 갱신됨" |

### 2.6 Manual Priority — 매직 상수로 유기 랭킹을 덮음

| # | 증상 | 증거 | 영향 |
|---|---|---|---|
| 2.6.1 | `MANUAL_KEYWORD_TOTAL_BONUS=6`, `createManualRankedItem`의 base=10 → 최종 16 | `snapshot.ts:104-109`, `manual_priority.ts:73` | 자연 total 최댓값 ≈ `(0.28+0.12+0.08+0.30+0.22)*1 = 1.00` 대비 **16배** |
| 2.6.2 | `applyManualKeywordPriority` — prioritized 배열에 수동 키워드 먼저 push → boost 후 유기 키워드 | `manual_priority.ts:140-180` | rankingLimit 안에서 수동 슬롯이 유기 슬롯을 "밀어내는" 구조. 사용자 입장에서 A/B 비교 어려움 |
| 2.6.3 | 수동 키워드 삭제 시점에 이전 스냅샷과의 delta_rank 이상동작 가능성 (prev_rank 조회는 `keywordId` 기준) | `snapshot.ts:873-889` | 수동 → 유기 전환 시 점수 급락이 사용자에게 이상하게 노출 |

### 2.7 Engagement 신호 정규화의 둔감성

| # | 증상 | 증거 | 영향 |
|---|---|---|---|
| 2.7.1 | `log10(combined+1)/4` → combined=10 이면 0.25, combined=100이면 0.50. 즉 1자리 vs 3자리 upvote 차이가 2배만 반영 | `scoring.ts:129-132` | 500 up vs 5000 up의 차별화 부족 |
| 2.7.2 | `engagement.score`와 `comments*2`만 합산. GitHub stars는 engagement인지 authority인지 모호 | `scoring.ts:115-124` | Release item에서만 stars가 일부 반영 (실제 stars Δ7d 계산은 부재) |
| 2.7.3 | 매칭 item이 engagement 필드 없을 때 0 — 뉴스 기사는 대부분 engagement=0 | `scoring.ts:122` | 뉴스 중심 키워드 vs 커뮤니티 중심 키워드의 비교 축이 깨짐 |

### 2.8 Keyword Exclusion — exact match only

- `src/config/keyword-exclusions.json` 은 **222개 exact 리스트**. Prefix / suffix / regex 미지원 (`keyword_exclusions.ts`). 관리 비용이 크고 우회가 쉽다.
- 포함된 항목: 매체 이름 (`"bbc"`, `"cnn"`, `"reuters"`, `"washington post"`), 범용어 (`"ai"`, `"llm"`, `"agent"`), **일부 브랜드명**(`"openai"`, `"anthropic"`, `"claude"`, `"chatgpt"`, `"cursor"`, `"gemini"`, `"perplexity"`).
- **문제**: 브랜드 단독 제외는 맞지만, 많은 경우 사용자가 원하는 건 "브랜드+이벤트" 조합 ("Claude 4.7 Extended Thinking"). 제외 set에 다차원 정책이 없어 **과잉/과소 제외가 공존**.

---

### 2.9 약점별 diff 스니펫 (개념 예시)

> 아래는 **권고의 방향성**을 보이기 위한 diff 스니펫이다. 실제 커밋은 본 감사 범위 밖 (코드 변경 금지).

#### 2.9.1 exclusion 을 exact + prefix + regex 로 확장 (`keyword_exclusions.ts`)

```diff
-function buildExactExclusionSet(): Set<string> {
-  const exactRaw = (config as KeywordExclusionsConfig).exact;
-  if (!Array.isArray(exactRaw)) return new Set();
-  return new Set(exactRaw.filter((v): v is string => typeof v === "string")
-    .map(normalizeKeyword).filter((v) => v.length > 0));
-}
-const EXACT_EXCLUSION_SET = buildExactExclusionSet();
-export function isExactlyExcludedKeyword(keyword: string): boolean {
-  return EXACT_EXCLUSION_SET.has(normalizeKeyword(keyword));
-}
+interface KeywordExclusionsConfig {
+  exact?: unknown;
+  prefix?: unknown;
+  regex?: unknown;
+}
+
+const EXACT_SET = buildExactExclusionSet();
+const PREFIX_LIST = buildPrefixExclusionList();
+const REGEX_LIST = buildRegexExclusionList();
+
+export function isExcludedKeyword(keyword: string): boolean {
+  const norm = normalizeKeyword(keyword);
+  if (EXACT_SET.has(norm)) return true;
+  if (PREFIX_LIST.some((p) => norm.startsWith(p))) return true;
+  if (REGEX_LIST.some((r) => r.test(norm))) return true;
+  return false;
+}
```

**기대**: `"claude models"`, `"ai agent framework update"` 등 exact 로 못 잡는 변이를 prefix 로 간단 차단.

#### 2.9.2 Policy delta 계수 축소 (`ranking_policy.ts:329-359`)

```diff
-  if (meta.keywordKind === "incident") delta += 0.08;
-  if (meta.keywordKind === "feature_event") delta += 0.06;
-  if (meta.keywordKind === "version_release") delta += 0.01;
-  if (meta.versionKind === "major") delta += 0.04;
-  if (meta.versionKind === "patch") delta -= 0.06;
-  if (meta.versionKind === "build") delta -= 0.12;
+  if (meta.keywordKind === "incident") delta += 0.02;
+  if (meta.keywordKind === "feature_event") delta += 0.02;
+  if (meta.keywordKind === "version_release") delta += 0.005;
+  if (meta.versionKind === "major") delta += 0.01;
+  if (meta.versionKind === "patch") delta -= 0.02;
+  if (meta.versionKind === "build") delta -= 0.04;
```

**기대**: 자연 점수 스케일(0~1)과 delta 스케일을 정합. patch/build 릴리스가 완전히 제거되지 않고 "낮은 순위로" 내려가는 자연스러운 분포가 만들어짐.

#### 2.9.3 Manual priority를 slot-reserve 로 (`manual_priority.ts`)

```diff
-export function createManualRankedItem(mode, manual, options): RankedKeywordWithDelta {
-  return {
-    rank: 0, deltaRank: 0, isNew: true,
-    keyword: /* empty candidates */,
-    score: { recency:1, frequency:1, authority:1, velocity:1, engagement:1,
-             internal: options.internalBonus,
-             total: parseFloat((10 + options.totalBonus).toFixed(4)) },
-  };
-}
+export function createManualRankedItemV2(
+  mode, manual, ctx: { totalAnchor: number }
+): RankedKeywordWithDelta {
+  // anchor total: Top3~5 평균값 근처로 고정 → 자연 점수대와 비교 가능
+  const anchored = Math.max(0.20, Math.min(0.50, ctx.totalAnchor));
+  return {
+    rank: 0, deltaRank: 0, isNew: true,
+    keyword: /* candidates 기본값 */,
+    score: { recency:0, frequency:0, authority:1.0,
+             velocity:0, engagement:0, internal: 0,
+             total: parseFloat(anchored.toFixed(4)) },
+  };
+}
```

#### 2.9.4 Dynamic query 에 KO baseline 추가 (`dynamic_query.ts:3-6`)

```diff
-const BASE_TERMS = [
-  "AI", "LLM", "GPT", "Claude", "Gemini",
-  "OpenAI", "Anthropic", "DeepSeek",
-];
+const BASE_TERMS_EN = [
+  "AI", "LLM", "GPT", "Claude", "Gemini",
+  "OpenAI", "Anthropic", "DeepSeek",
+];
+const BASE_TERMS_KO = [
+  "인공지능", "생성형 AI", "바이브 코딩", "오픈AI", "앤트로픽",
+];
+const BASE_TERMS = [...BASE_TERMS_EN, ...BASE_TERMS_KO];
```

**기대**: GDELT broad 쿼리에 한국어 OR term이 포함 → 한국어 매체 히트율 상승.

#### 2.9.5 Velocity 음수 허용 후 compress (`scoring.ts:100-105`)

```diff
-  const ratio = (recentCount + 1) / (baselinePerRecentWindow + 1);
-  const centered = (ratio - 1) / (ratio + 1); // -1..1
-  return Math.max(0, Math.min(1, centered));
+  const ratio = (recentCount + 1) / (baselinePerRecentWindow + 1);
+  const centered = (ratio - 1) / (ratio + 1); // -1..1
+  // 침체(-)도 부드럽게 반영: [-1,1] → [0,1] 로 shift
+  return Math.max(0, Math.min(1, (centered + 1) / 2));
```

**기대**: 완전히 식은 키워드 velocity=0, 중립=0.5, 폭발=1.0 의 연속 스케일. clamp 절벽 제거.

#### 2.9.6 Candidate 에 languageBy domain 추가 (`keywords.ts` 예시)

```diff
 export interface KeywordCandidates {
   text: string;
   count: number;
   domains: Set<string>;
+  domainsByLang: { ko: Set<string>; en: Set<string> };
   matchedItems: Set<number>;
   latestAt: Date;
   tier: Tier;
   domainBonus: number;
   authorityOverride: number;
+  stars7dDelta?: number;
+  phUpvoteRate?: number;
+  snsMentionCount?: number;
 }
```

---

## 3. 바이브코딩/AI 도메인 부스팅 시그널 추가안

### 3.1 추가 제안 시그널 (우선순위 고)

| # | 신호 | 정의 | 데이터 소스 | 정규화 | 기대 효과 |
|---|---|---|---|---|---|
| S1 | **github_stars_7d_delta** | 매칭된 리포의 7일 stars 증가량 | GitHub REST `repos/{owner}/{repo}` + history. 현재 `github_releases_source` 미활용 | `log10(Δ+1)/4` | 신규 AI 도구의 화제성 직접 반영 |
| S2 | **ph_upvote_velocity** | Product Hunt 게시물의 24h upvote rate | `product_hunt_top_source` 의 engagement 로 이미 수집 중 | `log10(rate+1)/3` | 바이브코딩 프로덕트 신선도 |
| S3 | **sns_mention_rate** | X(Twitter) + Threads 검색 결과 24h 포스트 수 (Subtask C 와 정합) | X API v2 count (또는 nitter RSS), Threads search scrape | `log10(count+1)/4` | 실시간 입소문 신호 |
| S4 | **korean_media_boost** | 매칭 도메인 중 KO 매체 비율 > 0.2 면 `+0.05` 가산 | RssItem.lang 또는 domain 화이트리스트 | 이진 조건 | 한국 사용자 만족도 |
| S5 | **cluster_coverage** | 같은 keyword 의 aliases 에 속한 원문 기사 수 (`matchedItems`) | 기존 `candidates.matchedItems` | `min(1, count/8)` | 실제 보도량을 frequency 보완 |
| S6 | **language_balance_penalty** | 매칭 소스가 한 언어에 95% 이상 집중 시 `-0.04` | RssItem.lang | 이진 조건 | 영문/한국어 균형 유도 |

### 3.2 한국어 매체 가중치 정책 (의사코드)

```ts
// 신규 계산: candidates.languageStats = { ko: 2, en: 7 }
const total = stats.ko + stats.en;
const koRatio = total > 0 ? stats.ko / total : 0;

const koreanBoost = koRatio >= 0.2 ? 0.05 : 0;
// 영문 95% 이상 → 한국 사용자 관점에서 축소
const languageBalancePenalty = koRatio < 0.05 && total >= 3 ? -0.04 : 0;

internal += koreanBoost + languageBalancePenalty;
```

### 3.3 키워드 표제어 정규화 (의사코드)

```ts
// 현재: candidates.text 를 그대로 keywordId 로 사용 (keywords.ts)
// 제안: 모델/제품 별 정규 표제어 표(aliases_table)로 합치기

interface CanonicalKeyword {
  canonical: string;             // "Claude Opus 4.7"
  aliases: string[];             // ["claude 4.7", "claude opus 4.7", "anthropic claude 4.7"]
  kind: "model" | "product" | "company" | "framework";
  version?: string;              // "4.7"
}

// 매칭 단계에서 aliases 중 하나라도 히트하면 canonical 로 병합
function mergeByAlias(keywords: NormalizedKeyword[], table: CanonicalKeyword[]): NormalizedKeyword[] {
  const merged = new Map<string, NormalizedKeyword>();
  for (const kw of keywords) {
    const canonical = findCanonical(kw.keyword, table);
    const key = canonical?.canonical ?? kw.keyword;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...kw, keywordId: slug(key), keyword: key });
    } else {
      // candidates 통합: domains, matchedItems, count 합집합
      mergeCandidates(existing.candidates, kw.candidates);
    }
  }
  return [...merged.values()];
}
```

### 3.4 버전 family 개선 (기존 로직 확장)

현재 `ranking_policy.ts:361-421` 의 `suppressVersionFamilyDuplicates` 는 버전 표기 차이만 묶음. 다음을 추가 권고:

1. **동의어 family 추가**: `{canonical: "Claude Code", aliases: ["claude-code", "Claude Code CLI", "Anthropic Claude Code"]}` 같은 외부 표 기반.
2. **ko/en family 병합**: `"OpenAI Codex"` + `"오픈AI 코덱스"` → 동일 family (locale 매핑).
3. **Family 대표 선정**: 현재는 total 최대값 1개 + feature_event 있으면 version_only 전부 제거. 제안: **feature_event 중에서도 authority 높은 것 1개 + 대표 version 1개** 유지 (2개 슬롯).

---

## 4. 개선된 점수 모델 의사코드

### 4.1 가중치 표 (제안값)

| 축 | 기존 | 제안 | 변화 이유 |
|---|---|---|---|
| recency | 0.28 | **0.22** | 단기 신선도 다소 완화 |
| frequency | 0.12 | **0.10** | cluster_coverage 로 일부 대체 |
| authority | 0.08 | **0.10** | P0 매체 및 KO authority override 반영 여유 |
| velocity | 0.30 | **0.22** | vibe 축 신설로 분산 |
| engagement | 0.22 | **0.14** | 뉴스/SNS 분리 후 비중 낮춤 |
| **vibe (신규)** | — | **0.14** | GitHub Δstars + PH upvote velocity + SNS mention rate 정규화 합 |
| **language (신규)** | — | **0.04** | KO 매체 보정 |
| internal (delta만) | 0 | 0 (additive) | 기존 유지 |
| **합계** | 1.00 | 0.96 (delta 여유 0.04) | — |

> **주의**: 가중치 합을 1.00 미만으로 두어 **delta 공간(internal)을 최대 0.04**로 제한 → manual bonus=16 같은 overshoot 억제.

### 4.2 신모델 점수 산식 (의사코드)

```ts
interface Candidates {
  matchedItems: Set<number>;
  domains: Set<string>;
  domainBonus: number;
  tier: Tier;
  authorityOverride: number;
  latestAt: Date;
  // 신규:
  domainsByLang: { ko: Set<string>; en: Set<string> };
  stars7dDelta?: number;       // GitHub API 연동 시
  phUpvoteRate?: number;       // Product Hunt 24h rate
  snsMentionCount?: number;    // X/Threads 24h
  releaseLatestAtUtc?: Date;   // 최신 릴리스 태그 시각
}

function calculateScoreV2(kw: NormalizedKeyword, ctx: ScoringCtxV2): ScoreBreakdownV2 {
  // 1) recency: 반감기 12h (기존 9h 대비 완화)
  const recency = 0.5 ** ((ctx.now - kw.candidates.latestAt) / hoursToMs(12));

  // 2) frequency: clusterCoverage 로 대체 (matchedItems)
  const frequency = Math.min(1, (kw.candidates.matchedItems.size + kw.candidates.domainBonus) / 10);

  // 3) authority: 기존 + KO P0 override
  const baseAuth = Math.max(TIER_AUTHORITY[kw.candidates.tier] ?? 0.2, kw.candidates.authorityOverride);
  const authority = Math.min(1, baseAuth + languageAuthorityBoost(kw));

  // 4) velocity: 구간 확장 8h/24h, 음수 허용 후 compress
  const velocity = calculateVelocityScoreV2(kw, ctx.items, {
    recentWindowH: 8,
    baselineWindowH: 24,
    allowNegative: true,
  });

  // 5) engagement: log scale 재조정 (upvotes 별 가중)
  const engagement = calculateEngagementV2(kw, ctx.items);

  // 6) vibe (신규): GitHub + PH + SNS
  const vibe = calculateVibeScore(kw);

  // 7) language (신규): KO balance
  const language = calculateLanguageScore(kw);

  // 8) total = Σ weights (internal 은 별도 delta 로 누적)
  const total =
    recency     * 0.22 +
    frequency   * 0.10 +
    authority   * 0.10 +
    velocity    * 0.22 +
    engagement  * 0.14 +
    vibe        * 0.14 +
    language    * 0.04;

  return { recency, frequency, authority, velocity, engagement, vibe, language, total };
}

function calculateVibeScore(kw: NormalizedKeyword): number {
  const starsNorm = log10Norm(kw.candidates.stars7dDelta ?? 0, 5_000);   // 5k/week 상한
  const phNorm    = log10Norm(kw.candidates.phUpvoteRate ?? 0, 500);    // 500/day
  const snsNorm   = log10Norm(kw.candidates.snsMentionCount ?? 0, 10_000); // 10k/day
  // 신호 없음 → 기본 0.10 (페널티는 아님, 평균화 안 함)
  const present = [starsNorm, phNorm, snsNorm].filter((v) => v > 0);
  if (present.length === 0) return 0.10;
  // 최댓값 기반 (OR 결합), 평균 기반(AND)은 너무 가혹
  return Math.max(...present);
}

function calculateLanguageScore(kw: NormalizedKeyword): number {
  const { ko, en } = kw.candidates.domainsByLang;
  const total = ko.size + en.size;
  if (total === 0) return 0.5;  // 중립
  const koRatio = ko.size / total;
  // KO 20%+ 이면 1.0, 완전 영문이면 0.3 (한국 사용자 기준)
  if (koRatio >= 0.2) return 1.0;
  if (koRatio >= 0.05) return 0.7;
  return 0.3;
}
```

### 4.3 Delta 레이어 제안 (기존 유지 + 축소)

| Delta | 기존 | 제안 | 이유 |
|---|---|---|---|
| policy_delta | +0.08 / +0.06 / +0.04 / -0.04 / -0.06 / -0.12 | +0.02 / +0.02 / +0.01 / -0.01 / -0.02 / -0.04 | 기본 weight 0.96 → delta는 ±0.04 범위로 축소 |
| stability_delta | +0.04 / +0.03 / -0.05 | +0.01 / +0.01 / -0.02 | 기득권 편향 완화. 신규 strongBreakout 보상은 유지 |
| manual_delta (additive) | +6 | 폐지 → **slot-reserve** | §4.4 참조 |

### 4.4 Manual Priority 재설계 (Slot Reserve)

```ts
interface ManualSlotConfig {
  maxSlots: number;             // 예: 3
  allowMissingSources: boolean; // false: 실제 소스 없이는 삽입 안 함
  requireMinTotalScore: number; // 예: 0.35
}

// 기존 createManualRankedItem(total=16) 폐지
// 변경: 정상 랭킹 후, 수동 키워드를 상위 N 슬롯에 "interleave"
function reserveManualSlots(
  ranked: RankedKeyword[],
  manualKeywords: ManualKeyword[],
  cfg: ManualSlotConfig,
): RankedKeyword[] {
  const matched = ranked.filter((r) => manualByLookup(r, manualKeywords));
  const unmatched = manualKeywords.filter(
    (m) => !matched.some((r) => matchesLookup(r, m))
  );

  const output: RankedKeyword[] = [...ranked];
  let inserted = 0;
  for (const m of unmatched) {
    if (inserted >= cfg.maxSlots) break;
    if (!cfg.allowMissingSources && !hasAnySource(m)) continue;
    const placeholder = createManualRankedItemV2(m, {
      // total = 실제 유기 점수 중 rank N의 score 와 동률 근처 (slot만 보장)
      totalAnchor: ranked[Math.min(ranked.length - 1, 2)].score.total,
    });
    output.splice(inserted, 0, placeholder);
    inserted += 1;
  }

  // 나머지는 유기 정렬 유지
  return output.slice(0, cfg.maxSlots + 10 /* Top10~20 */);
}
```

**효과**: manual 키워드는 **최대 3개 슬롯만** 차지, 그 외 Top 10 슬롯은 유기 랭킹이 결정. 총점 인플레이션 제거.

---

## 5. 회귀 검증용 테스트 시나리오 5개

각 시나리오는 `rankKeywords()` + 신규 delta 체인 + slot-reserve 결과를 기대치와 비교한다. `ranking_policy.test.ts`, `scoring.test.ts` 패턴 따라 `node:test` + `assert` 로 구현 가능.

### 5.1 시나리오 A — 한국어 매체 부스팅

**입력**
- 키워드 X: 도메인 4개 (`techcrunch.com`, `theverge.com`, `venturebeat.com`, `engadget.com`), P1, recency=0.8, velocity=0.4, engagement=0.2, vibe=0.3, lang_ko_ratio=0
- 키워드 Y: 도메인 3개 (`techcrunch.com`, `zdnet.co.kr`, `bloter.net`), P1, recency=0.75, velocity=0.35, engagement=0.2, vibe=0.3, lang_ko_ratio=0.67

**기대**
- 현 모델: X > Y (frequency & recency 우위)
- 신 모델: **Y > X** (language=1.0 vs 0.3, 가중치 0.04 → +0.028 차이가 dead heat 에서 Y를 위로 끌어올림)
- Assertion: `score(Y).language === 1.0 && score(Y).total > score(X).total`

### 5.2 시나리오 B — 버전 릴리스 트레인 억제

**입력**
- 키워드들: `vercel ai 6.0.140`, `vercel ai 6.0.141`, `vercel ai memory import` (같은 repo family)
- 점수: 모두 total=0.40 근처

**기대**
- `feature_event` 인 `memory import` 만 남고 버전 two개는 제거.
- Assertion: `filtered.length === 1 && filtered[0].keyword.keywordId === "vercel_ai_memory_import"`
- (기존 테스트 `ranking_policy.test.ts:134-172` 와 동일 패턴, family 확장 후 회귀 확인)

### 5.3 시나리오 C — GitHub stars 폭증 이벤트

**입력**
- 키워드 Z: 도메인 2개, recency=0.9, velocity=0.1, engagement=0.1, **stars7dDelta=3,500** (신규 bootstrap 프레임워크)
- 키워드 W: 도메인 5개, recency=0.7, velocity=0.4, engagement=0.3, stars7dDelta=0

**기대**
- 신 모델: Z 가 vibe=max(log10(3501)/... ≈ 0.71) 로 W 를 역전
- Assertion: `score(Z).vibe >= 0.7 && score(Z).total > score(W).total`

### 5.4 시나리오 D — Echo chamber 방지 (stability delta)

**입력**
- 키워드 A: 지난 3회 모두 Top5 (appearances=3, previousRank=3), 현재 recency=0.3, velocity=0.05
- 키워드 B: 신규 (appearances=0), recency=0.95, velocity=0.6, domains=4

**기대**
- 현 모델: A stability +0.07 누적으로 근소 잔존 가능
- 신 모델: A stability +0.02, stale 조건 -0.02 → 사실상 중립; B 의 자연 total 이 더 높아 상위 유지
- Assertion: `finalRanked[0].keyword.keywordId === "B"`

### 5.5 시나리오 E — Manual slot reserve

**입력**
- 활성 manual keywords: `["Cursor Composer", "Claude Code", "Next.js 16"]`
- 랭킹 후보 Top15 중 `Cursor Composer` 는 자연 점수 0.55 (rank 4 위치), 나머지 2개는 소스 없음
- `ManualSlotConfig = {maxSlots: 3, allowMissingSources: false, requireMinTotalScore: 0.35}`

**기대**
- 신 모델:
  - `Cursor Composer` 는 자연 rank 4 유지 (또는 slot 1 로 승격, boost는 없음)
  - `Claude Code`, `Next.js 16` 은 소스 0개이므로 **삽입 안 됨** (현재 로직에서는 total=16으로 무조건 삽입되던 것 대비 개선)
- Assertion: `finalRanked.filter(r => isManual(r)).length === 1 && finalRanked[0].score.total < 1.0`

---

## 6. 부가 권고 (스코프 외 메모)

| # | 권고 | 난이도 | 이유 |
|---|---|---|---|
| 6.1 | `keyword_exclusions.json` 을 `exact` + `prefix` + `regex` 3단 구조로 확장 | 하 | 현재 exact 리스트만으로는 우회 쉬움 (§2.3.3) |
| 6.2 | `dynamic_query.BASE_TERMS` 에 한국어 baseline 추가 (`"AI","인공지능","바이브 코딩","코딩","모델"`) | 하 | 한국어 수집량을 구조적으로 끌어올림 |
| 6.3 | `rankKeywords()` 에서 `sourceItems` 를 파라미터로 넘기는데, **매 호출마다 O(N*M)** 탐색이 발생. keyword → index 매핑 캐싱 | 중 | `snapshot.ts:854-858` 대량 키워드 시 성능 이슈 |
| 6.4 | `ranking_candidate_debug.internal_reason` 에 `vibe_signal` / `language_score` / `cluster_coverage` 추가 필드 제공 | 하 | 시뮬레이터/관리자 툴에서 디버깅 용이 |
| 6.5 | Manual priority DB 테이블에 `slot_priority: int` 컬럼 추가 → 삽입 순서 제어 | 중 | 다중 수동 키워드 간 우선순위 제어 |
| 6.6 | stability_delta 가 `recentSnapshotIds` 기반으로 계산되지만 스냅샷 주기(6시간)가 KST 기준 4회 → appearances 상한은 실질 4. 현재 `min(0.03, (apps-1)*0.01)` 상한 0.03 은 OK. 다만 `appearances` 기준을 **distinct slot** 이 아닌 **같은 rank 유지**로 바꾸면 질 ↑ | 중 | `ranking_policy.ts:450-453` |

---

## 7. 근거 인용 (file:line)

- `src/lib/pipeline/scoring.ts:15-22` — DEFAULT_WEIGHTS (recency 0.28, frequency 0.12, authority 0.08, velocity 0.30, engagement 0.22, internal 0.0)
- `src/lib/pipeline/scoring.ts:32-36` — DEFAULT_PROFILE (halfLife 9h, velocity 6h/18h)
- `src/lib/pipeline/scoring.ts:40-45` — TIER_AUTHORITY (P0 1.0, P1 0.6, P2 0.3, COMMUNITY 0.2)
- `src/lib/pipeline/scoring.ts:70-105` — calculateVelocityScore (recent6h+baseline18h, centered formula, max(0,...))
- `src/lib/pipeline/scoring.ts:110-133` — calculateEngagementScore (log10 기반, comments×2)
- `src/lib/pipeline/scoring.ts:135-209` — calculateScore 본체 및 total 계산
- `src/lib/pipeline/scoring.ts:219-246` — rankKeywords (limit slice, rank 재부여)
- `src/lib/pipeline/ranking_policy.ts:25-40` — MINOR_VARIANT_WORDS
- `src/lib/pipeline/ranking_policy.ts:42-55` — FRAMEWORK_SUFFIXES
- `src/lib/pipeline/ranking_policy.ts:57-74` — FAMILY_TRAILING_NOISE
- `src/lib/pipeline/ranking_policy.ts:76-103` — INCIDENT_HINTS (incident 판정)
- `src/lib/pipeline/ranking_policy.ts:105-139` — FEATURE_HINTS (feature_event 판정)
- `src/lib/pipeline/ranking_policy.ts:256-275` — classifyVersionKind (build/patch/minor/major)
- `src/lib/pipeline/ranking_policy.ts:329-359` — calculateKeywordPolicyDelta (±0.04~0.12)
- `src/lib/pipeline/ranking_policy.ts:361-421` — suppressVersionFamilyDuplicates
- `src/lib/pipeline/ranking_policy.ts:423-464` — calculateStabilityDelta (+0.04 기존 Top10, +0.03 appearances, -0.05 stale)
- `src/lib/pipeline/manual_priority.ts:38-76` — createManualRankedItem (total=10+totalBonus)
- `src/lib/pipeline/manual_priority.ts:78-92` — applyInternalDelta (total 1:1 가산)
- `src/lib/pipeline/manual_priority.ts:94-186` — applyManualKeywordPriority (slot prepend 로직)
- `src/lib/pipeline/dynamic_query.ts:3-6` — BASE_TERMS 영문 8종
- `src/lib/pipeline/dynamic_query.ts:13-53` — buildDynamicQuery (2회 이상 제외 정책)
- `src/lib/pipeline/snapshot.ts:104-115` — MANUAL_KEYWORD_TOTAL_BONUS=6, INTERNAL_BONUS=3
- `src/lib/pipeline/snapshot.ts:196-203` — DEFAULT_SCORING_WEIGHTS
- `src/lib/pipeline/snapshot.ts:205-261` — resolveRuntimeProfile (DB weights load + fallback)
- `src/lib/pipeline/snapshot.ts:853-925` — 랭킹 4단 파이프라인 (score → policy → dedupe → stability)
- `src/lib/pipeline/snapshot.ts:926-946` — applyManualKeywordPriority + finalRanked slice
- `src/lib/pipeline/ranking_candidate_debug.ts:27-52` — calculateFixedCandidateBonus (delta 역산)
- `src/lib/pipeline/ranking_candidate_debug.ts:54-82` — buildRankingCandidateDebug (reasons 조합)
- `src/lib/pipeline/keyword_exclusions.ts:11-27` — exact 기반 buildExactExclusionSet / isExactlyExcludedKeyword
- `src/config/keyword-exclusions.json:1-223` — 222개 exact 제외 키워드 (브랜드/범용/한국어)
- `src/lib/pipeline/ranking_policy.test.ts:53-207` — 기존 회귀 테스트 케이스 (version kind, policy map, policy delta, dedupe, stability)
- `src/lib/pipeline/scoring.test.ts:28-43` — frequency/authority override 테스트

---

## 8. 미해결 질문

1. **실제 수집 피드 중 한국어 매체 비중**: Subtask A (source catalog) 결과 확인 후 §2.1.5 추정치를 정량 수치로 대체 필요.
2. **`PIPELINE_REALTIME_*` 환경변수 운영 기본값**: `snapshot.ts:206-244` 에서 env 우선. 프로덕션 Vercel 설정 실제값을 확인해야 (a) recencyHalfLife 9h 가 정말 적용 중인지 (b) 관리자 UI 로 조정된 DB weights 가 dominant 인지 검증 가능.
3. **`getRankingWeights()` 관리자 조정 UI 스펙**: DB에서 weights 를 읽어오는 구조는 있으나(`snapshot.ts:212-222`), 관리자가 웹에서 어떻게 수정하는지 경로 미확인. 수정 권한 / 감사 로그 / rollback 정책 명확화 필요.
4. **X/Threads 언급량 취득 가능성**: Subtask C 보고서에서 SNS 통합 전략이 정해지면, vibe 축의 `sns_mention_rate` 가 실제 신호로 구현 가능한지 확정. (현 상황에서 X API 유료·Threads 공식 API 제한적일 가능성)
5. **GitHub stars Δ7d**: 매 스냅샷마다 N개 리포에 대해 stars history 를 가져오려면 rate limit 와 캐시 전략 필요. `github_releases_source` 연장으로 가능한지 별도 검토.
6. **Keyword canonical 테이블의 소스**: 제안한 `CanonicalKeyword[]` 를 누가 관리하나? (a) 정적 JSON (b) 관리자 UI (c) LLM 자동 클러스터링 — 초기 MVP 는 (a) 를 추천하지만 운영 규모 확대 시 (c) 혼합이 합리적. 의사결정 필요.
7. **Stability delta 와 dynamic_query 의 전략 충돌 해소**: 수집은 "2회 이상 등장 제외" vs 랭킹은 "기존 Top10 부스팅". 두 정책을 같은 목적함수 아래 재정렬하려면 product-level 정책 방향(신선함 ↔ 안정감) 결정 필요.
8. **Manual slot 기본값**: `maxSlots=3` 을 제안했으나, 편집자 워크플로우·가이드라인이 미공유. 운영팀 인터뷰 후 확정 권고.

---

## 9. 변경 범위 추정 (코드 레벨, 권고일 뿐 실행 금지)

| 변경 | 파일 | 예상 diff 규모 |
|---|---|---|
| `ScoreWeights` 에 vibe/language 축 추가, 기본 weight 재조정 | `scoring.ts` | +40 ~60 줄 |
| `calculateVibeScore` / `calculateLanguageScore` 신규 함수 | `scoring.ts` | +80줄 |
| `candidates` 타입에 `stars7dDelta`, `domainsByLang`, `phUpvoteRate`, `snsMentionCount` 필드 | `keywords.ts` | +20줄 + 채워넣는 수집 로직 |
| delta 축소 (정책/안정 delta 계수 1/3~1/4) | `ranking_policy.ts` | 기존 상수 수정 10~15곳 |
| Manual priority 를 slot-reserve 로 전환, `createManualRankedItem` 제거 | `manual_priority.ts`, `snapshot.ts` | ~80줄 재작성 |
| `keyword_exclusions.json` 에 `prefix`/`regex` 지원 | `keyword_exclusions.ts` | +30줄 |
| `dynamic_query.BASE_TERMS` 한국어 baseline 추가 + env 기반 override | `dynamic_query.ts` | +10줄 |
| 회귀 테스트 시나리오 A~E 추가 | `scoring.test.ts`, `ranking_policy.test.ts` | +200줄 |
| DB 스키마: `candidates` 메타를 `snapshot_candidates` 에 보존 (디버깅) | migration | 컬럼 3~4개 |

**실구현 권장 순서**: (1) `prefix/regex exclusions` → (2) `language score` (즉시 체감) → (3) `vibe score (PH upvote 부터)` → (4) `slot-reserve manual` → (5) `canonical aliases` → (6) delta 계수 튜닝 → (7) 회귀 테스트 추가.

---

## 10. 권고별 영향도 매트릭스

각 권고가 (a) 사용자 만족, (b) 바이브코딩 적합성, (c) 구현 난이도, (d) 회귀 위험에 미치는 예상 영향을 정량화한다. 척도: 1(낮음) ~ 5(높음).

| # | 권고 | 사용자 만족 | 바이브 적합성 | 구현 난이도 | 회귀 위험 | 우선순위 |
|---|---|---|---|---|---|---|
| R1 | `keyword_exclusions` 에 prefix/regex 지원 | 3 | 2 | 2 | 1 | P0 (즉시) |
| R2 | `language` 점수축 신설 + KO 매체 화이트리스트 | **5** | 3 | 3 | 2 | P0 |
| R3 | `vibe` 점수축 (PH upvote rate 먼저) | 4 | **5** | 3 | 2 | P0 |
| R4 | Manual priority slot-reserve 전환 | 4 | 2 | 4 | **3** | P1 |
| R5 | Canonical alias 테이블 도입 | 3 | 3 | 4 | **4** | P2 |
| R6 | GitHub stars Δ7d 수집·반영 | 3 | **5** | 4 | 2 | P1 |
| R7 | SNS mention rate (X/Threads) 반영 | 4 | **5** | **5** | 3 | P2 |
| R8 | 정책 delta 계수 축소 (±0.08 → ±0.02) | 3 | 3 | 1 | 2 | P0 |
| R9 | Stability delta 축소 + stale 기준 재정의 | 3 | 3 | 2 | 2 | P0 |
| R10 | `dynamic_query` 한국어 baseline 확장 | 4 | 2 | 1 | 1 | P0 |
| R11 | `ranking_candidate_debug` 확장(vibe/language 필드) | 2 | 2 | 1 | 1 | P1 |
| R12 | Velocity 구간 8h/24h + 음수 허용 (compress) | 3 | 3 | 2 | 3 | P1 |

**종합 권고**: P0 5개 패키지를 1~2스프린트 내 배포 → P1 4개 → P2 3개 순.

---

## 11. 경쟁 제품 벤치마크 (비교 컬럼)

바이브코딩 사용자가 실제로 보는 "경쟁 서비스"가 신호를 어떻게 다루는지 대조.

| 서비스 | 신선도 | 빈도 | 권위 | 속도/트렌드 | 커뮤니티 | 바이브 신호 | KO 지원 |
|---|---|---|---|---|---|---|---|
| **본 서비스 (현)** | ✅ 9h 반감기 | ✅ uniqueDomain | ⚠️ tier 4단 | ✅ centered velocity | ⚠️ upvotes log | ❌ 미분리 | ⚠️ 번역만 |
| **본 서비스 (제안)** | ✅ 12h 반감기 | ✅ cluster coverage | ✅ tier + lang override | ✅ 8h/24h + 음수 | ✅ log + comments x2 | ✅ vibe 축 | ✅ language 축 |
| Hacker News | ❌ (자동 감쇠) | — | — | ✅ score vs age | ✅ upvotes | ❌ | ❌ |
| Product Hunt | ✅ 24h 슬롯 | — | ❌ | ✅ daily upvote | ✅ upvotes/comments | △ 간접 | ❌ |
| GitHub Trending | ❌ | ⚠️ today only | — | ✅ stars/day | ❌ | ✅ stars | ❌ |
| GeekNews (KR) | ✅ 24h | — | — | ⚠️ 수동 큐레이션 | ✅ votes | ❌ | ✅ |
| Google Trends | ✅ | — | — | ✅ relative index | ❌ | ❌ | ✅ |
| X/Threads Trending | ✅ (분 단위) | — | ❌ | ✅ mention rate | ✅ engagement | ✅ | ✅ |

**관전 포인트**
- 본 서비스의 구조는 HN + Product Hunt + GitHub Trending 의 **장점을 일부 합친 형태**. 다만 각각의 "고유 신호"가 엔진에 1:1 로 맞물리지 못하고 engagement 한 축에 뭉뚱그려져 신호가 희석됨.
- 한국 사용자를 위한 실질적 경쟁자는 **GeekNews + Twitter KR + Product Hunt**. KO 매체가 모자란 상태에서 GeekNews 와 경쟁하려면 §3.2 의 KO boost 가 필수.

---

## 12. 실측 시그널 해석 예시 (가상 데이터)

아래 세 키워드의 가상 스냅샷을 통해 **현 모델 vs 신 모델**의 차이를 보여준다. 모든 수치는 2026-04-22 14:00 KST 기준 추정.

### 12.1 Case A — "Cursor Composer 2"

| 축 | 입력 (가상) | 현 모델 점수 | 신 모델 점수 | 주석 |
|---|---|---|---|---|
| latestAt | 2h 전 | recency=0.86 | recency=0.89 (12h half) | 완화된 감쇠로 약간 상승 |
| domains | 4 (producthunt.com, techcrunch.com, zdnet.co.kr, news1.kr) | freq=0.4 | freq (match=8) → 0.8 | cluster coverage 반영 |
| tier | P1 | auth=0.6 | auth=0.6 | 동일 |
| velocity | recent=4, baseline=3 (ratio ~1.6) | vel=0.23 | vel (8/24h) ~0.25 | 소폭 상승 |
| engagement | PH upvote 480, HN 120 | eng=0.74 | eng=0.70 | 축 분리로 다소 하락 |
| vibe | PH 480/day, stars7dΔ 280 | — | vibe=max(0.54, 0.39, 0) = 0.54 | 신규 |
| language | ko/(ko+en)=2/4 | — | lang=1.0 | KO 매체 2개 |
| **total (Σw)** | — | `0.28*0.86+0.12*0.4+0.08*0.6+0.30*0.23+0.22*0.74 = 0.535` | `0.22*0.89+0.10*0.8+0.10*0.6+0.22*0.25+0.14*0.70+0.14*0.54+0.04*1.0 = 0.625` | +17% |

### 12.2 Case B — "vercel/ai 6.0.141 (patch release)"

| 축 | 입력 (가상) | 현 모델 점수 | 신 모델 점수 | 주석 |
|---|---|---|---|---|
| latestAt | 4h | recency=0.74 | recency=0.79 | |
| domains | 1 (github.com) | freq=0.1 | freq=0.1 | |
| tier | P1_CONTEXT | auth=0.6 | auth=0.6 | |
| velocity | recent=1 | vel=0.0 | vel=0.0 | |
| engagement | 0 | eng=0.0 | eng=0.0 | |
| vibe | stars7dΔ 50 | — | vibe=0.14 | |
| language | 0 KO | — | lang=0.3 | |
| policy_delta | weakVersionOnly + patch = -0.04-0.06 | -0.10 | -0.02-0.01 = -0.03 | delta 축소 |
| **total** | — | `0.28*0.74+... = 0.255 - 0.10 = 0.155` | `0.22*0.79+...+vibe 0.14*0.14+lang 0.04*0.3 - 0.03 = 0.241` | 상대적으로는 개선 |

→ patch release 는 **여전히 상위엔 못 오르지만**, 과도한 -0.10 대신 -0.03 으로 순화되어 테스트 검증이 쉬워짐.

### 12.3 Case C — "Claude Code (stale incumbent)"

| 축 | 입력 (가상) | 현 모델 점수 | 신 모델 점수 | 주석 |
|---|---|---|---|---|
| latestAt | 30h | recency=0.10 | recency=0.18 | 12h half-life 확장 |
| domains | 3 | freq=0.3 | freq=0.3 | |
| tier | P0_CURATED | auth=1.0 | auth=1.0 | |
| velocity | recent=0, base=2 (ratio=1/3) | vel=0 (clamp) | vel=-0.20 → 0.0 (음수 허용 후 compress: 0.30) | §2.2.3 수정 |
| engagement | 0 | eng=0.0 | eng=0.0 | |
| vibe | stars7dΔ 10 | — | vibe=0.10 (기본) | |
| language | 2/3 KO | — | lang=1.0 | |
| stability_delta | Top10 3회 연속 (+0.04+0.03) | **+0.07** | +0.01+0.01 = **+0.02** | 축소 |
| stale_penalty | (recency<0.25, vel<0.08, eng<0.2 → -0.05) | **-0.05** | -0.02 | 축소 |
| **total** | — | `0.28*0.10+0.12*0.3+0.08*1.0+0+0 +0.07 -0.05 = 0.164` | `0.22*0.18+0.10*0.3+0.10*1.0+0.22*0.30+0.14*0+0.14*0.10+0.04*1.0 +0.02-0.02 = 0.293` | 겉보기 상승하나, **새로 뜨는 A/B 대비 낮아** 자연스럽게 탈락 |

---

## 13. Rollout 플랜 (권고)

### 13.1 단계별 전환

```
Phase 1 (즉시, 1 sprint)
  - R1 prefix/regex exclusions
  - R8 policy delta 계수 축소
  - R9 stability delta 축소
  - R10 KO baseline BASE_TERMS 확장
  → 테스트: ranking_policy.test.ts 기존 + 시나리오 D 추가

Phase 2 (2 sprint)
  - R2 language 점수축
  - R3 vibe 점수축 (PH upvote rate 먼저, GitHub stars 추후)
  - R11 debug 필드 확장
  → 테스트: 시나리오 A, E 추가

Phase 3 (3~4 sprint)
  - R4 manual slot-reserve
  - R6 GitHub stars Δ7d 수집 파이프라인
  - R12 velocity 구간/compress
  → 테스트: 시나리오 B, C 업데이트

Phase 4 (실험성, 별도 트랙)
  - R5 canonical alias (정적 JSON → 관리자 UI → LLM 클러스터링)
  - R7 SNS mention (X API v2 count endpoint + Threads scrape)
  → A/B 실험 필요
```

### 13.2 회귀 모니터링 지표

| 지표 | 수집 방법 | 임계치 | 알람 |
|---|---|---|---|
| Top10 교체율 (스냅샷 간) | `finalRanked.rank` diff | 30%~70% | <20% 또는 >80% 시 이상 |
| 한국어 매체 포함률 | `snapshot_candidates.is_korean` (신규 컬럼) | ≥ 25% | <15% |
| Manual 키워드 점유율 | slot-reserve 로직 로그 | ≤ 30% | >50% |
| Patch release 노출 빈도 | `policy_meta.version_kind === "patch"` 상위 5위 내 건수 | ≤ 1 | ≥ 3 |
| Vibe score 평균 (상위 10위) | `candidates.vibe` 집계 | ≥ 0.3 | <0.2 |

### 13.3 Feature Flag 제안

점진적 배포를 위해 아래 플래그로 on/off 제어:

```ts
// env: PIPELINE_RANKING_V2_ENABLED=true|false
// DB: ranking_weights 테이블에 w_vibe, w_language 컬럼 추가 후
//     NULL 이면 v1, 값 있으면 v2 로 분기

function resolveScoringVersion(weights: DbWeights): "v1" | "v2" {
  if (weights.w_vibe == null || weights.w_language == null) return "v1";
  return "v2";
}
```

---

## 14. 보안/운영 관점 체크리스트

| # | 항목 | 현 상태 | 권고 |
|---|---|---|---|
| 14.1 | DB `ranking_weights` 가 public 인가? | 미확인 | 관리자 전용 테이블로 격리, RLS (Neon) 또는 API 레이어에서 인증 필수 |
| 14.2 | Manual keywords 삽입이 audit log 남는가? | 미확인 | `manual_keywords_audit` 로그 테이블 권장 |
| 14.3 | `calculateFixedCandidateBonus` 는 delta 역산용이지만, weights 가 변경되면 과거 snapshot 의 bonus 재계산 불가능 | 설계상 한계 | weights 스냅샷별 보존 (`snapshot_meta.weights_json`) 권고 |
| 14.4 | `keyword_exclusions.json` 배포 시 cache invalidation | 빌드 시 포함 (정적 import) | runtime 재로드 불가. 긴급 제외는 재배포 필요 — DB 이관 검토 |
| 14.5 | LLM 기반 `naturalizeKeywordKo`/`classifyKeywordType` 호출 비용 | 매 신규 키워드마다 호출 | 캐싱/TTL + LLM 실패 fallback (원문 유지) 이미 구현됨 → OK |

---

## 15. 개선 전후 비교 체크리스트 (리뷰용)

사용자가 "개선됐나?"를 빠르게 검증할 수 있는 30초 체크리스트:

- [ ] Top10 중 한국어 매체 포함 키워드 ≥ 2개
- [ ] Top10 중 GitHub 리포 관련(stars 활발) 키워드 ≥ 2개
- [ ] Top10 중 SNS 활발(PH/X/HN 상위) 키워드 ≥ 2개
- [ ] Patch 버전(ex: x.y.z 형식)은 Top5 에 없음
- [ ] 24h 이상 정체된 기존 Top 키워드가 3스냅샷 연속 유지되지 않음
- [ ] Manual 키워드는 최대 3개만 상위 슬롯에 존재
- [ ] 같은 주제(예: "Claude 4.7") 의 변이 버전이 Top10 내 1개로 통합

---

## 16. 부록 — 점수 축 민감도 분석

현 모델의 각 축 가중치를 ±20% 이동했을 때 Top10 교체 비율 예측 (가상 실측 필요).

| 변화 | 기대 Top10 교체율 | 주 영향 키워드 유형 |
|---|---|---|
| `recency` +20% (0.28→0.336) | +15~25% | 2~4h 내 뜬 신규 뉴스 |
| `frequency` +20% (0.12→0.144) | +5~10% | GDELT broad 매칭 광범위 키워드 |
| `authority` +20% (0.08→0.096) | +3~8% | P0 매체 키워드 |
| `velocity` +20% (0.30→0.36) | +20~30% | HN/PH 급등 후보 |
| `engagement` +20% (0.22→0.264) | +10~20% | Reddit/HN 커뮤니티 핫 |
| `vibe` (신규 0.14) | — | GitHub/PH/SNS 시너지 |
| `language` (신규 0.04) | — | KO 매체 (edge case tie-break) |

> 이 표는 관리자 대시보드(슬라이더 UI)에서 "지금 가중치를 이렇게 바꾸면 Top10이 어떻게 변할지" 시뮬레이션해주는 기능(ranking simulator)의 기반이 될 수 있음. 기존 `insertSnapshotCandidates` 가 이미 후보 set을 저장하므로, offline re-scoring 만 구현하면 즉시 가능.

---

## 17. 부록 — 자주 묻는 질문 (FAQ)

**Q1. `internal` 가중치가 0인데 왜 internal delta 가 작동하나?**
A. `applyInternalDelta()` 가 `internal` 필드에 delta를 누적함과 **동시에** `total` 에도 1:1 로 가산한다(`manual_priority.ts:78-92`). 즉 internal 가중치는 표기상 존재하지만, 실제 runtime 에서는 우회. 제안된 신 모델에서는 `total = Σ(score_i * w_i) + Σdelta` 로 **명시적 분리** 를 권고한다.

**Q2. `domainBonus`, `authorityOverride` 는 어디서 채워지나?**
A. `keywords.ts`의 extraction 단계에서 도메인 매칭·tier 판정 시 할당. 본 감사에선 상세 분석은 생략했으나, KO 매체 화이트리스트 적용 시 `authorityOverride` 루트가 자연스러운 주입 지점.

**Q3. `dedupedRanked` 후 rank 가 재부여되는 시점은?**
A. 최종 `finalRanked` slice 단계(`snapshot.ts:935-946`). 그 이전의 rank는 candidate limit 내 임시값. 이 때문에 `getPreviousRanks` 조회는 `dedupedRanked.keywordId` 로 수행되어도, 최종 rank 재부여 후 `deltaRank` 를 다시 계산한다.

**Q4. `recentTopKeywordLists` 는 어디에 쓰이나?**
A. stability delta 계산에서 `appearances` / `previousRank` 산정용(`snapshot.ts:891-912`). 즉 "최근 N 스냅샷 Top10 내 등장 빈도". `dynamic_query` 의 echo chamber 방지와 전략적으로 충돌 가능성 있음 (§2.5.3).

**Q5. `velocityBaselineWindowHours=18` + recent 6h = 24h 인데 실제 스케줄은 6h 주기. 이게 맞나?**
A. 수집 윈도우(`fallbackHours=24`, `maxHours=96`)와 velocity 윈도우는 다른 개념. 수집은 "얼마나 과거까지 기사를 끌어올지", velocity는 "그 중 최근 6h 대 18h 비율". 둘이 일관되려면 velocity 도 운영 주기의 배수로 맞추는 편이 좋다(제안: 8h + 24h).

---

## 18. 근거 인용 (추가)

- `src/lib/pipeline/scoring.ts:211-246` — rankKeywords + scored.sort + slice
- `src/lib/pipeline/scoring.ts:250-261` — calculateDeltaRanks (isNew = prev===undefined)
- `src/lib/pipeline/manual_priority.ts:27-36` — keywordLookupKeys (aliases 정규화)
- `src/lib/pipeline/manual_priority.ts:140-180` — pushUnique / prioritized ordering
- `src/lib/pipeline/snapshot.ts:117-119` — clampNumber
- `src/lib/pipeline/snapshot.ts:121-126` — SourceWindowProfile
- `src/lib/pipeline/snapshot.ts:128-135` — PipelineRuntimeProfile (detailedKeywordLimit, allowExternalEnrichmentForNewKeywords)
- `src/lib/pipeline/snapshot.ts:142-153` — SOURCE_PLANS 순서(수집 우선순위 반영)
- `src/lib/pipeline/snapshot.ts:263-273` — buildSnapshotId (KST 기준)
- `src/lib/pipeline/snapshot.ts:276-293` — nextScheduledTime
- `src/lib/pipeline/snapshot.ts:810-830` — P0_CURATED 우선 URL dedup
- `src/lib/pipeline/snapshot.ts:840-851` — rankingLimit / candidateLimit 결정
- `src/lib/pipeline/snapshot.ts:954-990` — insertSnapshotCandidates (시뮬레이터용 저장)
- `src/lib/pipeline/ranking_policy.test.ts:14-51` — helper (buildSource, buildKeyword)
- `src/lib/pipeline/scoring.test.ts:7-26` — helper (buildKeyword defaults)

---

## 19. 요약 결론

현 점수·랭킹 엔진은 **구조적으로 잘 설계된 기본형**이다. 6축 + 3단 delta 레이어는 대부분의 실시간 트렌드 시스템이 도달하는 성숙도에 해당한다. 그러나 (A) **한국 바이브코딩 사용자**라는 타깃 관점에서 KO 매체와 SNS 신호가 직접 축에 반영되지 않아 만족도를 구조적으로 끌어올리기 어렵고, (B) Manual priority 가 자연 랭킹을 덮는 방식이라 실험·튜닝이 어려우며, (C) Family 기반 중복 억제가 의미적 동의어를 잡지 못해 Top10 슬롯이 자주 변이 버전에 낭비된다. 본 보고서의 **P0 5개 권고(R1, R2, R3, R8, R10)** 만 도입해도 사용자 만족 체감이 즉시 개선될 것으로 본다. P1/P2 권고는 신호 다양화 및 운영 자동화 측면에서 중장기 로드맵으로 배치할 것을 권한다.

---

*작성자: worker-2 / 2026-04-22 / Subtask B — 점수·랭킹 알고리즘 감사*
*보고서 총 라인 목표: 800~1500줄 (§ 1~19, 표 40+, 의사코드 8개, 시나리오 5개, 근거 인용 50+ 개)*
