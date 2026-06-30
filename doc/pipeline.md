# AI 트렌드 위젯 — 파이프라인 동작 문서

> 최종 업데이트: 2026-06-08
> 관련 코드: `src/lib/pipeline/`

---

## 개요

스냅샷 파이프라인은 하루 4회(KST 09:10 / 11:10 / 13:10 / 15:10) 자동 실행되며,
AI 관련 RSS/API 소스를 수집해 트렌드 후보 Top20을 만들고 Top10 상세 데이터를 DB에 저장합니다. 같은 크론 안에서 YouTube 추천 영상 수집도 독립적으로 실행됩니다.

```
RSS/API 수집 → 후보 추출 → AI 클러스터링 → 스코어링 → Tavily+Naver 검색 보강 → 요약 생성 → DB 저장
YouTube 채널 RSS → 영상 metadata prefix 파싱 → longform/shorts 분류 → youtube_videos 저장
```

실행 진입점: `src/app/api/cron/snapshot/route.ts`
핵심 오케스트레이터: `src/lib/pipeline/snapshot.ts`

---

## 1단계: 소스 수집 (`src/lib/pipeline/`)

### 피드 구성

RSS 피드를 4개 티어로 분류합니다. 별도 API/RSS 수집기(Product Hunt Top, Reddit, GitHub, YouTube, Techmeme, Google Alerts 등)는 `snapshot.ts`의 `SOURCE_PLANS`에서 함께 실행됩니다. 티어는 이후 스코어링의 authority 점수에 반영됩니다.

| 티어 | 설명 | 예시 |
|---|---|---|
| `P0_CURATED` | 고품질 AI 공식 블로그 | OpenAI Blog, Anthropic Blog, HuggingFace Blog |
| `P1_CONTEXT` | AI 전문 뉴스 미디어 | TechCrunch AI, VentureBeat AI, The Verge AI |
| `P2_RAW` | 한국어 AI 뉴스 | ZDNet Korea 등 |
| `COMMUNITY` | 커뮤니티/RSS | Dev.to, HackerNews AI, Towards AI |

### 특수 RSS 소스

- `Google AI (The Keyword)`: `rss.ts`의 일반 RSS 카탈로그에 `P1_CONTEXT`로 포함합니다. Google 공식 AI 발표 채널이지만 PR 성격이 있어 최상위 공식 릴리스보다 한 단계 낮게 취급합니다.
- `Techmeme Big Tech`: `techmeme_source.ts`에서 Techmeme RSS를 읽고 Google, Microsoft, Apple, Meta, Amazon, NVIDIA, OpenAI, Anthropic 등 빅테크 키워드가 포함된 항목만 `P1_CONTEXT`로 수집합니다.
- `Google Alerts`: `google_alerts_source.ts`의 `GOOGLE_ALERTS_FEEDS`에 하드코딩된 Alert RSS만 수집합니다. Google Alerts RSS URL은 쿼리만으로 만들 수 없으므로 google.com/alerts에서 Alert를 만든 뒤 RSS feed URL을 `url` 필드에 넣어야 합니다. Alert 피드는 검색 결과 기반이라 노이즈가 높으므로 기본 tier는 `P2_RAW`입니다.

### 수집 조건

- **48시간 컷오프**: `pubDate` 또는 `isoDate` 기준으로 48시간 이내 아이템만 수집
  - RSS 2.0은 `pubDate`, Atom 피드는 `isoDate` 필드를 사용하므로 둘 다 확인
- **URL 기준 중복 제거**: 동일 URL 아이템은 한 번만 포함
- **오류 무시**: 피드 fetch 실패 시 해당 피드만 스킵, 전체 파이프라인은 계속 진행

### 예상 수집량

정상 동작 시 RSS와 API 수집기를 합쳐 수십~수백 개 아이템. 피드/API 가용성과 증분 윈도우에 따라 달라집니다.

### YouTube 추천 영상 수집 (`youtube_recommend_source.ts`)

키워드 랭킹용 `youtube_source.ts`와 별개로, 앱의 YouTube 메뉴와 홈 YouTube 스트립에 쓰는 추천 영상 테이블을 갱신합니다.

- 채널 목록: `youtube_recommend_channels` DB 테이블에서 읽음. 관리자 `/admin`의 YouTube 수집 채널 탭에서 관리
- 피드: `https://www.youtube.com/feeds/videos.xml?channel_id={channelId}`
- 기본 수집 윈도우: 최근 72시간
- 저장 필드: `video_id`, `channel_id`, `channel_name`, `title`, `thumbnail_url`, `video_url`, `published_at`, `duration_seconds`, `video_type`
- 썸네일: `https://i.ytimg.com/vi/{videoId}/hqdefault.jpg`
- 분류:
  - URL path가 `/shorts/{id}`이면 `shorts`
  - metadata에서 `lengthSeconds` 또는 `approxDurationMs`를 읽고 180초 이하이면 `shorts`
  - 180초 초과이면 `longform`
  - metadata 파싱 실패 시 `unknown`
