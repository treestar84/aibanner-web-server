import { tavily } from "@tavily/core";
import { classifySourceCategory, type PrimaryType } from "./source_category";

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
}

// ─── Client ───────────────────────────────────────────────────────────────────

function getClient() {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set");
  return tavily({ apiKey });
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function parsePositiveIntEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
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

async function fetchByQuery(
  client: ReturnType<typeof tavily>,
  query: string,
  typeHint: SourceType,
  options: { maxResults: number; timeRange: "week" | "month" }
): Promise<TavilySource[]> {
  try {
    const res = await client.search(query, {
      searchDepth: "basic",
      maxResults: options.maxResults,
      timeRange: options.timeRange,
      includeImages: false,
    });
    return res.results.map((r) => ({
      title: r.title,
      url: r.url,
      domain: extractDomain(r.url),
      snippet: (r.content ?? "").slice(0, 220),
      imageUrl: null,
      publishedAt: r.publishedDate ?? null,
      type: typeHint,
    }));
  } catch {
    return [];
  }
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

export async function collectSources(
  keyword: string
): Promise<Record<SourceType, TavilySource[]>> {
  const client = getClient();

  const newsQuery = `${keyword} (news OR blog OR analysis OR article OR interview)`;
  const socialQuery = `${keyword} (site:threads.net OR site:reddit.com OR site:dev.to OR site:x.com OR site:twitter.com OR site:facebook.com OR site:instagram.com OR site:tiktok.com OR site:clien.net)`;
  const dataQuery = `${keyword} (site:youtube.com OR site:youtu.be OR site:docs.google.com OR site:drive.google.com OR site:arxiv.org OR site:openreview.net OR filetype:pdf OR dataset OR research paper OR benchmark)`;

  const [newsSeed, socialSeed, dataSeed, broadSeed] = await Promise.all([
    fetchByQuery(client, newsQuery, "news", {
      maxResults: TAVILY_NEWS_RESULTS,
      timeRange: "week",
    }),
    fetchByQuery(client, socialQuery, "social", {
      maxResults: TAVILY_SOCIAL_RESULTS,
      timeRange: "month",
    }),
    fetchByQuery(client, dataQuery, "data", {
      maxResults: TAVILY_DATA_RESULTS,
      timeRange: "month",
    }),
    fetchByQuery(client, keyword, "news", {
      maxResults: TAVILY_BROAD_RESULTS,
      timeRange: "month",
    }),
  ]);

  const merged = dedupeByUrl([...newsSeed, ...socialSeed, ...dataSeed, ...broadSeed]);
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

  for (const source of merged) {
    const category = classifySourceCategory(source);
    if (buckets[category].length >= limits[category]) continue;
    buckets[category].push({
      ...source,
      type: category,
    });
  }

  return buckets;
}
