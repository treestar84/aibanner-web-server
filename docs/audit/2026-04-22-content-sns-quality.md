# Subtask C — 키워드 콘텐츠 · SNS 통합 품질 감사 (2026-04-22)

> Worker-3 산출물 (vibe-coding-keyword-quality-audit)
> 대상 서비스: `realtime-ai-trend-news` / `web-server`
> 산출 언어: 한국어 · 코드 변경 없음 (분석·권고만)
> 작성 범위: 키워드 디테일 응답/검색 응답에 노출되는 콘텐츠 카테고리, X·Threads SNS 통합 전략, 키워드당 "골든 콘텐츠 5종" 큐레이션 알고리즘, 카드 UI 필드 스펙, DB/API 변경 범위.
> 본 보고서는 Subtask A(소스 카탈로그)·Subtask B(점수·랭킹)와 파일을 공유하지 않으며, 중복되는 영역은 **"→ A/B 보고서 참조"** 로 명시해 경계를 지킨다.

---

## 0. TL;DR (한 페이지 요약)

| 항목 | 현재 상태 | 목표 상태 | 시급도 |
| --- | --- | --- | --- |
| 키워드 디테일 카테고리 | `news / social / data` 3단(동적으로 비어있으면 제거) | `news / youtube / github / social(X+Threads) / paper-data` 5단 또는 고정 슬롯 5종 | 🔴 High |
| YouTube 노출 | `data` 버킷 하위로 섞여 들어감(도메인 기반 재분류) | 전용 `video` 슬롯 + 썸네일/채널/재생시간 메타 | 🔴 High |
| GitHub 리포 | `github_source` 파이프라인에서 수집되지만 디테일 응답에서는 `social` 또는 `data`로 분류 | 전용 `repo` 슬롯 + stars/최근 release/언어 | 🟡 Medium |
| X(Twitter) 통합 | Tavily `site:x.com OR site:twitter.com` 검색으로만 접근. 미인증 크롤링에 의존 | ① 1순위: 키워드별 검색 **deeplink**(저비용·ToS 안전), ② 선택: 큐레이션 X 리스트 RSS (서드파티 RSSHub) | 🔴 High (오픈이 가장 쉬움) |
| Threads 통합 | Tavily `site:threads.net` 검색만 존재. 공식 API는 사실상 미개방(쓰기 중심) | 1순위: 검색 **deeplink**, 2순위: 인플루언서 리스트 기반 주간 큐레이션 | 🟡 Medium |
| 골든 5종 알고리즘 | 명시적 정의 없음 — `news/social/data` 버킷별 최신 정렬 | 뉴스1 + GitHub1 + YouTube1 + X1 + Threads1 고정 슬롯 + 품질 하한 + 폴백 | 🔴 High |
| DB/API 변경 | 현재 `sources.type`만 존재 | `sources.slot` (golden5 슬롯), `sources.metadata(JSONB)`, `/api/v1/keywords/:id` 응답의 `golden` 필드 추가 | 🟡 Medium |

**한 줄 진단**: 현재 디테일 화면은 "뉴스 위주 / SNS 링크 거의 없음 / 영상·리포는 섞여서 노출" 상태이며, **바이브 코딩 사용자가 가장 공유하고 싶어 하는 X·Threads·YouTube 연결이 구조적으로 비어 있다.** 최소 변경 경로는 **검색 deeplink 기반 SNS 슬롯 2종 + YouTube·GitHub 전용 슬롯 2종을 API 응답에 고정**하는 것이며, 이는 DB 스키마 변경 없이 파이프라인·API 레이어에서 우선 구현 가능하다.

---

## 1. 현행 응답 매핑 — 키워드 디테일이 내려주는 콘텐츠 카테고리

### 1.1 데이터 흐름 한눈 보기

```
[collectSources()]  ← tavily + naver + OG 이미지
        │
        ├── news:    snapshot/sources 테이블 (type='news')
        ├── social:  snapshot/sources 테이블 (type='social')
        └── data:    snapshot/sources 테이블 (type='data')
                                │
                                ▼
                GET /api/v1/keywords/:id
                → classifySourceCategory(source)로 **재분류**
                → news/social/data 3그룹으로 출력
```

| 단계 | 파일 | 책임 |
| --- | --- | --- |
| 수집 시 1차 분류 | `src/lib/pipeline/tavily.ts:151-227` | 쿼리를 `site:` 수식으로 나눠 news/social/data 버킷으로 나눔 |
| 네이버 보강 | `src/lib/pipeline/naver_search.ts:171-186` | `news`, `blog→social`, `cafe→social` |
| 저장 | `src/lib/pipeline/snapshot.ts:738-754` | `sources` 테이블 `type` 컬럼에 1차 분류 그대로 기록 |
| 응답 시 2차 분류 | `src/app/api/v1/keywords/[id]/route.ts:80-103` | `classifySourceCategory(source)`로 **도메인 기반 재분류** 후 news/social/data로 묶어 응답 |

### 1.2 카테고리별 실제 내용 (코드 근거)

| API 응답 카테고리 | 포함되는 도메인/소스 | 근거(file:line) | 주의사항 |
| --- | --- | --- | --- |
| `news` | 기본값. 분류에 걸리지 않는 모든 URL. 영문 블로그, 공식 릴리스 노트, 한국 언론사 도메인(aitimes.com, etnews.com, zdnet.co.kr, ...) 등 | `src/lib/pipeline/source_category.ts:137-157`, `src/lib/pipeline/tavily.ts:229-250` | 필터의 "그외" 역할이라 뉴스가 아닌 글도 흘러들어옴 |
| `social` | `x.com`, `twitter.com`, `threads.net`, `reddit.com`, `news.ycombinator.com`, `dev.to`, `clien.net`, `facebook.com`, `instagram.com`, `tiktok.com`, `velog.io`, `hashnode.com`, `news.hada.io`, `mastodon.social`, `geeksforgeeks.org`, ... | `src/lib/pipeline/source_category.ts:10-41` | **HN·Reddit·geeksforgeeks·velog가 모두 "social"로 분류됨** → 사용자 멘탈모델과 어긋남 |
| `data` | `youtube.com`, `youtu.be`, `arxiv.org`, `huggingface.co`, `kaggle.com`, `docs.google.com`, `figshare.com`, `nature.com`, `paperswithcode.com`, PDF/CSV/PPT 파일 링크, GIF/이미지 링크 | `src/lib/pipeline/source_category.ts:43-102` | **영상(YouTube)과 학술(arxiv)과 데이터셋(kaggle)이 하나의 버킷**. 사용자 혼란 유발 |
| `github` (독립 카테고리 없음) | `github.com` URL은 `SOCIAL_DOMAINS`·`DATA_DOMAINS` 어느 쪽에도 명시적으로 포함되지 않아 `news`로 분류되거나 `media.githubusercontent.com`(data)으로 샌다 | `src/lib/pipeline/source_category.ts:71-72` | 파이프라인에는 `github_source`/`github_releases_source`/`github_md_source`가 존재함에도 **API 응답 레이어에서는 별도 노출되지 않음** |
| `podcast/video-blog` | 없음 | — | 사용자 관점 누락 |
| `X/Threads` | `social` 버킷 하위에 "Reddit·HN·Dev.to"와 섞여 노출 | `src/lib/pipeline/source_category.ts:13-41` | **X·Threads의 UI 우선순위를 줄 수 없는 구조** |

### 1.3 노출 우선순위 (현 코드 기준)

```text
/api/v1/keywords/:id  →  sources 배열 순서
  [0] { type: 'news',   items: [ ... ] }   ← 항상 존재하면 먼저
  [1] { type: 'social', items: [ ... ] }   ← X/Threads/HN/Reddit 혼재
  [2] { type: 'data',   items: [ ... ] }   ← YouTube + arxiv + kaggle 혼재
items 내부 정렬: published_at DESC (src/app/api/v1/keywords/[id]/route.ts:87-93)
```

→ **UI에서 사용자가 "트윗 보여줘"라고 말해도 social 카드 더미 안에 섞인 HN·Reddit과 구분할 방법이 없다.**

### 1.4 누락 카테고리 (사용자 관점 기준)