- oversized YouTube HTML은 전체를 읽지 않고 앞쪽 prefix만 읽어 metadata를 찾습니다. prefix 안에 duration이 있으면 분류하고, 없으면 안전하게 `unknown`으로 남깁니다.
- 기존 `unknown` 행은 기본 `longform` 피드에 포함해 레거시 데이터가 홈/YouTube 기본 목록에서 사라지지 않게 합니다.

---

## 2단계: 후보 추출 (`keywords.ts` — `extractCandidates`)

수집된 아이템의 **제목(title)** 에서 규칙 기반으로 키워드 후보를 추출합니다.

### 추출 방식

**N-gram (2~4 단어 조합)**
```
제목: "OpenAI releases GPT-4o mini for enterprise customers"

2-gram: "OpenAI releases", "releases GPT-4o", "GPT-4o mini", "mini for", ...
3-gram: "OpenAI releases GPT-4o", "releases GPT-4o mini", ...
4-gram: "OpenAI releases GPT-4o mini", ...
```
- 시작 단어 또는 끝 단어가 불용어(stopword)인 경우 제외

**패턴 매칭** (모델명, 제품명 추출)
```
CamelCase   : "ChatGPT", "DeepSeek", "LlamaIndex"
연속 대문자  : "GPT", "LLM", "RAG", "AGI"
버전 포함   : "GPT-4o", "Qwen2.5", "Claude-3.5", "Llama-3.1"
```

### 불용어 목록

```
영어: update, release, version, new, latest, using, via, open, source, github ...
한국어: 한국, 대한, 관련, 발표, 공개, 출시, 업데이트
```

### 후보 집계

동일 키워드가 여러 아이템에 등장하면 합산:
- `count`: 등장 횟수
- `domains`: 출처 도메인 집합
- `latestAt`: 가장 최근 등장 시각
- `tier`: 처음 등장한 피드의 티어

30개 아이템 기준 약 500~600개 후보 생성.

### 필터링

count 내림차순으로 정렬 후 **상위 60개**만 다음 단계로 전달합니다.
(OpenAI API 호출 1회에 처리 가능한 적정 양)

---

## 3단계: AI 클러스터링 (`keywords.ts` — `clusterKeywords`)

60개 후보를 **gpt-4o-mini 1회 호출**로 동의어 클러스터로 묶습니다.

### 목적

동일 개념의 다양한 표기를 하나의 canonical 키워드로 통일합니다.
```
"GPT 4o", "gpt-4o", "GPT4o", "ChatGPT-4o"  →  canonical: "GPT-4o"
"Sam Altman", "Altman", "Sam Altman CEO"    →  canonical: "Sam Altman"
```

### 프롬프트

```
System: AI 키워드 정규화 엔진. 동일 개념의 후보들을 클러스터로 묶어라.
        다른 모델/제품은 반드시 구분 (GPT-4o ≠ GPT-4 Turbo).
        JSON 배열로만 응답.

User: [60개 후보 목록]
```

### 출력 형식

```json
[
  { "canonical": "GPT-4o", "aliases": ["GPT 4o", "gpt-4o", "GPT4o"] },
  { "canonical": "Sam Altman", "aliases": ["Altman", "Sam Altman CEO"] }
]
```

### 키워드 ID 생성 (`slugify`)

canonical 문자열에서 stable한 ID를 생성합니다.
- 영문: 소문자 + 공백 → `_` 치환  (`"GPT-4o"` → `"gpt_4o"`)
- 한글 등 CJK: 텍스트 해시 → `kw_xxxxxxxx` 형식

---

## 4단계: 스코어링 (`scoring.ts`)

각 정규화 키워드에 4가지 가중치로 점수를 산출하고 Top 10을 선정합니다.

### 점수 계산

```
total = recency × 0.35
      + frequency × 0.35
      + authority × 0.20
      + internal × 0.10
```

| 요소 | 가중치 | 계산 방식 |
|---|---|---|
| `recency` | 0.35 | 가장 최근 등장 시각 기준 지수 감쇠 (`e^(-λt)`, λ=1/24h) |
| `frequency` | 0.35 | 등장 횟수 정규화 (전체 후보 중 상대적 비율) |
| `authority` | 0.20 | 티어별 고정값: P0=1.0, P1=0.6, P2=0.3, COMMUNITY=0.2 |
| `internal` | 0.10 | 이전 스냅샷 대비 순위 상승 시 보너스 |

