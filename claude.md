# web-server 압축 현황

## 0) 한 줄 상태
- **운영 가능한 상태**: `Top20` 랭킹 생성, `Top10` 상세 소스 저장, `ko/en` 로컬라이즈, `SSR 페이지 + API + 크론`이 모두 코드에 연결됨.

## 1) 사용자 기능(현재 구현)
- `/app`: 최신 스냅샷 기준 **AI 트렌드 Top10**(순위/변동/요약/썸네일) 표시.
- `/k/:id`: 키워드 상세(요약 + 출처를 `news/social/data`로 그룹) 표시.
- `/api/v1/meta`: 최신 스냅샷/다음 업데이트 시각 제공.
- `/api/v1/trends/top?limit=&lang=ko|en`: 랭킹 목록 제공(최대 50). 응답 최상위에 `minSupportedVersion`(semver, env `VIBENOW_MIN_SUPPORTED_VERSION`, 기본 `1.0.0`) 포함 — Flutter 클라이언트 강제 업데이트 게이트용(`src/lib/api/app_version.ts`).
- `/api/v1/keywords/:id?lang=ko|en&snapshotId=`: 키워드 상세 제공.
- `/api/v1/search?q=&lang=ko|en`: DB 우선 검색, 실패 시 Tavily+Naver 하이브리드 fallback.
- `/api/cron/snapshot` (`GET/POST`): 스냅샷 파이프라인 + retention 실행(`CRON_SECRET` 지원).

## 2) 파이프라인 실제 동작(압축)
- 키워드 후보 수집 루트: `SOURCE_PLANS` 기준 **16개**.
- 소스 수집: Product Hunt + RSS + HN + GDELT + GitHub(Repo/MD/Release) + YouTube + Changelog + Techmeme + Google Alerts + Reddit + **OpenRouter** + **Hugging Face** + **Vendor Announcements** + **Bluesky**.
- 키워드화: LLM 추출(`gpt-4o-mini`) + 다중 하드필터(제네릭/비AI/헤드라인/미디어명 등) + exact exclusion JSON.
- 랭킹화: recency/frequency/authority/internal 가중치 + delta rank + 신규 보너스.
- 저장전략: `Top1~10`은 요약/소스/이미지까지 상세 저장, `Top11~20`은 lightweight 저장.
- 소스강화: Tavily 글로벌 검색 + Naver 한국 자료 보강 + OG 이미지 보강 + 출처 타입 재분류.
- 전문(全文) 보강(2026-07-07): 신규 키워드의 news 버킷 상위 2개 소스를 Jina Reader(`r.jina.ai`)로 전문 수집해 `generateSummaries`에 전달(`src/lib/pipeline/jina_reader.ts`). 실패/미설정 시 프롬프트가 기존 스니펫 기반과 완전히 동일(폴백 보장). env: `JINA_API_KEY`(선택), `JINA_READER_ENABLED`(기본 true), `JINA_FULLTEXT_MAX_CHARS`(기본 6000).
- 검색 폴백(2026-07-07): `fetchByQuery`에서 Tavily가 throw하거나 0건이면 Exa REST(`src/lib/pipeline/exa_source.ts`, `provider:"exa"`)로 폴백. `EXA_API_KEY` 미설정 시 완전 비활성(현행 동일).
- 로컬라이즈: 키워드/제목/요약 `ko/en` 쌍 저장.
- 정리정책: retention(기본 상세 90일, 집계 365일) + `keyword_daily_stats` 집계.

## 3) 폴더 책임(핵심)
- `src/app/api/cron/snapshot/route.ts`: 배치 진입점(인증/실행/응답).
- `src/app/api/v1/*`: 앱/웹 공용 REST API.
- `src/app/app`, `src/app/k/[id]`: 사용자 SSR 페이지.
- `src/lib/pipeline/*`: 수집/정규화/점수화/요약/이미지/보관 정책.
- `src/lib/db/*`: Neon SQL 클라이언트, 쿼리, 스키마.
- `src/config/keyword-exclusions.json`: exact 키워드 제외 목록.
- `scripts/db/migrate.ts`: SQL 스키마 적용 스크립트.
- `.github/workflows/cron_realtime.yml`: KST `09:10`, `11:10`, `13:10`, `15:10` 스냅샷 트리거.

## 4) 소셜 소스 수집 현황
- `socialQuery`: `site:threads.net OR site:reddit.com OR site:dev.to OR site:x.com OR site:twitter.com OR site:facebook.com OR site:clien.net`
- 소셜 버킷 한국 소스 우선순위 가중치: **+0.6** (뉴스/데이터 버킷은 +1.2 유지) → X/Reddit 등 글로벌 소셜 진입 공간 확보
- X.com/Threads.net은 Tavily 크롤링 제약으로 실제 수집 불안정. 공식 API 연동 미구현.
- Bluesky는 키워드 후보 수집 루트에 직접 포함됨. 도메인 필터 검색 6종(github.com/huggingface.co/arxiv.org/openai.com/anthropic.com)과 큐레이션 계정 7종(2026-07-07 getProfile+최근30일 포스팅 검증: unsloth.ai, clihub.org, github-trending-js.bsky.social, simonwillison.net, theverge.com, techcrunch.com, arstechnica.com)을 사용하고, 검색 채널은 engagement 3 이상 및 AI 관련성 정규식을 통과해야 함.
- Reddit 서브레딧 16종(2026-07-07 확장: singularity/StableDiffusion/ChatGPT 추가. 후보 검증 curl이 egress IP 403으로 막혀 잘 알려진 3종만 편입 — AI_Agents/mcp/GithubCopilot 등은 검증 가능 환경에서 재시도).
- `/api/v1/keywords/:id` 응답에 `deeplinks` 필드(x_search, threads_search, youtube_search, github_search) 포함.