| 사용자가 기대하는 카테고리 | 현재 노출? | 왜 중요한가 (바이브 코딩 맥락) |
| --- | --- | --- |
| X(Twitter) 트윗 | ❌ (social 덩어리) | 개발자 속보·밈·짤성 레퍼런스의 80%가 X에서 발생 |
| Threads 포스트 | ❌ (social 덩어리) | 한국 개발자 커뮤니티 2023~2026 급성장, 바이브코더 집결 |
| YouTube 영상 | ⚠ (data 덩어리) | 데모·튜토리얼 소비 1순위 |
| GitHub 저장소 | ❌ (news 또는 분류 불가) | "직접 써볼 코드" — 골든5의 핵심 |
| ArXiv / 논문 | ⚠ (data 덩어리) | 상급자 참고용. 하위 우선순위여도 남겨야 |
| 한국어 블로그 (velog/tistory) | ⚠ (social 덩어리) | 한국 사용자 체감에서 뉴스보다 중요 |
| Product Hunt / Show HN | ⚠ (social 덩어리) | 신규 도구 발굴 |
| 커뮤니티 스레드 (r/LocalLLaMA 등) | ⚠ (social 덩어리) | 질·답이 같이 묶여야 가치 있음 |
| Podcast | ❌ | 필수는 아니나 차별화 소재 |

→ `data`/`social`이 "나머지 다 때려넣는 버킷" 역할을 하고 있다. **슬롯형(고정 5개 카테고리) 접근으로 리팩토링하면 UI와 큐레이션이 동시에 좋아진다.**

### 1.5 카테고리 분류의 구조적 결함 요약

| 결함 | 증거 | 사용자 체감 결과 |
| --- | --- | --- |
| `social` 버킷의 과적재 | `source_category.ts:10-41`에 X, Threads, Reddit, HN, Dev.to, Facebook, Instagram, TikTok, Velog, Mastodon, Clien, Geeksforgeeks 등 **22개 도메인**이 동일 버킷으로 매핑 | 사용자가 "X에서만 보기" 같은 필터링을 할 수 없음 |
| `data` 버킷의 의미 혼재 | `YOUTUBE_HINT_RE` + `ACADEMIC_HINT_RE` + `GOOGLE_DOCS_HINT_RE` + `IMAGE_OR_VIDEO_HINT_RE` + `DATA_FILE_HINT_RE` + `FILETYPE_HINT_RE` 6개 정규식이 같은 `data` 태그를 반환 (`source_category.ts:93-102, 137-157`) | YouTube 튜토리얼과 arXiv 논문이 같은 카루셀에 섞여 노출 |
| `github.com` 미등록 | `SOCIAL_DOMAINS`에도 `DATA_DOMAINS`에도 github.com 없음. `media.githubusercontent.com`/`raw.githubusercontent.com`만 data에 포함 (`source_category.ts:71-72`) | GitHub 저장소 URL은 기본값인 `news` 버킷으로 떨어져 진짜 뉴스와 섞임 |
| `sources.type` 저장값과 응답 분류 불일치 | `snapshot.ts:738-754`에서 저장한 `type`이 응답 시 `classifySourceCategory(source)` 로 다시 덮어쓰임 (`keywords/[id]/route.ts:80-83`) | 수집 단계 의도와 노출 단계 의도가 괴리 → 관리 어려움 |
| 언어 정보 부재 | `sources` 테이블에 `language` 컬럼 없음 (`schema.sql:66-104`). 현재는 `title_ko`/`title_en` 존재 여부로만 추정 | 한국어 사용자에게 한국어 비중을 올리는 정책을 SQL 레벨에서 구현 불가 |
| `primary_type` 3값 제한 | `keywords.primary_type` 문서 주석에 `news|social|data` (`schema.sql:35`) | 이후 `repo`, `video`, `xpost`, `thread`로 확장하려면 도메인 의미 재정의 |

### 1.6 Top·Hot·Search 응답의 카테고리 노출 비교

| 엔드포인트 | `primary_type` 노출 | `topSource` 구조 | 카테고리 그룹화 노출 | 비고 |
| --- | --- | --- | --- | --- |
| `GET /api/v1/trends/top` | ✅ `normalizePrimaryType`으로 1값(news/social/data) | ✅ | ❌ (단일 top only) | `trends/top/route.ts:59-89` |
| `GET /api/v1/trends/hot` | ✅ 동일 | ✅ | ❌ | `trends/hot/route.ts:82-105` |
| `GET /api/v1/keywords/:id` | ❌ (카테고리 그룹화로 대체) | ❌ | ✅ 3그룹(news/social/data) | `keywords/[id]/route.ts:85-103` |
| `GET /api/v1/search` (DB hit) | ❌ | ❌ | ✅ 3그룹 | `search/route.ts:56-97` |
| `GET /api/v1/search` (Tavily fallback) | ❌ | ❌ | ✅ 3그룹 | `search/route.ts:99-143` |

→ 골든5를 도입하려면 **네 엔드포인트 모두에서 응답 shape을 일관적으로 진화**시켜야 함. 특히 `trends/top`·`trends/hot`의 `topSource` 단일 필드가 "슬롯 1 — 뉴스"인지 "대표 SNS"인지 **현 코드에 정의가 없음**.

### 1.7 기존 파이프라인이 버리고 있는 메타데이터

다음 메타는 원본 소스에 존재하지만 **DB 저장 시 누락**되거나 **응답에 제외**된다:

| 메타 | 원본 소스 | 저장/응답? | 근거 |
| --- | --- | --- | --- |
| YouTube `videoId`, `channelId`, `duration`, `viewCount` | `youtube_source.ts`, `youtube_recommend_source.ts` | ❌ (title/url만) | `sources` 스키마(`schema.sql:66-104`)에 해당 컬럼 없음 |
| GitHub `repo_full_name`, `stars`, `language`, `default_branch` | `github_source.ts` | ❌ | 위와 동일 |
| GitHub Release `tag_name`, `published_at`, `prerelease` | `github_releases_source.ts` | ⚠(published_at만) | — |
| Reddit `subreddit`, `ups`, `num_comments` | `reddit_source.ts` | ❌ | — |
| X `likeCount`, `quoteCount`, `authorHandle`, `isVerified` | Tavily 검색 결과에 없음 (API 미연동) | ❌ | — |
| Threads `authorHandle`, `likeCount` | Tavily 결과에 없음 | ❌ | — |
| Product Hunt `votes`, `maker`, `launch_date` | `product_hunt_top_source.ts` | ❌ (제목·url만) | — |

→ **골든5 카드 UI에 뱃지를 달려면 최소한 `stars`, `duration`, `likeCount`를 보존하는 `sources.metadata JSONB` 컬럼이 필요.**

---

## 2. SNS 통합 전략 — X(Twitter) & Threads(Meta)

### 2.1 왜 X·Threads가 최우선 타깃인가

- 사용자 정의 (`_team-task.md:7-9`): "실시간 키워드를 누르면 그 키워드와 연관된 뉴스/콘텐츠/**SNS 자료**가 핫한 품질로 노출되어야 함. 우선순위 SNS: **X(Twitter)**, **Threads(Meta)** 링크 연결이 가장 긍정적."
- 바이브 코딩 커뮤니티의 **1차 발화 매체**는 X(속보), **2차 확산·한국어화** 매체는 Threads·velog. 뉴스 기사는 이들의 2~12시간 뒤 파생물.
- 현 시스템은 Tavily로 `site:x.com OR site:twitter.com OR site:threads.net`를 쿼리하는 수준이라(`src/lib/pipeline/tavily.ts:158`) 최신성이 보장되지 않음.

### 2.2 X(Twitter) 통합 옵션 비교

| 옵션 | 무엇을 하는가 | 실시간성 | 비용 | 안정성 | ToS/정책 리스크 | 난이도 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A. 공식 `X API v2 Basic` | `recent search` 엔드포인트로 키워드 검색 | 분단위 | $200/mo~, 15k 트윗/월 조회 제한 | ★★★ | 낮음 (단, 약관 변경 잦음) | 중 (OAuth2 + rate limit) | 2025~2026년 요금 인상/쿼터 변동 잦음 |
| B. 공식 `X API v2 Pro` | 검색 + 스트림 + 지리 필터 | 초단위 | $5,000/mo | ★★★ | 낮음 | 중~상 | 스타트업에는 과함 |
| C. 검색 URL **deeplink** | `https://x.com/search?q=<kw>&f=live` 링크만 노출 | 클릭 시점 실시간 | **무료** | ★★★★(클라 브라우저가 렌더) | **매우 낮음** (공개 URL) | **하** | 썸네일/프리뷰 없음. 사용자가 한 번 더 클릭 |
| D. 공식 임베드 위젯 (`blockquote.twitter-tweet` + `platform.twitter.com/widgets.js`) | 트윗 하나를 iframe 렌더 | 실시간 | 무료 | ★★★ | 낮음 | 중 (Content-Security-Policy 조정) | Flutter WebView에서 렌더 지연 이슈 가능 |
| E. Nitter 인스턴스 (서드파티) | 비공식 프론트엔드로 스크래핑 | 분단위 | 무료 | ★(인스턴스 주기적 차단/폐쇄) | 높음 (X의 봇 차단 강화) | 중 | 프로덕션 신뢰 어려움 |
| F. RSSHub / snscrape | 검색/타임라인 RSS 변환 | 분~시간 | 무료(자가호스팅) | ★~★★ | 중(X의 스크래핑 금지 ToS) | 중 | 2024년 이후 X 측이 공개 스크래핑 차단 강화 |
| G. Tavily로 X 검색(현재 방식) | 일반 검색엔진에 `site:x.com` 수식 | 시간~일 | Tavily 요금에 포함 | ★★ | 낮음 | 없음 | 미리보기 없음, 최신성 낮음 |