### 랭킹 품질 정책 (`ranking_quality_policy.ts`)

실시간 랭킹은 기본 점수와 기존 policy/stability/manual 보정 이후, final slicing 전에 품질 reason을 계산합니다. 기본 운영값은 `PIPELINE_QUALITY_SHADOW_ONLY=1`이며 이 상태에서는 reason만 만들고 순위는 바꾸지 않습니다.

품질 정책은 추가 OpenAI/Tavily/Naver 호출 없이 저장된 후보 점수와 수집된 source item만 사용합니다. 적용 가능한 reason code는 다음과 같습니다.

| 영역 | reason 예시 | 의미 |
|---|---|---|
| freshness | `recent_source`, `structured_release`, `breakout_velocity`, `community_interest`, `reignition`, `stale_no_evidence` | 72시간 날짜 단일 조건이 아니라 최신 출처/구조화 릴리스/관심도/재점화 중 하나를 OR 증거로 평가 |
| source | `missing_relevant_source` | 키워드 anchor와 출처 제목/본문/URL/domain 관련성이 낮음 |
| generic | `generic_unanchored`, `generic_anchored`, `specific_context_protected` | `MCP server`, `AI coding agent`, `Vibe Coding` 같은 broad keyword를 맥락 기반으로 감점/보호 |
| repeat | numeric delta reason | 2~3일 breakout은 유지하고, 3일 초과 stale evergreen은 감점하되 re-ignition은 감점 완화 |

품질 감점 합계는 하한으로 bounded 처리해 자연 score를 압도하지 않습니다. 수동 키워드는 기존 manual lifecycle 외의 quality delta를 적용하지 않습니다.

#### Rollout 순서

1. `PIPELINE_QUALITY_SHADOW_ONLY=1`로 3일 이상 reason을 수집하고 정상 키워드 손상 여부를 확인합니다.
2. `PIPELINE_SOURCE_QUALITY_ENABLED=1`을 먼저 켜서 무관 topSource 감점을 관찰합니다.
3. `PIPELINE_GENERIC_CONTEXT_POLICY_ENABLED=1`을 켜서 무맥락 broad keyword 감점을 관찰합니다.
4. `PIPELINE_REPEAT_EXPOSURE_POLICY_ENABLED=1`을 켜서 3일 초과 evergreen 억제를 관찰합니다.
5. API Top20 노출 품질이 충분히 검증되면 `PIPELINE_TOP20_LIGHTWEIGHT_GUARD_ENABLED=1`을 켭니다.

Rollback은 즉시 가능합니다. `PIPELINE_QUALITY_SHADOW_ONLY=1`로 되돌리고 `PIPELINE_SOURCE_QUALITY_ENABLED=0`, `PIPELINE_GENERIC_CONTEXT_POLICY_ENABLED=0`, `PIPELINE_REPEAT_EXPOSURE_POLICY_ENABLED=0`, `PIPELINE_TOP20_LIGHTWEIGHT_GUARD_ENABLED=0`을 배포하면 품질 정책은 reason 기록 또는 기존 노출 방식으로 돌아갑니다.

### 델타 랭크

현재 스냅샷의 순위와 직전 스냅샷 순위 차이.
```
delta_rank = 이전순위 - 현재순위   (양수 = 상승, 음수 = 하락, 0 = 유지)
is_new = true  (이전 스냅샷에 없던 키워드)
```

---

## 5단계: 외부 검색 보강 (`tavily.ts`, `naver_search.ts`)

Top 10 키워드 각각에 대해 Tavily Search API로 3가지 카테고리의 글로벌 소스를 수집하고,
Naver Search API 자격 증명이 있으면 한국 뉴스/블로그/카페글을 보수적으로 추가 수집합니다.

### 검색 타입별 설정

| 타입 | 목적 | 수집 수 |
|---|---|---|
| `news` | 뉴스/블로그/기사 | 6개 |
| `social` | 소셜/커뮤니티 반응 | 6개 |
| `data` | 유튜브/문서/PDF/연구자료/이미지·영상 소스 | 6개 |

Naver 보강 기본값:

| 타입 | Naver 엔드포인트 | 기본 수집 수 |
|---|---|---|
| `news` | `/v1/search/news.json` | 2개 |
| `social` | `/v1/search/blog.json` | 2개 |
| `social` | `/v1/search/cafearticle.json` | 2개 |

Naver 결과는 한국 자료 우선 노출을 위해 Tavily 결과와 병합 후 가산점 정렬합니다.
Naver 자격 증명이 없거나 호출에 실패하면 Tavily-only로 동작합니다.

### 호출 규모

