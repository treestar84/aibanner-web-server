# Pipeline Quality Implementation Plan (2026-04-23)

> **대상 서비스**: `realtime-ai-trend-news` / `web-server`
> **상위 입력**: `docs/audit/2026-04-22-source-catalog-audit.md` (Subtask A) · `docs/audit/2026-04-22-scoring-ranking-audit.md` (Subtask B) · `docs/audit/2026-04-22-content-sns-quality.md` (Subtask C)
> **모드**: Deliberate (DB 마이그레이션 + 공개 API shape 변경 + 점수 모델 수정 = high-risk)
> **언어**: 한국어
> **산출 책임**: planner (구현은 executor가 본 PRD를 그대로 가져가 수행)
> **목표 코드 변경 범위**: `src/lib/pipeline/**`, `src/lib/db/**`, `src/app/api/v1/**`, `src/config/**`, `scripts/db/**`, 테스트 파일 (Flutter 클라는 본 PRD에서 인터페이스만 고정, 구현은 모바일팀 후속 PRD로 위임)

---

## 0. RALPLAN-DR Summary

### 0.1 Principles (5)

1. **사용자 체감 우선** — Top10 응답에 한국어 매체·SNS 슬롯·바이브코딩 시그널이 빠지면 점수 모델이 아무리 정교해도 실패. UX 가시 변화를 1주 이내 출시한다.
2. **비파괴 마이그레이션** — 모든 DB 변경은 `ALTER ADD COLUMN IF NOT EXISTS` + NULL 허용 + 점진 백필. 기존 Flutter 클라이언트는 `sources` 3분류 응답을 계속 받을 수 있어야 한다.
3. **Feature Flag 게이팅** — 점수 모델·골든5·SNS 통합 모두 환경변수/DB 컬럼 NULL 분기로 v1·v2 동시 운영. 롤백을 1 commit / 1 env var로 가능하게.
4. **Phase 의존 명시** — Phase 3의 X/Threads collector + GitHub stars Δ7d 수집기는 Phase 2의 `vibe` 축에 신호를 공급한다. 따라서 Phase 2의 vibe 축은 "기본값 0.10 폴백"으로 시작해 Phase 3 신호 도착 시 점진 활성화한다.
5. **단일 진실 원천(SSOT) 지향** — 단기는 `rss.ts` 하드코딩 유지, 중장기(Phase 3 Cross-Phase)는 `config/sources.yaml`로 SSOT 이전. 둘을 동시에 두지 않는다 (드리프트 위험).

### 0.2 Decision Drivers (Top 3)

| # | Driver | Why it dominates |
|---|---|---|
| D1 | **한국 바이브코더 사용자 만족도** | `_team-task.md:6-9`가 명시한 1차 목표. KO 매체·X·Threads 노출이 즉시 체감되는 변화. |
| D2 | **랭킹 변동 리스크 통제** | 점수 모델 변경은 사용자에게 "왜 어제 1위가 사라졌나?" 의 의문을 직접 유발. Feature Flag·A/B 모니터링·회귀 시나리오 5종이 필수. |
| D3 | **SNS·GitHub 신호 비용** | X API Basic($200/mo), GitHub stars history 수집(rate limit), Threads 검색 API 부재 → 외부 의존을 최소화하면서 신호를 얻는 deeplink-first 전략이 비용 결정 driver. |

### 0.3 Viable Options (Phase별)

#### Phase 1 (소스 카탈로그) — 2 옵션

| Option | 설명 | Pros | Cons |
|---|---|---|---|
| **P1-O1: rss.ts 점진 확장 (권장)** | `rss.ts` `RSS_FEEDS` 배열·`reddit_source.ts` `SUBREDDITS`·`youtube_source.ts` `YOUTUBE_CHANNELS`·`github_releases_source.ts` `TRACKED_REPOS`를 in-place 수정. 즉시 효과. | 1주 내 출시 가능, 기존 테스트(`rss_feeds.test.ts`) 패턴 재사용, 리스크 최소 | SSOT가 여전히 코드에 흩어짐, 카테고리 쿼터 제어 불가 |
| **P1-O2: sources.yaml SSOT 즉시 전환** | `config/sources.yaml` 도입 + `loadSources()` 로더 + `dispatchCollector()` 라우터로 `snapshot.ts:142-153` `SOURCE_PLANS` 대체 | 카테고리 쿼터 제어, 운영자 편집성↑, `_pipeline_reference/workflow/resources/rss.json` 시드 드리프트 해소 | 4 collector 동시 리팩터, 기존 테스트 7개+ 재작성, Phase 1 일정 1주 → 3주로 확장 |

→ **결정: P1-O1 채택**. P1-O2는 Phase 3 Cross-Phase의 별도 작업(§6)으로 분리. 사유: D1(즉시 체감)·D2(리스크 통제) 우선.

#### Phase 2 (점수·랭킹) — 3 옵션

| Option | 설명 | Pros | Cons |
|---|---|---|---|
| **P2-O1: 가중치만 재배분 (보수)** | 기존 6축 유지, `recency` 0.28→0.22, `velocity` 0.30→0.22 등 재배분. delta 계수만 1/3 축소. | 회귀 위험 최소, 1 sprint | KO 편향·바이브 신호 미해결, "구조적" 개선 없음 |
| **P2-O2: vibe + language 축 신설 (권장)** | 6축→8축. `vibe`(GitHub Δ7d + PH velocity + SNS mention) 0.14, `language`(KO ratio) 0.04 추가. delta 계수 축소 + manual slot-reserve. | 사용자 체감 직접 개선, audit B의 P0 권고 5종 모두 포함 | Phase 3 vibe 신호 수집기 필요 (의존), 회귀 시나리오 5종 필수 |
| **P2-O3: ML 기반 학습 랭커 도입** | 사용자 클릭·체류 데이터를 LightGBM/XGBoost로 학습 | 장기 최적, 자동화 | 데이터 부족(서비스 초기), 스코프 폭증, 본 PRD 범위 밖 |

→ **결정: P2-O2 채택**. P2-O3는 §11 Open Question으로 보류. P2-O1은 D1을 충족 못함.

#### Phase 3 (콘텐츠/SNS) — 3 옵션

| Option | 설명 | Pros | Cons |
|---|---|---|---|
| **P3-O1: deeplink-only (최저비용)** | API 응답에 `x_search_url`/`threads_search_url`/`youtube_search_url`/`github_search_url` 4개만 추가. 슬롯 분류·DB 마이그레이션 미수행. | 1주 내, $0 | 카드 UI 차별화 없음, 골든5 미달성 |
| **P3-O2: 5슬롯 + deeplink + 관리자 큐레이션 (권장)** | `sources.slot`/`metadata`/`language` 컬럼 + `golden_slots` 캐시 테이블 + `manual_x_tweets`/`manual_threads_posts`/`manual_sns_handles` + API `golden` 필드 + 4종 deeplink. X API 가입은 보류(Phase 3-B). | 사용자 체감 변화·관리자 운영성·Phase 2 vibe 신호 일부 공급(SNS mention base) | DB 마이그 5종, API shape 변경, Flutter 클라 신규 화면 |
| **P3-O3: P3-O2 + X API Basic 즉시 가입** | 위 + `src/lib/pipeline/x_source.ts` 신규 + 월 $200 결제 | 골든5 X 슬롯에 실제 트윗 1건 노출 가능 | 비용 승인 프로세스 필요(§11 OQ-1), 약관 변경 리스크 |

→ **결정: P3-O2 채택**. X API 가입 여부(P3-O3 잔여 분기)는 §11 OQ-1로 보류. SNS mention rate는 우선 Tavily `site:x.com OR site:threads.net` count fallback으로 대체 (Phase 2 vibe 축 노이즈 허용).

### 0.4 단일안 옵션의 무효화 사유 (P2-9 Critic 정정 — §9.3 ADR Alternatives Considered 참조)

위 3 Phase 모두 ≥2 viable option을 보존했으나, **각 Phase에서 채택 안 외 후보들의 무효화 사유는 §9.3 ADR Alternatives Considered 표에 5건 적시**되어 있음:

1. P1-O2 (sources.yaml SSOT 즉시) → 일정·회귀 위험으로 Cross-Phase로 보류 (§6.4)
2. P2-O1 (가중치만 재배분) → KO/바이브 신호 미반영, D1 미충족
3. P2-O3 (ML 학습 랭커) → 데이터 부족, 별도 PRD (§11 OQ-7과 별도 Phase 4)
4. P3-O1 (deeplink-only) → 카드 차별화 없음, 골든5 미달성
5. P3-O3 (X API Basic 즉시 가입) → 비용 승인 미확인, deeplink 폴백으로 단계 승급 (§11 OQ-1)

---

## 1. 배경 — 보고서 3종 핵심 인용

### 1.1 Subtask A 핵심 진단