#### 권장 조합 (X)

1. **1순위 — C (검색 deeplink)**: 구현 즉시 가능, 비용·리스크 0. 키워드 디테일 카드에 "X에서 이 이야기 전체 보기" 버튼을 `https://x.com/search?q=<encoded keyword>&f=live` 로 노출.
2. **2순위 — D (임베드 위젯)**: 대표 트윗 1개를 골든5 슬롯에 고정하고 싶을 때. 단, **어떤 트윗을 골라야 하는가**가 자동으로 풀리지 않아 관리자 수동 큐레이션(`manual_youtube_links`와 같은 `manual_x_tweets` 테이블)이 필요.
3. **3순위 — A (공식 API Basic)**: 회사 자본 여력 생기면 전환. 배치에서 시간당 1~2회 `recent search`로 상위 트윗 3건을 골든5에 투입.
4. **비권장** — E(Nitter), F(RSSHub 공개 인스턴스): 2024~2026년 X의 크롤링 차단이 공격적이며, 사용자 경험이 불안정. 도입하면 OP/알림 비용이 개발자 시간을 잡아먹음.

### 2.3 Threads(Meta) 통합 옵션 비교

| 옵션 | 무엇을 하는가 | 실시간성 | 비용 | 안정성 | ToS/정책 리스크 | 난이도 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A. 공식 `Threads Graph API` | 자기 계정·자기 포스트만 CRUD. **타인 포스트 검색 미지원** | — | 무료 | ★★★ | 낮음 | 중 | **검색 불가** — 현재 감사 대상 유스케이스에 맞지 않음 |
| B. 검색 **deeplink** | `https://www.threads.net/search?q=<kw>` 및 `https://www.threads.com/search?q=<kw>&serp_type=default` | 클릭 시점 실시간 | 무료 | ★★★★ | 매우 낮음 | 하 | 공식 검색 UI로 이동 |
| C. 프로필 **deeplink** | `https://www.threads.net/@<handle>` 큐레이션 리스트 | 클릭 시점 실시간 | 무료 | ★★★★ | 매우 낮음 | 하 | 관리자가 "한국 바이브 코더" 핸들 20명을 리스트 관리 |
| D. oEmbed / 임베드 | Threads가 공식 oEmbed 제공 (개별 포스트 URL 기반) | 실시간 | 무료 | ★★★ | 낮음 | 중 | **URL을 알고 있어야** 임베드 가능 → 검색 결과가 먼저 필요 |
| E. 서드파티 스크래퍼 (`threads-api`, `threads-py`) | 비공식 백엔드 호출 | 분~시간 | 무료 | ★(차단 주기) | 높음 | 중 | 법적 회색지대 |
| F. Tavily `site:threads.net` | 검색엔진 경유 | 시간~일 | Tavily 포함 | ★★ | 낮음 | 없음 | 인덱싱 누락 많음 |

#### 권장 조합 (Threads)

1. **1순위 — B (검색 deeplink)**: `https://www.threads.net/search?q=<keyword>` 를 디테일 카드에서 바로 연결.
2. **2순위 — C + 관리자 큐레이션**: 관리자가 "바이브 코딩 계정 리스트" (예: `@clementmihailescu`, `@nextjs`, `@vibecoder_kr`) 를 DB에 저장 (`manual_threads_handles` 테이블) → 키워드 디테일 화면 하단에 "Threads 계정 추천" 섹션.
3. **3순위 — D (oEmbed)**: Tavily가 특정 Threads URL을 반환했을 때 해당 URL에 대해 oEmbed 호출로 공식 임베드 카드 노출.
4. **비권장** — E(비공식 API): 일관성·법적 리스크.

### 2.4 임베드 vs. 링크 — 결정 기준

| 시나리오 | 권장 표현 | 이유 |
| --- | --- | --- |
| 모바일 리스트 뷰 (카드 반복 노출) | **링크 + 미리보기 메타** (제목/본문 일부/도메인/썸네일) | 임베드 JS 로드 비용·스크롤 저크(jank) 방지 |
| 모바일 디테일 뷰 "대표 트윗/스레드" 1건 | **임베드 위젯** 또는 큰 카드 | 공식 룩&필, 참여 유도 |
| 오프라인 캐시 모드 | **링크** | 임베드는 온라인 필수 |
| 성인/정치 콘텐츠 우려 키워드 | **링크만** | 임베드가 호스트 페이지 규정에 종속되므로 |

결정 원칙: **"1건은 임베드, 나머지는 링크"** — 디테일에서 슬롯 1개(= 대표 SNS 포스트)만 임베드하고, 그 외의 관련 SNS 결과는 deeplink 버튼 1개로 묶어 "X에서 더 보기 / Threads에서 더 보기"로 전환.

### 2.5 최종 SNS 통합 권고 (실행 우선순위)

| 단계 | 내용 | 구현 위치 | 예상 비용 | 릴리스 영향 |
| --- | --- | --- | --- | --- |
| C-1 | 키워드 디테일에 `x_search_url`, `threads_search_url` 필드 추가 (서버에서 URL encode) | `src/app/api/v1/keywords/[id]/route.ts` | 거의 0 | **코드 1일** |
| C-2 | Flutter 앱 디테일 화면 하단에 "X에서 보기 / Threads에서 보기" CTA 버튼 2개 추가 | Flutter 쪽 | 낮음 | 2일 |
| C-3 | 검색 deeplink UTM 파라미터 부착(내부 트래픽 측정) | API 응답 생성부 | 0 | 1일 |
| C-4 | 관리자 큐레이션 `manual_x_handles`, `manual_threads_handles` 테이블 추가 | DB 마이그레이션 | 낮음 | 2일 |
| C-5 | 공식 X API Basic 가입 & 1시간 주기 배치로 대표 트윗 1건 선정 | `src/lib/pipeline/x_source.ts`(신규) | $200/mo | 1주 |
| C-6 | Threads oEmbed 렌더링 (대표 스레드 1건) | Flutter WebView 또는 SSR embed | 0 | 3일 |
| C-7 | 품질 판단을 위한 SNS-언급량(velocity) 시그널 연계 → Subtask B와 정합 | ranking_policy | — | B 보고서 참조 |

### 2.6 X 검색 deeplink 파라미터 레퍼런스

`https://x.com/search?q=<QUERY>&src=typed_query&f=<FILTER>` 구조를 기반으로 한 권장 조합:

| 목적 | 파라미터 | 예시 URL | 비고 |
| --- | --- | --- | --- |
| 최신(Live) | `f=live` | `https://x.com/search?q=%22Claude%20Code%22&f=live` | 가장 최근 트윗부터 |
| 인기(Top) | 기본값(없음) | `https://x.com/search?q=%22Claude%20Code%22` | 알고리즘 정렬 |
| 사람만 | `f=user` | `https://x.com/search?q=%22Claude%20Code%22&f=user` | 계정 탐색 |
| 미디어만 | `f=media` | `https://x.com/search?q=%22Claude%20Code%22&f=media` | 데모 영상 클립 |
| 최근 24h | `q=<kw>%20since%3A<YYYY-MM-DD>` | `q=%22Claude%22%20since%3A2026-04-21` | 서버에서 날짜 계산 |

권장 기본값: `f=live` (바이브 코딩 사용자는 "가장 최신"이 주된 의도).

### 2.7 Threads 검색 deeplink 파라미터 레퍼런스

| 목적 | URL 구조 | 예시 |
| --- | --- | --- |
| 키워드 검색 | `https://www.threads.net/search?q=<QUERY>` | `.../search?q=Vibe%20Coding` |
| 사용자 검색 | `https://www.threads.net/search?q=<QUERY>&serp_type=user` | `.../search?q=Vibe&serp_type=user` |
| 프로필 | `https://www.threads.net/@<HANDLE>` | `.../@zuck` |
| 단일 포스트 | `https://www.threads.net/@<HANDLE>/post/<ID>` | 공유 링크 형식 |

