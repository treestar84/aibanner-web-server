# 2026-10-31 의존성 보안 수정

## 결과

수정 전 npm audit의 high 7건을 해소했다. `npm audit --omit=dev`와 개발 의존성을 포함한
`npm audit` 모두 0건이다. lockfile로 `npm ci`를 다시 실행한 뒤에도 0건을 확인했다.
이 기록은 알려진 의존성 취약점과 변경 경로의 검증 결과이며, 모든 보안 문제에 대한 보장은 아니다.

## 경고의 원인과 실제 경로

7건은 경고가 있는 패키지 수다. 상위 의존성으로 전파되는 항목이 포함돼 있다.

| 근본 패키지 | 문제 | 코드에서의 경로 | 수정 |
|---|---|---|---|
| Zod | 큰 배열의 검증 오류가 과도하게 누적돼 메모리 고갈 가능 | MCP 입력 스키마, OpenAI의 선택 의존성, Blob → OIDC → CLI 설정의 중첩 Zod | 3.25.76 및 중첩 4.1.11 → 4.6.7 |
| Undici | 과도한 Content-Encoding/TLS 오류 등으로 중단 가능. 특정 shared-cache/redirect 조합에서 캐시 오염과 교차 사용자 노출 가능 | `safe-fetch.ts`의 서버 HTTP 클라이언트, Cheerio | 직접 의존성 7.29.1 → 7.30.1 |
| body-parser | 압축 요청 뒤의 잘못된 바이트가 처리되지 않은 예외를 유발해 서버 중단 가능 | MCP SDK → Express → body-parser | lockfile에서 2.3.0 → 2.4.0 |

Zod의 경고는 `openai`, `@vercel/cli-config`, `@vercel/oidc`, `@vercel/blob`에도 전파돼
7개 패키지로 집계됐다. OpenAI/Blob 자체의 별도 취약점 4개가 발견됐다는 뜻은 아니다.

MCP는 기존에 32 KiB 본문 제한과 1,000개 입력 요소 제한이 있었다. 이 제한을 유지하고,
Zod 자체도 교체했다. 현재 safe-fetch는 manual redirect와 전용 Agent를 사용하며 shared
cache interceptor 조합을 사용하지 않는다. 이 조건은 일부 Undici 경고의 적용 범위를
줄이지만, 외부 HTTP 처리를 실제 사용하므로 설치된 취약 버전을 패치했다.

Next.js MCP 라우트는 Express의 기본 body-parser를 직접 설치하지 않는다. 그래도 SDK의
전이 의존성에 취약 버전을 남기지 않도록 같은 major 내 수정 버전으로 갱신했다.

## 호환성 선택

- OpenAI SDK 4.104.0의 Zod peer 조건은 v3이므로 Zod 4를 지원하는 6.49.0으로 갱신했다.
  기존 Chat Completions 호출을 유지한다. 모델, 프롬프트, max_tokens, response_format,
  호출 횟수와 환경변수는 변경하지 않는다.
- MCP SDK 1.32.1과 zod-to-json-schema 3.25.2는 Zod 4를 지원한다.
- Blob 2.8.2 및 OIDC 3.8.10은 유지했다. CLI 설정 패키지가 구형 Zod 4.1.11을 정확히
  고정하므로 `overrides.zod: "$zod"`로 패치된 루트 버전을 공유한다.
- Blob의 별도 Undici 6.29.1은 현재 감사의 취약 범위에 포함되지 않아 유지한다.
- `npm audit fix --force`, SDK 하향, audit 무시 설정을 사용하지 않는다.
- API/DB 계약, 인증, cron 설정, 환경변수, 앱 버전은 변경하지 않는다.

## 검증

- 깨끗한 `npm ci`: 성공, 취약점 0건.
- `npm audit --omit=dev`, `npm audit`: 각 0건.
- `npm ls zod openai undici body-parser`: 잘못된 peer/override 없이 정상 트리.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`: 통과.
- `npm test`: src 564개 + source-health 3개 통과.
- 실제 SDK HTTP 직렬화/응답 역직렬화 테스트 2개 추가. 외부 API는 호출하지 않는다.
- MCP 통합 검사 확대: 도구 6개, schema default/min/max, 잘못된 언어/범위/소수/긴 문자열/
  빈 검색어의 도구 실행 전 거부, 본문 크기와 입력 요소 제한 통과.
- Vercel CLI config의 공개 parse 함수가 공유 Zod에서 정상 동작하는지 로컬 가짜 설정으로 확인.
- 수정된 Undici로 실제 RSS/API를 재조회: FIV 3건, promppy 50건, KORAIA 194건 정상 처리.
  보강 입력은 요약·출처 근거로 사용되지 않는다.
- 로컬 프로덕션 서버의 홈/트렌드/메타 API와 MCP tools/list 응답을 확인했다.

## 공식 근거

- Zod: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- body-parser: https://github.com/advisories/GHSA-27r3-jxmh-p828
- Undici redirects/cache: https://github.com/advisories/GHSA-4w7w-5xrc-9h26
- Undici 패치 릴리즈: https://github.com/nodejs/undici/releases/tag/v7.30.1
- OpenAI 공식 SDK 안내: https://developers.openai.com/api/docs/libraries
