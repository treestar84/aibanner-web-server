import { classifySourceCategory, type PrimaryType } from "./source_category";
import { collectNaverSources } from "./naver_search";
import {
  fetchTavilySearch,
  parsePositiveIntEnv,
} from "./tavily_client_pool";
export {
  classifyTavilyFailure,
  resolveTavilyApiKeys,
} from "./tavily_client_pool";
import {
  filterRelevantSources,
  isKoreanPreferredSource,
  scoreSourcePriority,
} from "./tavily_source_selection";
export { isKoreanPreferredSource } from "./tavily_source_selection";
export { scoreSourcePriority } from "./tavily_source_selection";
import { toOriginSources, type EventContext } from "./event_context";
import { buildSearchQueryPlanViaLlm } from "./search_query_plan";
import { filterByEventRelevance } from "./event_relevance_gate";
import { SNIPPET_MAX_CHARS } from "./snippet_policy";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SourceType = PrimaryType;

export interface TavilySource {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  imageUrl: string | null;
  publishedAt: string | null;
  type: SourceType;
  provider?: "tavily" | "naver" | "origin";
}

// ─── Client / API key pool ───────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const TAVILY_NEWS_RESULTS = parsePositiveIntEnv(
  process.env.TAVILY_NEWS_RESULTS,
  6,
  1,
  12
);
const TAVILY_SOCIAL_RESULTS = parsePositiveIntEnv(
  process.env.TAVILY_SOCIAL_RESULTS,
  6,
  1,
  12
);
const TAVILY_DATA_RESULTS = parsePositiveIntEnv(
  process.env.TAVILY_DATA_RESULTS,
  6,
  1,
  12
);
const TAVILY_BROAD_RESULTS = parsePositiveIntEnv(
  process.env.TAVILY_BROAD_RESULTS,
  8,
  1,
  16
);
const TAVILY_MAX_KEY_ATTEMPTS = parsePositiveIntEnv(
  process.env.TAVILY_MAX_KEY_ATTEMPTS,
  2,
  1,
  10
);
const TAVILY_RATE_LIMIT_COOLDOWN_MINUTES = parsePositiveIntEnv(
  process.env.TAVILY_RATE_LIMIT_COOLDOWN_MINUTES,
  15,
  1,
  1440
);
const TAVILY_QUOTA_COOLDOWN_HOURS = parsePositiveIntEnv(
  process.env.TAVILY_QUOTA_COOLDOWN_HOURS,
  24,
  1,
  744
);

async function fetchByQuery(
  query: string,
  typeHint: SourceType,
  options: { maxResults: number; timeRange: "day" | "week" | "month" }
): Promise<TavilySource[]> {
  const results = await fetchTavilySearch(query, options, {
    maxKeyAttempts: TAVILY_MAX_KEY_ATTEMPTS,
    rateLimitMinutes: TAVILY_RATE_LIMIT_COOLDOWN_MINUTES,
    quotaHours: TAVILY_QUOTA_COOLDOWN_HOURS,
  });
  return results.map((result) => ({
    title: result.title,
    url: result.url,
    domain: extractDomain(result.url),
    snippet: (result.content ?? "").slice(0, SNIPPET_MAX_CHARS),
    imageUrl: null,
    publishedAt: result.publishedDate ?? null,
    type: typeHint,
    provider: "tavily",
  }));
}

function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
    ];
    for (const key of trackingParams) {
      parsed.searchParams.delete(key);
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim().toLowerCase();
  }
}

function dedupeByUrl(sources: TavilySource[]): TavilySource[] {
  const seen = new Set<string>();
  const deduped: TavilySource[] = [];
  for (const source of sources) {
    const key = normalizeUrlKey(source.url);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(source);
  }
  return deduped;
}

// ─── Main export (news/social/data 수집 + 재분류) ──────────────────────────────

/**
 * 키워드를 따옴표로 감싸 exact match를 강화합니다.
 * 이미 따옴표가 있거나 단일 단어인 경우 그대로 사용합니다.
 */
function exactMatchKeyword(keyword: string): string {
  const trimmed = keyword.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed;
  if (!trimmed.includes(" ")) return trimmed;
  return `"${trimmed}"`;
}

