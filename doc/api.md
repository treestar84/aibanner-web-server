# AI 트렌드 위젯 - API 데이터/사용 가이드

> 최종 업데이트: 2026-02-27  
> 관련 코드: `src/app/api/`

## 1. 빠른 사용 흐름

1. `GET /api/v1/meta`로 최신 스냅샷 ID 확인
2. `GET /api/v1/trends/top?limit=10&lang=ko`로 Top 키워드 조회
3. `GET /api/v1/keywords/{id}?lang=ko`로 키워드 상세 조회
4. 필요 시 `GET /api/v1/search?q=...`로 자유 검색

예시 베이스 URL:

- 로컬: `http://localhost:3000`
- 프로덕션: `<your-domain>`

## 2. 공통 규칙

- 응답 포맷은 JSON입니다.
- 시간 필드(`updatedAt`, `nextUpdateAt`, `publishedAt`)는 ISO-8601 UTC 문자열입니다.
- `lang` 쿼리는 `en`일 때만 영어, 그 외 값은 기본 `ko`로 처리됩니다.
- 소스 타입 값은 `news | web | video | image`입니다.

캐시 헤더:

- `GET /api/v1/meta`: `s-maxage=60`, `stale-while-revalidate=30`
- `GET /api/v1/trends/top`: `s-maxage=120`, `stale-while-revalidate=60`
- `GET /api/v1/keywords/{id}`: `s-maxage=900`, `stale-while-revalidate=300`
- `GET /api/v1/search`: 별도 캐시 헤더 없음

## 3. 엔드포인트 상세

### 3.1 `GET /api/v1/meta`

최신 스냅샷 메타 정보를 반환합니다.

응답 예시:

```json
{
  "latestSnapshotId": "20260227_2100_KST",
  "updatedAt": "2026-02-27T12:00:00.000Z",
  "nextUpdateAt": "2026-02-27T21:00:00.000Z",
  "scheduleKst": ["09:17", "18:17"]
}
```

에러:

- `404`: `{ "error": "No snapshot available yet" }`
- `500`: `{ "error": "Internal server error" }`

### 3.2 `GET /api/v1/trends/top`

최신 스냅샷의 랭킹 키워드 목록을 반환합니다.

쿼리 파라미터:

- `limit` (선택): 기본 `10`, 최대 `50`
- `lang` (선택): `ko`(기본) 또는 `en`

요청 예시:

```bash
curl "http://localhost:3000/api/v1/trends/top?limit=10&lang=ko"
```

응답 예시:

```json
{
  "snapshotId": "20260227_2100_KST",
  "updatedAt": "2026-02-27T12:00:00.000Z",
  "nextUpdateAt": "2026-02-27T21:00:00.000Z",
  "items": [
    {
      "id": "gpt_5_1",
      "rank": 1,
      "keyword": "GPT 5.1",
      "deltaRank": 2,
      "isNew": false,
      "score": 0.8123,
      "scoreBreakdown": {
        "recency": 0.91,
        "frequency": 0.4,
        "authority": 1,
        "internal": 0
      },
      "summaryShort": "요약 문장...",
      "primaryType": "news",
      "topSource": {
        "title": "OpenAI announces ...",
        "url": "https://example.com/post",
        "source": "openai.com",
        "snippet": null,
        "imageUrl": "https://example.com/image.jpg"
      }
    }
  ]
}
```

참고:

- `topSource`는 없을 수 있어 `null`이 될 수 있습니다.
- `topSource.imageUrl`이 없으면 기본 이미지 경로가 내려갑니다.
- `primaryType` 값은 `news | social | data` 입니다.

에러:

- `404`: `{ "error": "No snapshot available yet" }`
- `500`: `{ "error": "Internal server error" }`

### 3.3 `GET /api/v1/keywords/{id}`

특정 키워드의 상세 정보와 소스 목록을 반환합니다.

경로 파라미터:

- `id`: `keyword_id`

쿼리 파라미터:

- `snapshotId` (선택): 특정 스냅샷 기준 조회
- `lang` (선택): `ko`(기본) 또는 `en`

요청 예시:

```bash
curl "http://localhost:3000/api/v1/keywords/gpt_5_1?lang=en"
curl "http://localhost:3000/api/v1/keywords/gpt_5_1?snapshotId=20260227_2100_KST&lang=ko"
```

