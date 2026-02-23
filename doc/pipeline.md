# AI 트렌드 위젯 — 파이프라인 동작 문서

> 최종 업데이트: 2026-02-23
> 관련 코드: `src/lib/pipeline/`

---

## 개요

스냅샷 파이프라인은 하루 4회(KST 09/12/18/21) 자동 실행되며,
AI 관련 RSS 피드를 수집해 트렌드 키워드 Top 10을 생성하고 DB에 저장합니다.

```
RSS 수집 → 후보 추출 → AI 클러스터링 → 스코어링 → Tavily 검색 → 요약 생성 → DB 저장
```

실행 진입점: `src/app/api/cron/snapshot/route.ts`
핵심 오케스트레이터: `src/lib/pipeline/snapshot.ts`

---

## 1단계: RSS 수집 (`rss.ts`)

### 피드 구성

19개 피드를 5개 티어로 분류합니다. 티어는 이후 스코어링의 authority 점수에 반영됩니다.

| 티어 | 설명 | 예시 |
|---|---|---|
| `P0_CURATED` | 고품질 AI 공식 블로그 | OpenAI Blog, Anthropic Blog, HuggingFace Blog |
| `P0_RELEASES` | AI 모델/SDK GitHub 릴리즈 | openai-python, anthropic-sdk-python, langchain |
| `P1_CONTEXT` | AI 전문 뉴스 미디어 | TechCrunch AI, VentureBeat AI, The Verge AI |
| `P2_RAW` | 한국어 AI 뉴스 | AI타임스, 전자신문 AI, ZDNet Korea |
| `COMMUNITY` | 커뮤니티 | r/MachineLearning, r/artificial, HackerNews AI |

### 수집 조건

- **48시간 컷오프**: `pubDate` 또는 `isoDate` 기준으로 48시간 이내 아이템만 수집
  - RSS 2.0은 `pubDate`, Atom 피드는 `isoDate` 필드를 사용하므로 둘 다 확인
- **URL 기준 중복 제거**: 동일 URL 아이템은 한 번만 포함
- **오류 무시**: 피드 fetch 실패 시 해당 피드만 스킵, 전체 파이프라인은 계속 진행

### 예상 수집량

정상 동작 시 30~100개 아이템. 피드 가용성에 따라 달라집니다.

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

### 델타 랭크

현재 스냅샷의 순위와 직전 스냅샷 순위 차이.
```
delta_rank = 이전순위 - 현재순위   (양수 = 상승, 음수 = 하락, 0 = 유지)
is_new = true  (이전 스냅샷에 없던 키워드)
```

---

## 5단계: Tavily 검색 (`tavily.ts`)

Top 10 키워드 각각에 대해 Tavily Search API로 4가지 타입의 소스를 수집합니다.

### 검색 타입별 설정

| 타입 | 목적 | 수집 수 |
|---|---|---|
| `news` | 최신 뉴스 기사 | 5개 |
| `web` | 관련 웹페이지 | 5개 |
| `video` | 유튜브 등 영상 | 3개 |
| `image` | 관련 이미지 | 3개 |

### 호출 규모

```
Top 10 키워드 × 4 타입 = 최대 40회 Tavily API 호출 / 스냅샷
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

- **220자 이내** 한국어
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
sources         : 키워드별 소스 카드 (news/web/video/image, 최대 8개/타입)
keyword_aliases : (현재 미사용, 향후 검색 최적화용)
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
| Tavily Search | ~40회 | 키워드 10 × 타입 4 |
| OG 이미지 fetch | ~100회 | HTTP 요청, 비용 없음 |
| **하루 합계** | gpt-4o-mini ~44회, Tavily ~160회 | 스냅샷 4회/일 |

---

## 실행 방법

### 로컬 수동 실행

```bash
curl -X GET http://localhost:3000/api/cron/snapshot \
  -H "Authorization: Bearer <CRON_SECRET>"
```

### Vercel 자동 실행 (vercel.json)

```json
{ "crons": [
  { "path": "/api/cron/snapshot", "schedule": "0 0 * * *"  },  // KST 09:00
  { "path": "/api/cron/snapshot", "schedule": "0 3 * * *"  },  // KST 12:00
  { "path": "/api/cron/snapshot", "schedule": "0 9 * * *"  },  // KST 18:00
  { "path": "/api/cron/snapshot", "schedule": "0 12 * * *" }   // KST 21:00
]}
```

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
| Tavily 40회 호출 비용 | 키워드×타입 조합 | 인기도 낮은 키워드는 타입 축소 |
