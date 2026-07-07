# AI Trend Widget - Web Server

AI 트렌드 키워드를 수집/랭킹/요약해서 웹 화면과 API로 제공하는 Next.js 서버입니다.

## 사용자 입장에서 이 서비스로 할 수 있는 것

- `/app`에서 최신 **AI 트렌드 Top10**을 본다.
- 각 키워드를 눌러 `/k/:id`에서 **왜 뜨는지(요약) + 근거 출처(news/social/data)**를 본다.
- 앱/위젯/외부 클라이언트는 REST API로 같은 데이터를 가져온다.
- 검색어가 DB에 없으면 Tavily+Naver 하이브리드 fallback으로 관련 출처를 즉시 보여준다.

## 현재 구현 상태 (코드 기준)

- 상태: **동작 중인 MVP+ 운영형 구조**
- 스냅샷: Top20 생성, Top10은 상세 저장, 11~20은 lightweight 저장
- 언어: `ko/en` 키워드/제목/요약 지원
- YouTube: RSS 기반 추천 영상 수집, title/thumbnail/duration 저장, `longform`/`shorts` 분리 제공
- 크론: `GET|POST /api/cron/snapshot` + `CRON_SECRET` 인증
- 운영 스케줄:
  - realtime: **KST 09:10 / 11:10 / 13:10 / 15:10**
- 보관 정책: retention 실행(상세 90일, 집계 365일 기본)
- 전문(全文) 보강: Top10 신규 키워드의 news 상위 2개 소스를 Jina Reader로 전문 수집해 요약 품질 강화. 실패/미설정 시 기존 스니펫 요약으로 자동 폴백
- 검색 폴백: Tavily 실패·0건 시 Exa REST 폴백(`EXA_API_KEY` 미설정 시 비활성)
- 소셜 소스 확장: Bluesky 도메인 검색 6종 + 검증된 큐레이션 계정 7종, Reddit 서브레딧 16종

## 사용자 기능과 엔드포인트

| 기능 | 경로 | 설명 |
|---|---|---|
| 트렌드 목록 페이지 | `/app` | 최신 스냅샷 Top10 SSR 렌더링 |
| 키워드 상세 페이지 | `/k/:id` | 요약 + 출처 카드(news/social/data) |
| 최신 메타 | `GET /api/v1/meta` | 최신 스냅샷 ID/업데이트/다음 업데이트 |
| 랭킹 목록 | `GET /api/v1/trends/top?limit=10&lang=ko` | Top N 키워드 목록 |
| 핫 키워드 | `GET /api/v1/trends/hot?limit=10&lang=ko` | 최근 3일 realtime Top10 진입 키워드의 조회수 기반 랭킹 |
| 키워드 상세 API | `GET /api/v1/keywords/:id?lang=ko` | 특정 키워드 상세 데이터 |
| 자유 검색 | `GET /api/v1/search?q=...&lang=ko` | DB 검색 우선, 미매칭 시 Tavily+Naver 하이브리드 fallback |
| YouTube 추천 | `GET /api/v1/youtube/recent?limit=20&type=longform` | 최신 AI YouTube 영상. `type=longform|shorts|all` 지원 |
| 스냅샷 실행 | `GET/POST /api/cron/snapshot` | 수집~랭킹~저장~retention 배치 실행 |

## API 빠른 사용 예시

```bash
# 1) 최신 스냅샷 메타
curl "http://localhost:3000/api/v1/meta"

# 2) 트렌드 Top10
curl "http://localhost:3000/api/v1/trends/top?limit=10&lang=ko"

# 3) 키워드 상세
curl "http://localhost:3000/api/v1/keywords/<keyword_id>?lang=ko"

# 4) 핫 키워드
curl "http://localhost:3000/api/v1/trends/hot?limit=10&lang=ko"

# 5) 검색
curl "http://localhost:3000/api/v1/search?q=claude%20code&lang=ko"

# 6) YouTube 추천 영상
curl "http://localhost:3000/api/v1/youtube/recent?limit=20&type=longform"
curl "http://localhost:3000/api/v1/youtube/recent?limit=20&type=shorts"

# 7) 수동 크론 실행
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/snapshot"
```

## 프로젝트 구조 (핵심)

```text
src/
  app/
    admin/                        # 관리자 UI(수동 키워드/유튜브/프로모션)
    app/page.tsx                 # /app 트렌드 페이지
    k/[id]/page.tsx              # /k/:id 상세 페이지
    api/
      v1/                        # 클라이언트용 REST API
      cron/snapshot/route.ts     # 배치 실행 엔드포인트
  lib/
    db/                          # Neon 쿼리/스키마
    pipeline/                    # 수집/정규화/스코어/요약/보관
  config/keyword-exclusions.json # exact 제외 키워드
scripts/db/migrate.ts            # DB 마이그레이션
```

## 파이프라인 요약

1. 다중 소스 수집: RSS/HN/GDELT/GitHub/YouTube/Changelog/Product Hunt/Techmeme/Google Alerts/Reddit/OpenRouter/Hugging Face/Vendor Announcements/Bluesky
2. 키워드 추출/정규화: OpenAI + 하드 필터
3. 점수화/랭킹: recency/frequency/authority/internal
4. 소스 수집: Tavily + Naver 한국 자료 보강 + OG 이미지 보강 + 타입 분류
5. YouTube 추천 영상 수집: 채널 RSS + 영상 HTML metadata prefix 파싱으로 duration/type 보강
6. 저장: snapshots/keywords/sources/youtube_videos
7. 정리: retention + daily stats 집계 + 90일 지난 YouTube 영상 삭제

## 키워드 수집 루트

