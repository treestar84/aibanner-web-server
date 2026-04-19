# Pipeline Quality Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Archived planning artifact. Parts of this plan have since been implemented or superseded by the current realtime pipeline, including Naver-assisted Korean source enrichment and conservative source ranking.

**Goal:** 6가지 파이프라인 품질 개선 — 동적 검색 쿼리, HN front_page, Reddit velocity, 키워드 중복 병합 강화, RSS 원본 기반 요약, 소스 관련성 정렬

**Architecture:** 기존 파이프라인 구조를 유지하면서 각 소스 수집기와 후처리 로직을 개선. 새 파일 생성 없이 기존 파일 수정 위주.

**Tech Stack:** TypeScript, Next.js, Neon PostgreSQL, OpenAI API (gpt-4o-mini), Tavily API, Naver Search API, HN Algolia API, Reddit JSON API

---

## File Map

| 파일 | 변경 사항 |
|------|-----------|
| `src/lib/pipeline/hn_source.ts` | front_page 수집 추가 |
| `src/lib/pipeline/reddit_source.ts` | `/new.json` 추가 수집으로 velocity 감지 지원 |
| `src/lib/pipeline/snapshot.ts` | processKeyword에 RSS 원본 컨텍스트 전달, 동적 쿼리 빌더 호출 |
| `src/lib/pipeline/dynamic_query.ts` | **신규** — 이전 스냅샷 키워드 기반 동적 검색 쿼리 빌드 |
| `src/lib/pipeline/tavily.ts` | 소스 관련성 점수 계산 + 정렬 로직 추가 |
| `src/lib/pipeline/summarize.ts` | generateSummaries에 RSS 원본 컨텍스트 파라미터 추가 |
| `src/lib/pipeline/keywords.ts` | consolidateKeywordVariants 강화 (ASCII/하이픈 변형 병합) |
| `src/app/api/v1/keywords/[id]/route.ts` | 소스 정렬 (최신성 + 관련성) |

---

### Task 1: 동적 검색 쿼리 생성기

**Files:**
- Create: `src/lib/pipeline/dynamic_query.ts`
- Modify: `src/lib/pipeline/hn_source.ts:3-4`
- Modify: `src/lib/pipeline/gdelt_source.ts:3-4`
- Modify: `src/lib/pipeline/github_source.ts:3-4`
- Modify: `src/lib/pipeline/snapshot.ts:819-821`

**개요:** 이전 스냅샷의 Top 키워드를 기반으로 HN/GDELT/GitHub 검색 쿼리를 동적으로 구성. 고정 베이스 쿼리("AI OR LLM") + 최근 트렌딩 키워드를 합쳐 검색 범위를 확장한다.

- [ ] **Step 1: dynamic_query.ts 생성**

```typescript
// src/lib/pipeline/dynamic_query.ts
import { getTopKeywords, getLatestSnapshotWithKeywords } from "../db/queries";

const BASE_TERMS = [
  "AI", "LLM", "GPT", "Claude", "Gemini",
  "OpenAI", "Anthropic", "DeepSeek",
];

/**
 * 이전 스냅샷의 Top 10 키워드에서 검색어로 쓸 만한 항목을 추출하여
 * 베이스 쿼리와 합친다. 최대 15개 term으로 제한.
 */
export async function buildDynamicQuery(): Promise<string> {
  try {
    const latest = await getLatestSnapshotWithKeywords();
    if (!latest) return BASE_TERMS.join(" OR ");

    const topKeywords = await getTopKeywords(latest.snapshot_id, 10);
    const dynamicTerms: string[] = [];

    for (const kw of topKeywords) {
      const term = (kw.keyword_en || kw.keyword).trim();
      // 이미 베이스에 있거나, 너무 짧거나, 너무 긴 것은 제외
      if (term.length < 3 || term.length > 30) continue;
      if (BASE_TERMS.some((b) => b.toLowerCase() === term.toLowerCase())) continue;
      // 공백 포함 키워드는 따옴표로 감싸기
      dynamicTerms.push(term.includes(" ") ? `"${term}"` : term);
    }

    const allTerms = [...BASE_TERMS, ...dynamicTerms].slice(0, 15);
    return allTerms.join(" OR ");
  } catch (err) {
    console.warn("[dynamic_query] Failed, using base query:", (err as Error).message);
    return BASE_TERMS.join(" OR ");
  }
}
```

