# 키워드 관심도 보강 소스

2026-10-31 구현. 사용자가 세 사이트의 저빈도 수집과 중단 요청 시 종료 방침을 승인했다.
이는 사이트의 포괄적인 이용 허가를 확인했다는 뜻이 아니다.

## 수집과 역할

| 대상 | 경로 | 한 실행의 상한 |
|---|---|---|
| 5분 AI 뉴스 | https://fiv.co.kr/feed.xml | 제공되는 RSS 항목, 실행 시간창 적용 |
| promppy | https://www.promppy.com/rss.xml | 제공되는 RSS 항목, 실행 시간창 적용 |
| KORAIA | https://report.koraia.org/info 에서 쓰는 Supabase JSON API | 공개 페이지 1회 + API 1회, 최대 200행 |

기존 `RssItem`과 수집 시간창을 재사용한다. FIV/promppy는 `RSS_FEEDS`에 등록하고,
KORAIA는 `SOURCE_PLANS`에 등록한다. 추가 유료 API 호출, DB 마이그레이션,
환경변수 변경은 없다. RSS 제목은 기존 키워드와 매칭하는 데만 쓰고 요약은 비운다.
KORAIA는 `title`의 ` | ` 뒤 발췌문을 제거한다. `created_at`은 집계 시각이며 원문
발행일의 근거로 사용하지 않는다. 공개 페이지에서 publishable key만 읽고 API 호스트를
고정 검증한다. 비공개 키는 사용하거나 저장하지 않는다. 장애/설정 변경/비정상 JSON은
빈 결과로 처리하며 기존 수집을 계속한다.

## 집계와 순위

- 정상 소스만으로 키워드 추출, 정규화, 관련성 필터링을 마친 뒤 보강한다.
- 보강 항목만으로 신규 키워드를 생성하지 않고, 외부 LLM의 추출 입력에도 넣지 않는다.
- 제목의 키워드/별칭을 매칭한다. 대소문자, NFKC, 하이픈/밑줄 표기를 정규화한다.
- 키워드당 사이트별 최대 1회, 전체 최대 3회를 `supplementalCount`로 별도 집계한다.
- 후보의 `count`에는 보강 건수를 더하되 `matchedItems`, `domains`, `latestAt`, tier와
  authority override는 바꾸지 않는다.
- 빈도 점수에 사이트당 0.25 단위를 더한다. 최대 빈도 증가 0.075,
  기본 frequency 가중치 0.10에서 총점 증가 상한은 0.0075다.
- 약한 근거/단일 기사 패널티는 보강분을 제외한 근거 건수로 계산한다.
- 공신력, 최신성, velocity, engagement 및 독립 출처 수를 증가시키지 않는다.

## 출처와 요약 제외

`keywordBoostSource` 표시 또는 보강 도메인에 해당하면 사건 컨텍스트에서 제외한다.
FIV/promppy/report.koraia.org와 그 하위 호스트는 검색 결과에서도 제외한다.
origin 변환에서도 다시 검사한다. 해당 사이트가 들어 있는 과거 캐시는 재사용하지
않고 정상 근거로 다시 처리한다. URL과 domain을 각각 확인한다.

따라서 기사/블로그 후보 출처, 대표 출처, 요약의 근거, 이미지 추출 후보에 보강 항목을
넣지 않는다. KORAIA가 연결한 원 매체의 주소를 보강 항목의 주소로 사용하지도 않는다.
원 매체가 기존 수집 경로로 별도 수집된 경우에는 기존 정책대로 처리한다.

## 확인한 이용 안내

- FIV: https://fiv.co.kr/about.html#citation 과 https://fiv.co.kr/llms.txt 에 짧은
  요약/인용과 출처 표기 안내가 있다. https://fiv.co.kr/robots.txt 는 공개 경로를 허용한다.
  전체 복제/재배포, 외부 자료 재사용에 대한 포괄 허가는 아니다.
- promppy: https://www.promppy.com/terms 제7조는 운영 방해 수준의 자동 요청과
  상업적 목적의 무단 복제/재배포를 제한한다. robots.txt는 /api/와 /admin을 제외한다.
  구현은 공식 RSS를 사용한다.
- KORAIA: 뉴스 전용 약관의 직접 연결은 찾지 못했다. 협회 회원약관
  https://startups.koraia.org/membership_Agreement.html 에 상업 이용/배포 제한이 있으며,
  비회원 뉴스 페이지에 대한 적용 범위는 미확정이다.

중단 요청이 오면 해당 RSS 등록 또는 KORAIA source plan을 제거한다. 검색/출처 제외
정책은 남겨 재유입을 막는다. 일괄 기사 백필과 원문 전체 저장은 하지 않는다.

## 검증과 한계

- 회귀 테스트: 보강 단독 입력의 키워드 생성 차단, 정상/보강 혼합 입력의 추출·매칭
  인덱스 보존, 별칭/모델명 경계, 사이트별 중복 제한, 신뢰도와 시각 보존, 순위 패널티
  우회 차단, 컨텍스트/origin/검색 결과 제외, KORAIA 오류·시각·상한 검증.
- 실제 72시간창 수집: FIV 3건, promppy 50건, KORAIA 194건. 세 소스 모두 summary는
  빈 문자열이며 보강 항목이 사건 근거로 편입되지 않는 것을 확인했다.
- 각 사이트는 원본 발표를 재소개할 수 있다. 독립 출처 수로 세지 않는다.
- FIV의 한 RSS 항목은 하루의 여러 주제를 담으므로 제목에 없는 세부 키워드는 놓친다.
- promppy 최근 50건과 KORAIA 최대 200건을 넘는 과거 항목은 누락될 수 있다.
  보강 신호의 불완전성이며 기존의 정상 수집을 대체하지 않는다.
- 추가 키워드 추출 LLM 호출은 없다. 매칭은 로컬에서 수행한다.
- 배포 전 기존 lockfile에서도 npm audit --omit=dev의 high 7건을 확인했다.
  이번 변경은 의존성을 변경하지 않는다. OpenAI/Zod 등의 major 변경은 별도 작업이다.

배포 전 검증: `npm install`, `npm run lint`, `npx tsc --noEmit`, `npm test`
(562개 + source-health 3개), `npm run build`,
`node --import tsx scripts/test-mcp-hardening.mjs` 통과.
로컬 프로덕션 서버의 `/`, `/api/v1/trends/top`, `/api/v1/meta`는 모두 HTTP 200.

후속 처리: 위 배포 당시 남았던 의존성 경고 7건은
[2026-10-31 보안 수정](dependency-security-20261031.md)에서 해소했다.