```
Top 10 키워드 × 3 타입(보조 broad 질의 포함) = 약 30~50회 Tavily API 호출 / 스냅샷
Naver 활성화 시 Top 10 키워드 × 3 엔드포인트 = 30회 Naver API 호출 / 스냅샷
```

각 소스 카드에는 title, url, domain, publishedAt, snippet, imageUrl이 포함됩니다.

---

## 6단계: OG 이미지 추출 (`og-parser.ts`)

Tavily가 imageUrl을 제공하지 않은 소스에 대해 OG 이미지를 추가로 추출합니다.

### 처리 방식

```
1순위: Tavily가 제공한 imageUrl 사용
2순위: 해당 URL의 <meta property="og:image"> 추출
3순위: favicon
4순위: 기본 이미지 (/images/default-thumbnail.png)
```

- 키워드당 최대 15개 URL에 대해 처리
- `concurrency=5`로 병렬 처리

---

## 7단계: 요약 생성 (`summarize.ts`)

각 키워드의 뉴스 소스를 바탕으로 **gpt-4o-mini**가 한국어 요약을 생성합니다.

### 입력

해당 키워드의 뉴스 소스 5개의 title + snippet. 뉴스가 없으면 전체 소스 상위 5개 사용.

### 출력 제약

- **약 440자 이내** 한국어 (기본값, `SUMMARY_MAX_CHARS`로 조정 가능)
- 이모지 사용 금지
- 불릿/번호 목록 금지
- 자연스러운 문장체

### 호출 규모

```
Top 10 키워드 × 1회 = 10회 gpt-4o-mini 호출 / 스냅샷
```

---

## 8단계: DB 저장 (`snapshot.ts` → `queries.ts`)

처리된 데이터를 Neon Postgres에 저장합니다.

### 저장 테이블

```
snapshots       : 스냅샷 메타 (ID, 업데이트 시각, 다음 업데이트 시각)
keywords        : Top 10 키워드 + 점수 + 요약 + top source
sources         : 키워드별 소스 카드 (news/social/data, 최대 8개/타입)
keyword_aliases : canonical/ko/en alias 저장, 검색 join에 사용
youtube_videos  : 추천 YouTube 영상(title/thumbnail/duration/type)
manual_youtube_links : 관리자 수동 YouTube 큐레이션
youtube_recommend_channels : 추천 영상 수집 대상 채널
```

### 스냅샷 ID 형식

```
20260223_0900_KST   (YYYYMMDD_HHMM_KST)
```

---

## 전체 비용 추정 (스냅샷 1회)

| 항목 | 호출 수 | 비고 |
|---|---|---|
| OpenAI gpt-4o-mini | ~11회 | 클러스터링 1 + 요약 10 |
| Tavily Search | ~30~50회 | 키워드 10 × 카테고리 3(+broad, news 보충) |
| Naver Search | 최대 30회 | 키워드 10 × news/blog/cafe, 자격 증명 있을 때만 |
| OG 이미지 fetch | ~100회 | HTTP 요청, 비용 없음 |
| YouTube metadata fetch | 최근 72시간 영상 수만큼 | title/thumbnail은 RSS, duration/type은 HTML prefix 파싱 |
| **하루 합계** | gpt-4o-mini ~44회, Tavily ~120~200회, Naver 최대 ~120회 | 스냅샷 4회/일 |

---

## 실행 방법

### 로컬 수동 실행

```bash
curl -X GET http://localhost:3000/api/cron/snapshot \
  -H "Authorization: Bearer <CRON_SECRET>"
```

### GitHub Actions 자동 실행

`.github/workflows/cron_realtime.yml`에서 Vercel API를 호출합니다.

```yaml
schedule:
  - cron: "10 0,2,4,6 * * *" # KST 09:10 / 11:10 / 13:10 / 15:10
```

프로덕션에는 `APP_URL`, `CRON_SECRET` GitHub secret이 필요합니다.

### DB 마이그레이션

```bash
npm run db:migrate
```

---

## 알려진 한계 및 개선 방향

| 한계 | 원인 | 개선 방향 |
|---|---|---|
| P0_CURATED 피드 수집 불안정 | 일부 블로그 RSS URL 만료/변경 | 주기적 URL 검증 자동화 |
| 한국어 키워드 ID 가독성 낮음 | slugify가 CJK 제거 → 해시 사용 | 로마자 표기 변환 or UUID |
| 영문 키워드 편향 | 한국어 n-gram 추출 미지원 | 형태소 분석기 연동 (mecab/kiwi) |
| Tavily/Naver 외부 검색 호출 비용 | 키워드×타입 조합 | 타입별 결과 수 조정, Naver는 2건씩 보수 유지 |
