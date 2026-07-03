import type { NormalizedKeyword } from "./keywords";
import type { RssItem } from "./rss";
import { classifySourceCategory } from "./source_category";
import type { TavilySource } from "./tavily";

const MAX_EVENT_CONTEXT_ARTICLES = 5;

export interface EventContextArticle {
  readonly title: string;
  readonly url: string;
  readonly domain: string;
  readonly snippet: string;
  readonly publishedAt: string | null;
  readonly tier: string;
}

export interface EventContext {
  readonly keyword: string;
  readonly articles: readonly EventContextArticle[];
}

function tierOrder(tier: string): number {
  switch (tier) {
    case "P0_CURATED":
      return 0;
    case "P1_CONTEXT":
      return 1;
    case "P2_RAW":
      return 2;
    case "COMMUNITY":
      return 3;
    default:
      return 9;
  }
}

function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim().toLowerCase();
  }
}

export function buildEventContext(
  keyword: NormalizedKeyword,
  items: readonly RssItem[]
): EventContext {
  const matched = [...keyword.candidates.matchedItems]
    .map((index) => items[index])
    .filter((item): item is RssItem => item != null)
    .sort((a, b) => tierOrder(a.tier) - tierOrder(b.tier));

  const seen = new Set<string>();
  const articles: EventContextArticle[] = [];
  for (const item of matched) {
    const key = normalizeUrlKey(item.link);
    if (seen.has(key)) continue;
    seen.add(key);
    articles.push({
      title: item.title,
      url: item.link,
      domain: item.sourceDomain,
      snippet: (item.summary ?? "").slice(0, 220),
      publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
      tier: item.tier,
    });
    if (articles.length >= MAX_EVENT_CONTEXT_ARTICLES) break;
  }

  return { keyword: keyword.keyword, articles };
}

export function toOriginSources(context: EventContext): TavilySource[] {
  return context.articles.map((article) => {
    const base = {
      title: article.title,
      url: article.url,
      domain: article.domain,
      snippet: article.snippet,
      publishedAt: article.publishedAt,
    };
    return {
      ...base,
      imageUrl: null,
      type: classifySourceCategory(base),
      provider: "origin" as const,
    };
  });
}