export async function collectSources(
  keyword: string,
  eventContext?: EventContext
): Promise<Record<SourceType, TavilySource[]>> {
  const exact = exactMatchKeyword(keyword);
  const plan = eventContext
    ? await buildSearchQueryPlanViaLlm(keyword, eventContext.articles)
    : null;
  const contextual =
    plan && plan.disambiguationTerms.length > 0
      ? `${exact} ${plan.disambiguationTerms.join(" ")}`
      : exact;

  const newsQuery = `${contextual} (news OR blog OR analysis OR article OR interview)`;
  const socialQuery = `${contextual} (site:threads.net OR site:reddit.com OR site:dev.to OR site:x.com OR site:twitter.com OR site:facebook.com OR site:clien.net)`;
  const dataQuery = `${exact} (site:youtube.com OR site:youtu.be OR site:docs.google.com OR site:drive.google.com OR site:arxiv.org OR site:openreview.net OR filetype:pdf OR dataset OR research paper OR benchmark)`;
  const broadQuery = contextual;

  // 뉴스는 최근 1일 우선 수집 후, 부족하면 week로 보충
  const [naverSources, newsDay, socialWeek, dataSeed, broadSeed] = await Promise.all([
    collectNaverSources(keyword),
    fetchByQuery(newsQuery, "news", {
      maxResults: TAVILY_NEWS_RESULTS,
      timeRange: "day",
    }),
    fetchByQuery(socialQuery, "social", {
      maxResults: TAVILY_SOCIAL_RESULTS,
      timeRange: "week",
    }),
    fetchByQuery(dataQuery, "data", {
      maxResults: TAVILY_DATA_RESULTS,
      timeRange: "month",
    }),
    fetchByQuery(broadQuery, "news", {
      maxResults: TAVILY_BROAD_RESULTS,
      timeRange: "week",
    }),
  ]);

  // day 결과가 부족하면 week로 보충
  let newsSeed = newsDay;
  if (newsDay.length < TAVILY_NEWS_RESULTS) {
    const newsWeek = await fetchByQuery(newsQuery, "news", {
      maxResults: TAVILY_NEWS_RESULTS,
      timeRange: "week",
    });
    newsSeed = dedupeByUrl([...newsDay, ...newsWeek]).slice(0, TAVILY_NEWS_RESULTS);
  }

  // week 결과가 부족하면 month로 보충
  let socialSeed = socialWeek;
  if (socialWeek.length < TAVILY_SOCIAL_RESULTS / 2) {
    const socialMonth = await fetchByQuery(socialQuery, "social", {
      maxResults: TAVILY_SOCIAL_RESULTS,
      timeRange: "month",
    });
    socialSeed = dedupeByUrl([...socialWeek, ...socialMonth]).slice(0, TAVILY_SOCIAL_RESULTS);
  }

  const merged = dedupeByUrl([
    ...naverSources.news,
    ...naverSources.social,
    ...naverSources.data,
    ...newsSeed,
    ...socialSeed,
    ...dataSeed,
    ...broadSeed,
  ]);
  const relevant = filterRelevantSources(merged, keyword);

  const originSources = eventContext ? toOriginSources(eventContext) : [];
  // plan이 있어도 event_summary가 비어 있으면 원본 기사 제목으로 폴백해 게이트가 항상 작동하게 한다.
  const eventSummary =
    plan?.eventSummary ||
    (eventContext ? eventContext.articles.map((article) => article.title).slice(0, 3).join(" / ") : "");
  const gated = await filterByEventRelevance(keyword, eventSummary, relevant);

  // 한국 자료가 있으면 먼저 노출하되, 없으면 기존 글로벌 결과를 유지합니다.
  gated.sort((a, b) => scoreSourcePriority(b, keyword) - scoreSourcePriority(a, keyword));

  // origin 소스(원본 기사)는 어휘 필터·이벤트 게이트를 거치지 않고 최우선으로 배치됩니다.
  const ordered = dedupeByUrl([...originSources, ...gated]);

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

  for (const source of ordered) {
    const category = classifySourceCategory(source);
    if (buckets[category].length >= limits[category]) continue;
    buckets[category].push({
      ...source,
      type: category,
    });
  }

  return buckets;
}