`src/lib/pipeline/snapshot.ts`의 `SOURCE_PLANS` 기준 키워드 후보 수집 루트는 16개입니다. `youtube_recommend_source.ts`는 별도 추천 영상 저장 루트라 이 개수에 포함하지 않습니다.

| key | 신호 | tier/역할 | 주요 안전장치 |
|---|---|---|---|
| `product_hunt_top` | Product Hunt 상위 제품 | 제품/도구 신호 | Top feed 중심, 기존 랭킹 필터 적용 |
| `rss` | AI/테크 RSS 피드 | 뉴스/공식/커뮤니티 혼합 | 피드 allowlist와 기존 RSS 중복 제거 |
| `hn` | Hacker News | 커뮤니티 | Algolia 기반 AI 관련 쿼리 |
| `gdelt` | 글로벌 뉴스 | 뉴스 | 언어별 GDELT 검색, 기간 윈도우 적용 |
| `github` | GitHub repo 검색 | 개발자 신호 | 토큰 없으면 skip, 쿼리 그룹 단위 수집 |
| `github_md` | GitHub 문서/README 변화 | 개발자 신호 | 최근 파일 중심 |
| `youtube` | AI 관련 YouTube 업로드 | 영상 신호 | 채널 RSS 기반 |
| `github_releases` | GitHub 릴리즈 | 릴리즈 신호 | 릴리즈 도메인/시간 기준 |
| `changelog` | 제품 changelog | 릴리즈 신호 | 기존 changelog 패턴 |
| `techmeme` | Techmeme | 큐레이션 뉴스 | 최신 항목 중심 |
| `google_alerts` | Google Alerts RSS | 검색 알림 | Alerts RSS 파싱 |
| `reddit` | Reddit | 커뮤니티/SNS | OAuth 실패 시 skip, hot/rising 분리 |
| `openrouter` | OpenRouter 신규 모델 등록 | `P1_CONTEXT` | `:free` variant 병합, `~alias` 제외 |
| `huggingface` | Hugging Face 신규 모델 드랍 | 공식 org `P1`, 그 외 `COMMUNITY` | `createdAt` 최근성 필수, uncensored/GGUF 재업로드 차단, 비공식 org likes 50 이상 |
| `vendor_announcements` | Cursor/OpenAI 공식 공지 | `P0_CURATED` | pinned 옛글 `created_at` 필터, 벤더명 prefix로 키워드 맥락 보장 |
| `bluesky` | SNS발 신도구/신모델 | `COMMUNITY` | GitHub/HF 링크 도메인 필터, 큐레이션 계정 3종, 검색 채널 engagement 3 이상, AI 관련성 정규식 |

운영 로그는 `[snapshot] Got N items (...)`의 소스별 카운트로 확인합니다. 신규 4루트 효과와 함께 `reddit`, `google_alerts` 복구 효과가 섞일 수 있으므로 품질 변화를 볼 때 소스별 카운트를 먼저 분리해서 봅니다.

## 로컬 실행

```bash
npm install
npm run dev
```

브라우저:

- `http://localhost:3000/app`

## DB 마이그레이션

```bash
npm run db:migrate
```

## 필수 환경 변수

최소 실행 기준:

- `DATABASE_URL` (또는 `POSTGRES_URL`)
- `OPENAI_API_KEY`

권장:

- `CRON_SECRET`
- `TAVILY_API_KEY` (글로벌 출처 보강)
- `OPENAI_MODEL` (기본 `gpt-4o-mini`)
- `GITHUB_TOKEN` (GitHub 소스 수집 품질/한도 개선)
- `PRODUCT_HUNT_TOKEN` (Product Hunt Top Products Launching Today 반영)
- `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` (선택, 한국 뉴스/블로그/카페 보강)
- `JINA_API_KEY` (선택, 상위 소스 전문(全文) 수집 — 무키도 동작하나 rate limit 낮음), `JINA_READER_ENABLED`(기본 true), `JINA_FULLTEXT_MAX_CHARS`(기본 6000)
- `EXA_API_KEY` (선택, Tavily 실패/0건 시 검색 폴백 — 미설정 시 비활성)
- `PIPELINE_*`, `TAVILY_*`, `NAVER_*`, `RETENTION_*` 튜닝 값

랭킹 품질 정책은 기본적으로 shadow-only입니다. 운영 반영은 `PIPELINE_SOURCE_QUALITY_ENABLED`, `PIPELINE_GENERIC_CONTEXT_POLICY_ENABLED`, `PIPELINE_REPEAT_EXPOSURE_POLICY_ENABLED`, `PIPELINE_TOP20_LIGHTWEIGHT_GUARD_ENABLED`를 단계적으로 켜고, 문제가 있으면 `PIPELINE_QUALITY_SHADOW_ONLY=1`과 각 플래그 `0`으로 rollback합니다.

`.env.example`를 템플릿으로 복사 후 사용하세요.

```bash
cp .env.example .env.local
```

## 운영 참고

- 관리자 페이지: `/admin` (수동 키워드, YouTube 추천 소스, 프로모션 카드 관리)
- 공개 프로모션 API: `GET /api/v1/promos?lang=ko|en`
- realtime 자동 트리거: `.github/workflows/cron_realtime.yml`
- API 상세 문서: `doc/api.md`
- 파이프라인 상세 문서: `doc/pipeline.md`

## 주의 (현 시점 코드 기준)

- `keyword_aliases` 테이블은 검색 join에 쓰이며 스냅샷 처리 시 canonical/ko/en alias를 upsert합니다.
- `.env.example`에 일부 미사용 키가 남아 있습니다(`UPSTASH_*`, `RATE_LIMIT_RPM`, `TAVILY_WEB_RESULTS`).