→ 2026년 초 기준 `threads.com` 도메인도 유효. 서버에서는 `threads.net`을 표준으로 고정하고, 수집 단계에서 `threads.com` → `threads.net` 정규화를 추천.

### 2.8 "임베드 전략"의 세부 시나리오

| 시나리오 | 슬롯 수 | UX 권장 | 구현 노트 |
| --- | --- | --- | --- |
| 디테일 첫 진입 | 5 | 리스트 + 썸네일/텍스트 미리보기(임베드 없음) | 첫 페인트 빠르게 |
| 사용자가 슬롯4(X)를 탭 | 1 | 풀스크린 WebView — X 공식 포스트 페이지 | 기본 브라우저로 빼거나 in-app WebView |
| "자동 임베드" A/B 실험군 | 1(대표) | 첫 진입부터 대표 트윗 임베드 | Performance 계측 필수(FCP, TTI) |
| 오프라인 | 5 | 링크만, 임베드 비활성 | `connectivity` 감지 |
| 다크 모드 | 5 | X/Threads 임베드에 `theme=dark` | Threads는 oEmbed 옵션 지원, X는 data-theme 속성 |

### 2.9 SNS 소스별 rate limit / 쿼터 요약

| 소스 | 무료 한도 | 유료 옵션 | 실질 사용 가능량 |
| --- | --- | --- | --- |
| X API Basic | 없음(유료 전용) | $200/mo → 15k tweets/월 read | 상위 5키워드 × 일 4스냅샷 × 4주 = 400 호출 → 여유 있음 |
| X API Pro | 있음(일부 엔드포인트) | $5,000/mo → 1M tweets/월 | 전 키워드 커버 가능 |
| Threads Graph API | 자기 포스트만 | — | 타인 검색 불가 → 본 유스케이스 무효 |
| Threads oEmbed | 무제한(URL별) | 무료 | 대표 URL을 먼저 얻어야 함 |
| Tavily 검색 | 플랜별 | 기존 사용 중 | 기존 파이프라인 재활용 |
| Naver 검색 | 25k/일(기본) | 가능 | 한국 자료 보강용 |
| RSSHub 자가호스팅 | 서버 용량만 | — | 운영 비용 있음, ToS 리스크 |

---

## 3. 골든 콘텐츠 5종 큐레이션 알고리즘

### 3.1 슬롯 정의

| 슬롯 | 내용 | 필수 여부 | 대표 필드 |
| --- | --- | --- | --- |
| 1. **대표 뉴스** | 가장 신뢰할 수 있는 뉴스 기사 1건 | 필수 | title / snippet / publishedAt / domain / imageUrl |
| 2. **대표 GitHub 리포** | 키워드와 직결되는 리포 1건 | 선택(폴백 有) | repo_full_name / stars / description / last_release / language |
| 3. **대표 YouTube 영상** | 데모/리뷰 영상 1건 | 선택(폴백 有) | video_id / title / channel / published_at / thumbnail / duration |
| 4. **대표 X 포스트** | 속보·인사이트 트윗 1건 또는 검색 deeplink | 필수 (최소 deeplink 보장) | tweet_url or x_search_url |
| 5. **대표 Threads 포스트** | 한국어 맥락 포함 이상적 | 필수 (최소 deeplink 보장) | thread_url or threads_search_url |

**합계 5슬롯 모두 빈 상태로 나가는 키워드는 0건이 되어야 한다** — deeplink는 키워드 문자열만 있으면 생성되므로 슬롯 4/5는 항상 채움.

### 3.2 슬롯별 선정 규칙

#### 슬롯 1 — 대표 뉴스

```
scoreNews(source) =
    0.40 * freshness_decay(publishedAt, halfLife=24h)
  + 0.30 * domain_authority[domain]                   // B 보고서의 authority 시그널과 공유
  + 0.15 * title_keyword_coverage(title, keyword)
  + 0.10 * image_present ? 1.0 : 0.0
  + 0.05 * language_preference(userLocale)            // ko 사용자에는 한국어 기사 +0.05
```

- 최소 품질 임계:
  - 제목 길이 ≥ 20자, ≤ 160자
  - `publishedAt` 존재 & 48시간 이내 (없으면 72시간까지 완화)
  - 도메인이 차단 리스트(예: 콘텐츠 팜) 에 없을 것
- 다양성 제약: 동일 도메인이 골든5 전체에서 2개 이상이면 두 번째 선택 금지.
- 폴백: `scoreNews` 조건을 만족하는 기사가 없으면 가장 최근 `news` 타입 소스 1건.

#### 슬롯 2 — 대표 GitHub 리포

```
scoreRepo(source) =
    0.35 * stars_growth_7d (log scale)
  + 0.20 * stars_absolute (log scale)
  + 0.20 * recency_of_last_release
  + 0.15 * readme_keyword_coverage(keyword)
  + 0.10 * language_is_popular   // TS/Python/Rust/Go > 기타
```

- 최소 임계: stars ≥ 10 (너무 엄격하면 신생 바이브 코딩 툴을 놓치므로 낮춤). `archived=false`.
- 다양성: 동일 조직 리포 2건 금지.
- 폴백 1: `github_source` / `github_releases_source` / `github_md_source` 에서 파생된 `url contains github.com/`.
- 폴백 2: GitHub 검색 deeplink `https://github.com/search?q=<kw>&type=repositories&s=stars&o=desc`.
- 참고: `github_source.ts` / `github_releases_source.ts` / `github_md_source.ts` 는 이미 파이프라인에 있으므로(snapshot.ts:7-8,146-151) 전처리 단계에서 **리포 메타데이터를 보존**하도록 확장 필요 → Subtask B·수집 레이어 공동.

#### 슬롯 3 — 대표 YouTube 영상

```
scoreVideo(source) =
    0.35 * freshness_decay(publishedAt, halfLife=14d)
  + 0.20 * view_count_log
  + 0.15 * channel_authority[channel_id]    // youtube_recommend_channels 기반
  + 0.15 * duration_fit (3~25분 대 가중)
  + 0.10 * title_keyword_coverage
  + 0.05 * is_korean_channel ? 1 : 0
```

- 최소 임계: 길이 ≥ 60초 (쇼츠 제외 여부는 채널별 옵션으로).
- 소스: `youtube_source.ts`, `youtube_recommend_source.ts`, 및 `youtube_recommend_channels` 테이블 활용(`schema.sql:254-298`).
- 다양성: 같은 채널 2건 금지.
- 폴백: YouTube 검색 deeplink `https://www.youtube.com/results?search_query=<kw>&sp=CAISAhAB` (최근 1주 필터).

#### 슬롯 4 — 대표 X 포스트

```
if (manual_x_tweets[keyword] 존재) return manual_x_tweets[keyword];
else if (x_api 사용 가능 && lastFetch < 30m) return topTweet_by_engagement;
else return { kind: 'deeplink', url: `https://x.com/search?q=<kw>&f=live` };
```

- 최소 임계(API 모드): `like_count ≥ 10 || retweet_count ≥ 5 || quote_count ≥ 2`.
- 다양성: 동일 작성자 2건 금지.
- 폴백: 검색 deeplink는 **항상 반환 가능** → 슬롯 비지 않음.
- 비용 상한: X API 호출은 스냅샷당 최대 N회 — 랭킹 상위 5개 키워드만 API 호출, 나머지는 deeplink로 처리하는 티어드 전략.

#### 슬롯 5 — 대표 Threads 포스트

```
if (manual_threads_posts[keyword]) return manual_threads_posts[keyword];
else if (tavily_result[site:threads.net]의 상위 URL이 품질 통과) return oEmbed(url);
else return { kind: 'deeplink', url: `https://www.threads.net/search?q=<kw>` };
```

- 최소 임계 (Tavily 경유): snippet 내 키워드 일치 + published 2주 이내.
- 다양성: 동일 핸들 2건 금지.
- 폴백: 검색 deeplink — 항상 가능.

### 3.3 슬롯 채우기 의사코드

```ts
function buildGolden5(keyword: Keyword, sources: Source[], options: GoldenOptions): Golden5 {
  const pool = sources.filter(s => !isBlockedDomain(s.domain));
  const byType = {
    news:   pool.filter(s => classifySlot(s) === 'news'),
    repo:   pool.filter(s => classifySlot(s) === 'repo'),
    video:  pool.filter(s => classifySlot(s) === 'video'),
    xpost:  pool.filter(s => classifySlot(s) === 'x'),
    thread: pool.filter(s => classifySlot(s) === 'threads'),
  };

  return {
    news:    pickBest(byType.news,   scoreNews,   { diversityKey: 'domain' }) ?? fallbackNews(keyword),
    repo:    pickBest(byType.repo,   scoreRepo,   { diversityKey: 'org' })     ?? fallbackRepo(keyword),
    video:   pickBest(byType.video,  scoreVideo,  { diversityKey: 'channel' }) ?? fallbackVideo(keyword),
    xpost:   pickBest(byType.xpost,  scoreXPost,  { diversityKey: 'author' })  ?? fallbackXDeeplink(keyword),
    thread:  pickBest(byType.thread, scoreThread, { diversityKey: 'author' })  ?? fallbackThreadsDeeplink(keyword),
  };
}

