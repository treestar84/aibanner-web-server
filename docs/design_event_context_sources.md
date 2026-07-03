# 설계: 실시간 키워드 이벤트 맥락 기반 소스 수집 (A~D)

목표: 실시간 키워드의 관련 콘텐츠(뉴스/커뮤니티/데이터)가 "그 키워드를 트렌드로 만든 사건"에 정확히 부합하도록 수집 파이프라인을 개선한다.

- A. 원본 기사(matchedItems)를 1급 소스로 승격
- B. 이벤트 맥락 기반 검색 쿼리 탈모호화 (LLM 1콜)
- C. timeRange를 키워드 신선도에 정합 + 최신성 가점
- D. 이벤트 기준 의미 관련성 게이트 (LLM 배치 1콜)

모든 LLM 호출은 기존 `audience_relevance.ts` 패턴을 따른다: `new OpenAI()`, `process.env.OPENAI_MODEL ?? "gpt-4o-mini"`, temperature 0, 실패 시 **fail-open** (기존 동작 유지), 순수 함수와 IO 래퍼 분리(순수 함수만 단위 테스트).

---

## 신규 파일 1: `src/lib/pipeline/event_context.ts`

```ts
export interface EventContextArticle {
  readonly title: string;
  readonly url: string;
  readonly domain: string;      // RssItem.sourceDomain
  readonly snippet: string;     // RssItem.summary.slice(0, 220)
  readonly publishedAt: string | null; // RssItem.publishedAt.toISOString()
  readonly tier: string;        // RssItem.tier
}

export interface EventContext {
  readonly keyword: string;
  readonly articles: readonly EventContextArticle[];
}
```

- `buildEventContext(keyword: NormalizedKeyword, items: readonly RssItem[]): EventContext` (순수)
  - `keyword.candidates.matchedItems` 인덱스로 `items` 조회, null 제외
  - tier 순 정렬 (P0_CURATED < P1_CONTEXT < P2_RAW < COMMUNITY < 기타) — `audience_relevance.ts`의 `tierOrder`와 동일 로직을 이 파일에 구현
  - URL 기준 중복 제거, 최대 **5개**
- `toOriginSources(context: EventContext): TavilySource[]` (순수)
  - 각 article → `TavilySource { title, url, domain, snippet, imageUrl: null, publishedAt, type: classifySourceCategory(...)로 결정, provider: "origin" }`
  - `classifySourceCategory`는 `source_category.ts`의 기존 함수 사용
- 단위 테스트: `event_context.test.ts` — tier 정렬, 최대 5개 제한, URL dedupe, matchedItems 인덱스 범위 밖 처리

## 신규 파일 2: `src/lib/pipeline/search_query_plan.ts`

```ts
export interface SearchQueryPlan {
  readonly disambiguationTerms: readonly string[]; // 최대 3개
  readonly eventSummary: string; // 사건 한 줄 요약 (영어)
}
```

- `parseSearchQueryPlan(content: string): SearchQueryPlan | null` (순수)
  - LLM 응답에서 `{...}` JSON 추출 (audience_relevance와 동일하게 `content.match(/\{[\s\S]*\}/)`)
  - 스키마: `{ "disambiguation_terms": string[], "event_summary": string }`
  - 검증: terms는 문자열만, 각 2~40자, 최대 3개로 절단, 키워드 자체와 동일(대소문자 무시)한 term 제거. event_summary는 문자열 아니면 "" 처리. terms가 비고 summary도 비면 null.
- `buildSearchQueryPlanViaLlm(keyword: string, articles: readonly EventContextArticle[]): Promise<SearchQueryPlan | null>` (IO 래퍼)
  - `articles.length === 0`이면 LLM 호출 없이 null
  - `ENABLE_QUERY_CONTEXTUALIZATION` env가 false면 null (기본 true, 파싱은 tavily.ts의 parseBooleanEnv 스타일 — summarize.ts에 있는 `parseBooleanEnv` 로직 복제 가능)
  - 시스템 프롬프트 요지:
    ```
    A keyword is trending RIGHT NOW because of a specific event described by the article titles below.
    1) Give up to 3 short disambiguation search terms that pin web search results to THIS event
       (company name, product name, version number, event verb). Do NOT repeat the keyword itself.
       Do NOT use site: or other search operators.
    2) Summarize the event in one English sentence.
    Output STRICT JSON: {"disambiguation_terms": ["..."], "event_summary": "..."}
    ```
  - 유저 메시지: `JSON.stringify({ keyword, titles: articles.slice(0,3).map(a => a.title) })`
  - try/catch로 실패 시 console.warn + null
- 단위 테스트: `search_query_plan.test.ts` — 정상 파싱, terms 절단/필터, 키워드 중복 term 제거, 잘못된 JSON → null

## 신규 파일 3: `src/lib/pipeline/event_relevance_gate.ts`

```ts
export interface EventRelevanceScoreMap { readonly [index: string]: number }
```

- `selectByEventRelevance<T>(candidates: readonly T[], scores: EventRelevanceScoreMap, minScore: number): T[]` (순수)
  - 인덱스 문자열 키("0","1",...)로 점수 조회. **점수 누락 후보는 통과**(fail-open), `score < minScore`만 탈락
