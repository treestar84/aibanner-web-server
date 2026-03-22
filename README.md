# AI Trend Widget - Web Server

AI 트렌드 키워드를 수집/랭킹/요약해서 웹 화면과 API로 제공하는 Next.js 서버입니다.

## 사용자 입장에서 이 서비스로 할 수 있는 것

- `/app`에서 최신 **AI 트렌드 Top10**을 본다.
- 각 키워드를 눌러 `/k/:id`에서 **왜 뜨는지(요약) + 근거 출처(news/social/data)**를 본다.
- 앱/위젯/외부 클라이언트는 REST API로 같은 데이터를 가져온다.
- 검색어가 DB에 없으면 Tavily fallback으로 관련 출처를 즉시 보여준다.

## 현재 구현 상태 (코드 기준)

- 상태: **동작 중인 MVP+ 운영형 구조**
- 스냅샷: Top20 생성, Top10은 상세 저장, 11~20은 lightweight 저장
- 언어: `ko/en` 키워드/제목/요약 지원
- 크론: `GET|POST /api/cron/snapshot` + `CRON_SECRET` 인증
- 운영 스케줄:
  - realtime: **KST 05:00 / 11:00 / 17:00 / 23:00**
  - briefing: **KST 09:17 / 18:17**
- 보관 정책: retention 실행(상세 90일, 집계 365일 기본)

## 사용자 기능과 엔드포인트

| 기능 | 경로 | 설명 |
|---|---|---|
| 트렌드 목록 페이지 | `/app` | 최신 스냅샷 Top10 SSR 렌더링 |
| 키워드 상세 페이지 | `/k/:id` | 요약 + 출처 카드(news/social/data) |
| 최신 메타 | `GET /api/v1/meta` | 최신 스냅샷 ID/업데이트/다음 업데이트 |
| 랭킹 목록 | `GET /api/v1/trends/top?limit=10&lang=ko` | Top N 키워드 목록 |
| 핫 키워드 | `GET /api/v1/trends/hot?limit=10&lang=ko` | 최근 3일 realtime Top10 진입 키워드의 조회수 기반 랭킹 |
| 키워드 상세 API | `GET /api/v1/keywords/:id?lang=ko` | 특정 키워드 상세 데이터 |
| 자유 검색 | `GET /api/v1/search?q=...&lang=ko` | DB 검색 우선, 미매칭 시 Tavily fallback |
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

# 6) 수동 크론 실행
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/snapshot"
```

## 프로젝트 구조 (핵심)

```text
src/
  app/
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

1. 다중 소스 수집: RSS/HN/GDELT/GitHub/YouTube/Changelog
2. 키워드 추출/정규화: OpenAI + 하드 필터
3. 점수화/랭킹: recency/frequency/authority/internal
4. 소스 수집: Tavily + OG 이미지 보강 + 타입 분류
5. 저장: snapshots/keywords/sources
6. 정리: retention + daily stats 집계

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
- `TAVILY_API_KEY`
- `OPENAI_API_KEY`

권장:

- `CRON_SECRET`
- `OPENAI_MODEL` (기본 `gpt-4o-mini`)
- `GITHUB_TOKEN` (GitHub 소스 수집 품질/한도 개선)
- `PRODUCT_HUNT_TOKEN` (Product Hunt Top Products Launching Today 반영)
- `PIPELINE_*`, `TAVILY_*`, `RETENTION_*` 튜닝 값

`.env.example`를 템플릿으로 복사 후 사용하세요.

```bash
cp .env.example .env.local
```

## 운영 참고

- realtime 자동 트리거: `.github/workflows/cron_realtime.yml`
- briefing 자동 트리거: `.github/workflows/cron.yml`
- API 상세 문서: `doc/api.md`
- 파이프라인 상세 문서: `doc/pipeline.md`

## 주의 (현 시점 코드 기준)

- `keyword_aliases` 테이블은 검색 join에 쓰이지만 alias 저장 로직은 아직 연결되지 않았습니다.
- `.env.example`에 일부 미사용 키가 남아 있습니다(`UPSTASH_*`, `RATE_LIMIT_RPM`, `TAVILY_WEB_RESULTS`).