function classifySlot(s: Source): 'news' | 'repo' | 'video' | 'x' | 'threads' | 'other' {
  const host = hostFromUrl(s.url);
  if (host.endsWith('github.com')) return 'repo';
  if (host.endsWith('youtube.com') || host === 'youtu.be') return 'video';
  if (host.endsWith('x.com') || host.endsWith('twitter.com')) return 'x';
  if (host.endsWith('threads.net') || host.endsWith('threads.com')) return 'threads';
  if (isNewsDomain(host)) return 'news';
  return 'other';
}
```

### 3.4 다양성·폴백 정책 요약

| 정책 | 규칙 |
| --- | --- |
| 전체 도메인 다양성 | 골든5 전체에서 같은 `domain` 2회 이상 금지 (단, github.com/youtube.com/x.com/threads.net은 예외 — 슬롯 의미상 같은 도메인이 정답) |
| 같은 기사 복제 금지 | `normalizeUrlKey` 기준 중복 URL 제거 (이미 구현됨, `src/lib/pipeline/tavily.ts:104-124`) |
| 언어 균형 | 한국어 UI일 때: news 슬롯의 한국어 비율 ≥ 50% 권장. 없으면 감점이 아닌 폴백으로 채움 |
| 최신성 기준선 | 각 슬롯별 별도 half-life 사용 — 뉴스 24h, 리포 7d, 영상 14d, 트윗 6h, 스레드 24h |
| 빈 슬롯 허용 여부 | SNS 슬롯(4·5)는 **항상 deeplink로 채움** → 사실상 빈 슬롯 없음 |
| 품질 하한 실패 시 | 각 슬롯은 독립적으로 폴백 — 뉴스가 없다고 리포 슬롯까지 비우지 않음 |

### 3.5 큐레이션 빈도 & 캐시

| 대상 | 재계산 주기 | 캐시 키 | 무효화 조건 |
| --- | --- | --- | --- |
| 슬롯1·2·3 (뉴스/리포/영상) | 스냅샷 주기 (현재 KST 05/11/17/23시; `CLAUDE.md:15`) | `golden5:<keyword_id>:v1` | 새 스냅샷 생성 시 |
| 슬롯4 (X API 경유) | 30~60분 (티어드) | `golden5:x:<keyword_id>` | 관리자 override |
| 슬롯4/5 (deeplink) | 서버 요청 시 즉시 생성 | 없음 | 불필요 |

### 3.6 슬롯 폴백 체인 (Decision Tree)

```
[slot: news]
  primary   ← 뉴스 후보 상위 1 (scoreNews ≥ threshold)
  fallback1 ← 최근 24h 내 가장 신선한 뉴스 타입 source
  fallback2 ← title에 키워드 토큰 ≥1 포함한 모든 source 중 1건
  fallback3 ← Tavily broad 검색 결과 1건
  sentinel  ← 빈 슬롯 플래그(UI에서 숨김)

[slot: repo]
  primary   ← github.com URL 후보 중 scoreRepo 최고
  fallback1 ← github_source / github_releases_source 파생 레코드
  fallback2 ← 수동 큐레이션 매핑(manual_github_pins, 선택)
  fallback3 ← https://github.com/search?q=<kw>&type=repositories&s=stars&o=desc deeplink
  sentinel  ← 없음 (deeplink 항상 생성 가능)

[slot: video]
  primary   ← youtube_source / youtube_recommend_source 후보 중 scoreVideo 최고
  fallback1 ← 채널 whitelist (youtube_recommend_channels 26개) 최근 업로드 1건
  fallback2 ← manual_youtube_links 큐레이션 레코드
  fallback3 ← https://www.youtube.com/results?search_query=<kw>&sp=CAISAhAB deeplink
  sentinel  ← 없음

[slot: xpost]
  primary   ← X API 응답(설정된 경우) 품질 하한 통과 1건
  fallback1 ← manual_x_tweets 레코드
  fallback2 ← Tavily site:x.com 결과 중 신선도·매칭 통과 1건
  fallback3 ← https://x.com/search?q=<kw>&f=live deeplink
  sentinel  ← 없음

[slot: thread]
  primary   ← manual_threads_posts 레코드
  fallback1 ← Tavily site:threads.net 결과 중 신선도·매칭 통과 1건
  fallback2 ← manual_threads_handles 기반 "계정 추천" 1개 (프로필 deeplink)
  fallback3 ← https://www.threads.net/search?q=<kw> deeplink
  sentinel  ← 없음