- [ ] **Step 2: hn_source.ts에 동적 쿼리 적용**

기존:
```typescript
const HN_QUERY =
  "AI OR LLM OR GPT OR Claude OR Gemini OR OpenAI OR Anthropic OR DeepSeek";
```

변경:
```typescript
import { buildDynamicQuery } from "./dynamic_query";

export async function collectHnItems(windowHours = 72): Promise<RssItem[]> {
  try {
    const query = await buildDynamicQuery();
    const since = Math.floor(
      (Date.now() - windowHours * 60 * 60 * 1000) / 1000
    );
    const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=100`;
    // ... 나머지 동일
```

- [ ] **Step 3: gdelt_source.ts에 동적 쿼리 적용**

기존:
```typescript
const GDELT_QUERY =
  '"AI" OR "LLM" OR "large language model" OR "GPT" OR "Claude" OR "Gemini" OR "OpenAI" OR "Anthropic" OR "DeepMind" OR "NVIDIA"';
```

변경:
```typescript
import { buildDynamicQuery } from "./dynamic_query";

export async function collectGdeltItems(windowHours = 72): Promise<RssItem[]> {
  try {
    const dynamicQuery = await buildDynamicQuery();
    // GDELT는 따옴표 스타일이 다름 — 각 term을 따옴표로 감싸기
    const gdeltQuery = dynamicQuery
      .split(" OR ")
      .map((term) => {
        const clean = term.replace(/^"|"$/g, "").trim();
        return `"${clean}"`;
      })
      .join(" OR ");

    const until = new Date();
    const since = new Date(until.getTime() - windowHours * 60 * 60 * 1000);
    const params = new URLSearchParams({
      query: gdeltQuery,
      // ... 나머지 동일
```

- [ ] **Step 4: github_source.ts에 동적 쿼리 적용**

기존:
```typescript
const GITHUB_QUERY =
  "llm OR gpt OR agent OR rag OR openai OR anthropic OR gemini OR claude";
```

변경:
```typescript
import { buildDynamicQuery } from "./dynamic_query";

export async function collectGithubItems(windowHours = 72): Promise<RssItem[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log("[github_source] No GITHUB_TOKEN, skipping");
    return [];
  }

  try {
    const dynamicQuery = await buildDynamicQuery();
    // GitHub search는 소문자 + space로 구분
    const githubQuery = dynamicQuery
      .split(" OR ")
      .map((t) => t.replace(/^"|"$/g, "").trim().toLowerCase())
      .join(" OR ");

    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const sinceDate = since.toISOString().slice(0, 10);
    const params = new URLSearchParams({
      q: `${githubQuery} pushed:>=${sinceDate}`,
      // ... 나머지 동일
```

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add src/lib/pipeline/dynamic_query.ts src/lib/pipeline/hn_source.ts src/lib/pipeline/gdelt_source.ts src/lib/pipeline/github_source.ts
git commit -m "feat: dynamic search queries from previous snapshot keywords"
```

---

### Task 2: HN front_page 수집 추가

**Files:**
- Modify: `src/lib/pipeline/hn_source.ts`

**개요:** 기존 검색 API에 더해 HN front_page(인기 스토리)도 수집. front_page 항목은 AI 관련 여부와 무관하게 가져온 뒤, 키워드 추출 단계에서 AI 관련 키워드만 자연스럽게 필터링된다. front_page 항목은 높은 engagement를 가지므로 velocity/engagement 점수에 기여.

- [ ] **Step 1: front_page 수집 함수 추가**

`collectHnItems` 함수 아래에 추가:

```typescript
async function fetchHnFrontPage(): Promise<RssItem[]> {
  try {
    const res = await fetch(
      "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30",
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data: HnResponse = await res.json();

    return data.hits
      .filter((h) => h.url && h.title)
      .map((h) => ({
        title: h.title,
        link: h.url!,
        publishedAt: new Date(h.created_at_i * 1000),
        summary: "",
        sourceDomain: new URL(h.url!).hostname.replace(/^www\./, ""),
        feedTitle: "HackerNews FrontPage",
        tier: "P1_CONTEXT" as const,  // front_page는 authority 높음
        lang: "en",
        engagement:
          h.points != null || h.num_comments != null
            ? { score: h.points ?? 0, comments: h.num_comments ?? 0 }
            : undefined,
      }));
  } catch (err) {
    console.warn("[hn_source] FrontPage failed:", (err as Error).message);
    return [];
  }
}
```

- [ ] **Step 2: collectHnItems에서 front_page 병합**

`collectHnItems` 반환 직전에 front_page 결과를 병합:

```typescript
export async function collectHnItems(windowHours = 72): Promise<RssItem[]> {
  try {
    const query = await buildDynamicQuery();
    const since = Math.floor(
      (Date.now() - windowHours * 60 * 60 * 1000) / 1000
    );
    const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=100`;

    const [searchRes, frontPageItems] = await Promise.all([
      fetch(url, { signal: AbortSignal.timeout(10000) }),
      fetchHnFrontPage(),
    ]);

    if (!searchRes.ok) throw new Error(`HTTP ${searchRes.status}`);
    const data: HnResponse = await searchRes.json();

    const searchItems: RssItem[] = data.hits
      .filter((h) => h.url && h.title)
      .map((h) => ({
        title: h.title,
        link: h.url!,
        publishedAt: new Date(h.created_at_i * 1000),
        summary: "",
        sourceDomain: new URL(h.url!).hostname.replace(/^www\./, ""),
        feedTitle: "HackerNews",
        tier: "COMMUNITY" as const,
        lang: "en",
        engagement:
          h.points != null || h.num_comments != null
            ? { score: h.points ?? 0, comments: h.num_comments ?? 0 }
            : undefined,
      }));

    // URL 기반 중복 제거 (front_page 우선 — tier가 더 높음)
    const seen = new Set<string>();
    const merged: RssItem[] = [];
    for (const item of [...frontPageItems, ...searchItems]) {
      if (seen.has(item.link)) continue;
      seen.add(item.link);
      merged.push(item);
    }

    return merged;
  } catch (err) {
    console.warn("[hn_source] Failed:", (err as Error).message);
    return [];
  }
}
```

- [ ] **Step 3: 타입 체크 및 커밋**

Run: `npx tsc --noEmit`

```bash
git add src/lib/pipeline/hn_source.ts
git commit -m "feat: add HN front_page collection for higher authority AI stories"
```

---

### Task 3: Reddit velocity 감지를 위한 `/new.json` 추가 수집

**Files:**
- Modify: `src/lib/pipeline/reddit_source.ts`

**개요:** 현재 `hot.json`만 수집하여 이미 인기 있는 포스트만 잡음. `/new.json`을 추가로 수집하면 최근 올라온 포스트의 early engagement를 잡을 수 있어 velocity 점수에 기여. `/rising.json`도 추가하여 급상승 감지를 강화한다.

- [ ] **Step 1: fetchSubreddit에 endpoint 파라미터 추가**

```typescript
type RedditEndpoint = "hot" | "new" | "rising";

async function fetchSubreddit(
  subreddit: string,
  cutoff: Date,
  endpoint: RedditEndpoint = "hot"
): Promise<RssItem[]> {
  try {
    const limit = endpoint === "new" ? 15 : 30;
    const res = await fetch(
      `https://www.reddit.com/r/${subreddit}/${endpoint}.json?limit=${limit}`,
      {
        headers: { "User-Agent": "AI-Trend-Widget/1.0" },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data: RedditListing = await res.json();

    return data.data.children
      .filter((post) => {
        const created = new Date(post.data.created_utc * 1000);
        return created > cutoff && post.data.title;
      })
      .map((post) => ({
        title: post.data.title,
        link: `https://www.reddit.com${post.data.permalink}`,
        publishedAt: new Date(post.data.created_utc * 1000),
        summary: (post.data.selftext ?? "").slice(0, 500),
        sourceDomain: "reddit.com",
        feedTitle: `r/${subreddit}`,
        tier: "COMMUNITY" as const,
        lang: "en",
        engagement: {
          score: post.data.score,
          comments: post.data.num_comments,
        },
      }));
  } catch (err) {
    console.warn(
      `[reddit_source] r/${subreddit}/${endpoint} failed:`,
      (err as Error).message
    );
    return [];
  }
}
```

- [ ] **Step 2: collectRedditItems에서 hot + rising 병합**

```typescript
export async function collectRedditItems(
  windowHours = 72
): Promise<RssItem[]> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const all: RssItem[] = [];
  const seen = new Set<string>();

  for (const sub of SUBREDDITS) {
    // hot + rising 병렬 수집
    const [hotItems, risingItems] = await Promise.all([
      fetchSubreddit(sub, cutoff, "hot"),
      fetchSubreddit(sub, cutoff, "rising"),
    ]);

    // URL 중복 제거 (hot 우선)
    for (const item of [...hotItems, ...risingItems]) {
      if (seen.has(item.link)) continue;
      seen.add(item.link);
      all.push(item);
    }

    console.log(
      `[reddit_source] r/${sub}: ${hotItems.length} hot, ${risingItems.length} rising`
    );

    // Reddit rate limit: 1초 간격
    if (sub !== SUBREDDITS[SUBREDDITS.length - 1]) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return all;
}
```

- [ ] **Step 3: 타입 체크 및 커밋**

Run: `npx tsc --noEmit`

```bash
git add src/lib/pipeline/reddit_source.ts
git commit -m "feat: add Reddit rising endpoint for velocity detection"
```

---

### Task 4: 키워드 중복 병합 강화 (ASCII/하이픈/대소문자 변형)

**Files:**
- Modify: `src/lib/pipeline/keywords.ts` — `consolidateKeywordVariants` 함수

**개요:** 현재 `consolidateKeywordVariants`는 trailing action words 제거 기반 매칭만 수행. "Claude Code", "claude-code", "ClaudeCode" 같은 변형을 잡지 못함. 정규화된 slug 비교를 추가한다.

- [ ] **Step 1: consolidateKeywordVariants에 slug 기반 병합 추가**

`consolidateKeywordVariants` 함수 내, 기존 `getCore` 함수 아래에 slug 정규화 함수를 추가:

```typescript
function consolidateKeywordVariants(
  keywords: LLMKeyword[],
  candidateMap: Map<string, KeywordCandidate>
): { keywords: LLMKeyword[]; candidateMap: Map<string, KeywordCandidate> } {
  if (keywords.length <= 1) return { keywords, candidateMap };

  // 기존 getCore 로직 유지
  function getCore(kw: string): string {
    const words = normalizeKeywordSurface(kw).split(/\s+/).filter(Boolean);
    if (words.length >= 2 && TRAILING_ACTION_WORDS.has(words[words.length - 1])) {
      return words.slice(0, -1).join(" ");
    }
    return words.join(" ");
  }

  // 추가: slug 정규화 — 하이픈/언더스코어/대소문자/CamelCase 변형 통합
  function getSlug(kw: string): string {
    return kw
      .replace(/([a-z])([A-Z])/g, "$1 $2")  // CamelCase 분리
      .replace(/[-_./]/g, " ")                // 구분자 → 공백
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  // 두 가지 키로 그룹핑: core(기존) + slug(신규)
  const groups = new Map<string, number[]>();  // groupKey → keyword indices

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i].keyword;
    const coreKey = getCore(kw);
    const slugKey = getSlug(kw);

    // 두 키 중 하나라도 이미 그룹에 있으면 합류
    let targetGroup: string | null = null;
    for (const [groupKey, members] of groups) {
      const existingKw = keywords[members[0]].keyword;
      if (getCore(existingKw) === coreKey || getSlug(existingKw) === slugKey) {
        targetGroup = groupKey;
        break;
      }
    }

    if (targetGroup) {
      groups.get(targetGroup)!.push(i);
    } else {
      groups.set(slugKey, [i]);
    }
  }

  // 각 그룹에서 가장 많은 매칭 아이템을 가진 키워드를 대표로 선택
  const mergedKeywords: LLMKeyword[] = [];
  const mergedCandidateMap = new Map<string, KeywordCandidate>();

  for (const members of groups.values()) {
    // 대표 선택: 매칭 아이템이 가장 많은 것, 동률이면 더 짧은 이름
    let bestIdx = members[0];
    let bestCount = 0;
    for (const idx of members) {
      const kw = keywords[idx];
      const candidate = candidateMap.get(kw.keyword.toLowerCase());
      const count = candidate?.matchedItems.size ?? 0;
      if (count > bestCount || (count === bestCount && kw.keyword.length < keywords[bestIdx].keyword.length)) {
        bestIdx = idx;
        bestCount = count;
      }
    }

    const representative = keywords[bestIdx];

    // 다른 멤버의 aliases와 matchedItems를 대표에 병합
    const allAliases = new Set(representative.aliases);
    let mergedCandidate = candidateMap.get(representative.keyword.toLowerCase());
    if (!mergedCandidate) {
      mergedKeywords.push(representative);
      continue;
    }
    mergedCandidate = cloneCandidate(mergedCandidate);

    for (const idx of members) {
      if (idx === bestIdx) continue;
      const other = keywords[idx];
      allAliases.add(other.keyword);
      for (const alias of other.aliases) allAliases.add(alias);

      const otherCandidate = candidateMap.get(other.keyword.toLowerCase());
      if (otherCandidate) {
        for (const item of otherCandidate.matchedItems) {
          mergedCandidate.matchedItems.add(item);
        }
        for (const domain of otherCandidate.domains) {
          mergedCandidate.domains.add(domain);
        }
        if (otherCandidate.latestAt > mergedCandidate.latestAt) {
          mergedCandidate.latestAt = otherCandidate.latestAt;
        }
      }
    }

    mergedCandidate.count = mergedCandidate.matchedItems.size;
    allAliases.delete(representative.keyword);

    mergedKeywords.push({
      ...representative,
      aliases: [...allAliases],
    });
    mergedCandidateMap.set(representative.keyword.toLowerCase(), mergedCandidate);
  }

  // 병합되지 않은 candidate도 유지
  for (const [key, candidate] of candidateMap) {
    if (!mergedCandidateMap.has(key)) {
      mergedCandidateMap.set(key, candidate);
    }
  }

  return { keywords: mergedKeywords, candidateMap: mergedCandidateMap };
}
```

**참고:** 기존 `consolidateKeywordVariants`를 위 코드로 완전 교체. `cloneCandidate` 함수는 이미 keywords.ts에 존재한다 (line ~308).

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/lib/pipeline/keywords.ts
git commit -m "fix: strengthen keyword dedup with slug normalization (CamelCase, hyphens)"
```

---

### Task 5: RSS 원본 기사 컨텍스트를 요약에 포함

**Files:**
- Modify: `src/lib/pipeline/snapshot.ts:522-530, 668-671, 997-1013`
- Modify: `src/lib/pipeline/summarize.ts:128-175`

**개요:** 현재 요약은 Tavily 재검색 결과만 사용. 키워드에 매칭된 RSS 원본 기사(title+summary)를 요약 컨텍스트에 포함시켜 원본 맥락을 보존한다.

- [ ] **Step 1: processKeyword에 allItems 파라미터 추가**

`snapshot.ts`의 `processKeyword` 함수 시그니처 변경:

```typescript
async function processKeyword(
  item: RankedKeywordWithDelta,
  snapshotId: string,
  recentSnapshotIds: string[],
  defaultImage: string,
  allowExternalEnrichmentForNewKeywords: boolean,
  forceExternalEnrichmentForKeyword: boolean,
  allSourceItems: RssItem[]   // 추가
): Promise<{ reused: boolean }> {
```

- [ ] **Step 2: processKeyword 호출부에서 allItems 전달**

`snapshot.ts` ~line 1004의 `processKeyword` 호출을 수정:

```typescript
  const kwResults = await mapWithConcurrency(
    detailedRanked,
    KEYWORD_CONCURRENCY,
    (item) => {
      const forceExternalEnrichmentForKeyword = keywordLookupKeys(item).some(
        (key) => activeManualKeywordKeySet.has(key)
      );
      return processKeyword(
        item,
        snapshotId,
        recentSnapshotIds,
        DEFAULT_IMAGE,
        profile.allowExternalEnrichmentForNewKeywords,
        forceExternalEnrichmentForKeyword,
        allItems   // 추가
      );
    }
  );
```

- [ ] **Step 3: processKeyword 내에서 RSS 컨텍스트 추출 및 요약에 전달**

`processKeyword` 함수 내, `generateSummaries` 호출 부분 수정:

```typescript
  // RSS 원본 기사에서 컨텍스트 추출 (matchedItems 인덱스 활용)
  const rssContext: Array<{ title: string; snippet: string }> = [];
  for (const idx of kw.candidates.matchedItems) {
    const rssItem = allSourceItems[idx];
    if (!rssItem) continue;
    if (rssItem.title && (rssItem.summary || rssItem.title)) {
      rssContext.push({
        title: rssItem.title,
        snippet: rssItem.summary || "",
      });
    }
    if (rssContext.length >= 5) break;
  }

  const summaries = await generateSummaries(
    kw.keyword,
    sourcesMap.news.length > 0 ? sourcesMap.news : allSources.slice(0, 5),
    rssContext   // 추가
  );
```

- [ ] **Step 4: generateSummaries에 rssContext 파라미터 추가**

`summarize.ts`의 `generateSummaries` 함수 수정:

```typescript
export async function generateSummaries(
  keyword: string,
  sources: TavilySource[],
  rssContext: Array<{ title: string; snippet: string }> = []
): Promise<SummariesResult> {
  const client = new OpenAI();

  const tavilyContextLines = sources
    .slice(0, SUMMARY_CONTEXT_LIMIT)
    .map((s) => `- ${s.title}: ${s.snippet}`);

  const rssContextLines = rssContext
    .slice(0, 3)
    .map((r) => `- [RSS] ${r.title}${r.snippet ? `: ${r.snippet.slice(0, 150)}` : ""}`);

  const context = [...rssContextLines, ...tavilyContextLines]
    .slice(0, SUMMARY_CONTEXT_LIMIT + 3)
    .join("\n");

  const userMessage = `Keyword: "${keyword}"\n\nRelated news:\n${context}`;
  // ... 나머지 동일
```

- [ ] **Step 5: 타입 체크 및 커밋**

Run: `npx tsc --noEmit`

```bash
git add src/lib/pipeline/snapshot.ts src/lib/pipeline/summarize.ts
git commit -m "feat: include RSS original articles in summary context"
```

---

### Task 6: 소스 관련성 기반 정렬

**Files:**
- Modify: `src/lib/pipeline/tavily.ts` — `collectSources` 결과 정렬
- Modify: `src/app/api/v1/keywords/[id]/route.ts` — API 응답 정렬

**개요:** 두 단계 정렬을 적용한다:
1. **수집 시** (tavily.ts): 소스를 관련성 점수로 정렬하여 저장
2. **API 응답 시** (route.ts): 최신성 기반으로 정렬 (publishedAt 내림차순)

- [ ] **Step 1: tavily.ts에 관련성 기반 정렬 추가**

`collectSources` 함수의 `filterRelevantSources` 호출 후, 버켓에 넣기 전에 정렬:

```typescript
  const merged = dedupeByUrl([...newsSeed, ...socialSeed, ...dataSeed, ...broadSeed]);
  const relevant = filterRelevantSources(merged, keyword);

  // 관련성 점수로 정렬: exact match > proximity match, 최신순 보조
  const scored = relevant.map((source) => ({
    source,
    relevance: scoreSourceRelevance(source, keyword),
  }));
  scored.sort((a, b) => b.relevance - a.relevance);

  const limits: Record<SourceType, number> = {
    news: TAVILY_NEWS_RESULTS,
    social: TAVILY_SOCIAL_RESULTS,
    data: TAVILY_DATA_RESULTS,
  };
  const buckets: Record<SourceType, TavilySource[]> = {
    news: [],
    social: [],
    data: [],
  };

  for (const { source } of scored) {
    const category = classifySourceCategory(source);
    if (buckets[category].length >= limits[category]) continue;
    buckets[category].push({
      ...source,
      type: category,
    });
  }

  return buckets;
```

- [ ] **Step 2: scoreSourceRelevance 함수 추가**

`filterRelevantSources` 함수 아래에 추가:

```typescript
/**
 * 소스의 관련성 점수를 계산한다 (0~1).
 * - exact match (키워드가 제목에 그대로 포함): 1.0
 * - title match (키워드가 제목에 부분 포함): 0.7
 * - snippet only match: 0.4
 * - 최신성 보너스: 24시간 이내 +0.1
 */
function scoreSourceRelevance(source: TavilySource, keyword: string): number {
  const kw = keyword.trim().toLowerCase();
  const title = source.title.toLowerCase();
  const snippet = (source.snippet ?? "").toLowerCase();

  let score = 0;

  // 제목에 exact match
  if (title.includes(kw)) {
    score = 1.0;
  } else if (snippet.includes(kw)) {
    score = 0.4;
  } else {
    // 단어별 부분 매칭
    const kwWords = kw.split(/\s+/);
    const titleWords = title.split(/\s+/);
    const matchedWords = kwWords.filter((w) =>
      titleWords.some((tw) => tw.includes(w))
    );
    score = (matchedWords.length / kwWords.length) * 0.7;
  }

  // 최신성 보너스
  if (source.publishedAt) {
    const ageHours =
      (Date.now() - new Date(source.publishedAt).getTime()) / (1000 * 60 * 60);
    if (ageHours < 24) score += 0.1;
  }

  return Math.min(1, score);
}
```

- [ ] **Step 3: API route에서 소스 최신순 정렬**

`src/app/api/v1/keywords/[id]/route.ts`의 `grouped` 구성 부분을 수정:

```typescript
    const grouped = SOURCE_TYPES.map((type) => ({
      type,
      items: categorized[type]
        .sort((a, b) => {
          // 최신순 정렬 (publishedAt 내림차순), null은 뒤로
          const dateA = a.published_at_utc ? new Date(a.published_at_utc).getTime() : 0;
          const dateB = b.published_at_utc ? new Date(b.published_at_utc).getTime() : 0;
          return dateB - dateA;
        })
        .map((s) => ({
          title: lang === "en"
            ? (s.title_en || s.title)
            : (s.title_ko || s.title),
          url: s.url,
          source: s.domain,
          publishedAt: s.published_at_utc,
          snippet: s.snippet ?? "",
          imageUrl: s.image_url,
        })),
    })).filter((g) => g.items.length > 0);
```

- [ ] **Step 4: 타입 체크 및 커밋**

Run: `npx tsc --noEmit`

```bash
git add src/lib/pipeline/tavily.ts src/app/api/v1/keywords/\[id\]/route.ts
git commit -m "feat: sort sources by relevance (collection) and recency (API)"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** 6개 요구사항 모두 Task 1~6에 매핑됨
- [x] **Placeholder scan:** 모든 step에 실제 코드 포함, TBD/TODO 없음
- [x] **Type consistency:** `buildDynamicQuery`, `RssItem`, `TavilySource`, `SummariesResult` — 기존 타입과 일치
- [x] **Task 독립성:** Task 1~4는 완전 독립. Task 5는 snapshot.ts+summarize.ts 동시 수정 필요. Task 6은 독립.