## 5) 키워드 파이프라인 주요 설계 결정
- **audience relevance 필터**: `filterByAudienceRelevance(keywords, items)` — 키워드 텍스트만이 아니라 매칭된 기사 제목 1-2개를 LLM에 함께 전달해 "오늘 새로운 소식인지" 맥락 판단. 임계값 5점 미만 제거.
- **AI prefix 필터 정밀화**: `AI_GENERIC_PREFIX_RE`에 `어시스턴트|오케스트레이션|문서|다중|기사|처리|헬스케어|효율성|지식` 추가. "AI 오케스트레이션" → 필터, "LangChain 오케스트레이션" → 통과.
- **appearances 임계값**: cron 4x/day 기준으로 `>= 8 && < 12`(2~3일), `>= 12`(evergreen 패널티) 로 재조정. 기존 값은 1x/day 기준이었음.
- **version_release delta**: 단순 flat delta → authority/domain/engagement 기반 조건부 delta. 권위 있는 소스의 major 릴리즈는 +0.04, 단일 소스 낮은 릴리즈는 +0.005 유지.

## 6) 보안 & Rate Limiting (2026-06-06 적용·배포 완료)
- **`src/middleware.ts`**: `/api/v1/*` 전체에 IP 기반 슬라이딩 윈도우 Rate Limiting 적용.
  - `/api/v1/search`: 10 RPM — Tavily 비용 보호
  - `/api/v1/trends`: 30 RPM
  - `/api/v1/keywords`: 60 RPM
  - `/api/v1/` 기타: 100 RPM
  - 한도 초과 시 `429 Too Many Requests` + `Retry-After: 60` 헤더 반환.
  - 인스턴스 내 메모리 기반(Redis 미사용). 최대 10,000 엔트리, 만료 항목 자동 정리.
- **`POST /api/v1/keywords/{id}/view`**: 동일 IP + 동일 keyword 조합 1시간 쿨다운 적용. 중복 시 DB 집계 생략 (`{ ok: true, skipped: true }` 반환).

## 7) 배치 조회수 집계 (2026-06-06 적용·배포 완료)
- 기존 `/keywords/:id/view` 개별 POST → Flutter `ViewBatchQueue`로 전환.
- **신규 엔드포인트**: `POST /api/v1/keywords/views` — `{ ids: string[] }` 최대 20개 일괄 집계.
  - `src/app/api/v1/keywords/views/route.ts`
  - `src/lib/db/queries.ts` → `incrementKeywordViewCountBatch()`
- **Flutter 큐 규칙**: 세션 내 Set 중복 제거 → 5개 누적 또는 앱 백그라운드 진입 시 flush. 타이머 없음.
- 효과: 하루 최대 150,000 함수 호출 → 약 9,000건 (94% 감소).

## 8) 클라이언트 강제 업데이트 게이트 (2026-07-04 적용)
- `src/lib/api/app_version.ts`의 `getMinSupportedVersion()`이 `VIBENOW_MIN_SUPPORTED_VERSION`을 읽고 미설정 시 `'1.0.0'`을 반환.
- `src/app/api/v1/trends/top/route.ts` 성공 응답 최상위에 `minSupportedVersion` 필드로 노출.
- Flutter 쪽은 `package_info_plus`로 읽은 설치 버전과 비교(`lib/core/providers/update_required_provider.dart`)해 미달 시 업데이트 다이얼로그 표시. 서버 env를 올릴 때는 실제 배포된 최소 버전과 반드시 맞출 것 — 잘못 올리면 최신 버전 사용자까지 업데이트 다이얼로그를 보게 된다.

## 9) 구현 갭/주의(현재 코드 기준)
- `keyword_aliases` 테이블은 검색 join에 사용되며 스냅샷 처리 시 canonical/ko/en alias를 upsert함.
- `snapshot.ts`의 수집 결과는 `SOURCE_PLANS` 배열 순서와 구조 분해 순서가 반드시 일치해야 함. 과거 12개 plan 대비 10개만 구조 분해해 `reddit`, `google_alerts` 결과가 유실되고 `techmeme`이 잘못 매핑되던 문제가 있었으므로, 신규 수집기 추가 시 이 주석과 테스트를 함께 확인.
- `.env.example`에는 현재 미사용 키(`UPSTASH`, `RATE_LIMIT_RPM`, `TAVILY_WEB_RESULTS`)가 남아 있음. Naver 보강은 `NAVER_CLIENT_ID/SECRET`이 있을 때만 활성화됨.
- Rate Limiting은 Vercel 다중 인스턴스 간 공유 안됨(Redis 미도입). 단일 봇 burst 차단에는 효과적.
- README의 과거 설명(`lib/kv`)과 실제 구조가 불일치할 수 있어 문서 정합성 유지 필요.