응답 예시:

```json
{
  "snapshotId": "20260227_2100_KST",
  "id": "gpt_5_1",
  "keyword": "GPT 5.1",
  "updatedAt": "2026-02-27T12:00:00.000Z",
  "summary": "Keyword summary...",
  "sources": [
    {
      "type": "news",
      "items": [
        {
          "title": "기사 제목",
          "url": "https://example.com/article",
          "source": "example.com",
          "publishedAt": "2026-02-27T11:20:00.000Z",
          "snippet": "본문 요약",
          "imageUrl": "https://example.com/image.jpg"
        }
      ]
    }
  ]
}
```

에러:

- `404`: `{ "error": "Snapshot not found" }` (`snapshotId`가 잘못된 경우)
- `404`: `{ "error": "No snapshot available yet" }`
- `404`: `{ "error": "Keyword not found" }`
- `500`: `{ "error": "Internal server error" }`

### 3.4 `GET /api/v1/search`

자유 검색 API입니다.

동작 순서:

1. 최신 스냅샷 DB에서 `keyword`/`alias`를 부분 검색 (`ILIKE`)
2. 결과가 있으면 랭크가 가장 높은 1개 키워드 상세 반환
3. 결과가 없으면 Tavily 검색 결과를 fallback으로 반환

쿼리 파라미터:

- `q` (필수): 검색어
- `limit` (선택): 타입별 최대 아이템 수, 기본 `10`
- `lang` (선택): `ko`(기본) 또는 `en`

요청 예시:

```bash
curl "http://localhost:3000/api/v1/search?q=claude%20code&limit=5&lang=ko"
```

응답 예시(DB 매칭 성공):

```json
{
  "id": "claude_code",
  "keyword": "Claude Code",
  "updatedAt": "2026-02-27T12:00:00.000Z",
  "summary": "요약 문장...",
  "bullets": [],
  "sources": [
    {
      "type": "web",
      "items": [
        {
          "title": "문서 제목",
          "url": "https://example.com/doc",
          "source": "example.com",
          "publishedAt": "2026-02-27T11:00:00.000Z",
          "snippet": "설명...",
          "imageUrl": "https://example.com/image.png"
        }
      ]
    }
  ]
}
```

응답 예시(DB 미매칭 -> Tavily fallback):

```json
{
  "id": "search_claude code swammode",
  "keyword": "claude code swammode",
  "updatedAt": "2026-02-27T12:34:56.000Z",
  "summary": "첫 검색 결과 스니펫...",
  "bullets": [],
  "sources": [
    {
      "type": "news",
      "items": [
        {
          "title": "Search result title",
          "url": "https://example.com",
          "source": "example.com",
          "publishedAt": "2026-02-27T12:00:00.000Z",
          "snippet": "snippet",
          "imageUrl": ""
        }
      ]
    }
  ]
}
```

에러:

- `400`: `{ "error": "q parameter is required" }`
- `500`: `{ "error": "Internal server error" }`

### 3.5 `GET/POST /api/cron/snapshot`

스냅샷 파이프라인을 실행합니다. `POST`는 `GET`과 동일 동작입니다.

인증:

- `CRON_SECRET`가 설정된 경우 헤더 필요
- `Authorization: Bearer <CRON_SECRET>`

요청 예시:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/snapshot"
```

성공 응답:

```json
{
  "ok": true,
  "snapshotId": "20260227_2100_KST",
  "keywordCount": 10,
  "reusedCount": 7,
  "newCount": 3,
  "durationMs": 41234
}
```

에러:

- `401`: `{ "error": "Unauthorized" }`
- `500`: `{ "error": "Pipeline failed", "detail": "..." }`

## 4. 클라이언트 구현용 최소 타입 예시

```ts
type SourceType = "news" | "web" | "video" | "image";

interface SourceItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  snippet: string;
  imageUrl: string | null;
}

interface GroupedSources {
  type: SourceType;
  items: SourceItem[];
}
```

## 5. 참고 코드

- `src/app/api/v1/meta/route.ts`
- `src/app/api/v1/trends/top/route.ts`
- `src/app/api/v1/keywords/[id]/route.ts`
- `src/app/api/v1/search/route.ts`
- `src/app/api/cron/snapshot/route.ts`
