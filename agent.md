# web-server 압축 현황

## 0) 한 줄 상태
- **운영 가능한 상태**: `Top20` 랭킹 생성, `Top10` 상세 소스 저장, `ko/en` 로컬라이즈, `SSR 페이지 + API + 크론`이 모두 코드에 연결됨.

## 1) 사용자 기능(현재 구현)
- `/app`: 최신 스냅샷 기준 **AI 트렌드 Top10**(순위/변동/요약/썸네일) 표시.
- `/k/:id`: 키워드 상세(요약 + 출처를 `news/social/data`로 그룹) 표시.
- `/api/v1/meta`: 최신 스냅샷/다음 업데이트 시각 제공.
- `/api/v1/trends/top?limit=&lang=ko|en`: 랭킹 목록 제공(최대 50).
- `/api/v1/keywords/:id?lang=ko|en&snapshotId=`: 키워드 상세 제공.
- `/api/v1/search?q=&lang=ko|en`: DB 우선 검색, 실패 시 Tavily+Naver 하이브리드 fallback.
- `/api/cron/snapshot` (`GET/POST`): 스냅샷 파이프라인 + retention 실행(`CRON_SECRET` 지원).

## 2) 파이프라인 실제 동작(압축)
- 소스 수집: RSS + HN + GDELT + GitHub(Repo/Release/MD) + YouTube + Changelog + Product Hunt + Reddit.
- 키워드화: LLM 추출(`gpt-4o-mini`) + 다중 하드필터(제네릭/비AI/헤드라인/미디어명 등) + exact exclusion JSON.
- 랭킹화: recency/frequency/authority/internal 가중치 + delta rank + 신규 보너스.
- 저장전략: `Top1~10`은 요약/소스/이미지까지 상세 저장, `Top11~20`은 lightweight 저장.
- 소스강화: Tavily 글로벌 검색 + Naver 한국 자료 보강 + OG 이미지 보강 + 출처 타입 재분류.
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
- `.github/workflows/cron_realtime.yml`: KST `05:00`, `11:00`, `17:00`, `23:00` 스냅샷 트리거.

## 4) 구현 갭/주의(현재 코드 기준)
- `keyword_aliases` 테이블은 검색 join에 사용되며 스냅샷 처리 시 canonical/ko/en alias를 upsert함.
- `.env.example`에는 현재 미사용 키(`UPSTASH`, `RATE_LIMIT_RPM`, `TAVILY_WEB_RESULTS`)가 남아 있음. Naver 보강은 `NAVER_CLIENT_ID/SECRET`이 있을 때만 활성화됨.
- README의 과거 설명(`lib/kv`)과 실제 구조가 불일치할 수 있어 문서 정합성 유지 필요.
