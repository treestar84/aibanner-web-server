# AI Trend Widget — Server

AI 트렌드 실시간 키워드 랭킹 서비스 서버.
Next.js + Vercel Functions + Vercel Postgres + Vercel KV

## Stack

- **Framework**: Next.js 15 (App Router)
- **Hosting**: Vercel
- **DB**: Vercel Postgres
- **Cache**: Vercel KV (Redis)
- **Search**: Tavily Search API
- **AI**: OpenAI (gpt-4o-mini)

## 구조

```
src/
├── app/
│   ├── app/          # /app  - Top10 트렌드 목록 (SSR)
│   ├── k/[id]/       # /k/:id - 키워드 상세 (SSR)
│   └── api/
│       ├── v1/       # REST API (Flutter/웹 공용)
│       └── cron/     # 배치 파이프라인
└── lib/
    ├── db/           # Vercel Postgres 쿼리
    ├── kv/           # Vercel KV 캐시
    └── pipeline/     # 데이터 수집/처리 파이프라인
```

## API Endpoints

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/meta` | 최신 스냅샷 메타 |
| GET | `/api/v1/trends/top?limit=10` | Top10 트렌드 |
| GET | `/api/v1/keywords/:id?snapshotId=` | 키워드 상세 |
| POST | `/api/cron/snapshot` | 스냅샷 생성 (cron) |

## 배치 스케줄 (KST)

- 09:00 / 12:00 / 18:00 / 21:00

## 환경 변수 설정

```bash
cp .env.example .env.local
# .env.local 편집 후 값 채우기
```

## 개발 실행

```bash
npm install
npm run dev
```

## DB 마이그레이션

```bash
npm run db:migrate
```