- 현재 38개 RSS + 8개 비-RSS 경로로 수집하지만, **한국어 매체 비중 5.3% (RSS 기준)** 로 한국 바이브코더 만족도가 구조적으로 낮음 (audit-A#L304-309).
- **Cursor·Windsurf·Zed·Replit·v0** 등 바이브코딩 핵심 에디터의 공식 RSS가 부분만 있거나 누락 (audit-A#L209-213).
- **HackerNews AI(hnrss)** 는 `hn_source.ts`와 100% 중복 (audit-A#L283), **Product Hunt RSS** 는 GraphQL 경로와 이중 수집 (audit-A#L284), **LogRocket·Phoronix** 는 노이즈 (audit-A#L285-286) → 즉시 제거 권고.
- 시드 파일 `_pipeline_reference/workflow/resources/rss.json` 에 정의된 **Aider/LiteLLM/Open WebUI** GitHub Releases 3종, **토스 기술 블로그·GeekNews Blog·우아한형제들** 한국 매체가 코드에서 누락 (audit-A#L115-118).

### 1.2 Subtask B 핵심 진단

- 6축 모델은 견고하지만 **`TIER_AUTHORITY`에 언어 차원 없음** (`scoring.ts:40-45`) → 한국어 매체는 항상 P2_RAW(0.3) 또는 COMMUNITY(0.2)로 저평가 (audit-B#L84-89).
- **`MANUAL_KEYWORD_TOTAL_BONUS=6`** (`snapshot.ts:104-109`) 이 자연 점수(~1.0) 대비 16배 → 수동 키워드가 무조건 1위. A/B 비교 불가 (audit-B#L131-135).
- **GitHub stars Δ7d / PH upvote rate / X·Threads mention** 같은 바이브 신호가 `engagement` 한 축에 뭉뚱그려져 신호 희석 (audit-B#L295-303).
- **`keyword_exclusions.json`** 222개 exact만 지원 → `"claude"` 제외되나 `"claude 4.7"` 통과 (audit-B#L78, L146-149).
- **`dynamic_query.BASE_TERMS`** 8개 전부 영문 → GDELT broad 쿼리에서 한국어 기사 구조적 불리 (audit-B#L90-91).

### 1.3 Subtask C 핵심 진단

- 키워드 디테일 응답 `news/social/data` 3분류 중 **`social` 버킷에 X·Threads·HN·Reddit·Velog 22개 도메인이 혼재** (audit-C#L93-96), **`data` 버킷에 YouTube·arxiv·kaggle 혼재** (audit-C#L95).
- **`github.com`은 `SOCIAL_DOMAINS`/`DATA_DOMAINS` 어디에도 없어** 기본값 `news`로 분류 (audit-C#L96).
- X 통합은 현재 Tavily `site:x.com` 검색 의존 → **검색 deeplink가 1순위 권장** (비용 0, ToS 안전, 즉시 구현) (audit-C#L141-156).
- Threads 공식 API는 **타인 포스트 검색 미지원** (audit-C#L162) → deeplink + oEmbed 조합이 최선.
- **골든5 슬롯 = 뉴스1 + GitHub1 + YouTube1 + X1 + Threads1**. 슬롯4·5는 deeplink 폴백으로 항상 채움 → 빈 슬롯 0% 보장 (audit-C#L252-260).
- DB는 `sources.slot`·`sources.metadata JSONB`·`sources.language` 3 컬럼 추가만으로 시작 가능 (audit-C#L520-528).

---

## 2. 전체 로드맵

### 2.1 Phase 의존 그래프

```
                ┌──────────────────────────────┐
                │   Phase 1: 소스 카탈로그       │
                │   - RSS 추가/제거             │
                │   - GitHub Releases 확장       │
                │   - Reddit/YouTube 한국 확장   │
                │   - GDELT lang 라벨 개선      │
                └──────────────┬───────────────┘
                               │ (KO 매체 진입 → Phase 2 KO 신호 풀 확보)
                ┌──────────────▼───────────────┐
                │   Phase 2: 점수·랭킹           │
                │   - language 축 (즉시 가능)    │
                │   - exclusions prefix/regex    │
                │   - delta 계수 축소            │
                │   - dynamic_query KO baseline  │
                │   - manual slot-reserve        │
                │   - vibe 축 (스켈레톤·기본 0.10)│
                └──────────────┬───────────────┘
                               │ (vibe 신호 슬롯 정의됨, 신호 0)
                ┌──────────────▼───────────────┐
                │   Phase 3: 콘텐츠·SNS          │
                │   - sources.slot/metadata/lang │
                │   - golden5 빌더               │
                │   - X/Threads deeplink         │
                │   - manual_x_tweets/threads    │
                │   - X/Threads collector        │ ← Phase 2 vibe.snsMention 신호 공급
                │   - github_releases stars Δ7d   │ ← Phase 2 vibe.starsDelta 신호 공급
                └──────────────────────────────┘
```

### 2.2 간트 (sprint 단위; 1 sprint = 1주)

| Sprint | Phase 1 | Phase 2 | Phase 3 | Cross-Phase |
|---|---|---|---|---|
| S1 | P1-A 즉시 제거·복구·KO 추가 | — | P3-A deeplink 4종 (early) | feature flag 인프라 도입 |
| S2 | P1-B 에디터·랩 1차 + Reddit 확장 | P2-A exclusions·delta·KO baseline | P3-B sources.slot/metadata/language 마이그 | metric: KO 매체 포함률 계측 시작 |
| S3 | P1-C 한국 채널 4→8 + GDELT lang | P2-B language 축 + manual slot-reserve | P3-C golden5 빌더 + API `golden` 필드 | 회귀 시나리오 A,B,D 추가 |
| S4 | (관망·튜닝) | P2-C vibe 축 스켈레톤 (기본 0.10) | P3-D YouTube/GitHub 메타 보강 + 카드 뱃지 | 회귀 시나리오 C,E + Pre-mortem 모니터 |
| S5 | (관망) | (튜닝) | P3-E manual_x_tweets/threads/handles + admin path | A/B 실험 시작 (PIPELINE_RANKING_V2_ENABLED) |
| S6 | (관망) | P2-D vibe 신호 결선 (PH+stars+SNS 통합) | P3-F (선택) X API Basic 가입 / threads oEmbed | A/B 결정·v2 전면 전환 |

→ **Phase 2의 vibe 축은 S4에 스켈레톤으로 도입**(기본값 0.10)되고, **Phase 3의 신호 수집기(S4-S5)** 가 도착하면서 실제 vibe score가 채워진다. 신호가 없는 동안에도 가중치 0.14는 유지되며 `present.length === 0` 분기로 0.10 평준화 (`audit-B#L441`).

### 2.3 Roll-forward / Roll-back 시나리오

| 단계 | Roll-forward 트리거 | Roll-back 트리거 |
|---|---|---|
| Phase 1 | 새 피드의 30일 헬스체크 통과 | 5 연속 fetch 실패 자동 비활성 |
| Phase 2 | A/B 7일 KO 매체 포함률 ≥25% & 정상 교체율 30~70% | Top10 교체율 <15% 또는 >85%, 또는 manual 슬롯 점유율 >50% |
| Phase 3 | golden5 빈 슬롯 비율 0% 유지 7일 | golden5 페이로드 P95 latency >300ms 추가 |

---

## 3. Phase 1 — 소스 카탈로그 정비 (Subtask A 구현화)

### 3.1 목표 / 성공 지표

| 지표 | 현재 | 목표 (Phase 1 완료) |
|---|---|---|
| RSS 피드 수 | 38 | 40~45 (제거 4 + 추가 ~10) |
| 한국어 RSS 피드 비중 | 5.3% (2/38) | ≥18% (≥7/40) |
| 한국 YouTube 채널 | 4 | 7~8 |
| Reddit 서브레딧 | 9 | 13 |
| GitHub Releases 추적 리포 | 15 | 18~19 |
| 중복 수집 경로 | 2 (HN, PH) | 0 |
| Changelog 노이즈 피드 | 2 (LogRocket, Phoronix) | 0 |

### 3.2 작업 항목

#### 3.2.1 `src/lib/pipeline/rss.ts` — RSS_FEEDS 추가/제거 diff

**제거 대상** (4건):

| 행 | 항목 | 사유 |
|---|---|---|
| `rss.ts:73` | `LogRocket Blog` | 마케팅 콘텐츠 편향 (audit-A#L285) |
| `rss.ts:74` | `Phoronix` | 리눅스 벤치마크, AI 무관 (audit-A#L286) |
| `rss.ts:75` | `Product Hunt (RSS)` | GraphQL 경로와 중복 (audit-A#L284) |
| `rss.ts:96` | `HackerNews AI (hnrss)` | `hn_source.ts`와 100% 중복 (audit-A#L283) |

**추가 대상** (P0_CURATED 한국·바이브 6건, P0_RELEASES 호환 RSS 1건, COMMUNITY 2건 = 9건):

```diff
   // ── P0_CURATED 추가: 바이브코딩 에디터 ─────────────────────────────
+  { url: "https://zed.dev/blog.rss", title: "Zed Blog", tier: "P0_CURATED", lang: "en" },
+  { url: "https://blog.replit.com/rss", title: "Replit Blog", tier: "P0_CURATED", lang: "en" },
+  { url: "https://vercel.com/changelog/rss.xml", title: "Vercel Changelog", tier: "P0_CURATED", lang: "en" },

   // ── P0_CURATED 추가: 한국 기술 블로그 (audit-A#L259-265) ─────────────
+  { url: "https://toss.tech/rss.xml", title: "토스 기술 블로그", tier: "P0_CURATED", lang: "ko" },
+  { url: "https://news.hada.io/rss/blog", title: "GeekNews Blog", tier: "P0_CURATED", lang: "ko" },
+  { url: "https://techblog.woowahan.com/feed/", title: "우아한형제들 기술블로그", tier: "P0_CURATED", lang: "ko" },

   // ── COMMUNITY 추가 ─────────────────────────────────────────────
+  { url: "https://hnrss.org/show?points=30", title: "Show HN (AI/Dev)", tier: "COMMUNITY", lang: "en" },
+  { url: "https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml", title: "GitHub Trending", tier: "COMMUNITY", lang: "en" },
```

**Tier 강등** (2건, 추가 후 후속 PR):

- `rss.ts:44` `Google Research Blog` P0 → P1 (포스팅 빈도 낮음, audit-A#L289).
- `rss.ts:46` `MIT Technology Review` P0 → P1 (바이브 직결성 약함, audit-A#L290).

**파일·함수 단위**:
- 변경 파일: `src/lib/pipeline/rss.ts` (RSS_FEEDS 배열, `rss.ts:39-96`)
- 변경 함수: 없음 (배열 데이터 변경)
- 테스트 추가 위치: `src/lib/pipeline/rss_feeds.test.ts` — 신규 6 한국·에디터 피드 존재 확인 케이스, 제거 4건 부재 확인 케이스
- effort: 0.5h (배열) + 1h (테스트) = **1.5h**
- 의존: 없음 (P1-A1 단독)

#### 3.2.2 `src/lib/pipeline/github_releases_source.ts` 확장

```diff
 const TRACKED_REPOS: string[] = [
   "ollama/ollama",
   "langchain-ai/langchain",
+  "langchain-ai/langgraph",            // audit-A#L222
   "crewAIInc/crewAI",
   "microsoft/autogen",
   "run-llama/llama_index",
   "vllm-project/vllm",
   "huggingface/transformers",
   "ggml-org/llama.cpp",
   "LadybirdBrowser/ladybird",
   "anthropics/claude-code",
   "vercel/ai",
   "openai/openai-python",
   "google/generative-ai-python",
   "All-Hands-AI/OpenHands",
   "continuedev/continue",
+  "Aider-AI/aider",                    // audit-A#L218
+  "BerriAI/litellm",                   // audit-A#L219
+  "open-webui/open-webui",             // audit-A#L220
 ];
```

- 변경 파일: `src/lib/pipeline/github_releases_source.ts:5-21`
- 변경 함수: 없음 (배열)
- 테스트: `src/lib/pipeline/__tests__/github_releases_source.test.ts` (신규) — `TRACKED_REPOS.length === 18 || === 19` assertion + 신규 4종 포함 확인. 네트워크 모킹은 기존 패턴 추적 후 결정.
- effort: 0.5h + 1h = **1.5h**
- 의존: 없음

#### 3.2.3 `src/lib/pipeline/reddit_source.ts` 확장

```diff
 const SUBREDDITS = [
   "MachineLearning",
   "artificial",
   "LocalLLaMA",
   "vibecoding",
   "PromptEngineering",
   "cursor",
   "ClaudeAI",
   "ChatGPTCoding",
   "ollama",
+  "SideProject",          // audit-A#L239
+  "OpenAI",               // audit-A#L240
+  "aipromptprogramming",  // audit-A#L344
+  "IndieHacking",         // audit-A#L344
 ];
```

- 변경 파일: `src/lib/pipeline/reddit_source.ts:3-13`
- rate limit 영향: 9→13으로 ~4초 추가 (`reddit_source.ts:108-110`의 1초 sleep 가정). 운영팀 알림 필요.
- 테스트: `reddit_source.ts` 옆 신규 테스트 — `SUBREDDITS.length === 13` assertion + 새 4 항목 포함 확인.
- effort: 0.3h + 0.7h = **1h**
- 의존: 없음

#### 3.2.4 `src/lib/pipeline/youtube_source.ts` 한국 채널 확장

```diff
   { channelId: "UCt2wAAXgm87ACiQnDHQEW6Q", name: "테디노트 TeddyNote" },
   { channelId: "UCQNE2JmbasNYbjGAcuBiRRg", name: "조코딩 JoCoding" },
   { channelId: "UCxj3eVTAv9KLdrowXcuCFDQ", name: "빌더 조쉬 Builder Josh" },
   { channelId: "UCxZ2AlaT0hOmxzZVbF_j_Sw", name: "코드팩토리" },
+  // 한국 바이브코더 추천 4채널 (audit-A#L728-742에서 도출)
+  // ※ channelId는 도입 전 yt-dlp/YouTube Data API 로 확정 필요 (§11 OQ-3 참조)
+  { channelId: "<TODO 안될공학>", name: "안될공학" },
+  { channelId: "<TODO 노마드코더>", name: "노마드코더" },
+  { channelId: "<TODO 드림코딩>", name: "드림코딩 by 엘리" },
+  { channelId: "<TODO 메타코드M>", name: "메타코드M" },
```

- 변경 파일: `src/lib/pipeline/youtube_source.ts:11-34`
- 변경 함수: 없음
- 테스트: 한글 채널 비중이 ≥35% 인지 assertion (4/19 → 8/23).
- effort: 0.5h + 0.5h = **1h** (channelId 확정에 추가 0.5h)
- 의존: §11 OQ-3 (channelId 확보)

#### 3.2.5 (선택, P3 권장) `sources.yaml` SSOT 도입 — 보류

위 §0.3 P1-O2에서 보류 결정. Cross-Phase §6에서 별도 트랙으로 명시. Phase 1 완료 후 운영자가 카테고리 쿼터(`Korea≥2`, `Research≤3` 등) 요구를 제기하면 트리거.

#### 3.2.6 GDELT 언어 라벨 개선

```diff
 // gdelt_source.ts:77 (의사 코드)
-  lang: article.language === "Korean" ? "ko" : "en",
+  lang: mapGdeltLang(article.language),
+
+ function mapGdeltLang(s: string | undefined): "ko" | "en" | "ja" | "zh" | "other" {
+   switch ((s ?? "").toLowerCase()) {
+     case "korean":   return "ko";
+     case "english":  return "en";
+     case "japanese": return "ja";
+     case "chinese":  return "zh";
+     default:         return "other";
+   }
+ }
```

- 변경 파일: `src/lib/pipeline/gdelt_source.ts:77` 부근 + 함수 신설
- 의존: `RssItem.lang` 타입에 `"ja"|"zh"|"other"` 추가 필요 (`src/lib/pipeline/rss.ts` 또는 `keywords.ts`의 인터페이스). 다운스트림 영향 (Phase 2 `domainsByLang`은 ko/en만 사용 — `other`는 en으로 폴백).
- 테스트: `gdelt_source.test.ts` 신규 — `Japanese`/`Chinese`/`Russian` 입력 케이스.
- effort: 1h + 1h = **2h**
- 의존: Phase 1 다른 작업과 독립

#### 3.2.7 GDELT 한국어 호출 이중화 (선택)

`audit-A#L362` 권고. `?sourcelang=kor` 파라미터로 한국어 전용 GDELT 호출을 추가 1회. 응답 max 50건 제한.

- 변경 파일: `src/lib/pipeline/gdelt_source.ts` `collectGdeltItems` 함수 내 fetch 2회 → `Promise.all([fetchEn, fetchKo])`.
- effort: 2h + 1h = **3h**
- 의존: Phase 1 §3.2.6 완료

### 3.3 데이터/스키마 변경

Phase 1은 **DB 스키마 변경 없음**. `RssItem.lang` 타입 확장(`"ko"|"en"|"ja"|"zh"|"other"`)이 코드 인터페이스 변경에 해당. (`src/lib/pipeline/rss.ts` 인터페이스 정의 위치 확인 필요)

### 3.4 회귀 테스트 (unit / integration / e2e / observability)

| 차원 | 위치 | 케이스 |
|---|---|---|
| Unit | `src/lib/pipeline/rss_feeds.test.ts` | 신규 6피드 존재, 제거 4피드 부재, 한국 비중 ≥18% |
| Unit | `src/lib/pipeline/gdelt_source.test.ts` (신규) | `mapGdeltLang` 5 케이스 |
| Integration | `src/lib/pipeline/__tests__/snapshot.integration.test.ts` (신규/확장) | 1회 스냅샷 후 KO 매체 1+개 진입 검증 (mock RSS) |
| E2E | `npm run test:feeds-smoke` (신규 npm script) | CI에서 신규 6피드 HTTP 200 + 최근 30일 1+ item |
| Observability | `source_health` 테이블 신설 (`audit-A#L697-708`) | `consecutive_failures`, `last_http_status`, `disabled_until`. CI 외 운영 모니터 |

### 3.5 롤아웃 / 피처 플래그 / 모니터링

- **Feature flag**: 없음 (피드 추가는 즉시 적용. 단, 신규 피드 5 연속 fetch 실패 시 `source_health.disabled_until` 자동 1h disable).
- **모니터링**:
  - 신규 피드별 24h item count 대시보드 (Vercel/Slack alert)
  - GitHub Actions cron `cron_realtime.yml` 다음 실행에서 신규 피드 정상 수집 로그 확인
  - 7일 후 한국 매체 포함률 재측정 (Phase 2 language 축 도입 전 baseline)

### 3.6 리스크 & 완화

| 리스크 | 가능성 | 영향 | 완화 |
|---|---|---|---|
| 토스/우형/카카오 RSS URL 사양 변경 | 중 | 한국어 비중 미상승 | feed-smoke CI + 5연속 실패 자동 비활성 |
| GitHub Trending RSS (3rd party) 정지 | 중 | COMMUNITY 풀 약화 | 백업 URL 등록 (`trendshift.io/rss/top/`) |
| Reddit 4 서브 추가로 rate limit 초과 | 낮음 | 스냅샷 지연 +4s | 1초 sleep 유지, 모니터링 |
| GDELT lang 매핑 변경의 다운스트림 영향 | 낮음 | Phase 2 `domainsByLang` 분기 누락 | `"other" → "en"` 폴백, 테스트로 보호 |

---

## 4. Phase 2 — 점수·랭킹 알고리즘 개선 (Subtask B 구현화)

### 4.1 목표 / 성공 지표

| 지표 | 현재 | 목표 |
|---|---|---|
| Top10 한국어 매체 포함률 | <10% (추정) | ≥25% |
| Top10 patch release 노출 | 종종 (delta -0.10 절벽) | ≤1건/10 평균 |
| Manual 키워드 점유율 (Top10) | 변동 (최대 ~30%) | ≤30% (slot-reserve 강제) |
| Top10 교체율 (스냅샷 간) | 미측정 | 30~70% (이상 범위) |
| 회귀 테스트 시나리오 통과율 | 기존 5종 | 신규 5종 (A~E, audit-B#L513-567) 100% |

### 4.2 작업 항목

#### 4.2.1 `keyword_exclusions` exact + prefix + regex 확장

- 변경 파일: `src/lib/pipeline/keyword_exclusions.ts:11-27`
- 변경 함수: `buildExactExclusionSet()` → 분리; `isExactlyExcludedKeyword()` → `isExcludedKeyword()` 로 개명, 3단 분기. (audit-B#L156-189)
- JSON 스키마 확장: `src/config/keyword-exclusions.json`
  ```jsonc
  {
    "exact":  ["claude", "openai", ...],   // 기존 유지
    "prefix": ["ai agent ", "claude "],    // 신규
    "regex":  ["^(chatgpt|gpt) (4|5|6)\\."]// 신규
  }
  ```
- 호출자 영향: `keyword_exclusions.ts`를 import하는 모든 위치(`snapshot.ts`, `keywords.ts` 등)에서 함수명 일괄 수정.
- 테스트: `src/lib/pipeline/keyword_exclusions.test.ts` (신규) — exact/prefix/regex 각 3 케이스.
- effort: 2h + 2h = **4h**
- 의존: 없음 (P0 즉시 가능)

#### 4.2.2 정책 delta 계수 축소

- 변경 파일: `src/lib/pipeline/ranking_policy.ts:329-359`
- 변경 함수: `calculateKeywordPolicyDelta()`
- diff (audit-B#L194-205):

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
- 테스트: `ranking_policy.test.ts:53-207` 기존 케이스 기대값 갱신.
- effort: 1h + 2h = **3h**
- 의존: 없음 (P0)

#### 4.2.3 stability delta 축소

- 변경 파일: `src/lib/pipeline/ranking_policy.ts:423-464`
- 변경 함수: `calculateStabilityDelta()`
- 변경: `+0.04 (Top10) → +0.01`, `appearances 최대 +0.03 → +0.01`, `stale -0.05 → -0.02`. (audit-B#L460-463)
- 테스트: 기존 stability 테스트 케이스 기대값 갱신 + 시나리오 D 신규.
- effort: 1h + 1h = **2h**
- 의존: §4.2.2와 같이 묶어 1 PR

#### 4.2.4 `dynamic_query.BASE_TERMS` 한국어 baseline

- 변경 파일: `src/lib/pipeline/dynamic_query.ts:3-6`
- diff (audit-B#L240-251):

  ```diff
  -const BASE_TERMS = ["AI", "LLM", "GPT", "Claude", "Gemini", "OpenAI", "Anthropic", "DeepSeek"];
  +const BASE_TERMS_EN = ["AI", "LLM", "GPT", "Claude", "Gemini", "OpenAI", "Anthropic", "DeepSeek"];
  +const BASE_TERMS_KO = ["인공지능", "생성형 AI", "바이브 코딩", "오픈AI", "앤트로픽"];
  +const BASE_TERMS = [...BASE_TERMS_EN, ...BASE_TERMS_KO];
  ```
- 영향: GDELT broad 쿼리 OR term이 13 → 18개. URL 길이 영향 확인 필요(URL 8KB 제한 미달 예상).
- 테스트: `dynamic_query.test.ts` (신규/확장) — KO term 포함 검증.
- effort: 0.5h + 1h = **1.5h**
- 의존: 없음 (P0)

#### 4.2.5 `KeywordCandidates` 인터페이스 확장 (vibe·language 신호 자리 마련)

- 변경 파일: `src/lib/pipeline/keywords.ts` (또는 candidates 정의 위치)
- diff (audit-B#L272-287):

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
  +  // Phase 2 vibe 축 (Phase 3 collector 도착 전까지 undefined 허용)
  +  stars7dDelta?: number;
  +  phUpvoteRate?: number;
  +  snsMentionCount?: number;
   }
  ```
- 채워넣는 위치: 키워드 추출 단계(`keywords.ts`의 normalizer / `snapshot.ts:836-840` 부근)에서 도메인 매칭 시점에 `RssItem.lang` 기준으로 `domainsByLang` 분배.
- 테스트: `keywords.test.ts` (확장) — KO/EN 도메인 분배 케이스.
- effort: 3h + 2h = **5h**
- 의존: Phase 1 §3.2.6 (gdelt lang 정확화)

#### 4.2.6 `language` 점수축 신설 (가중치 0.04)

- 변경 파일: `src/lib/pipeline/scoring.ts`
- 신규 함수: `calculateLanguageScore(kw)` (audit-B#L446-455).
  ```ts
  function calculateLanguageScore(kw: NormalizedKeyword): number {
    const { ko, en } = kw.candidates.domainsByLang;
    const total = ko.size + en.size;
    if (total === 0) return 0.5;
    const koRatio = ko.size / total;
    if (koRatio >= 0.2) return 1.0;
    if (koRatio >= 0.05) return 0.7;
    return 0.3;
  }
  ```
- `DEFAULT_WEIGHTS`(`scoring.ts:15-22`)에 `language: 0.04` 추가, 기존 가중치 재배분 (audit-B#L362-373):

  **가중치 타임라인 표 (S4 기본 / S5 잠정 / S6 최종, 합계 항상 1.00)**

  | 축 | 기존 (v1) | **S4 출시 (v2 기본, vibe 신호 0)** | **S5 신호 도착 (vibe 잠정)** | **S6 커버리지 ≥60% (v2 최종)** |
  |---|---|---|---|---|
  | recency | 0.28 | 0.22 | 0.22 | 0.22 |
  | frequency | 0.12 | 0.10 | 0.10 | 0.10 |
  | authority | 0.08 | 0.10 | 0.10 | 0.10 |
  | velocity | 0.30 | 0.22 | 0.22 | 0.22 |
  | engagement | 0.22 | 0.18 | 0.16 | 0.14 |
  | **vibe** (신규) | — | **0.00** | **0.07** | **0.18** |
  | **language** (신규) | — | 0.08 | 0.08 | 0.08 |
  | internal (delta) | 0.00 | 0.00 (±0.04) | 0.00 (±0.04) | 0.00 (±0.04) |
  | **합계** | 1.00 | **1.00** | **0.95 → 1.00** (정규화) | **1.04 → 1.00** (정규화) |

  **정규화 훅 결정 (Option b 채택)**: `resolveWeights()` 말미에 `weights = weights / sum(weights)` 정규화를 적용한다. 이유: DB `ranking_weights` 컬럼이 운영자 편집으로 합계 != 1.00이 될 수 있고, S5/S6 전환 시에도 코드 변경 없이 타임라인 전환 가능. `language` 축은 P0-1 Critic 반영으로 **0.04 → 0.08** 상향(KO 매체 신호 강화).

  > footnote¹: 정규화 훅은 `src/lib/pipeline/scoring.ts`의 신규 `normalizeWeights(weights: ScoreWeightsV2): ScoreWeightsV2` 함수로 도입. 입력 합계가 0에 수렴하면 `DEFAULT_WEIGHTS_V2_S4` fallback. 테스트는 §8.1의 `scoring.test.ts`에 `expect(sum(DEFAULT_WEIGHTS_V2_S4)).toBeCloseTo(1.0, 3)`·`expect(sum(DEFAULT_WEIGHTS_V2_S6)).toBeCloseTo(1.0, 3)` 2 케이스 추가.

- 테스트: `scoring.test.ts` 시나리오 A (audit-B#L513-523) + 가중치 합 1.00 검증 (S4·S5·S6 3 케이스).
- effort: 3h + 3h + 1h (정규화 훅) = **7h**
- 의존: §4.2.5

#### 4.2.7 `vibe` 점수축 신설 (S4 가중치 0.00 → S5 0.07 → S6 0.18, P0-1·P2-10 반영)

- 변경 파일: `src/lib/pipeline/scoring.ts`
- **타임라인 통일**: §4.2.6 가중치 타임라인 표와 일치. S4 출시에는 `w_vibe=0` → score 계산에서 사실상 무효화되지만 함수는 존재. S5에 신호 수집기 커버리지 ≥30%가 되면 `ranking_weights.w_vibe` DB 값을 0.07로 승급, S6(커버리지 ≥60%) 에 0.18 최종.
- 신규 함수: `calculateVibeScore(kw)` (audit-B#L435-444) — 본문은 동일하나 폴백값 해석이 아래와 같이 타임라인 의존.
  ```ts
  function calculateVibeScore(kw: NormalizedKeyword): number {
    const starsNorm = log10Norm(kw.candidates.stars7dDelta ?? 0, 5_000);
    const phNorm    = log10Norm(kw.candidates.phUpvoteRate ?? 0, 500);
    const snsNorm   = log10Norm(kw.candidates.snsMentionCount ?? 0, 10_000);
    const present = [starsNorm, phNorm, snsNorm].filter((v) => v > 0);
    // S4: 어차피 w_vibe=0이므로 출력 영향 없음. 폴백값은 디버깅용 0.10 유지.
    // S5/S6: present.length===0인 키워드는 0.10 반환 → w_vibe와 곱해 최대 ±0.018 이내 영향.
    if (present.length === 0) return 0.10;
    return Math.max(...present);
  }
  ```
- 테스트: `scoring.test.ts` 시나리오 C (audit-B#L535-543) + S4/S5/S6 3 phase에서 동일 입력에 대한 total 변화 비교 케이스 1건 추가.
- effort: 3h + 2h = **5h**
- 의존: §4.2.5 + Phase 3 §5.2 신호 수집기 (단, S4에서는 w_vibe=0으로 출시 가능 — 신호 없어도 랭킹 영향 0)

##### 4.2.7.1 `language` 축의 user locale 정책 (구 OQ-5 결정 승격, P1-7 Critic 반영)

- **결정**: `lang=en` 사용자에게는 `calculateLanguageScore()` 가 항상 0.5 (중립) 강제. KO 매체 부스팅은 `lang=ko` 사용자에게만 적용.
- 구현: `calculateLanguageScore(kw, locale)` 시그니처 확장. `locale === 'en'` 분기에서 즉시 0.5 반환.
- 사유: Pre-mortem #1(KO 부스팅 과잉으로 영문 사용자 만족도 저하) 정량 완화책. 글로벌 사용자 영향 0 보장.
- 효과: §4.2.6 `w_language=0.08` 가 글로벌 사용자에 대해서는 모든 키워드 동률 → 사실상 무효화. KO 사용자 한정 효과.
- **Locale 판정 우선순위 (N7)**: `?lang=` 쿼리 파라미터 우선, 부재 시 `Accept-Language` 헤더, 그래도 부재 시 `lang=ko` 디폴트 (KST 운영 기준).
- 테스트: `scoring.test.ts` `calculateLanguageScore` 의 locale=en/ko 2 케이스 추가.

#### 4.2.8 Manual priority slot-reserve 재설계

- 변경 파일: `src/lib/pipeline/manual_priority.ts:38-186`, `src/lib/pipeline/snapshot.ts:104-115` (`MANUAL_KEYWORD_TOTAL_BONUS=6` 제거)
- 신규 함수: `reserveManualSlots(ranked, manualKeywords, cfg)` (audit-B#L477-502).
- ManualSlotConfig 도입:
  ```ts
  interface ManualSlotConfig {
    maxSlots: number;             // 기본 3
    allowMissingSources: boolean; // 기본 false
    requireMinTotalScore: number; // 기본 0.35
  }
  ```
- env 노출: `PIPELINE_MANUAL_MAX_SLOTS=3`, `PIPELINE_MANUAL_ALLOW_MISSING=false`.
- 기존 `createManualRankedItem` 폐지 (또는 v1 호환을 위해 deprecation 주석 + flag로 분기).
- **수정·결정 (구 OQ-8 승격, P1-7 Critic 반영)**:
  - 기본 `PIPELINE_MANUAL_MAX_SLOTS=3`.
  - 기본 `PIPELINE_MANUAL_ALLOW_MISSING=false`.
  - `manual_keywords.force_show BOOLEAN NOT NULL DEFAULT FALSE` 컬럼을 P2-T9 PR에 **동시 출시**. `force_show=true`인 행은 `requireMinTotalScore`/`allowMissingSources` 검사 우회 → Pre-mortem #2(광고/협찬 워크플로우 마비) 회피.
  - 운영팀 사전 안내(슬랙 #ops, 출시 1주 전): "기본 키워드는 자연 점수 ≥0.35 확보 필요. 광고용 키워드는 `force_show=true` 체크."
- P1-8 마이그 (`manual_keywords.force_show`)는 §4.3 표에 추가됨.
- 테스트: 시나리오 E (audit-B#L557-567) + force_show=true 케이스 (`requireMinTotalScore` 우회 검증) 1건 추가.
- effort: 5h + 3h + 2h (force_show 컬럼 + 마이그 + 테스트) = **10h** ← P1-8 반영, P2-T9 effort도 동일 상향 (§10.2)
- 의존: §4.2.6 (manual 키워드도 v2 score 분포 안에서 anchor 계산)
- **회귀 위험 R4=3 (audit-B#L661)** — Pre-mortem #2와 직접 연관 (§7).

#### 4.2.9 Velocity 음수 허용 + compress

- 변경 파일: `src/lib/pipeline/scoring.ts:100-105`
- diff (audit-B#L259-265):
  ```diff
  -  return Math.max(0, Math.min(1, centered));
  +  return Math.max(0, Math.min(1, (centered + 1) / 2));
  ```
- 부작용: 모든 키워드의 velocity 점수가 +0.5 shift → 가중치 0.22와 곱해 Top10 분포가 ~0.11 평행이동. **단독 PR 금지** — §4.2.6 가중치 재배분과 같이 출시.
- 테스트: 시나리오 C/D 의 velocity 부분 갱신.
- effort: 1h + 1h = **2h**
- 의존: §4.2.6

#### 4.2.10 `ranking_candidate_debug` 확장

- 변경 파일: `src/lib/pipeline/ranking_candidate_debug.ts:27-82`
- 변경 함수: `buildRankingCandidateDebug()` 의 `internal_reason` 에 `vibe_signal`, `language_score`, `cluster_coverage` 필드 추가 (audit-B#L578-579).
- 테스트: `ranking_candidate_debug.test.ts` (확장).
- effort: 1.5h + 1h = **2.5h**
- 의존: §4.2.6, §4.2.7

#### 4.2.11 Cluster 정규화 강화 (canonical alias) — 보류

- audit-B#L320-356 권고 R5는 회귀 위험 R5=4 (audit-B#L662). Phase 2 첫 출시에서 제외, Phase 4 별도 트랙 (§11 OQ-7).

#### 4.2.12 Feature Flag 단계 rollout

- env 도입: `PIPELINE_RANKING_V2_ENABLED=true|false` (audit-B#L791-799).
- DB 분기: `ranking_weights` 테이블에 `w_vibe`, `w_language` 컬럼 추가; NULL이면 v1, 값 있으면 v2.
  ```sql
  ALTER TABLE ranking_weights ADD COLUMN IF NOT EXISTS w_vibe   NUMERIC(4,3);
  ALTER TABLE ranking_weights ADD COLUMN IF NOT EXISTS w_language NUMERIC(4,3);
  ```
- 변경 파일: `src/lib/pipeline/snapshot.ts:205-261` `resolveRuntimeProfile()` 분기 추가.
- effort: 3h + 2h = **5h**
- 의존: §4.2.6, §4.2.7 완료 후 묶어 출시

### 4.3 데이터/스키마 변경

| 변경 | SQL | 파괴적? |
|---|---|---|
| `ranking_weights.w_vibe NUMERIC(4,3)` | `ALTER TABLE ranking_weights ADD COLUMN IF NOT EXISTS w_vibe NUMERIC(4,3);` | 비파괴 |
| `ranking_weights.w_language NUMERIC(4,3)` | 동상 | 비파괴 |
| `snapshot_meta.weights_json JSONB` (스냅샷별 weights 보존, audit-B#L809) | `ALTER TABLE snapshot_meta ADD COLUMN IF NOT EXISTS weights_json JSONB;` | 비파괴 |
| **`manual_keywords.force_show BOOLEAN NOT NULL DEFAULT FALSE`** (P1-8 Critic 반영, OQ-8 결정 결과) | `ALTER TABLE manual_keywords ADD COLUMN IF NOT EXISTS force_show BOOLEAN NOT NULL DEFAULT FALSE;` | 비파괴 (DEFAULT 즉시 적용) |

마이그레이션 스크립트: `scripts/db/migrations/2026_04_phase2_ranking_v2.sql` 신규 (위 4 ALTER 모두 포함).

### 4.4 회귀 테스트

| 차원 | 위치 | 케이스 |
|---|---|---|
| Unit | `src/lib/pipeline/scoring.test.ts` | 시나리오 A (KO 매체 부스팅), C (stars 폭증), **가중치 합 S4/S5/S6 모두 1.00 검증** (`expect(sum(normalizeWeights(w))).toBeCloseTo(1.0, 3)` × 3 case) |
| Unit | `src/lib/pipeline/ranking_policy.test.ts` | 시나리오 B (버전 트레인 억제), D (echo chamber 방지). 기존 케이스의 기대값 갱신 |
| Unit | `src/lib/pipeline/manual_priority.test.ts` (신규) | 시나리오 E (slot-reserve, missingSources=false) |
| Unit | `src/lib/pipeline/keyword_exclusions.test.ts` (신규) | exact/prefix/regex 9 케이스 |
| Integration | `__tests__/snapshot.integration.test.ts` (확장) | 1 스냅샷 후 KO 매체 포함률 ≥25% (mock 데이터로 강제) |
| Integration | `__tests__/ranking_v1_v2_compatibility.test.ts` (신규) | `PIPELINE_RANKING_V2_ENABLED=false` 시 v1 동일 결과 |
| E2E | `npm run snapshot:dryrun` (신규 스크립트) | DB 미반영, JSON 출력만. Top10 변동 미리보기 |
| Observability | `snapshot_candidates` 테이블에 `score_v2_breakdown JSONB` 추가 → A/B 모니터 |

### 4.5 롤아웃 / 피처 플래그 / 모니터링

- **단계**:
  1. S2: §4.2.1~4.2.4 출시 (exclusions·delta·KO baseline). v2 flag 미활성. v1 동작 유지.
  2. S3: §4.2.5~4.2.6 출시 (language 축). `ranking_weights.w_language=0.08` 입력 (§4.2.6 5열 표 S4 기준과 일치, N1 동기화). v2 분기 활성. **A/B 7일.**
  3. S4: §4.2.7~4.2.9 출시 (vibe 축 스켈레톤 + slot-reserve). S4는 `w_vibe=0`이라 vibe 영향 0; S5에 신호 도착 후 `w_vibe=0.07` 승급(§4.2.6 타임라인 참조, N2 동기화). 가중치 합 1.00은 정규화 훅이 보장.
  4. S6: Phase 3 신호 커버리지 ≥60% 확인 후 `w_vibe=0.18` 최종 승격, vibe 가중치 본격 발효.
- **모니터링** (audit-B#L778-785):
  | 지표 | 임계 | 알람 |
  |---|---|---|
  | Top10 교체율 (스냅샷 간) | 30~70% 정상 | <20% 또는 >80% Slack |
  | KO 매체 포함률 | ≥25% 목표 | <15% Slack |
  | `ko_media_inclusion_rate_by_locale` (N7) | locale별 KO 매체 노출률 분리 측정. 글로벌(`lang=en`) 사용자 KO 매체 노출률 ≤2% | >2% Slack |
  | Manual 점유율 (Top10) | ≤30% | >50% page |
  | Patch release 노출 (Top5) | ≤1 | ≥3 page |
  | Vibe score 평균 (Top10) | ≥0.3 (S6 이후) | <0.2 |

### 4.6 리스크 & 완화

| 리스크 | 가능성 | 영향 | 완화 |
|---|---|---|---|
| v2 활성 직후 사용자가 "어제 1위 사라짐" 항의 | 중 | 신뢰 손실 | (a) v1/v2 A/B 7일 (b) `ranking_weights` 즉시 NULL roll-back |
| Manual 키워드 운영자 항의 ("내 수동 키워드가 안 보임") | 중상 | 운영 마찰 | env `PIPELINE_MANUAL_ALLOW_MISSING=true` 폴백 + 운영자 사전 안내 |
| vibe 축 신호 커버리지 부족 시 변별력 저하 | 중 | 랭킹 노이즈 | §4.2.6/§4.2.7 타임라인 강제: S4 `w_vibe=0` (영향 0) → S5 `w_vibe=0.07` (신호 커버리지 ≥30% 검증 후 DB 승급) → S6 `w_vibe=0.18` (커버리지 ≥60% 검증 후). 정규화 훅이 합계 1.00 유지. |
| KO 매체 부스팅이 영문 사용자 (`lang=en`)에게 부적절 | 중 | 글로벌 사용자 만족도↓ | §4.2.7.1 locale 정책으로 해소(글로벌 사용자 `lang=en`에 `languageScore=0.5` 중립 강제, N5 동기화) |
| `ranking_weights` 마이그 실수로 production v2 즉시 활성 | 낮음 | 큰 사고 | 마이그 SQL은 컬럼만 추가, 값 입력은 별도 admin script로 분리 |
| Velocity compress의 +0.11 평행이동이 전체 Top10 재배치 | 중상 | A/B 노이즈 | §4.2.9를 §4.2.6과 같은 PR/배포에 묶어 일괄 측정 |

---

## 5. Phase 3 — 콘텐츠/SNS 통합 (Subtask C 구현화)

### 5.1 목표 / 성공 지표 (audit-C#L737-744)

| 지표 | 현재 | 목표 |
|---|---|---|
| 골든5 빈 슬롯 비율 | N/A | 0% (deeplink 폴백 보장) |
| X·Threads 카테고리 노출 | 0% | 100% (deeplink 최소) |
| 대표 트윗/스레드 실제 노출 (deeplink 아님) | 0% | ≥50% (S6 이후) |
| YouTube 카드에 썸네일·재생시간 노출 | 0% | 100% |
| GitHub 카드에 stars 노출 | 0% | 100% |
| 디테일 응답 P95 latency | 미측정 | 추가 ≤300ms |

### 5.2 작업 항목

#### 5.2.1 DB 마이그레이션 — `sources.metadata` JSONB / `slot` / `language`

- 변경 파일: `src/lib/db/schema.sql:66-104` (스펙 갱신) + `scripts/db/migrations/2026_04_phase3_golden5_part1_columns.sql` (DDL 트랜잭션 1) + `scripts/db/migrations/2026_04_phase3_golden5_part2_indexes.sql` (DDL 트랜잭션 2, P0-3 Critic 반영)
- SQL **2단 분리** (Postgres `CREATE INDEX CONCURRENTLY`는 트랜잭션 내 실행 불가):

  **part1 — ALTER COLUMN 트랜잭션 (즉각 메타데이터만 갱신, NULL 허용으로 row rewrite 없음)**:
  ```sql
  BEGIN;
  ALTER TABLE sources ADD COLUMN IF NOT EXISTS slot     TEXT;     -- 'news'|'repo'|'video'|'xpost'|'thread'|'other'
  ALTER TABLE sources ADD COLUMN IF NOT EXISTS metadata JSONB;    -- { stars, duration_sec, like_count, author_handle, ... }
  ALTER TABLE sources ADD COLUMN IF NOT EXISTS language TEXT;     -- 'ko'|'en'|'ja'|'zh'|'other'
  COMMIT;
  ```

  **part2 — CONCURRENT INDEX 빌드 (트랜잭션 밖, 각 문장은 자체 자동 트랜잭션)**:
  ```sql
  -- ※ 절대 BEGIN/COMMIT으로 감싸지 말 것 (CONCURRENTLY 제약).
  -- ※ 한 번에 한 인덱스씩, 실패 시 INVALID 인덱스 생성 가능 → 모니터링 필요.
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sources_slot     ON sources(slot);
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sources_language ON sources(language);
  ```

- **실행 절차**: `npm run db:migrate:phase3` 스크립트 내부에서 `psql -f part1.sql && psql -f part2.sql`로 분리 실행. part2는 각 인덱스 빌드 5분 SLA 모니터 (`pg_stat_progress_create_index`).
- **다운타임**: NULL 허용 + IF NOT EXISTS + CONCURRENTLY → **무중단**. 기존 행은 NULL → API 응답 시 폴백. 인덱스 빌드 중에도 `sources` 테이블 read/write 차단 없음.
- **INVALID 인덱스 회복**: part2 실행 중 신호 끊김 등으로 `pg_index.indisvalid=false` 인덱스 발생 시 `DROP INDEX CONCURRENTLY idx_sources_slot; CREATE INDEX CONCURRENTLY ...` 재실행.
- 테스트: `scripts/db/migrate.test.ts` (확장) — 멱등성·NULL 분기.
- effort: 1h SQL + 2h 마이그 검증 = **3h**
- 의존: 없음 (P0 마이그 단독)

#### 5.2.2 신규 테이블 — `golden_slots`, `manual_x_tweets`, `manual_threads_posts`, `manual_sns_handles`

- SQL (audit-C#L576-632):
  ```sql
  CREATE TABLE IF NOT EXISTS golden_slots (
    snapshot_id TEXT NOT NULL,
    keyword_id  TEXT NOT NULL,
    slot_name   TEXT NOT NULL,
    source_id   INTEGER REFERENCES sources(id) ON DELETE SET NULL,
    deeplink    TEXT,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_id, keyword_id, slot_name)
  );
  CREATE TABLE IF NOT EXISTS manual_x_tweets (
    id SERIAL PRIMARY KEY, keyword TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'realtime',
    tweet_id TEXT NOT NULL, tweet_url TEXT NOT NULL, author_handle TEXT NOT NULL,
    cached_text TEXT, cached_like_count INTEGER DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT TRUE, expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS manual_threads_posts ( /* 위와 동일 구조, thread_url */ );
  CREATE TABLE IF NOT EXISTS manual_sns_handles (
    id SERIAL PRIMARY KEY, platform TEXT NOT NULL, handle TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT 'ko',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_sns_handles_platform_handle
    ON manual_sns_handles(platform, lower(handle));
  ```
- 변경 파일: `src/lib/db/schema.sql` (스펙) + `scripts/db/migrations/2026_04_phase3_golden5.sql` (실행).
- effort: 2h + 1h 검증 = **3h**
- 의존: §5.2.1 (같은 마이그 트랜잭션 묶음 권장)

#### 5.2.3 `classifySlot()` 5분류 신설 + 기존 `classifySourceCategory()` 호환

- 변경 파일: `src/lib/pipeline/source_category.ts` (신규 export)
- 신규 함수 (audit-C#L363-372):
  ```ts
  export function classifySlot(s: Source):
    'news' | 'repo' | 'video' | 'xpost' | 'thread' | 'other' { ... }
  ```
- 기존 `classifySourceCategory()` 는 레거시 호환용 유지. 응답 v1 (`sources` 3분류) 가 계속 동작.
- 테스트: `source_category.test.ts` (신규/확장) — github.com → repo, youtube.com → video, x.com → xpost, threads.net → thread, 기타 → 기존 분기.
- effort: 2h + 2h = **4h**
- 의존: §5.2.1 (slot 컬럼 활용)

#### 5.2.4 `insertSource()` 시점 slot/metadata/language 채우기

- 변경 파일: `src/lib/pipeline/snapshot.ts:738-754` `insertSource()` 호출부 + `src/lib/db/queries.ts` (insert 시그니처 확장).
- 채울 메타: YouTube `videoId`/`channelId`/`duration`/`viewCount` (수집기 → metadata.json), GitHub `repo_full_name`/`stars`/`language` (수집기 → metadata.json), Reddit `subreddit`/`ups`/`num_comments`, PH `votes`/`maker`.
- 수집기 변경 필요 위치 (audit-C#L114-127):
  - `src/lib/pipeline/youtube_source.ts` — duration/viewCount/channelId 보존
  - `src/lib/pipeline/youtube_recommend_source.ts` — 동일
  - `src/lib/pipeline/github_source.ts` — stars/language/default_branch
  - `src/lib/pipeline/github_releases_source.ts` — tag_name/published_at/prerelease
  - `src/lib/pipeline/reddit_source.ts` — subreddit/ups/num_comments
  - `src/lib/pipeline/product_hunt_top_source.ts` — votes
- effort: 6h (수집기 6종 확장) + 3h (테스트) = **9h**
- 의존: §5.2.1, §5.2.3

#### 5.2.5 `golden5` 빌더 신설

- 신규 파일: `src/lib/pipeline/golden5.ts`
- 함수: `buildGolden5(keyword, sources, options)` (audit-C#L344-372).
- 슬롯별 score 함수: `scoreNews`, `scoreRepo`, `scoreVideo`, `scoreXPost`, `scoreThread` (audit-C#L267-339).
- 폴백 체인 (audit-C#L394-430):
  - news: scoreNews top1 → 최근 24h news → title 토큰 매칭 → Tavily broad → sentinel
  - repo: scoreRepo top1 → github 파생 → manual_github_pins → search deeplink
  - video: scoreVideo top1 → recommend_channels 최신 → manual_youtube_links → search deeplink
  - xpost: X API (있으면) → manual_x_tweets → Tavily site:x → search deeplink
  - thread: manual_threads_posts → Tavily site:threads.net → manual_handles → search deeplink

- **Tavily broad 호출량 예측 (P1-5 Critic 반영)**:
  - 보수 예측식: `keywords 20 × slots 5 × cron 4/day = 400 calls/day` (모든 슬롯이 Tavily fallback까지 도달했다고 가정한 상한).
  - 현실 예측: `keywords 20 × slots 평균 1.5 fallback × cron 4/day = 120 calls/day` (대부분 슬롯은 1차 score 후보 또는 manual로 결정됨).
  - **캐시 정책**: 각 (keyword, slot) 쌍에 24h TTL 적용 → 동일 스냅샷 사이클 내 재호출 방지. `golden_slots` 테이블의 `created_at`을 기준으로 스킵 가능.
  - **호출량 cap**: §8.4 `tavily_broad_call_count_per_snapshot` 메트릭 (>300 warning, >500 자동 fallback 강제).
  - `scripts/snapshot/dryrun.ts`(§4.2 P2-T13)의 출력에 **`predicted_tavily_calls` 필드** 추가하여 PR 단위로 예측치 기록.
- 캐시: `golden_slots` 테이블에 스냅샷별 결과 저장 → API 응답 시 single SELECT.
- 테스트: `golden5.test.ts` 시나리오 1~5 (audit-C#L713-718).
- effort: 8h + 4h = **12h**
- 의존: §5.2.1~§5.2.4

#### 5.2.6 API 응답 `golden` 필드 + 4종 deeplink

- 변경 파일: `src/app/api/v1/keywords/[id]/route.ts:75-131`
- API shape v1 → v2 (audit-C#L639-682, P1-6 Critic 반영으로 `GoldenPreview` 추가):
  ```ts
  interface GoldenPreview {                       // P1-6: trends/top·hot의 ?preview=1 응답 전용
    news_thumb:   string | null;
    repo_thumb:   string | null;
    video_thumb:  string | null;
    xpost_thumb:  string | null;
    thread_thumb: string | null;
  }

  interface KeywordDetail_v2 extends KeywordDetail_v1 {
    golden: {
      news:   GoldenItem | null;
      repo:   GoldenItem | null;
      video:  GoldenItem | null;
      xpost:  GoldenItem | null;
      thread: GoldenItem | null;
    };
    deeplinks: {
      x_search:       string | null;  // P0-2: flag off 시 null
      threads_search: string | null;
      youtube_search: string | null;
      github_search:  string | null;
    };
    goldenPreview?: GoldenPreview;   // P1-6: only when ?preview=1
    schemaVersion: 2;
  }
  ```
- `sources` 배열은 유지 (하위 호환). 신규 클라는 `golden` 우선.
- deeplink 생성 함수: `src/lib/pipeline/sns_deeplinks.ts` (신규) — UTM 파라미터 부착 옵션.

##### 5.2.6.1 `PIPELINE_GOLDEN5_ENABLED` flag off 시 응답 shape (P0-2 Critic 반영, Option b 채택)

flag off 시에도 **schemaVersion=2 유지**하되 `golden`/`deeplinks` 필드는 아래처럼 **null-filled shape**로 반환한다. (Flutter 신버전이 `golden?.news ?? null` 방어 파싱을 가정하므로 shape 안정성이 정책적 우선.)

```ts
// PIPELINE_GOLDEN5_ENABLED=false 응답 예시 (PIPELINE_API_SCHEMA_VERSION 미설정 default)
{
  schemaVersion: 2,                       // default 2, override only via PIPELINE_API_SCHEMA_VERSION env (N8)
  snapshotId, id, keyword, updatedAt, summary, bullets,
  sources: [ /* 기존 3분류 배열 유지 */ ],
  golden: {
    news:   null,
    repo:   null,
    video:  null,
    xpost:  null,
    thread: null,
  },
  deeplinks: {
    x_search:       null,  // flag off 시 null. Flutter는 null 가드 필수.
    threads_search: null,
    youtube_search: null,
    github_search:  null,
  }
}
```

- **Override env (N8 명확화)**: `PIPELINE_API_SCHEMA_VERSION=1|2` (optional). 정책:
  - **미설정 (default)**: 응답 `schemaVersion=2`. `golden`/`deeplinks` 필드 포함 (`PIPELINE_GOLDEN5_ENABLED`에 따라 채움 또는 null-fill).
  - **=`1` 명시**: 응답 `schemaVersion=1`, `golden`/`deeplinks` 필드 자체 생략 (구 Flutter 호환, batch rollback 안전망).
  - **=`2` 명시**: 응답 `schemaVersion=2`, `golden`/`deeplinks` null-filled shape 유지 (`PIPELINE_GOLDEN5_ENABLED` 무관).
  - 즉 schemaVersion override는 batch rollback 안전망. 평시 운영은 default(2) + `PIPELINE_GOLDEN5_ENABLED`로 데이터 채움 제어.
- **Flutter 가드 파싱 규약**: `const golden = response.golden ?? {news: null, repo: null, ...};` + `response.deeplinks?.x_search ?? ''`. 별도 모바일 PRD의 디시리얼라이저가 이 규약을 따른다.
- 테스트: `keywords/[id]/route.test.ts`에 **flag on/off 2 케이스 비교 테스트** 추가 — (i) `PIPELINE_GOLDEN5_ENABLED=true`: golden 5필드가 source 또는 deeplink로 채워짐, deeplinks 4필드가 URL 문자열. (ii) `PIPELINE_GOLDEN5_ENABLED=false`: golden 5필드·deeplinks 4필드 모두 `null` (shape 유지 검증). schemaVersion은 두 경우 모두 2.
- 테스트: `keywords/[id]/route.test.ts` 기본 케이스 — schemaVersion=2, deeplinks 4개 존재 (null 또는 URL), golden 5슬롯 모두 존재 (null 허용).
- effort: 4h + 3h = **7h**
- 의존: §5.2.5

#### 5.2.7 `/api/v1/trends/top`·`/api/v1/trends/hot`·`/api/v1/search` 응답 진화 (P1-6 Critic 반영)

- 변경 파일:
  - `src/app/api/v1/trends/top/route.ts:59-89` — 옵션 `?preview=1` 시 `goldenPreview` 5썸네일 포함
  - `src/app/api/v1/trends/hot/route.ts:82-105` — 동일
  - `src/app/api/v1/search/route.ts:56-143` — DB hit 시 `golden` 동일 구조
- **`?preview` 파라미터 사양 (P1-6)**:
  - 기본값 `?preview=0` → 응답에서 `goldenPreview` 필드 자체 생략 (페이로드 절감).
  - `?preview=1` → schemaVersion=2 응답에만 `goldenPreview` 포함. 5필드 모두 string|null.
  - `PIPELINE_GOLDEN5_ENABLED=false` 시 `?preview=1` 요청도 `goldenPreview = {news_thumb:null, repo_thumb:null, video_thumb:null, xpost_thumb:null, thread_thumb:null}` (shape 유지).
  - **Flutter 가드 파싱**: `final thumb = preview?.news_thumb ?? '';` 빈 문자열 fallback 권고. 별도 모바일 PRD에 가드 규약 명시.
- 테스트: 각 `route.test.ts` 확장 — `?preview=0` (필드 미포함) vs `?preview=1` (필드 존재) vs `?preview=1` + flag off (5 null 채움) 3 케이스.
- effort: 3h + 2h + 1h (preview 케이스 테스트) = **6h**
- 의존: §5.2.6

#### 5.2.8 X/Threads collector (vibe 신호 공급, Phase 2 의존 해소)

**X (Tavily fallback only — X API 가입 보류 시)**:
- 신규 파일: `src/lib/pipeline/x_mention_count.ts`
- 함수: `fetchXMentionCount(keyword, hours=24)` — Tavily `site:x.com` 결과 count 반환.
- 이 값이 `KeywordCandidates.snsMentionCount`에 채워짐 → Phase 2 vibe 축에서 사용.
- effort: 4h + 2h = **6h**

**X API Basic (가입 결정 시, §11 OQ-1)**:
- 신규 파일: `src/lib/pipeline/x_source.ts`
- 함수: `fetchTopTweet(keyword)`, `fetchMentionCount(keyword)` (X API v2 `/2/tweets/counts/recent`).
- env: `X_BEARER_TOKEN`. 미설정 시 no-op (deeplink 경로만 사용).
- 1시간 주기 배치 + 상위 5 키워드만 호출 (audit-C#L327).
- effort: 8h + 3h = **11h** (가입 후)

**Threads**:
- 신규 파일: `src/lib/pipeline/threads_oembed.ts`
- 함수: `fetchOembedThread(url)` — 공식 oEmbed.
- 검색 API 부재 (audit-C#L162) → mention count는 Tavily fallback.
- effort: 3h + 2h = **5h**

#### 5.2.9 GitHub stars Δ7d 수집 (vibe 신호 공급)

- 변경 파일: `src/lib/pipeline/github_releases_source.ts` 확장 또는 신규 `src/lib/pipeline/github_stars_history.ts`
- 함수: `fetchStarsDelta7d(repoFullName)` — `/repos/{owner}/{repo}` 응답의 stargazers_count 와 7일 전 캐시값 비교.
- 캐시 테이블: `github_stars_history (repo_full_name PK, snapshot_at TIMESTAMPTZ, stars INT)` 신규 권장.
- 이 값이 `KeywordCandidates.stars7dDelta` 에 채워짐.
- rate limit: 18 추적 리포 × 1 호출 = 18/스냅샷, GitHub PAT의 5000/h 한도에서 안전.
- effort: 5h + 3h = **8h**
- 의존: Phase 1 §3.2.2 (TRACKED_REPOS 확정)

#### 5.2.10 PH upvote velocity 신호 채우기

- 변경 파일: `src/lib/pipeline/product_hunt_top_source.ts:219-248`
- 기존 GraphQL 응답에서 24h votes 추출 → `KeywordCandidates.phUpvoteRate` 에 채움.
- effort: 2h + 1h = **3h**
- 의존: 없음

#### 5.2.11 Flutter 클라이언트 변경 범위 (모바일 PRD 위임)

> **본 PRD 범위 밖**. 인터페이스만 고정.

| 화면 | 필요 변경 | 위치 |
|---|---|---|
| 홈 Top10 카드 | `goldenPreview` 썸네일 5스트립 (옵션) | `lib/features/trends/presentation/trends_screen.dart` |
| 디테일 화면 | golden 5슬롯 카드 + deeplink 4 CTA 버튼 | `lib/features/trends/presentation/keyword_detail_screen.dart` (신규/확장) |
| 상태 보관 | `golden` 필드 파싱 | `lib/features/trends/state/trends_controller.dart` |
| 임베드 (선택) | X/Threads WebView 또는 oEmbed | 별도 모바일 PRD에서 결정 (audit-C#L226-232) |

→ 별도 산출물: **`docs/plans/2026-04-23-mobile-golden5-pivot.md`** (모바일팀 후속 PRD, 본 PRD 범위 외).

### 5.3 데이터/스키마 변경 (총괄)

| 변경 | 마이그 파일 | 우선순위 | 파괴적 |
|---|---|---|---|
| `sources.slot/metadata/language` 3 컬럼 | `2026_04_phase3_golden5.sql` (P0) | S2 | NO |
| `golden_slots` 테이블 | 동상 | S3 | NO (신규) |
| `manual_x_tweets`, `manual_threads_posts`, `manual_sns_handles` | 동상 | S5 | NO (신규) |
| `github_stars_history` (vibe용) | `2026_04_phase3_stars_history.sql` | S5 | NO (신규) |

### 5.4 회귀 테스트

| 차원 | 위치 | 케이스 |
|---|---|---|
| Unit | `source_category.test.ts` (확장) | classifySlot 5분류 |
| Unit | `golden5.test.ts` (신규) | 시나리오 1~5 (audit-C#L713-718): 모든 슬롯 채움, 한국어 우선, 단일 소스 → deeplink 폴백, 다양성 정책, X API enabled 케이스 |
| Unit | `sns_deeplinks.test.ts` (신규) | URL encode, UTM 파라미터, 한국어 키워드 |
| Integration | `keywords/[id]/route.test.ts` | schemaVersion=2, golden+sources 동시 존재, deeplinks 4개 |
| Integration | `__tests__/pipeline_phase3.integration.test.ts` (신규) | 1 스냅샷 → golden_slots 테이블 채워짐 → API 응답 검증 |
| E2E | `npm run test:api-shape` (신규 — schemathesis 또는 직접 jest) | v1 클라가 v2 응답에서 `sources` 정상 파싱 (하위 호환) |
| Observability | `golden_slots` 빈 슬롯 카운터 메트릭 | <5% 알람 |
| Observability | API `/api/v1/keywords/:id` P95 latency | +300ms 이상 시 알람 |

### 5.5 롤아웃 / 피처 플래그 / 모니터링

- **단계** (audit-C#L697-705):
  1. S2: §5.2.1~5.2.2 마이그. 데이터 NULL. v1 응답 영향 없음.
  2. S2-late: §5.2.7 `deeplinks` 4종만 응답에 추가 (early). Flutter 신규 빌드는 4 CTA 버튼만 추가.
  3. S3: §5.2.3~5.2.6 — 5슬롯 분류 + golden5 빌더 + API `golden` 필드. **API schemaVersion=2.**
  4. S4: §5.2.4 메타 보강 (YouTube duration/views, GitHub stars).
  5. S5: §5.2.8 (X/Threads collector — Tavily fallback) + §5.2.9 (stars Δ7d) → Phase 2 vibe 축에 신호 공급 시작.
  6. S6 (선택): §5.2.8 X API Basic 가입 분기.
- **Feature flag**:
  - `PIPELINE_GOLDEN5_ENABLED=true|false` — golden 빌더 on/off. false 시에도 schemaVersion=2 + null-filled shape 유지(§5.2.6.1 참조, N6 동기화)
  - `X_BEARER_TOKEN` 존재 여부 = X collector 자동 분기
  - `PIPELINE_VIBE_SNS_FROM_TAVILY=true|false` — Tavily 기반 mention count 사용 여부
- **모니터링**:
  | 지표 | 임계 | 알람 |
  |---|---|---|
  | golden_slots 빈 슬롯 비율 | 0% (deeplink 폴백 보장) | >5% page |
  | 디테일 응답 P95 | 베이스라인 +300ms 이내 | 초과 시 page |
  | manual_x_tweets enabled & expires_at 만료 | 0 만료 | >0 Slack |
  | X API 호출 수 (월) | <15k (Basic 한도) | >12k Slack |

### 5.6 리스크 & 완화

| 리스크 | 가능성 | 영향 | 완화 |
|---|---|---|---|
| `sources` 3분류 응답 제거 시 구 Flutter 클라 충돌 | 중 | 사용자 화면 깨짐 | v2.x 까지 `sources` 유지, v3에서 제거. §11 OQ-12 |
| Tavily site:x.com count의 부정확성으로 vibe 노이즈 | 중 | 랭킹 비신뢰 | Phase 2 vibe 가중치 단계 승급: S4 `w_vibe=0` → S5 후 `0.07` → S6 후 `0.18` (§4.2.6 타임라인 일치, N3 동기화). 정규화 훅이 합계 1.00 유지. |
| X API 약관 변경 (월 가격 인상) | 중 | 비용 폭증 | deeplink 폴백 항상 유지 + monthly cap |
| Threads URL 정규화 (threads.net vs threads.com) | 낮음 | 중복 행 | `normalizeThreadsUrl()` 신설, audit-C#L222 권고 |
| GitHub stars history 레이트리밋 초과 | 낮음 | 신호 누락 | 24h TTL 캐시, 18 리포 한정 |
| `golden_slots` 테이블 폭증 (스냅샷 N × 키워드 20 × 슬롯 5) | 중 | DB 비용 | retention 90일 (`scripts/db/cleanup.ts`에 추가) |
| 사용자가 deeplink 클릭 시 외부 앱 전환 — 체류 이탈 | 중 | 메트릭 변화 | UTM 파라미터로 트래픽 측정, 디테일 화면에서 임베드 A/B (audit-C#L227) |
| **Tavily 호출 한도 초과** (P1-5) | 중 (스냅샷당 최대 400 calls 가능, 일 1,600 calls) | 골든5 미생성·요금 폭증 | Owner: Backend/Pipeline. Trigger: `tavily_daily_calls > 800` (분간 모니터). Action: ① (keyword, slot) 24h TTL 캐시 적용, ② 슬롯당 1회 이상 시 추가 호출 skip, ③ `PIPELINE_VIBE_SNS_FROM_TAVILY=false` 자동 강제로 vibe 신호도 fallback. `scripts/snapshot/dryrun.ts` 출력의 `predicted_tavily_calls`로 PR 사전 검증. |

---

## 6. Cross-Phase: 공통 인프라

### 6.1 Feature Flag 인프라 (S1)

- 구현 파일: `src/lib/config/feature_flags.ts` (신규).
- 인터페이스:
  ```ts
  export interface FeatureFlags {
    pipelineRankingV2: boolean;
    pipelineGolden5: boolean;
    pipelineVibeSnsFromTavily: boolean;
    pipelineManualMaxSlots: number;
    pipelineManualAllowMissing: boolean;
    xApiEnabled: boolean;        // X_BEARER_TOKEN 유무 자동
  }
  export function loadFeatureFlags(env: NodeJS.ProcessEnv): FeatureFlags { ... }
  ```
- 호출자: `snapshot.ts`, `scoring.ts`, `manual_priority.ts`, `golden5.ts`.
- effort: 3h + 1h = **4h**

### 6.2 CI / 테스트 파이프라인 확장 (S1~S3)

- 신규 npm script:
  - `npm run test:feeds-smoke` — 신규 RSS 피드 HTTP 200 + 30일 1+ item (S1)
  - `npm run snapshot:dryrun` — DB 미반영 JSON 출력 (S2)
  - `npm run test:api-shape` — v1/v2 응답 호환 (S3)
- GitHub Actions: `.github/workflows/ci.yml` (확인 필요) — `feeds-smoke`는 nightly만 (네트워크 비용).
- effort: 3h + 2h = **5h**

### 6.3 메트릭/관측 (S2~S6)

- 메트릭 적재: `snapshot_meta` 또는 신규 `pipeline_metrics(snapshot_id, key, value, ts)`.
- 적재 항목 (Phase 2·3 통합):
  - `top10_swap_rate` (스냅샷 간 교체율)
  - `ko_media_inclusion_rate` (Top10 중 KO 매체 포함 키워드 수 / 10)
  - `manual_slot_occupancy_rate`
  - `patch_release_in_top5_count`
  - `vibe_score_avg_top10`
  - `golden5_empty_slot_count`
  - `keyword_detail_p95_ms`
- 대시보드: Vercel Analytics 또는 별도 (운영팀 결정).
- effort: 5h + 2h = **7h**

### 6.4 (보류) `sources.yaml` SSOT 마이그레이션

- §0.3 P1-O2 보류 결정. 트리거: 운영팀이 카테고리 쿼터 또는 yaml 편집을 명시 요청 시.
- 예상 effort: **20h** (loadSources, dispatchCollector, 테스트 7개+ 재작성).
- 별도 PRD 필요.

---

## 7. Pre-mortem (3 시나리오) — Deliberate

### 7.1 시나리오 #1 — "한국 사용자 만족도가 오히려 떨어졌다"

**가상 사건 (S6 후 2주)**: A/B 결과 v2 그룹의 7일 잔존율이 v1 대비 -8%. 사용자 피드백: "Top10에 모르는 한국 매체가 너무 많다", "어제 봤던 Cursor 기능이 사라졌다".

**원인 분석**:
- `language` 점수축이 KO 매체 30% → 50% 부스팅을 과도하게 하여 영문 키워드가 KO 매체 1건만 있어도 상위 진입 (`koRatio >= 0.2 → 1.0` 임계가 너무 낮음).
- stability delta 축소 (+0.04 → +0.01)로 어제의 1위가 30분 만에 5위로 내려가 "익숙한 키워드 사라짐" 체감.
- Phase 1에서 추가한 토스/우형/카카오 RSS 가 일반 IT 글(AI 무관)을 대량 토해냄 → KO 매체 풀 자체에 노이즈.

**대응**:
1. 즉시 `ranking_weights.w_language=0.04 → 0.02` 하향 조정 (NULL 회귀 가능).
2. `calculateLanguageScore` 임계 재튜닝 (`koRatio>=0.4 → 1.0`, `0.2 → 0.7`, `0.05 → 0.5`).
3. 토스/우형/카카오 RSS에 `topic_whitelist_keywords` 적용 (audit-A#L120, Phase 3-late) — AI 무관 글 제외.
4. stability `Top10 +0.01 → +0.02` 일부 회복.
5. 7일 추가 A/B → 결과 비교.

**예방 (사전 작업)**:
- 출시 전 v1/v2 dry-run 비교 보고서 (Top20 diff) 자동 생성하여 운영자 사전 승인 단계 추가.
- KO 매체 화이트리스트(audit-A 카테고리 Korea)에 `topic_filter` 추가 (RSS의 카테고리/키워드 필터).

### 7.2 시나리오 #2 — "수동 키워드 운영이 마비되었다"

**가상 사건 (S4 직후)**: slot-reserve 도입 후 운영자가 등록한 수동 키워드 10개 중 2개만 화면에 노출. 운영팀: "광고/PR 협찬 의뢰가 수동 키워드 노출을 전제로 진행됐는데 노출이 안 된다."

**원인 분석**:
- `requireMinTotalScore=0.35` 임계로 "신규 발표라 자연 점수가 낮은" 수동 키워드가 폴백됨.
- `allowMissingSources=false` 설정으로 "광고용 키워드(아직 뉴스 0건)"가 자동 제외.
- audit-B#L131-135에서 지적한 16배 인플레이션 제거의 부작용.

**대응**:
1. env `PIPELINE_MANUAL_ALLOW_MISSING=true` 임시 활성 → 광고 키워드 노출 복구.
2. `requireMinTotalScore=0.20` 으로 완화.
3. `manual_keywords` 테이블에 `force_show: boolean` 컬럼 추가 → 광고 키워드만 force=true.
4. `reserveManualSlots`에서 `force_show=true`는 anchor 무시.

**예방**:
- §11 OQ-8 (운영팀 워크플로우) 사전 인터뷰. slot-reserve 출시 1주 전 운영팀에 영향 안내·교육.
- `force_show` 컬럼은 §4.2.8 PR에 같이 포함하여 출시 즉시 가용.

### 7.3 시나리오 #3 — "DB 마이그레이션이 production에서 깨졌다"

**가상 사건 (S2)**: `2026_04_phase3_golden5.sql` 실행 중 `sources` 테이블 (수십만 행) `ALTER TABLE ADD COLUMN metadata JSONB` 가 Neon에서 long-running transaction 으로 인식되어 5분 락. cron snapshot 호출 4건 실패. 사용자 영향: Top10 갱신 지연 1회 (5h → 11h 사이).

**원인 분석**:
- Neon Postgres는 `ALTER TABLE ADD COLUMN` 자체는 instantaneous (NULL 디폴트는 메타데이터만 갱신)지만, `JSONB` 디폴트값을 표현식으로 지정하면 row rewrite 발생.
- 또는 동시 실행 트랜잭션이 `sources` 행 lock 보유.

**대응 (즉시)**:
1. 마이그 SQL 분리: §5.2.1 part1(ALTER COLUMN, 트랜잭션 1) + part2(`CREATE INDEX CONCURRENTLY`, 트랜잭션 밖)로 강제 분리. 컬럼 추가는 NULL 허용으로 row rewrite 없음 → 즉시 종료.
2. `ALTER TABLE` 전후 `pg_stat_activity` 확인 스크립트 (`scripts/db/preflight.ts` 신규).
3. 실행 시간대: KST 02~04시 (cron 실행 사이 가장 긴 갭).
4. 실패 시 rollback: 컬럼 추가는 비파괴이므로 그대로 두고 코드 분기로 NULL 처리. INVALID 인덱스는 §5.2.1 회복 절차로 처리.

**예방** (P0-3 Critic 반영 강화):
- **`CREATE INDEX CONCURRENTLY` + staging dry-run 5분 SLA**: production 적용 전 Neon staging branch에서 같은 row 수로 part2 실행 시간 측정. 인덱스당 5분 초과 시 운영팀 승인 후에만 production 진행.
- production 마이그 전 Neon 브랜치(staging)에서 같은 row 수로 실측.
- 마이그 SQL 각 ALTER 사이에 `SELECT pg_sleep(0.5);` 또는 별도 트랜잭션.
- cron `cron_realtime.yml` 일시 중단 옵션 (`SNAPSHOT_DISABLED=true` env) 사전 마련.
- 운영팀 사전 공지 (Slack #ops 1일 전).
- part2 실행 중 `pg_stat_progress_create_index` 폴링으로 진행률 모니터, 5분 SLA 위반 시 즉시 알람.

---

## 8. Expanded Test Plan — Deliberate

### 8.1 Unit (격리 테스트, ms-단위)

| 영역 | 파일 | 신규/확장 | 케이스 수 |
|---|---|---|---|
| Phase 1 RSS_FEEDS | `rss_feeds.test.ts` | 확장 | +6 |
| Phase 1 GDELT lang | `gdelt_source.test.ts` | 신규 | 5 |
| Phase 2 exclusions | `keyword_exclusions.test.ts` | 신규 | 9 |
| Phase 2 scoring v2 | `scoring.test.ts` | 확장 | +시나리오 A,C, **가중치 합 S4/S5/S6 모두 1.00 (P0-1)** , `calculateLanguageScore` locale=en/ko 분기 (§4.2.7.1, P1-7) |
| Phase 2 scoring weights normalize | `scoring.test.ts` | 확장 | (P0-1) `normalizeWeights()` 의 합 0/음수/정상 3 케이스 |
| Phase 3 schemaVersion gating | `keywords/[id]/route.test.ts` | 확장 | (P0-2) `PIPELINE_GOLDEN5_ENABLED=true` vs `false` 응답 비교: 두 케이스 모두 schemaVersion=2, golden 5 필드 존재성, deeplinks 4 필드 존재성 (URL 또는 null) |
| Phase 3 ?preview 파라미터 | `trends/top/route.test.ts`, `trends/hot/route.test.ts` | 확장 | (P1-6) `?preview=0` (필드 미포함) vs `?preview=1` (5필드 string\|null) vs `?preview=1`+flag off (5 null) |
| Phase 2 ranking_policy | `ranking_policy.test.ts` | 확장 | +시나리오 B,D |
| Phase 2 manual slot-reserve | `manual_priority.test.ts` | 신규 | +시나리오 E + force_show |
| Phase 2 dynamic_query KO | `dynamic_query.test.ts` | 신규/확장 | 3 |
| Phase 2 ranking_candidate_debug | `ranking_candidate_debug.test.ts` | 확장 | +3 |
| Phase 3 classifySlot | `source_category.test.ts` | 확장 | +5 |
| Phase 3 golden5 | `golden5.test.ts` | 신규 | 5 (시나리오 1~5) |
| Phase 3 sns_deeplinks | `sns_deeplinks.test.ts` | 신규 | 4 |
| Phase 3 normalizeThreadsUrl | `source_category.test.ts` | 확장 | +2 |

### 8.2 Integration (DB 또는 다중 모듈, s-단위)

| 영역 | 파일 | 검증 |
|---|---|---|
| Phase 1 한국 매체 진입 | `__tests__/snapshot.integration.test.ts` (신규) | mock RSS로 1회 스냅샷 → KO 매체 1+개 후보 진입 |
| Phase 2 v1/v2 호환 | `__tests__/ranking_v1_v2_compatibility.test.ts` (신규) | flag false 시 v1 동일, true 시 v2 분기 |
| Phase 3 마이그 멱등성 | `scripts/db/migrate.test.ts` (확장) | `IF NOT EXISTS` 2회 실행 동일 결과 |
| Phase 3 golden5 endto-end | `__tests__/pipeline_phase3.integration.test.ts` (신규) | 1 스냅샷 → golden_slots → API 응답 |

### 8.3 E2E (실서버/스테이징, m-단위)

| 영역 | 스크립트 | 검증 |
|---|---|---|
| Feed health | `npm run test:feeds-smoke` (신규) | 신규 6 RSS HTTP 200 + 최근 30일 1+ item |
| Snapshot dry-run | `npm run snapshot:dryrun` (신규) | DB 미반영, Top20 JSON 출력 → v1/v2 diff 비교 |
| API shape v1/v2 호환 | `npm run test:api-shape` (신규) | 구 Flutter 가 v2 응답의 `sources`만 파싱하면 정상 |
| Cron snapshot 실행 | GitHub Actions `cron_realtime.yml` 다음 정기 실행 | 신규 피드·신규 컬럼 정상 처리 |
| Production smoke | 수동 (S2/S3 출시 직후 30분) | `/api/v1/meta`, `/api/v1/trends/top?lang=ko`, `/api/v1/keywords/:id` 200 + 응답 시간 |

### 8.4 Observability (운영, h~d 단위)

| 메트릭 | 적재 위치 | 임계 | 알람 채널 |
|---|---|---|---|
| `top10_swap_rate` | `pipeline_metrics` 또는 stdout 로그 | 30~70% | <20% / >80% Slack |
| `ko_media_inclusion_rate` (Top10) | 동상 | ≥25% | <15% Slack |
| `manual_slot_occupancy_rate` (Top10) | 동상 | ≤30% | >50% page |
| `patch_release_in_top5_count` | 동상 | ≤1 | ≥3 Slack |
| `vibe_score_avg_top10` | 동상 | ≥0.3 (S6 이후) | <0.2 Slack |
| `golden5_empty_slot_count` | 동상 | 0 | >0 Slack |
| `keyword_detail_p95_ms` | API access log | baseline+300ms 이내 | 초과 시 page |
| `source_health.consecutive_failures` | `source_health` 테이블 | <5 | ≥5 자동 비활성+Slack |
| `x_api_monthly_calls` (S6 이후) | `pipeline_metrics` | <12k/월 | >12k/월 Slack |
| **`user_retention_7d_v1_vs_v2`** (P1-4) | analytics 이벤트 | v1 baseline -5% 이내 | -5% 초과 시 Slack #pipeline-alerts (Pre-mortem #1 조기 감지) |
| **`keyword_card_ctr_v1_vs_v2`** (P1-4) | analytics 이벤트 | v1 baseline -10% 이내 | -10% 초과 시 PagerDuty |
| **`flutter_schema_version_mismatch_count`** (P1-4) | Sentry 또는 클라 로그 | 0 | >0 시 Sentry 알람 (P0-2 응답 shape 위반 → roll-back 트리거) |
| **`tavily_broad_call_count_per_snapshot`** (P1-4·P1-5) | `pipeline_metrics` | ≤300/스냅샷 | >300 warning, >500 시 자동 vibe fallback (`PIPELINE_VIBE_SNS_FROM_TAVILY=false` 임시 강제) |

---

## 9. ADR (Architecture Decision Record)

### 9.1 Decision

**realtime-ai-trend-news web-server의 키워드 품질을 다음 3 Phase에 걸쳐 개선한다:**
1. **Phase 1**: RSS 피드 즉시 정비 (제거 4 + 추가 9), Reddit·YouTube·GitHub Releases 한국·바이브 확장, GDELT lang 라벨 개선.
2. **Phase 2**: 점수 모델을 6축 → 8축으로 확장 (`vibe`, `language` 신설), delta 계수 1/3 축소, exclusions prefix/regex 지원, dynamic_query KO baseline, manual priority slot-reserve 전환. Feature flag (`PIPELINE_RANKING_V2_ENABLED` + `ranking_weights.w_vibe/w_language` NULL 분기) 로 v1/v2 동시 운영 후 7일 A/B 결정.
3. **Phase 3**: `sources` 테이블에 `slot/metadata/language` 3 컬럼 + `golden_slots`/`manual_x_tweets`/`manual_threads_posts`/`manual_sns_handles` 4 신규 테이블. API `golden` 5슬롯 + `deeplinks` 4종 응답 추가 (schemaVersion=2). X·Threads·GitHub stars 신호 수집기로 Phase 2 vibe 축에 신호 공급. X API Basic 가입은 보류 (deeplink 폴백 항상 유지).

### 9.2 Drivers (재명시)

D1 한국 바이브코더 사용자 만족도 / D2 랭킹 변동 리스크 통제 / D3 SNS·GitHub 신호 비용 (§0.2 참조).

### 9.3 Alternatives Considered

| Alternative | 무효화 사유 |
|---|---|
| Phase 1 sources.yaml SSOT 즉시 (P1-O2) | 일정 1주 → 3주, 회귀 위험 증가, D2 위배. Cross-Phase 별도 트랙으로 보류 (§6.4). |
| Phase 2 가중치만 재배분 (P2-O1) | KO/바이브 신호 반영 불가, D1 미충족. |
| Phase 2 ML 학습 랭커 (P2-O3) | 사용자 데이터 부족, 스코프 폭증, 별도 PRD 필요 (§11 OQ-7). |
| Phase 3 deeplink-only (P3-O1) | 카드 차별화 없음, 골든5 미달성. |
| Phase 3 X API Basic 즉시 (P3-O3) | 월 $200 비용 승인 미확인, deeplink 폴백으로 즉시 시작 후 단계 승급 가능. |

### 9.4 Why Chosen

각 Phase에서 (a) **사용자 체감 변화 시점이 가장 빠르고**, (b) **회귀 위험이 가장 잘 통제되며**, (c) **외부 의존이 가장 적은** 옵션을 선택. 특히 Phase 2의 vibe 축 스켈레톤(기본 0.10) → Phase 3의 신호 공급 → 본격 발효의 단계적 결합이 가장 안전한 결합 경로.

### 9.5 Consequences

**긍정**:
- KO 매체 포함률 5.3% → ≥18% (Phase 1) → Top10 ≥25% (Phase 2 후).
- X·Threads 카테고리 노출 0% → 100% (Phase 3 deeplink).
- 바이브 신호(GitHub stars Δ7d, PH velocity)가 명시적 축 → 신규 도구 화제성 즉시 반영.
- API schemaVersion 도입 → 향후 진화 경로 명시화.

**부정 (의도적 트레이드오프)**:
- DB 컬럼·테이블 9개 추가 (`sources` 3 + 신규 6) → 운영 복잡도 증가.
- 점수 모델 변경으로 사용자 체감 랭킹 변동 → A/B 7일 + 운영자 사전 공지 필수.
- vibe 축이 Phase 2와 Phase 3에 걸쳐 의존 → 스켈레톤 출시 시 변별력 제한 기간 존재.
- `sources` 응답 deprecation 경로 (v3에서 제거) → Flutter 강제 업데이트 필요 시점 발생 (§11 OQ-12).

### 9.6 Follow-ups

- Phase 4 (별도 PRD): canonical alias 테이블 (audit-B R5).
- Phase 5 (별도 PRD): `sources.yaml` SSOT 마이그.
- Mobile PRD: Flutter 골든5 화면 + deeplink 4 CTA.
- Operations: 운영자 워크플로우 문서 (manual_x_tweets/threads CMS).
- Data: Neon read replica 도입 검토 (메트릭 적재 부하).

---

## 10. 작업 분해 — Executor 가이드

### 10.1 Phase 1 Tasks (총 14h + 회귀)

| ID | 제목 | 변경 파일 | effort | 의존 |
|---|---|---|---|---|
| P1-T1 | RSS_FEEDS 제거 4 + 추가 9 | `src/lib/pipeline/rss.ts:39-96`, `rss_feeds.test.ts:14-91` | 1.5h | — |
| P1-T2 | GitHub Releases 추가 4 | `github_releases_source.ts:5-21` + 신규 test | 1.5h | — |
| P1-T3 | Reddit 서브 추가 4 | `reddit_source.ts:3-13` + 신규 test | 1h | — |
| P1-T4 | YouTube 한국 채널 +4 | `youtube_source.ts:11-34` | 1h | OQ-3 (channelId) |
| P1-T5 | Tier 강등 (Google Research, MIT TR) | `rss.ts:44, 46` | 0.5h | P1-T1 |
| P1-T6 | GDELT lang 매핑 + RssItem.lang 타입 확장 | `gdelt_source.ts:77`, `rss.ts` 또는 `keywords.ts` | 2h | — |
| P1-T7 | (선택) GDELT KO 호출 이중화 | `gdelt_source.ts` `collectGdeltItems` | 3h | P1-T6 |
| P1-T8 | source_health 테이블 + 5연속 실패 자동 비활성 | `schema.sql`, `snapshot.ts:355-363`, 신규 마이그 | 4h | — |
| P1-T9 | feeds-smoke npm script + nightly CI | `package.json`, `.github/workflows/feeds-smoke.yml` (신규) | 2h | P1-T1 |
| P1-T10 | Phase 1 회귀 통합 테스트 | `__tests__/snapshot.integration.test.ts` 신규 | 3h | P1-T1~T6 |

### 10.2 Phase 2 Tasks (총 ~47h + 회귀, P0-1·P1-7·P1-8 Critic 반영 +2h)

| ID | 제목 | 변경 파일 | effort | 의존 |
|---|---|---|---|---|
| P2-T1 | exclusions exact+prefix+regex | `keyword_exclusions.ts`, `keyword-exclusions.json` + 신규 test | 4h | — |
| P2-T2 | policy delta 계수 축소 | `ranking_policy.ts:329-359` + 기존 test 갱신 | 3h | — |
| P2-T3 | stability delta 축소 | `ranking_policy.ts:423-464` | 2h | P2-T2 (같은 PR 권장) |
| P2-T4 | dynamic_query KO baseline | `dynamic_query.ts:3-6` + test | 1.5h | — |
| P2-T5 | KeywordCandidates 인터페이스 확장 (domainsByLang, vibe 신호) | `keywords.ts`, `snapshot.ts:836-840` | 5h | P1-T6 |
| P2-T6 | language 점수축 + DEFAULT_WEIGHTS 재배분 | `scoring.ts:15-22, 135-209` + test | 6h | P2-T5 |
| P2-T7 | vibe 점수축 (스켈레톤, 기본 0.10) | `scoring.ts` | 5h | P2-T5 |
| P2-T8 | velocity compress + 음수 허용 | `scoring.ts:100-105` | 2h | P2-T6 (같은 PR) |
| P2-T9 | manual slot-reserve 전환 + force_show 컬럼 (P1-8) | `manual_priority.ts`, `snapshot.ts:104-115`, `manual_keywords` 마이그 | 8h + 1h SQL + 2h force_show 처리·테스트 = **11h** | P2-T6 |
| P2-T10 | ranking_candidate_debug 확장 | `ranking_candidate_debug.ts:27-82` | 2.5h | P2-T6, P2-T7 |
| P2-T11 | Feature flag + ranking_weights v_vibe/w_language 마이그 | `snapshot.ts:205-261`, 신규 마이그 SQL, `feature_flags.ts` | 5h | P2-T6, P2-T7 |
| P2-T12 | Phase 2 회귀 시나리오 A~E 통합 | `scoring.test.ts`, `ranking_policy.test.ts`, `manual_priority.test.ts` | 5h | P2-T6~T11 |
| P2-T13 | snapshot:dryrun npm script | `scripts/snapshot/dryrun.ts` (신규) | 4h | P2-T11 |

### 10.3 Phase 3 Tasks (총 ~70h + 회귀)

| ID | 제목 | 변경 파일 | effort | 의존 |
|---|---|---|---|---|
| P3-T1 | sources.slot/metadata/language 마이그 | `schema.sql`, `2026_04_phase3_golden5.sql` 신규 | 3h | — |
| P3-T2 | golden_slots/manual_x_tweets/manual_threads_posts/manual_sns_handles 마이그 | 동상 | 3h | P3-T1 |
| P3-T3 | classifySlot 5분류 + 호환 유지 | `source_category.ts` + test | 4h | P3-T1 |
| P3-T4 | normalizeThreadsUrl + threads.com → threads.net 정규화 | `source_category.ts` 또는 신규 utils | 1.5h + 0.5h = 2h | — |
| P3-T5 | insertSource() slot/metadata/language 채우기 | `snapshot.ts:738-754`, `db/queries.ts` | 3h | P3-T1, P3-T3 |
| P3-T6 | YouTube 메타 보강 (duration/views/channelId) | `youtube_source.ts`, `youtube_recommend_source.ts` | 3h | P3-T5 |
| P3-T7 | GitHub 메타 보강 (stars/language/release) | `github_source.ts`, `github_releases_source.ts` | 2h | P3-T5 |
| P3-T8 | Reddit 메타 보강 (subreddit/ups/comments) | `reddit_source.ts` | 1.5h | P3-T5 |
| P3-T9 | PH 메타 보강 (votes/maker/upvoteRate) | `product_hunt_top_source.ts:219-248` | 2h | P3-T5 |
| P3-T10 | sns_deeplinks.ts 유틸 | `src/lib/pipeline/sns_deeplinks.ts` 신규 + test | 3h | — |
| P3-T11 | golden5.ts 빌더 + 슬롯 score 함수 5종 + 폴백 체인 | `golden5.ts` 신규 + test | 12h | P3-T3, P3-T5, P3-T10 |
| P3-T12 | API `/keywords/:id` v2 응답 (`golden`, `deeplinks`, `schemaVersion`) | `src/app/api/v1/keywords/[id]/route.ts:75-131` + test | 7h | P3-T11 |
| P3-T13 | trends/top·hot·search 응답 진화 (`?preview=1`) | 3 route files | 5h | P3-T12 |
| P3-T14 | x_mention_count.ts (Tavily fallback) | 신규 + test | 6h | — |
| P3-T15 | threads_oembed.ts | 신규 + test | 5h | — |
| P3-T16 | github_stars_history.ts + 캐시 테이블 | 신규 + 마이그 + test | 8h | P1-T2 |
| P3-T17 | KeywordCandidates에 신호 채우기 (collector → candidates) | `snapshot.ts:836-840` 부근 | 3h | P3-T14, P3-T16, P3-T9, P2-T5 |
| P3-T18 | (선택) X API Basic — `x_source.ts` | 신규 | 11h | OQ-1 결정 |
| P3-T19 | golden_slots retention 90일 cleanup | `scripts/db/cleanup.ts` | 1.5h | P3-T2 |
| P3-T20 | Phase 3 통합·시나리오 1~5 회귀 | `golden5.test.ts`, `pipeline_phase3.integration.test.ts` | 6h | P3-T11, P3-T12 |

### 10.4 Cross-Phase Tasks (총 ~16h)

| ID | 제목 | effort | 의존 |
|---|---|---|---|
| X-T1 | feature_flags.ts 인프라 | 4h | — |
| X-T2 | CI: feeds-smoke + snapshot:dryrun + test:api-shape | 5h | P1-T9 |
| X-T3 | pipeline_metrics 적재 + 대시보드 hook | 7h | P2-T11, P3-T12 |

### 10.5 ID·effort·의존 요약

| Phase | Task 수 | 총 effort | 의존성 핵심 |
|---|---|---|---|
| Phase 1 | 10 | 19.5h | P1-T6 → P2-T5 |
| Phase 2 | 13 | 53h | P2-T5 → P2-T6,T7 → P2-T11 |
| Phase 3 | 20 | 87h | P3-T1 → 전체 마이그 의존 / P3-T11이 큰 hub |
| Cross | 3 | 16h | X-T1 → P2/P3 모든 flag 분기 |
| **합계** | **46** | **~178.5h** (P0-1 +1h, P1-6 +1h, P1-8 +2h, P2-T9 +2h, §4.2.7.1 +0.5h 반영) | (병렬 가능 영역 다수, 1인 1일 6h 가정 시 ~30 영업일 = 6주 = S1~S6 일정 일치) |

> footnote² (P2-11 Critic 반영): **합계 178.5h는 단일 시퀀셜 작업 가정**. 실제 일정은 다음 병렬화로 단축 가능:
>
> - **트랙 A (Backend/Pipeline)**: Phase 1 전부 + Phase 2 §4.2.1~4.2.10 + Phase 3 §5.2.1~5.2.5, §5.2.8~5.2.10 (≈ 130h)
> - **트랙 B (Backend/API + SRE)**: Cross-Phase X-T1~T3 + Phase 2 §4.2.11~12 + Phase 3 §5.2.6~5.2.7 (≈ 30h)
> - **트랙 C (Mobile)**: §5.2.11 별도 PRD로 위임 — 본 합계에서 제외
>
> **외부 결정자 lead time**은 effort에 포함하지 않음 (PR/구현 시간만 산정):
>
> - **OQ-1 (X API Basic 가입 결정)**: 사업/예산 승인 ≈ 1~2주 lead, 가입 후 P3-T18 11h
> - **OQ-3 (YouTube 4 신규 채널 channelId 확보)**: 데이터 엔지니어 작업 1일
> - **OQ-9 (DB 마이그 다운타임 정책)**: DevOps 운영팀 동의 1주
>
> 위 lead time을 모두 포함하면 캘린더 기준 **6~8주 (S1~S8)** 가 현실적 일정.

### 10.6 Owner 매핑 (제안)

| Owner 역할 | 담당 Task |
|---|---|
| Backend / Pipeline | Phase 1 전부, Phase 2 전부, Phase 3 P3-T1~T11, T14~T17, T19, X-T1, X-T3 |
| Backend / API | Phase 3 P3-T12, T13 |
| Mobile (별도 PRD) | Flutter 골든5 화면 (§5.2.11) |
| DevOps | X-T2 (CI), Phase 3 마이그 production 실행 (Pre-mortem #3) |
| Operations | manual_x_tweets/threads CMS (Phase 3 Late, S5 후) |

---

## 11. 미해결 질문 (Open Questions)

> 사용자 또는 운영팀 결정이 필요. PRD 본문에서 보류된 모든 항목.

| OQ # | 질문 | 결정자 | 마감 (Phase 의존) | 디폴트 (미결시) |
|---|---|---|---|---|
| OQ-1 | **X API Basic 가입 여부 ($200/mo)** — Phase 3 P3-T18을 진행할지. 미가입 시 골든5 X 슬롯은 영구 deeplink. | 사업/예산 | S6 시작 전 | 미가입 (deeplink) |
| OQ-2 | **`sources.yaml` SSOT 전환 시점** — Phase 1 직후? Phase 3 후? | 운영팀 | Phase 3 종료 후 | 보류 (별도 PRD) |
| OQ-3 | **YouTube 한국 4 신규 채널 channelId** — 안될공학/노마드코더/드림코딩/메타코드M 정확한 ID. yt-dlp 또는 YouTube Data API로 확보. | 데이터 엔지니어 | S3 시작 전 | TODO 주석 후 1주 보류 |
| OQ-4 | **Threads 검색 정책** — Meta 공식 검색 API 미공개. deeplink+관리자 큐레이션을 장기 전략으로 유지할지, 또는 Threads 포기 후 Reddit을 2순위 SNS로 승격할지. | 제품 | Phase 3 시작 전 | deeplink+큐레이션 유지 |
| ~~OQ-5~~ | **(승격 — §4.2.7.1로 본문 결정)** `lang=en` 사용자에는 `languageScore=0.5` 중립 강제, `lang=ko` 사용자에만 KO 매체 부스팅. P1-7 Critic 반영. | — | — | (결정 완료) |
| OQ-6 | **임베드 vs deeplink 기본값** — Flutter WebView 임베드 로드 1~3s. 기본 임베드로 할지 deeplink로 할지. A/B 필요. | 모바일/제품 | Phase 3 모바일 PRD | deeplink 우선 (임베드는 슬롯 1개만) |
| OQ-7 | **canonical alias 테이블의 source** — 정적 JSON / 관리자 UI / LLM 자동 클러스터링 중 무엇으로? Phase 4 별도 PRD 필요. | 운영팀 | Phase 4 PRD | 정적 JSON MVP |
| ~~OQ-8~~ | **(승격 — §4.2.8로 본문 결정)** `PIPELINE_MANUAL_MAX_SLOTS=3`, `PIPELINE_MANUAL_ALLOW_MISSING=false`, `manual_keywords.force_show` 컬럼을 P2-T9 PR에 동시 출시. P1-7 Critic 반영. | — | — | (결정 완료) |
| OQ-9 | **DB 마이그레이션 다운타임 정책** — Pre-mortem #3 대비. KST 02~04시 cron pause + 운영팀 사전 공지 필요. | DevOps | Phase 3 §5.2.1 직전 | KST 03시, cron 30분 pause |
| OQ-10 | **`primary_type` 백필 범위** — 기존 키워드 수만 건의 `primary_type`을 5슬롯으로 백필할지, 신규 스냅샷부터만 적용할지. | 데이터 엔지니어 | Phase 3 §5.2.6 출시 전 | 신규 스냅샷부터만 (안전) |
| OQ-11 | **YouTube 쇼츠 취급** — 골든5 video 슬롯에 쇼츠 포함할지. | 제품 | Phase 3 §5.2.5 | 60s 이상만 (쇼츠 제외) |
| OQ-12 | **`sources` 응답 deprecation 시점** — v2에서 유지, v3에서 제거. v3 출시 시 Flutter 강제 업데이트 필요. | 모바일 | v3 PRD | v2.x 6개월 유지 후 v3 |
| OQ-13 | **RSSHub 의존 허용** — X/Threads 비공식 프록시 운영 환경 사용 가능 여부. 자체 호스팅 하면 effort 추가. | 인프라 | Phase 3 후속 | 비허용 (deeplink 우선) |
| OQ-14 | **한국 언론사 TOS 재시도** — `AI타임스`/`전자신문` (이전 차단)을 재시도할지. User-Agent 정책 결정. | 법무/제품 | Phase 1 후속 | 보류 (현 카탈로그로 충분) |
| OQ-15 | **Stability vs dynamic_query 충돌 해소** — 수집은 "2회 이상 제외" vs 랭킹은 "기존 Top10 부스팅". 신선/안정 trade-off 정책 방향. | 제품 | Phase 2 vibe 출시 후 | 안정 가중 약화 (delta 축소로 자동 해소) |
| OQ-16 | **`PIPELINE_REALTIME_*` 환경변수 production 실측값** — recencyHalfLifeHours 등이 진짜 9h인지 확인 필요. | DevOps | Phase 2 시작 전 | 디폴트 사용 가정 |
| OQ-17 | **golden_slots retention 정책** — 90일이면 충분? 메트릭 분석 필요 시 더 길게. | 데이터 | Phase 3 §5.2.5 | 90일 |
| OQ-18 | **Changelog 스크레이프 모니터링 임계** — `changelog_source.ts`가 0건 연속 N회 실패 시 알람 임계. | DevOps | Phase 1 후속 | 3회 연속 0건 |

### 11.1 (Analyst 미사용) Open Questions 영속화

본 PRD는 planner 단독 작성으로 analyst 호출이 발생하지 않았음. 위 OQ-1~OQ-18을 `.omc/plans/open-questions.md`로 별도 export 권장 (본 PRD 본문이 SSOT이므로 동기화 시점은 1주 단위 권장).

---

## 12. 참고 — 보고서 인용 매핑

> 본문에서 사용한 `audit-A#L<line>` / `audit-B#L<line>` / `audit-C#L<line>` 표기의 원본 위치 매핑.

### 12.1 Subtask A — `2026-04-22-source-catalog-audit.md`

| 표기 | 위치 | 내용 |
|---|---|---|
| audit-A#L9-13 | §0 Executive Summary | 38 RSS + 8 비-RSS, 한국어 비중 4건, 제거/추가 권고 |
| audit-A#L21-65 | §1.1 RSS_FEEDS 카탈로그 표 | 38 피드 전수 |
| audit-A#L70-79 | §1.2 비-RSS 경로 표 | GDELT/HN/YouTube/Changelog/GitHub/PH/Reddit |
| audit-A#L113-119 | §1.3 rss.json 시드 드리프트 | Aider/LiteLLM/Open WebUI 누락 |
| audit-A#L209-220 | §3.2 추천 에디터 Changelog | Cursor/Windsurf/Zed/Replit/v0/Aider |
| audit-A#L259-269 | §3.6 한국어 매체 추천 | 토스/우형/카카오/네이버/요즘IT/GeekNews Blog |
| audit-A#L283-294 | §4 제거·교체 권고 표 | R1~R12 |
| audit-A#L304-309 | §5.1 한국어 매체 비중 수치 | 5.3% / 21.0% |
| audit-A#L329-353 | §6 도입 우선순위 로드맵 | Phase 1~3 |
| audit-A#L443-557 | §10 sources.yaml SSOT 의사코드 | yaml/loader/dispatcher |
| audit-A#L588-672 | §11 diff 스니펫 | RSS, github_releases, reddit, youtube |
| audit-A#L697-708 | §12.3 source_health SQL | 헬스체크 테이블 |
| audit-A#L728-742 | §14 추천 YouTube 10선 | 한국 5채널 |
| audit-A#L781-799 | §16 미해결 질문 | OQ-1~15 |

### 12.2 Subtask B — `2026-04-22-scoring-ranking-audit.md`

| 표기 | 위치 | 내용 |
|---|---|---|
| audit-B#L9-25 | §0 Executive Summary | 6축 + 3단 delta, 약점 표 |
| audit-B#L34-39 | §1.1 6축 점수 구조 표 | scoring.ts 상수 |
| audit-B#L44-72 | §1.2 파이프라인 단계별 점수 변형 | snapshot.ts:853-946 |
| audit-B#L84-91 | §2.1 한국어 편향 증거 표 | TIER_AUTHORITY 언어 차원 부재 |
| audit-B#L131-135 | §2.6 Manual Priority 16배 | snapshot.ts:104-109 |
| audit-B#L156-189 | §2.9.1 exclusions diff | exact+prefix+regex |
| audit-B#L194-205 | §2.9.2 Policy delta 축소 diff | ±0.04~0.12 → ±0.005~0.04 |
| audit-B#L240-251 | §2.9.4 dynamic_query KO baseline | BASE_TERMS_KO |
| audit-B#L259-265 | §2.9.5 Velocity compress | (centered+1)/2 |
| audit-B#L272-287 | §2.9.6 Candidates 인터페이스 확장 | domainsByLang, stars7dDelta 등 |
| audit-B#L295-303 | §3.1 추가 시그널 표 | S1~S6 (stars/PH/SNS/KO/cluster/balance) |
| audit-B#L362-373 | §4.1 가중치 표 (제안) | recency 0.22, frequency 0.10, vibe 0.14, language 0.04 |
| audit-B#L380-455 | §4.2 신모델 의사코드 | calculateScoreV2 |
| audit-B#L460-463 | §4.3 Delta 레이어 축소 표 | policy/stability/manual |
| audit-B#L468-502 | §4.4 Manual slot-reserve 의사코드 | reserveManualSlots |
| audit-B#L513-567 | §5 회귀 시나리오 5종 | A~E |
| audit-B#L656-671 | §10 권고별 영향도 매트릭스 | R1~R12 우선순위 |
| audit-B#L750-799 | §13 Rollout 플랜 + Feature Flag | PIPELINE_RANKING_V2_ENABLED |

### 12.3 Subtask C — `2026-04-22-content-sns-quality.md`

| 표기 | 위치 | 내용 |
|---|---|---|
| audit-C#L13-22 | §0 TL;DR 표 | news/social/data → 5슬롯 |
| audit-C#L44-61 | §1.2 카테고리별 도메인 표 | SOCIAL_DOMAINS 22 / DATA_DOMAINS / github 미등록 |
| audit-C#L93-99 | §1.5 분류 결함 요약 | github.com 누락 |
| audit-C#L114-127 | §1.7 버려지는 메타데이터 표 | YouTube duration/GitHub stars/Reddit ups |
| audit-C#L141-156 | §2.2 X 통합 옵션 표 + 권장 | deeplink 1순위 |
| audit-C#L161-173 | §2.3 Threads 옵션 + 권장 | deeplink + manual 큐레이션 |
| audit-C#L191-197 | §2.5 SNS 통합 우선순위 표 | C-1 ~ C-7 |
| audit-C#L201-220 | §2.6-7 X/Threads deeplink 파라미터 | f=live, threads.net |
| audit-C#L252-260 | §3.1 골든5 슬롯 정의 | 뉴스1+GitHub1+YouTube1+X1+Threads1 |
| audit-C#L267-339 | §3.2 슬롯별 score 함수 | scoreNews/Repo/Video/XPost/Thread |
| audit-C#L344-372 | §3.3 골든5 빌더 의사코드 | buildGolden5 |
| audit-C#L394-430 | §3.6 슬롯 폴백 체인 | sentinel·deeplink |
| audit-C#L432-440 | §3.7 슬롯 품질 하한 표 | likeCount/stars/duration |
| audit-C#L460-468 | §4.1 카드 UI 필드 표 | 뱃지·메타 |
| audit-C#L520-528 | §5.1 DB 스키마 변경 표 | sources.slot/metadata/language |
| audit-C#L563-632 | §5.5 마이그 SQL 초안 | golden_slots/manual_x/threads/handles |
| audit-C#L639-682 | §5.6 API 응답 v2 인터페이스 | KeywordDetail_v2 |
| audit-C#L686-692 | §5.7 하위 호환 정책 타임라인 | v1 → v2 → v3 |
| audit-C#L697-705 | §6 구현 로드맵 sprint 표 | S1~S5 |
| audit-C#L713-718 | §7 회귀 시나리오 5건 | 모든 슬롯 채움 등 |
| audit-C#L725-731 | §8 위험 요소 표 | X 요금/Threads ToS/Tavily 품질 |
| audit-C#L737-744 | §9 사용자 만족 체크리스트 | 빈 슬롯 0% 등 |
| audit-C#L789-801 | §11 미해결 질문 | OQ-1~12 |

### 12.4 보조 인용

| 표기 | 위치 |
|---|---|
| `_team-task.md:6-9, 69-95` | 사용자 컨텍스트 + Subtask C 요구사항 |
| `web-server/CLAUDE.md:15` | KST 05/11/17/23시 스냅샷 주기 |
| `_pipeline_reference/workflow/resources/rss.json:141-162` | diversity_quotas + source_weights 시드 |
| `_pipeline_reference/workflow/resources/rss.json:286-299` | P0_RELEASES 13 (Aider/LiteLLM/Open WebUI 누락) |

---

## 13. 부록 — 환경변수 / 마이그레이션 / npm 스크립트 요약

### 13.1 신규 환경변수

| ENV | 디폴트 | 도입 Phase | 설명 |
|---|---|---|---|
| `PIPELINE_RANKING_V2_ENABLED` | `false` | Phase 2 §4.2.12 | v2 점수 모델 활성 (DB w_vibe/w_language NULL이면 코드 분기로 v1 강제) |
| `PIPELINE_GOLDEN5_ENABLED` | `false` | Phase 3 §5.2.6 | API `golden`/`deeplinks` 필드 채움 활성. flag off 시에도 schemaVersion=2 + null-filled shape 유지 (P0-2 §5.2.6.1) |
| **`PIPELINE_API_SCHEMA_VERSION`** (P0-2) | `(unset → GOLDEN5_ENABLED 연동)` | Phase 3 §5.2.6.1 | optional override. `1` 명시 시 `golden`/`deeplinks` 필드 자체 생략 (구 Flutter 호환). `2` 명시 시 GOLDEN5_ENABLED 와 무관하게 v2 shape 유지 |
| `PIPELINE_MANUAL_MAX_SLOTS` | `3` | Phase 2 §4.2.8 | manual slot-reserve 최대 슬롯 |
| `PIPELINE_MANUAL_ALLOW_MISSING` | `false` | Phase 2 §4.2.8 | 소스 0건 manual 키워드 허용 (광고용) |
| `PIPELINE_VIBE_SNS_FROM_TAVILY` | `true` | Phase 3 §5.2.8 | Tavily 기반 SNS mention count 사용 |
| `X_BEARER_TOKEN` | (none) | Phase 3 §5.2.8 옵션 | X API Basic 키 (가입 시) |
| `SNAPSHOT_DISABLED` | `false` | Cross-Phase | cron 일시 중단 (마이그 시) |

### 13.2 신규 마이그레이션 SQL 파일

| 파일 | Phase | 내용 |
|---|---|---|
| `scripts/db/migrations/2026_04_phase1_source_health.sql` | 1 | `source_health` 테이블 |
| `scripts/db/migrations/2026_04_phase2_ranking_v2.sql` | 2 | `ranking_weights.w_vibe/w_language`, `snapshot_meta.weights_json`, **`manual_keywords.force_show`** (P1-8) |
| `scripts/db/migrations/2026_04_phase3_golden5_part1_columns.sql` | 3 | (P0-3) `sources.slot/metadata/language` ALTER + `golden_slots`/`manual_x_tweets`/`manual_threads_posts`/`manual_sns_handles` CREATE TABLE — 단일 트랜잭션 |
| `scripts/db/migrations/2026_04_phase3_golden5_part2_indexes.sql` | 3 | (P0-3) `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sources_slot/idx_sources_language` — 트랜잭션 밖 |
| `scripts/db/migrations/2026_04_phase3_stars_history.sql` | 3 | `github_stars_history` |

### 13.3 신규 npm scripts

| Script | 목적 | Phase |
|---|---|---|
| `npm run test:feeds-smoke` | nightly RSS HTTP 200 + 30일 1+ item | 1 |
| `npm run snapshot:dryrun` | DB 미반영 Top20 JSON 출력 | 2 |
| `npm run test:api-shape` | v1/v2 응답 호환 | 3 |
| `npm run db:migrate:phase1` | Phase 1 마이그 실행 | 1 |
| `npm run db:migrate:phase2` | Phase 2 마이그 실행 | 2 |
| `npm run db:migrate:phase3` | Phase 3 마이그 실행 | 3 |

### 13.4 신규/수정 핵심 파일 일람 (executor용 빠른 인덱스)

| 파일 | 종류 | Phase | Task ID |
|---|---|---|---|
| `src/lib/pipeline/rss.ts` | 수정 | 1 | P1-T1, P1-T5 |
| `src/lib/pipeline/rss_feeds.test.ts` | 수정 | 1 | P1-T1 |
| `src/lib/pipeline/github_releases_source.ts` | 수정 | 1 | P1-T2 |
| `src/lib/pipeline/reddit_source.ts` | 수정 | 1 | P1-T3 |
| `src/lib/pipeline/youtube_source.ts` | 수정 | 1 | P1-T4 |
| `src/lib/pipeline/gdelt_source.ts` | 수정 | 1 | P1-T6, P1-T7 |
| `src/lib/pipeline/keyword_exclusions.ts` | 수정 | 2 | P2-T1 |
| `src/config/keyword-exclusions.json` | 수정 | 2 | P2-T1 |
| `src/lib/pipeline/ranking_policy.ts` | 수정 | 2 | P2-T2, P2-T3 |
| `src/lib/pipeline/dynamic_query.ts` | 수정 | 2 | P2-T4 |
| `src/lib/pipeline/keywords.ts` | 수정 | 2 | P2-T5 |
| `src/lib/pipeline/scoring.ts` | 수정 | 2 | P2-T6, P2-T7, P2-T8 |
| `src/lib/pipeline/manual_priority.ts` | 수정 | 2 | P2-T9 |
| `src/lib/pipeline/snapshot.ts` | 수정 | 2 + 3 | P2-T5, P2-T9, P2-T11, P3-T5 |
| `src/lib/pipeline/ranking_candidate_debug.ts` | 수정 | 2 | P2-T10 |
| `src/lib/config/feature_flags.ts` | 신규 | Cross | X-T1 |
| `src/lib/db/schema.sql` | 수정 | 1+2+3 | P1-T8, P2-T9, P2-T11, P3-T1, P3-T2, P3-T16 |
| `src/lib/pipeline/source_category.ts` | 수정 | 3 | P3-T3, P3-T4 |
| `src/lib/pipeline/youtube_source.ts` | 수정 | 3 | P3-T6 |
| `src/lib/pipeline/youtube_recommend_source.ts` | 수정 | 3 | P3-T6 |
| `src/lib/pipeline/github_source.ts` | 수정 | 3 | P3-T7 |
| `src/lib/pipeline/product_hunt_top_source.ts` | 수정 | 3 | P3-T9 |
| `src/lib/pipeline/sns_deeplinks.ts` | 신규 | 3 | P3-T10 |
| `src/lib/pipeline/golden5.ts` | 신규 | 3 | P3-T11 |
| `src/app/api/v1/keywords/[id]/route.ts` | 수정 | 3 | P3-T12 |
| `src/app/api/v1/trends/top/route.ts` | 수정 | 3 | P3-T13 |
| `src/app/api/v1/trends/hot/route.ts` | 수정 | 3 | P3-T13 |
| `src/app/api/v1/search/route.ts` | 수정 | 3 | P3-T13 |
| `src/lib/pipeline/x_mention_count.ts` | 신규 | 3 | P3-T14 |
| `src/lib/pipeline/threads_oembed.ts` | 신규 | 3 | P3-T15 |
| `src/lib/pipeline/github_stars_history.ts` | 신규 | 3 | P3-T16 |
| `scripts/db/migrations/*.sql` | 신규 | 1+2+3 | 4 파일 |
| `scripts/snapshot/dryrun.ts` | 신규 | 2 | P2-T13 |
| `.github/workflows/feeds-smoke.yml` | 신규 | Cross | X-T2 |

### 13.5 출시 체크리스트 (Phase별 GO/NO-GO)

#### Phase 1 GO 조건
- [ ] P1-T1~T6 PR 머지
- [ ] feeds-smoke nightly 7일 100% pass
- [ ] cron 다음 4회 실행 정상
- [ ] 한국 매체 RSS 수집량 ≥1건/24h × 6 신규 피드

#### Phase 2 GO 조건
- [ ] P2-T1~T11 PR 머지
- [ ] 시나리오 A~E 5종 100% pass
- [ ] dryrun으로 Top20 v1/v2 diff 보고 운영자 승인
- [ ] **S4 출시 GO**: `w_vibe=0`, `w_language=0.08` 입력 후 7일 A/B (language 축 단독 검증, N4 동기화)
- [ ] **S6 최종 승급 GO**: `w_vibe=0.18`로 승격, vibe 신호 커버리지 ≥60% 확인 (N4)
- [ ] KO 매체 포함률 ≥25%, Top10 교체율 30~70%

#### Phase 3 GO 조건
- [ ] P3-T1~T20 PR 머지
- [ ] golden5 빈 슬롯 비율 0% 7일 유지
- [ ] API P95 latency baseline+300ms 이내
- [ ] `sources` v1 응답 구 Flutter 호환 검증
- [ ] **schemaVersion=2 응답에서 golden 5 필드 존재성 100% (null 허용)** (P0-2 Critic 반영)
- [ ] **`PIPELINE_GOLDEN5_ENABLED=false` 응답에서도 golden·deeplinks shape 유지 검증** (P0-2)
- [ ] **`flutter_schema_version_mismatch_count` 메트릭 24h 누적 0** (P1-4)
- [ ] **`tavily_broad_call_count_per_snapshot` 7일 평균 ≤300** (P1-5)
- [ ] manual_x_tweets/threads CMS 운영자 교육 완료

---

_End of Pipeline Quality Implementation Plan (2026-04-23)._
_분량 목표: 1200~2000줄 (현재 약 1300줄). RALPLAN-DR + 3 Phase + Pre-mortem + 8축 가중치표 + 46 Task 분해 + 18 Open Questions + Pre-mortem 3 시나리오 모두 포함._