- `filterByEventRelevance(keyword: string, eventSummary: string, candidates: TavilySource[]): Promise<TavilySource[]>` (IO 래퍼)
  - `ENABLE_EVENT_RELEVANCE_GATE` env false → 후보 그대로 반환 (기본 true)
  - `eventSummary`가 빈 문자열이거나 `candidates.length === 0` → 그대로 반환
  - 임계값: `EVENT_RELEVANCE_MIN` env (기본 5, 범위 1~10, tavily_client_pool의 `parsePositiveIntEnv` 사용)
  - LLM 배치 1콜. 시스템 프롬프트 요지:
    ```
    Keyword "<keyword>" is trending because of this event: <eventSummary>
    Score each candidate 0-10 for how directly it covers THIS SPECIFIC event
    (not merely the same words or the same product in a different context).
    Old news about the same product from a different event scores low (0-3).
    Output STRICT JSON mapping index → score, e.g. {"0": 8, "1": 2}. Include ALL indices.
    ```
  - 유저 메시지: `JSON.stringify(candidates.map((c, i) => ({ i, title: c.title.slice(0,120), snippet: (c.snippet??"").slice(0,200), domain: c.domain, publishedAt: c.publishedAt })))`
  - 탈락 소스는 `console.log("[sources] DROP(event_relevance=N): <domain> <title 앞 60자>")` 로그
  - try/catch 실패 시 console.warn + 후보 그대로 반환
- 단위 테스트: `event_relevance_gate.test.ts` — 임계 미달 탈락, 점수 누락 통과, 빈 후보 처리

## 수정 1: `src/lib/pipeline/tavily.ts`

1. `TavilySource.provider` 유니언 확장: `"tavily" | "naver" | "origin"`
2. `collectSources` 시그니처 변경:
   ```ts
   export async function collectSources(
     keyword: string,
     eventContext?: EventContext
   ): Promise<Record<SourceType, TavilySource[]>>
   ```
3. 내부 흐름 (기존 구조 최대한 유지):
   ```
   const exact = exactMatchKeyword(keyword);
   const plan = eventContext ? await buildSearchQueryPlanViaLlm(keyword, eventContext.articles) : null;
   const contextual = plan && plan.disambiguationTerms.length > 0
     ? `${exact} ${plan.disambiguationTerms.join(" ")}`
     : exact;

   // 쿼리: news/social/broad는 contextual 사용, data는 exact 유지 (논문/데이터셋은 이벤트 어휘와 어긋날 수 있음)
   const newsQuery   = `${contextual} (news OR blog OR analysis OR article OR interview)`;
   const socialQuery = `${contextual} (site:... 기존 그대로)`;
   const dataQuery   = `${exact} (site:youtube.com ... 기존 그대로)`;
   const broadQuery  = contextual;
   ```
4. **timeRange 변경 (C)**:
   - news: `day` → 부족 시 `week` 보충 (기존 유지)
   - social: `week` 로 1차 수집 → 결과가 `TAVILY_SOCIAL_RESULTS / 2` 미만이면 `month`로 재수집해 dedupe 병합 (news day→week 보충과 동일 패턴)
   - broad: `month` → `week`
   - data: `month` 유지
5. **원본 기사 병합 (A)**:
   ```
   const originSources = eventContext ? toOriginSources(eventContext) : [];
   const merged = dedupeByUrl([...naver..., ...seeds...]);            // 검색 결과만
   const relevant = filterRelevantSources(merged, keyword);           // 기존 어휘 필터 (origin 제외)
   const eventSummary = plan?.eventSummary
     ?? (eventContext ? eventContext.articles.map(a => a.title).slice(0,3).join(" / ") : "");
   const gated = await filterByEventRelevance(keyword, eventSummary, relevant);  // (D)
   gated.sort((a,b) => scoreSourcePriority(b, keyword) - scoreSourcePriority(a, keyword));
   const ordered = dedupeByUrl([...originSources, ...gated]);         // origin 최우선, 중복 제거
   // 이후 기존 bucket 채우기 로직 동일 (ordered 순회)
   ```
   - origin 소스는 어휘 필터·이벤트 게이트를 **거치지 않는다** (사건의 근거 그 자체이므로)

## 수정 2: `src/lib/pipeline/tavily_source_selection.ts`

- `scoreSourcePriority`에 추가 (C 최신성 가점):
  - `source.provider === "origin"` → `+2.0`
  - `source.publishedAt`이 현재 시각 기준 72시간 이내 → `+0.3` (파싱 실패/누락 시 가점 없음)

## 수정 3: `src/lib/pipeline/snapshot.ts`

- `processKeyword`의 신규 키워드 경로(collectSources 호출부):
  ```ts
  const eventContext = buildEventContext(kw, allSourceItems);
  const sourcesMap = await collectSources(kw.keyword, eventContext);
  ```
- 기존 `rssContext` 블록(690~697행 부근)은 `eventContext.articles`를 재사용해 대체:
  ```ts
  const rssContext = eventContext.articles.map(a => ({ title: a.title, snippet: a.snippet }));
  ```
  (`generateSummaries` 시그니처 불변)

## 불변 조건 / 주의

- `collectSources`는 `eventContext` 없이 호출돼도 기존과 동일하게 동작해야 한다 (search API fallback 등 다른 호출처 대비 — `grep -rn "collectSources" src` 로 모든 호출처 확인하고, 다른 호출처는 인자 추가 없이 그대로 둘 것).
- 모든 LLM 호출은 실패 시 기존 결과를 그대로 반환 (파이프라인 중단 금지).
- `snapshot.ts`의 SOURCE_PLANS 구조 분해 순서 관련 코드는 건드리지 않는다.
- 기존 테스트 전부 통과 + 신규 테스트 3개 파일 추가. 테스트 러너/스타일은 기존 `*.test.ts` 파일 관례를 따른다.
- 검증: `npx tsc --noEmit` (또는 프로젝트의 typecheck 스크립트) + 테스트 전체 실행.
