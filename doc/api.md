# AI 트렌드 위젯 - API 데이터/사용 가이드

> 최종 업데이트: 2026-06-08
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
- 소스 타입 값은 `news | social | data`입니다. (`web | video | image`는 레거시 응답에서만 나타날 수 있음)

캐시 헤더:

- `GET /api/v1/meta`: `s-maxage=60`, `stale-while-revalidate=30`
- `GET /api/v1/trends/top`: `s-maxage=120`, `stale-while-revalidate=60`
- `GET /api/v1/keywords/{id}`: `s-maxage=900`, `stale-while-revalidate=300`
- `GET /api/v1/youtube/recent`: `no-store`
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
  "scheduleKst": ["09:10", "11:10", "13:10", "15:10"]
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

### 3.2-1 `GET /api/v1/trends/hot`

조회수 기반 핫 키워드 목록을 반환합니다.

핵심 규칙:

- 기준 집합: 최근 `RETENTION_KEYWORD_VIEW_DAYS`일(기본 3일) 내 `Top10`에 포함된 키워드
- 정렬: `viewCount DESC` → `lastViewedAt DESC` → `rank ASC`
- `viewCount`는 `POST /api/v1/keywords/{id}/view` 호출 누적값입니다.

쿼리 파라미터:

- `limit` (선택): 기본 `10`, 최대 `50`
- `lang` (선택): `ko`(기본) 또는 `en`

요청 예시:

```bash
curl "http://localhost:3000/api/v1/trends/hot?limit=10&lang=ko"
```

응답 예시:

```json
{
  "snapshotId": "20260301_1817_KST",
  "updatedAt": "2026-03-01T09:17:10.000Z",
  "lifecycleDays": 3,
  "items": [
    {
      "id": "claude_code_2",
      "keyword": "Claude Code 2",
      "rank": 3,
      "deltaRank": 1,
      "isNew": false,
      "viewCount": 1284,
      "lastViewedAt": "2026-03-01T10:20:02.000Z",
      "summaryShort": "요약...",
      "primaryType": "news",
      "topSource": {
        "title": "Release notes ...",
        "url": "https://example.com",
        "source": "example.com",
        "snippet": null,
        "imageUrl": "https://example.com/image.jpg"
      }
    }
  ]
}
```

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
3. 결과가 없으면 Tavily+Naver 하이브리드 검색 결과를 fallback으로 반환

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
      "type": "social",
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

응답 예시(DB 미매칭 -> Tavily+Naver fallback):

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

### 3.5 `GET /api/v1/promos`

앱/웹에 노출할 활성 프로모션 카드 목록을 반환합니다.

쿼리 파라미터:

- `lang` (선택): `ko`(기본) 또는 `en`

응답 특징:

- `Cache-Control: public, max-age=3600, s-maxage=3600`
- 활성 프로모션의 `updated_at` 기준 `Last-Modified` 제공
- 클라이언트의 `If-Modified-Since`가 최신이면 `304` 반환

응답 예시:

```json
{
  "items": [
    {
      "id": 1,
      "slug": "claude-code-meetup",
      "tag": "INFO",
      "tagColor": "#7C3AED",
      "title": "프로모션 제목",
      "subtitle": "첫 문장 기반 부제목",
      "body": "프로모션 본문",
      "imageUrl": "https://example.com/image.png",
      "gradientFrom": "#7C3AED",
      "gradientTo": "#4F46E5",
      "iconName": "info",
      "linkUrl": ""
    }
  ],
  "updatedAt": "2026-04-20T00:00:00.000Z"
}
```

### 3.5-1 `GET /api/v1/youtube/recent`

AI/바이브코딩 YouTube 채널에서 수집한 최신 영상을 반환합니다. 수집기는 채널 RSS에서 제목/썸네일/URL/게시시각을 저장하고, 영상 HTML metadata prefix에서 `durationSeconds`를 파싱해 `longform`/`shorts`를 분류합니다.

쿼리 파라미터:

- `limit` (선택): 기본 `20`, 최대 `50`
- `type` (선택): `longform`(기본), `shorts`, `all`

필터 규칙:

