# OMC Team Task — 실시간 AI/바이브코딩 키워드 품질 감사 (2026-04-22)

## 목표
`realtime-ai-trend-news` 서비스의 실시간 키워드 품질을 사용자 만족 수준으로 끌어올리기 위한 감사·개선 보고서 3종 작성. **코드 변경 금지, 분석/권고만 산출**.

## 사용자 컨텍스트
- 서비스 사용자: "바이브 코딩"을 즐기는 사람들. 실시간 키워드를 누르면 그 키워드와 연관된 뉴스/콘텐츠/SNS 자료가 핫한 품질로 노출되어야 함.
- 우선순위 SNS: **X(Twitter)**, **Threads(Meta)** 링크 연결이 가장 긍정적.

## 공유 컨텍스트
- 워크스페이스 루트(워커 cwd): `/Users/treestar/dev/realtime-ai-trend-news/web-server`
- 핵심 코드: `src/lib/pipeline/`, `src/app/api/v1/`, `src/config/keyword-exclusions.json`
- 과거 RSS 시드 참고: `_pipeline_reference/workflow/resources/rss.json`
- 기존 문서: `doc/pipeline.md`, `doc/api.md`, `docs/superpowers/plans/2026-04-03-pipeline-quality-improvements.md`
- 산출물 디렉토리: `docs/audit/`
- 산출물 언어: **한국어**

## 작업 규칙
1. 워커는 자신이 claim한 서브태스크의 산출물 1개만 생성/수정. 다른 워커 파일은 절대 수정하지 말 것.
2. 코드 수정 금지(권고만). 단 보고서 안에 의사코드/diff 스니펫은 허용.
3. 외부 정보 필요 시 web fetch / web search 사용 가능.
4. 보고서 마지막에 **`근거 인용(file:line)`** 과 **`미해결 질문`** 섹션 필수.
5. 표/체크리스트 적극 활용. 막연한 형용사("좋다/나쁘다") 대신 등급/숫자 기준으로 판단.

---

## Subtask A — RSS / 외부 소스 카탈로그 감사
- 산출물: `docs/audit/2026-04-22-source-catalog-audit.md`
- 검토 대상 파일:
  - `src/lib/pipeline/gdelt_source.ts`
  - `src/lib/pipeline/hn_source.ts`
  - `src/lib/pipeline/youtube_source.ts`
  - `src/lib/pipeline/youtube_recommend_source.ts`
  - `src/lib/pipeline/changelog_source.ts`
  - `src/lib/pipeline/rss_feeds.test.ts` (현재 RSS 정의 추적)
  - `_pipeline_reference/workflow/resources/rss.json` (옛 시드 비교)
- 보고서가 답해야 할 질문
  1. 지금 어떤 소스(피드 URL · API 엔드포인트)를 호출하고 있는가? **표로 카탈로그화**.
  2. 각 소스의 (a) 바이브코딩/AI 트렌드 적합성, (b) 신뢰성·노이즈 비율, (c) 신선도, (d) 중복 위험을 1~5 등급으로 평가.
  3. 누락된 핵심 소스 추천(영문/한글 모두) — 예: AI 랩 공식 블로그(OpenAI/Anthropic/Google DeepMind/Mistral/Meta AI), 바이브코딩 커뮤니티(Hacker News Show, Lobsters, Indie Hackers, Reddit r/SideProject·r/LocalLLaMA·r/MachineLearning, Product Hunt RSS, GitHub Trending, devto AI 태그, GeekNews 등). 각 추천에 도입 근거·예상 노이즈·도입 우선순위를 함께 명시.
  4. 제거/교체 권장 소스 + 이유.
  5. 현재 시드의 한국어 매체 비중과 한국 사용자 만족 관점에서의 갭.
- 출력 형식 권장: 카탈로그 표 → 평가 표 → 추천 추가 표 → 제거/교체 표 → 도입 우선순위 로드맵 → 근거 인용 → 미해결 질문.

## Subtask B — 점수·랭킹 알고리즘 분석
- 산출물: `docs/audit/2026-04-22-scoring-ranking-audit.md`
- 검토 대상 파일:
  - `src/lib/pipeline/ranking_policy.ts`
  - `src/lib/pipeline/ranking_policy.test.ts`
  - `src/lib/pipeline/scoring.test.ts`
  - `src/lib/pipeline/dynamic_query.ts`
  - `src/lib/pipeline/manual_priority.ts`
  - `src/lib/pipeline/snapshot.ts`
  - `src/lib/pipeline/ranking_candidate_debug.ts`
  - `src/lib/pipeline/keyword_exclusions.ts` + `src/config/keyword-exclusions.json`