```

### 3.7 슬롯 품질 하한값 제안치

| 슬롯 | 필수 임계 | 권장 임계 | 비고 |
| --- | --- | --- | --- |
| news | publishedAt ≤ 72h, title length 20~160, 차단 도메인 아님 | publishedAt ≤ 24h, 도메인 tier ≥ B, 키워드 토큰 1개 이상 title 포함 | 공식 블로그는 24h 제한 완화 |
| repo | stars ≥ 10, archived=false | stars ≥ 50, 최근 30d commit | 바이브 코딩 초기 툴 포용 위해 하한 느슨 |
| video | duration ≥ 60s | 3~25분, viewCount ≥ 500 | 쇼츠 별도 슬롯 가능성 검토 |
| xpost | likeCount ≥ 10 OR retweetCount ≥ 5 | likeCount ≥ 50 | 낚시 필터는 author whitelist로 추가 |
| thread | snippet 키워드 매칭 | authorHandle이 `manual_threads_handles`에 포함 | Threads는 공식 엔드게이지 메트릭 부족 |

### 3.8 키워드 유형별 슬롯 가중 조정 (선택)

아래는 키워드가 특정 유형일 때 슬롯 가중치를 조정하는 힌트. 현행 `classify_keyword_type` 과는 다른, **"슬롯 배치용" classifier**가 필요.

| 키워드 유형 | 예 | 슬롯 가중 |
| --- | --- | --- |
| 모델 릴리스 | "GPT 5.1", "Claude Code 2" | news↑, repo↔, video↑, xpost↑, thread↔ |
| 개발 도구 | "Cursor", "Windsurf" | news↔, repo↑↑, video↑, xpost↑, thread↑ |
| 개념/기법 | "RAG", "Vibe Coding" | news↑, repo↔, video↔, xpost↔, thread↑ |
| 밈/이벤트 | "Dev Summit 2026" | news↑, repo↓, video↑, xpost↑↑, thread↑ |
| 데이터셋/벤치마크 | "MMLU-Pro" | news↔, repo↑, video↓, xpost↓, thread↓, **paper 슬롯 추가 고려** |

→ 슬롯이 고정 5개가 아니라 **키워드 유형에 따라 "선택 가능한 슬롯 풀"** 로 진화할 여지. (미해결 질문 #4 참조)

---

## 4. 카드 UI 필드 스펙 — 디테일 화면 노출

### 4.1 슬롯별 카드 필드

| 슬롯 | 최소 필드 | 권장 필드 | 뱃지 |
| --- | --- | --- | --- |
| 뉴스 | title, url, domain, publishedAt | snippet(100~220자), imageUrl, sourceTrustTier(A/B/C/D) | 🟢 공식 · 🟡 주요매체 · 🔴 개인블로그 |
| GitHub | repoFullName, url, description | stars, language, lastReleaseVersion, lastCommitAt | ⭐ stars · 🟢 활발(최근 7d 커밋) · ⚠ archived |
| YouTube | videoId, title, channelName, thumbnailUrl | publishedAt, durationSec, viewCount, isShort | ▶ 일반 · ⚡ 쇼츠 · 🎙 라이브 |
| X 포스트 | tweetId or xSearchUrl, authorHandle | text(표시), likeCount, quoteCount, createdAt | 🔵 인증 · 💬 대화형 |
| Threads 포스트 | threadUrl or threadsSearchUrl, authorHandle | text(표시), likeCount, createdAt | 🔵 인증 · 🇰🇷 한국어 |

### 4.2 공통 메타

```jsonc
{
  "id":        "kw_xxx",
  "keyword":   "Claude Code 2",
  "lang":      "ko",
  "updatedAt": "2026-04-22T12:00:00Z",
  "summary":   "한 문장 요약",
  "bullets":   ["포인트 1", "포인트 2"],
  "golden": {
    "news":    { ... },
    "repo":    { ... },
    "video":   { ... },
    "xpost":   { ... },
    "thread":  { ... }
  },
  "sources": [  // 기존 호환 필드 (하위 호환)
    { "type": "news",   "items": [ ... ] },
    { "type": "social", "items": [ ... ] },
    { "type": "data",   "items": [ ... ] }
  ]
}
```

→ **`golden` 필드를 `sources`와 병기 제공**: 구 Flutter 클라이언트(`keywords/[id]`의 `sources` 배열 파싱 기존 코드)와 호환되면서, 신규 클라는 `golden`을 우선 렌더. 구현 2주차에 `sources`를 deprecation 표시.

### 4.3 신뢰도 뱃지 매핑 (뉴스용)

| Tier | 예시 도메인 | 판단 기준 |
| --- | --- | --- |
| A (Official) | openai.com, anthropic.com, deepmind.google, huggingface.co 공식 블로그 | AI 랩 공식 채널 |
| B (Major Media) | theverge.com, wired.com, techcrunch.com, aitimes.com, zdnet.co.kr | 편집 데스크 있는 매체 |
| C (Community) | news.hada.io, velog.io, tistory.com, dev.to, medium.com | 개인/커뮤니티 |
| D (Aggregator / Unknown) | 기타 | 의심 시 표시 |

→ 데이터 원천은 Subtask A(소스 카탈로그 감사) 산출과 합쳐서 `domain_trust_tier` 테이블(JSON 설정) 로 관리 권고.

### 4.4 반응형 표기 (앱 · 웹 공통)

- 소형 디바이스(≤ 360px 너비): 골든5 슬롯을 2열×3행 (마지막 1칸은 공백 or "더보기").
- 대형 디바이스: 가로 스크롤 카루셀 5장.
- 접근성: 각 카드에 `aria-label` = "슬롯 타입 + 키워드 + 도메인".

---

## 5. DB / API 변경 범위 추정

### 5.1 DB 스키마 변경 (우선순위 순)

| 우선 | 변경 대상 | 변경 내용 | 근거(file:line) | 파괴적? |
| --- | --- | --- | --- | --- |
| P0 | `sources` 테이블 | `slot TEXT` 컬럼 추가 (`news/repo/video/xpost/thread/other`) + `metadata JSONB` 추가 (stars, duration, author_handle 등) | `src/lib/db/schema.sql:66-104` | 추가 컬럼 — 비파괴 |
| P0 | 신규 테이블 `golden_slots` 또는 `sources.slot` 활용 | 키워드별 5슬롯 결과 저장 (역정규화 캐시) | — | 신규 — 비파괴 |
| P1 | 신규 테이블 `manual_x_tweets` | `(keyword_id, tweet_id, tweet_url, author_handle, text, cached_like_count, created_at)` | — | 신규 |
| P1 | 신규 테이블 `manual_threads_posts` | 위와 동일 구조 | — | 신규 |
| P1 | 신규 테이블 `manual_x_handles`, `manual_threads_handles` | 큐레이션 리스트 (한국 바이브코딩 핸들 N개) | — | 신규 |
| P2 | `domain_trust_tiers` (JSON config or DB) | 도메인별 A/B/C/D 등급 | — | 신규(JSON 파일이면 DB 불필요) |
| P2 | `sources.language` | `ko/en/ja/zh/...` 명시 필드 | `src/lib/db/schema.sql:77-78` | 추가 컬럼 |

### 5.2 파이프라인 변경

| 우선 | 위치 | 변경 |
| --- | --- | --- |
| P0 | `src/lib/pipeline/snapshot.ts:738-754` | `insertSource()` 호출 시 `slot`과 `metadata` 계산 후 기록 |
| P0 | `src/lib/pipeline/source_category.ts` | `classifySlot()`(5분류) 신규 export. `classifySourceCategory()`(3분류)는 레거시 호환용으로 유지 |
| P0 | `src/lib/pipeline/tavily.ts:151-227` | 반환 타입을 `news/social/data` → 5슬롯 구조로 확장 (내부 시드 쿼리는 유지) |
| P1 | 신규 `src/lib/pipeline/golden5.ts` | `buildGolden5(keyword, sources)` 함수 구현 |
| P1 | 신규 `src/lib/pipeline/x_source.ts` | X API 호출 래퍼 (환경변수 `X_BEARER_TOKEN` 기반, 미설정 시 no-op) |
| P2 | 신규 `src/lib/pipeline/threads_oembed.ts` | Threads oEmbed 호출 |
| P2 | `src/lib/pipeline/youtube_source.ts` / `youtube_recommend_source.ts` | 영상 duration·viewCount 메타 보존하도록 확장 (현재는 제목·URL 중심) |

### 5.3 API 변경

| 우선 | 엔드포인트 | 변경 |
| --- | --- | --- |
| P0 | `GET /api/v1/keywords/:id` | 응답에 `golden` 필드 추가. `sources`는 당분간 유지(하위 호환) |
| P0 | `GET /api/v1/keywords/:id` | 응답에 `x_search_url`, `threads_search_url`, `github_search_url`, `youtube_search_url` 기본 deeplink 필드 4개 추가 |
| P1 | `GET /api/v1/trends/top` | 각 아이템에 `goldenPreview`(제목 5종 썸네일)만 얇게 포함하는 선택 파라미터 `?preview=1` |
| P1 | `GET /api/v1/search` | DB 매칭 성공 시 `golden` 동일 구조 반환 |
| P2 | `POST /api/v1/keywords/:id/view` | 파라미터에 `slotClicked?: 'news'|'repo'|'video'|'xpost'|'thread'` 추가 (어디서 이탈했는지 측정) |
| P2 | `GET /api/v1/trends/hot` | `hot` 판정 기준에 SNS 슬롯 클릭 이벤트 가중 (engagement 시그널, B 보고서 참조) |

### 5.4 클라이언트(Flutter) 측 변경 (요약)

> 상세는 Flutter 팀 후속 작업. 본 보고서는 변경 **범위만** 명시.

- `lib/features/trends/presentation/trends_screen.dart` — Top10 카드에 `goldenPreview` 썸네일 5개 스트립 (옵션).
- `lib/features/trends/state/trends_controller.dart` — `golden` 필드 파싱 · 상태 보관.
- 디테일 화면 신설 또는 기존 화면 확장: 슬롯 5카드 + "X/Threads/YouTube/GitHub에서 더 보기" 4 CTA.

### 5.5 마이그레이션 SQL 초안 (의사코드)

```sql
-- P0-1: sources.slot 컬럼 추가 (NULL 허용)
ALTER TABLE sources ADD COLUMN IF NOT EXISTS slot TEXT;
-- slot ∈ {'news','repo','video','xpost','thread','other'}

-- P0-2: sources.metadata JSONB 추가 (NULL 허용)
ALTER TABLE sources ADD COLUMN IF NOT EXISTS metadata JSONB;
-- 예: { "stars": 1234, "duration_sec": 480, "like_count": 120, "author_handle": "@foo" }

-- P0-3: sources.language 추가
ALTER TABLE sources ADD COLUMN IF NOT EXISTS language TEXT;
-- ko/en/ja/zh/other

-- P1-1: golden5 결과 캐시
CREATE TABLE IF NOT EXISTS golden_slots (
  snapshot_id TEXT NOT NULL,
  keyword_id  TEXT NOT NULL,
  slot_name   TEXT NOT NULL,  -- news/repo/video/xpost/thread
  source_id   INTEGER,         -- sources.id 참조, NULL이면 deeplink
  deeplink    TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (snapshot_id, keyword_id, slot_name)
);