- `longform`: `videoType`이 `longform` 또는 기존 미분류 호환값 `unknown`인 영상
- `shorts`: `videoType`이 `shorts`인 영상만
- `all`: longform/shorts/unknown 전체

요청 예시:

```bash
curl "http://localhost:3000/api/v1/youtube/recent?limit=20&type=longform"
curl "http://localhost:3000/api/v1/youtube/recent?limit=20&type=shorts"
curl "http://localhost:3000/api/v1/youtube/recent?limit=20&type=all"
```

응답 예시:

```json
{
  "updatedAt": "2026-06-07T12:00:00.000Z",
  "nextUpdateAt": "2026-06-07T15:10:00.000Z",
  "type": "shorts",
  "items": [
    {
      "videoId": "mcRL96sy7lA",
      "channelName": "AI Channel",
      "title": "메타·구글 광고를 AI가 알아서 돌린다?",
      "thumbnailUrl": "https://i.ytimg.com/vi/mcRL96sy7lA/hqdefault.jpg",
      "videoUrl": "https://www.youtube.com/watch?v=mcRL96sy7lA",
      "publishedAt": "2026-06-07T03:20:00.000Z",
      "viewCount": null,
      "likeCount": null,
      "durationSeconds": 52,
      "videoType": "shorts",
      "isManual": false
    }
  ]
}
```

참고:

- Flutter의 YouTube 화면은 `롱폼`, `쇼츠`, `전체` 모드를 모두 사용합니다.
- Flutter 홈 화면의 YouTube 스트립은 홈 전용 controller로 항상 `type=longform`을 요청하고, 렌더링 단계에서도 `shorts` 항목을 제외합니다.
- `durationSeconds`는 YouTube 페이지 파싱 실패 시 `null`일 수 있으며, 이 경우 자동 수집 영상은 `unknown`으로 남아 기본 longform 피드에 포함됩니다.

### 3.6 `GET/POST /api/cron/snapshot`

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

### 3.7 `POST /api/v1/keywords/{id}/view`

특정 키워드 상세 조회 이벤트를 누적합니다.

동작:

- `keyword_id`가 최신 스냅샷 기준 유효한 경우 `keyword_view_counts.view_count` 증가
- 동일 IP + 동일 keyword 조합은 1시간 내 중복 집계 차단 (서버 인스턴스 내 메모리 기반)
- 유효하지 않은 ID는 `404`

> **참고**: Flutter 앱은 이 엔드포인트를 직접 호출하지 않고 `POST /api/v1/keywords/views` 배치 엔드포인트를 사용합니다.

요청 예시:

```bash
curl -X POST "http://localhost:3000/api/v1/keywords/claude_code_2/view"
```

응답 예시:

```json
{ "ok": true, "keywordId": "claude_code_2" }
```

중복 요청 응답 (집계 생략):

```json
{ "ok": true, "keywordId": "claude_code_2", "skipped": true }
```

에러:

- `400`: `{ "error": "keyword id is required" }`
- `404`: `{ "error": "Keyword not found" }`
- `500`: `{ "error": "Internal server error" }`

### 3.8 `POST /api/v1/keywords/views` _(신규 · 2026-06-06)_

여러 키워드 조회수를 한 번에 집계합니다. Flutter 앱의 `ViewBatchQueue`가 사용합니다.

동작:

- `ids` 배열을 받아 각 `keyword_id`의 `view_count`를 일괄 증가
- 중복 ID는 서버 측 Set으로 자동 제거
- 최대 20개 처리 (초과분 무시)

요청 예시:

```bash
curl -X POST "http://localhost:3000/api/v1/keywords/views" \
  -H "Content-Type: application/json" \
  -d '{"ids": ["claude_code_2", "gpt_5_1", "cursor_ai"]}'
```

응답 예시:

```json
{ "ok": true, "counted": 3 }
```

에러:

- `400`: `{ "error": "ids must be a non-empty array" }`
- `400`: `{ "error": "No valid ids provided" }`
- `500`: `{ "error": "Internal server error" }`

## 4. 클라이언트 구현용 최소 타입 예시

```ts
type SourceType = "news" | "social" | "data";

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
- `src/app/api/v1/promos/route.ts`
- `src/app/api/cron/snapshot/route.ts`