- 보고서가 답해야 할 질문
  1. 현재 점수 모델을 한 페이지로 요약 (가중치, 신선도 감쇠, 소스 가산점, 중복/클러스터링, 수동 priority 작용 방식).
  2. 약점 진단 — 신선도 편향, 인기도 편향, 중복 키워드, 영문 우세 편향, 노이즈 과적합 등 항목별 증거(file:line) 제시.
  3. 바이브코딩/AI 도메인에 맞는 부스팅 시그널 추가안:
     - GitHub stars 7일 증가율
     - 신규 도구 릴리스 시그널
     - SNS 언급 추세(X/Threads — Subtask C와 정합)
     - 한국어 매체 가중치 / 다국어 균형 정책
     - 키워드 클러스터링/표제어 정규화 강화 (예: "Claude 4.7" vs "Claude Opus 4.7")
  4. 개선된 점수 모델 의사코드 + 가중치 표.
  5. 회귀 검증용 테스트 시나리오 5개 (입력 후보 set → 기대 랭킹 결과).
- 출력 형식 권장: 현행 모델 요약 → 약점 진단 → 신호 추가 제안 → 신모델 의사코드 → 회귀 시나리오 → 근거 인용 → 미해결 질문.

## Subtask C — 키워드 콘텐츠 · SNS 통합 품질
- 산출물: `docs/audit/2026-04-22-content-sns-quality.md`
- 검토 대상 파일:
  - `src/app/api/v1/keywords/[id]/route.ts`
  - `src/app/api/v1/trends/hot/route.ts`
  - `src/app/api/v1/trends/top/route.ts`
  - `src/app/api/v1/search/route.ts`
  - `src/lib/pipeline/snapshot.ts`
  - `doc/api.md` (현행 응답 스펙)
- 보고서가 답해야 할 질문
  1. 현재 키워드 디테일 응답에 어떤 콘텐츠 카테고리(뉴스/YouTube/GitHub/데이터/기타)가 어떤 우선순위로 노출되는지 표로 정리. 누락 카테고리는?
  2. SNS 통합 전략 — **X(Twitter)** & **Threads(Meta)**:
     - 공식 API(가용성·비용·rate limit·정책 위험)
     - 검색 URL deeplink (예: `https://x.com/search?q=...`, `https://www.threads.net/search?q=...`) — 장단점, ToS 리스크
     - 서드파티(예: nitter 인스턴스, RSSHub) — 안정성·합법성
     - 임베드 위젯 vs 링크 노출 결정 기준
     - 트레이드오프 표 작성 후 권장 1순위/대안 제시.
  3. **키워드 1건당 골든 콘텐츠 5종** 큐레이션 알고리즘 명세:
     - (1) 대표 뉴스 1건
     - (2) 핵심 GitHub 리포 1건
     - (3) YouTube 데모/리뷰 1건
     - (4) X 대표 트윗(또는 검색링크) 1건
     - (5) Threads 대표 게시물(또는 검색링크) 1건
     - 각 슬롯의 선정 규칙(가중치, 최소 품질 임계, 다양성 제약, 폴백 규칙)을 정의.
  4. 카드 UI에 노출할 필드 스펙(제목/요약/발행일/소스 신뢰도 뱃지/언어 등) 권고.
  5. DB/API 변경 범위 추정 — 어떤 테이블/컬럼이 새로 필요하고, 어떤 응답 필드를 추가/변경해야 하는지 목록화.
- 출력 형식 권장: 현행 응답 매핑 → SNS 통합 비교 → 골든5 알고리즘 → 카드 스펙 → DB/API 변경 범위 → 근거 인용 → 미해결 질문.

---

## 협업 / 충돌 방지 원칙
- 각 워커는 정확히 1개 서브태스크만 claim. 산출물 파일이 다르므로 write 충돌 없음.
- 다른 워커가 작성하는 파일은 **읽지도 말 것**(작업 진행 중 상호 의존 금지). 필요하면 자기 보고서 안에서 "B 보고서에서 다룰 예정"으로 표시.
- 작업 시작 전, 산출물 파일을 빈 상태로 미리 `Write` 하여 자기 점유를 명확히 표시할 것.
- 모든 보고서 파일명/날짜는 **2026-04-22** 고정.

## 완료 기준
- 3개 보고서 파일이 모두 생성됨.
- 각 보고서 길이 가이드: 800~1500줄 사이(표/리스트 포함). 너무 짧으면 깊이 부족, 너무 길면 노이즈.
- 마지막에 **근거 인용** + **미해결 질문** 섹션이 있어야 완료로 인정.