-- P1-2: 관리자 X 수동 큐레이션
CREATE TABLE IF NOT EXISTS manual_x_tweets (
  id            SERIAL      PRIMARY KEY,
  keyword       TEXT        NOT NULL,
  mode          TEXT        NOT NULL DEFAULT 'realtime',
  tweet_id      TEXT        NOT NULL,
  tweet_url     TEXT        NOT NULL,
  author_handle TEXT        NOT NULL,
  cached_text   TEXT,
  cached_like_count INTEGER DEFAULT 0,
  enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- P1-3: 관리자 Threads 수동 큐레이션
CREATE TABLE IF NOT EXISTS manual_threads_posts (
  id            SERIAL      PRIMARY KEY,
  keyword       TEXT        NOT NULL,
  mode          TEXT        NOT NULL DEFAULT 'realtime',
  thread_url    TEXT        NOT NULL,
  author_handle TEXT        NOT NULL,
  cached_text   TEXT,
  enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- P1-4: 관리자 SNS 핸들 리스트
CREATE TABLE IF NOT EXISTS manual_sns_handles (
  id          SERIAL      PRIMARY KEY,
  platform    TEXT        NOT NULL,  -- 'x' or 'threads'
  handle      TEXT        NOT NULL,
  label       TEXT        NOT NULL DEFAULT '',
  language    TEXT        NOT NULL DEFAULT 'ko',
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_sns_handles_platform_handle
  ON manual_sns_handles(platform, lower(handle));
```

> 의사코드. 기존 `scripts/db/migrate.ts`(`CLAUDE.md:17`) 스타일과 맞춰 **비파괴적 ALTER + IF NOT EXISTS 패턴**을 유지.

### 5.6 API 응답 스키마 진화 (신구 혼합)

```ts
// 기존 응답 (유지)
interface KeywordDetail_v1 {
  snapshotId: string;
  id: string;
  keyword: string;
  updatedAt: string;
  summary: string;
  bullets: string[];
  sources: Array<{
    type: 'news' | 'social' | 'data';
    items: SourceItem[];
  }>;
}

// v2 (제안) — v1의 superset
interface KeywordDetail_v2 extends KeywordDetail_v1 {
  golden: {
    news:   GoldenItem | null;
    repo:   GoldenItem | null;
    video:  GoldenItem | null;
    xpost:  GoldenItem | null;
    thread: GoldenItem | null;
  };
  deeplinks: {
    x_search:       string;  // 항상 존재
    threads_search: string;  // 항상 존재
    youtube_search: string;  // 항상 존재
    github_search:  string;  // 항상 존재
  };
  schemaVersion: 2;
}

interface GoldenItem {
  kind: 'source' | 'deeplink' | 'embed';
  title?: string;
  url: string;
  source?: string;          // domain
  publishedAt?: string;
  snippet?: string;
  imageUrl?: string;
  metadata?: Record<string, unknown>;  // stars / duration / likeCount 등
  badge?: string;           // A/B/C/D trust tier, ⚡ 쇼츠, 🇰🇷 한국어
}
```

### 5.7 하위 호환 정책 타임라인

| 버전 | `sources` | `golden` | `deeplinks` | 비고 |
| --- | --- | --- | --- | --- |
| v1(현행) | ✅ | ❌ | ❌ | 현재 Flutter 클라 대응 |
| v1.1 | ✅ | ❌ | ✅ (추가) | Flutter 앱 구버전도 무시하므로 안전 |
| v2 | ✅ | ✅ | ✅ | 신규 Flutter 릴리스 기반 |
| v2.1 | ⚠ (deprecation 메모) | ✅ | ✅ | `sources`는 유지하되 문서에 deprecation 표시 |
| v3 | ❌ (제거) | ✅ | ✅ | 앱 강제 업데이트 완료 후 |

---

## 6. 구현 로드맵 & 영향도

| 스프린트 | 목표 | 기술 작업 | 사용자 체감 | 코드 변경량(대략) |
| --- | --- | --- | --- | --- |
| S1 (1주) | SNS deeplink CTA | API 응답에 4 deeplink 필드 추가 + Flutter 4 CTA 버튼 | "X/Threads/YouTube/GitHub에서 한 번에 이동" | 300~500 LOC |
| S2 (1~2주) | 5슬롯 분류 | `classifySlot`, `sources.slot`, 파이프라인 기록, API `golden` 필드 | 디테일 화면 구조적 개선 | 800~1200 LOC |
| S3 (2주) | YouTube·GitHub 메타 보강 | duration/stars/release 필드 수집, 카드에 뱃지 노출 | "영상 길이·별 수 보고 빠르게 판단" | 500 LOC |
| S4 (2주) | 관리자 큐레이션 | `manual_x_tweets` / `manual_threads_posts` / `manual_handles` | 한국 바이브코더 핸들 노출 | 700 LOC + admin UI |
| S5 (선택) | X API 연동 | `X_BEARER_TOKEN`, 1h 배치 | 대표 트윗 1건이 실제로 최신 | 400 LOC + 월 $200 |

---

## 7. 회귀 검증 시나리오 (5건)

> 각 시나리오는 Subtask B(랭킹) 와 겹치지 않도록 **콘텐츠 슬롯 품질**에만 초점.

| # | 입력 조건 | 기대 결과 |
| --- | --- | --- |
| 1 | 키워드 `"Claude Code 2"`, 뉴스 소스 8건·YouTube 2건·GitHub 1건·X Tavily hit 1건·Threads Tavily hit 0건 | `golden.news` = 공식 OR 주요매체 1건, `golden.video` = 2건 중 스코어 높은 1건, `golden.repo` = 그 1건, `golden.xpost` = Tavily hit 또는 deeplink, `golden.thread` = **deeplink(빈 결과 없어야 함)** |
| 2 | 키워드 `"바이브코딩"`, 한국 매체 news 6건·velog 2건·YouTube(한국 채널) 3건 | `golden.news`에 한국어 기사 1건 우선, `golden.video`에 한국 채널 1건, 영어 `scoreNews`가 높더라도 언어 가중치로 한국어 기사가 채택되는지 검증 |
| 3 | 키워드 `"ChatGPT Atlas"`, 단일 공식 openai.com 글 1건·GitHub hit 0건·YouTube hit 0건·X hit 0건·Threads hit 0건 | 골든5 중 슬롯1만 실 콘텐츠, 슬롯2·3·4·5는 모두 deeplink 폴백(`github_search_url`/`youtube_search_url`/`x_search_url`/`threads_search_url`) |
| 4 | 동일 도메인 techcrunch.com 기사가 news 상위 3건·social 상위 2건에 반복 등장 | 다양성 정책에 따라 `golden.news`에 1건만 채택되고, 나머지는 레거시 `sources` 배열에만 남음 |
| 5 | X API enabled + `X_BEARER_TOKEN` 설정, 키워드 `"Windsurf Editor"`에 대해 likeCount 150·quoteCount 20 트윗 존재 | `golden.xpost`에 해당 트윗 `tweetId`·`authorHandle` 채움, 품질 하한(`≥10 likes`) 통과. `cached_like_count` 기록으로 이후 30분 내 재호출 시 API 재호출 없이 재사용 |

---

## 8. 위험 요소 & 완화

| 위험 | 영향 | 완화 |
| --- | --- | --- |
| X API 요금 인상 / 쿼터 변경 | 예산 초과 | 티어드 호출(상위 5키워드만) + deeplink 폴백 상시 유지 |
| Threads oEmbed 사양 변경 | 임베드 렌더 실패 | 실패 시 자동 deeplink로 전환 |
| Tavily `site:x.com` 결과 품질 저하 | 골든5 X 슬롯에 낚시 트윗 들어감 | 품질 하한(`≥10 likes`)·관리자 블랙리스트 해시 테이블 |
| 한국어 편향 과다 | 글로벌 사용자에게 이질감 | `lang` 쿼리에 따라 가중치 비대칭 — `lang=en`이면 0 |
| DB 스키마 변경이 타 팀과 충돌 | 배포 지연 | `sources.slot`을 NULL 허용 + default로 시작 → 점진 백필 |
| X/Threads 약관 위반 소지 | 앱스토어 정책 | 스크래핑 경로(Nitter 등) 도입하지 않음을 **정책으로 명문화** |

---

## 9. 사용자 만족 체크리스트 (Subtask C 성공 기준)

- [ ] 키워드 하나를 누르면 **5개 카테고리(뉴스/리포/영상/X/Threads)가 항상 보인다** (빈 슬롯 0%).
- [ ] X·Threads 카테고리가 **존재한다** (현재 0 → 목표 100%).
- [ ] 대표 트윗/스레드 1건이라도 실제 노출되는 키워드 비율 ≥ 50% (나머지는 deeplink 허용).
- [ ] "X에서 더 보기", "Threads에서 더 보기", "YouTube 검색", "GitHub 검색" 버튼이 디테일 하단에 상시 존재.
- [ ] YouTube 카드에 썸네일·재생시간, GitHub 카드에 별 수가 노출.
- [ ] 한국어 UI에서 한국어 뉴스·영상 비율 ≥ 40% (언어 정책).
- [ ] 관리자가 수동으로 X/Threads 대표 포스트를 고정할 수 있다 (최소 key 단위 수동 override 수단 제공).

---

## 10. 근거 인용 (file:line)

### 10.1 현행 카테고리 분류 로직
- `src/lib/pipeline/source_category.ts:10-41` — `SOCIAL_DOMAINS` 세트 정의. X/Threads/Reddit/HN/Velog/Dev.to 등이 모두 하나의 `social` 버킷.
- `src/lib/pipeline/source_category.ts:43-102` — `DATA_DOMAINS` 세트 및 `YOUTUBE_HINT_RE`, `ACADEMIC_HINT_RE` 등. YouTube와 arXiv가 동일 `data` 버킷.
- `src/lib/pipeline/source_category.ts:137-157` — `classifySourceCategory()` 3분류 구현.
- `src/lib/pipeline/source_category.ts:159-192` — `determinePrimaryType()` 다수결 기반 primary 결정.
- `src/lib/pipeline/source_category.ts:194-201` — `pickPrimarySource()` 우선순위 소스 선택.

### 10.2 키워드 디테일 응답
- `src/app/api/v1/keywords/[id]/route.ts:13-17` — `SourceType = "news" | "social" | "data"` 고정.
- `src/app/api/v1/keywords/[id]/route.ts:75-103` — 응답 생성 시 `classifySourceCategory`로 재분류 및 `published_at` 기준 정렬.
- `src/app/api/v1/keywords/[id]/route.ts:115-131` — 최종 응답 형태(`snapshotId`, `keyword`, `summary`, `bullets`, `sources`).
- `src/app/api/v1/search/route.ts:17-97` — 검색 경로에서도 동일한 3분류 재활용.

### 10.3 SNS 검색 시드
- `src/lib/pipeline/tavily.ts:157-159` — X·Threads·Reddit·Dev.to 검색을 `site:` 쿼리로 묶어 처리.
- `src/lib/pipeline/tavily.ts:162-199` — Naver + Tavily 병렬 수집 → `dedupeByUrl` → `filterRelevantSources` → `scoreSourcePriority`.
- `src/lib/pipeline/tavily.ts:229-272` — 한국 소스 가중치 및 `isKoreanPreferredSource`.

### 10.4 파이프라인이 이미 확보한 영상/리포/공식 소스
- `src/lib/pipeline/snapshot.ts:1-17` — `github_source`, `github_releases_source`, `github_md_source`, `youtube_source`, `changelog_source`, `product_hunt_top_source`, `reddit_source` 임포트.
- `src/lib/pipeline/snapshot.ts:142-153` — `SOURCE_PLANS` 순서(P0_CURATED 우선).
- `src/lib/pipeline/snapshot.ts:738-754` — `insertSource()`에 `type`만 저장하고 추가 메타 없음.

### 10.5 DB 스키마 현재 모습
- `src/lib/db/schema.sql:66-104` — `sources` 테이블: `type`, `title`, `url`, `domain`, `published_at_utc`, `snippet`, `image_url`, `title_ko`, `title_en`. **slot/metadata 없음**.
- `src/lib/db/schema.sql:18-44` — `keywords` 테이블: `primary_type TEXT`.
- `src/lib/db/schema.sql:159-163` — `search_counts`.
- `src/lib/db/schema.sql:169-181` — `keyword_view_counts` (조회수).
- `src/lib/db/schema.sql:186-228` — `manual_keywords` 구조 (X/Threads 수동 큐레이션 테이블을 신설할 때 참고 패턴).
- `src/lib/db/schema.sql:233-249` — `manual_youtube_links` (영상 수동 큐레이션 기존 구조 — **X/Threads용으로 복제하면 됨**).
- `src/lib/db/schema.sql:254-298` — `youtube_recommend_channels` + 시드 26개 한국 채널 (바이브 코딩 맥락 매우 높음).

### 10.6 기타 관련
- `doc/api.md:1-436` — 현재 API 문서. `sources` 3분류 응답 명세 및 캐시 헤더.
- `_team-task.md:7-9, 69-95` — 사용자 컨텍스트 및 Subtask C 요구사항.
- `CLAUDE.md:15` — KST 05/11/17/23시 스냅샷 주기.

---

## 11. 미해결 질문

1. **X API 유료 플랜 도입 의사결정권자는 누구인가?** 월 $200 비용 승인 프로세스가 필요. 미도입 시 슬롯4는 영구 deeplink만 지원 → UX가 한 단계 제한됨.
2. **Threads 타인 포스트 검색을 공식적으로 얻을 방법이 현재 존재하지 않는다.** Meta가 2026년 내 검색 API를 개방할 가능성은 있으나 불확실. 그 사이 "deeplink + 관리자 수동 큐레이션" 조합이 장기 전략으로 적절한지, 아니면 "Threads 포기 후 Reddit 2순위 SNS로 승격" 같은 대체안을 원하는지 사용자 의사 필요.
3. **`primary_type` 컬럼 마이그레이션 범위** — 기존 키워드 레코드 수천~수만 건의 `primary_type`을 5슬롯(news/repo/video/xpost/thread)로 백필할 지, 아니면 신규 스냅샷부터 적용하고 기존은 레거시 3분류를 유지할 지? 전자는 데이터 일관성, 후자는 안전성.
4. **골든5의 "강제 5슬롯" vs. "가변 N슬롯"** — 최소 슬롯 보장(5개)이 UX에 유리하지만, 키워드 카테고리에 따라 "논문·데이터셋" 슬롯이 더 필요할 수도 있음 (예: "RAG Benchmark" 키워드). 슬롯 스키마가 키워드 타입에 따라 바뀌어도 되는가?
5. **임베드 대 deeplink 기본값** — 모바일 WebView에서 X/Threads 임베드 로드 시간이 체감상 1~3초대인데, 기본값을 "임베드"로 하면 디테일 화면 첫 페인트가 지연될 수 있다. **A/B 테스트 필요**.
6. **한국어 편향 허용 범위** — 글로벌 사용자에게 "한국어가 너무 많다"로 불만이 생길 가능성. `lang=en` 사용자에게도 Threads 한국 핸들 큐레이션을 보여줄 것인지?
7. **관리자 큐레이션 UI** — 현재 `manual_keywords`, `manual_youtube_links`에 대한 관리자 UI가 코드상 확인되지 않음. SNS 수동 큐레이션을 새로 도입할 때 **관리자 페이지 범위**가 어디까지인지 결정 필요(슬랙 명령? 별도 dashboard?).
8. **소스 중복 제거 기준** — 현재 `normalizeUrlKey`(tavily.ts:104-124)는 UTM 파라미터만 제거. X의 `?s=20`, YouTube의 `?feature=` 같은 도메인별 트래킹 파라미터는 유지됨. 슬롯 단위 중복 제거의 정밀도를 얼마나 높일 것인가?
9. **Threads URL 포맷** — 2026년 현재 `threads.net`과 `threads.com` 두 호스트가 혼재. `source_category.ts:18`는 `threads.net`만 소셜 도메인으로 등록됨. 정규화 필요.
10. **YouTube 쇼츠 취급** — 바이브 코딩 컨텍스트에서 쇼츠는 밈·훅 역할로 유용할 수도, 소음일 수도 있음. 기본 포함/제외 여부 결정 필요.
11. **뉴스 신뢰 tier JSON을 DB로 옮길지, JSON 파일(`src/config/domain_trust.json`)로 유지할지** — 관리자 편집 빈도가 어느 정도인지에 따라 선택. 관리자 편집 없으면 JSON 파일이 가장 저렴.
12. **Flutter 클라 버전 하위 호환 정책** — 구 앱 사용자가 `golden` 필드를 모르는 상태에서 `sources`만 렌더할 때 충돌이 없는지 — 기존 `sources` 배열 유지로 충분한지, 또는 앱 강제 업데이트 정책을 쓸지.

---

## 12. 본 보고서 범위 밖 표시 (다른 Subtask 소관)

- 소스 URL의 **추가·제거·교체 의사결정**(RSS, 공식 블로그 시드 목록 등) → **Subtask A** 소관.
- 골든5 슬롯의 **가중치 튜닝**이 전체 랭킹 `score`에 어떻게 기여해야 하는가 → **Subtask B** 소관. 본 보고서는 슬롯 내부 스코어(slot-local) 만 다루며, 전역 랭킹 영향은 별도.
- SNS 언급량·GitHub stars 증가율 같은 **새 시그널 도입** → 본 보고서에서는 "C-7 — Subtask B 정합" 한 줄로만 언급하고 정의는 B에 위임.

---

_끝._
