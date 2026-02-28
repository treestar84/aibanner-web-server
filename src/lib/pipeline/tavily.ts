import { tavily } from "@tavily/core";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SourceType = "news" | "web" | "video" | "image";

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
  5,
  1,
  10
);
const TAVILY_WEB_RESULTS = parsePositiveIntEnv(
  process.env.TAVILY_WEB_RESULTS,
  5,
  1,
  10
);

// ─── Queries (news + web only) ────────────────────────────────────────────────

async function fetchNews(
  client: ReturnType<typeof tavily>,
  keyword: string,
  maxResults = 5
): Promise<TavilySource[]> {
  try {
    const res = await client.search(`${keyword} news`, {
      searchDepth: "basic",
      maxResults,
      timeRange: "week",
      includeImages: false,
    });
    return res.results.map((r) => ({
      title: r.title,
      url: r.url,
      domain: extractDomain(r.url),
      snippet: (r.content ?? "").slice(0, 220),
      imageUrl: null,
      publishedAt: r.publishedDate ?? null,
      type: "news" as SourceType,
    }));
  } catch {
    return [];
  }
}

async function fetchWeb(
  client: ReturnType<typeof tavily>,
  keyword: string,
  maxResults = 5
): Promise<TavilySource[]> {
  try {
    const res = await client.search(keyword, {
      searchDepth: "basic",
      maxResults,
      timeRange: "month",
      includeImages: false,
    });
    return res.results.map((r) => ({
      title: r.title,
      url: r.url,
      domain: extractDomain(r.url),
      snippet: (r.content ?? "").slice(0, 220),
      imageUrl: null,
      publishedAt: r.publishedDate ?? null,
      type: "web" as SourceType,
    }));
  } catch {
    return [];
  }
}

// ─── Main export (news + web만 수집) ─────────────────────────────────────────

export async function collectSources(
  keyword: string
): Promise<Record<SourceType, TavilySource[]>> {
  const client = getClient();
  const [news, web] = await Promise.all([
    fetchNews(client, keyword, TAVILY_NEWS_RESULTS),
    fetchWeb(client, keyword, TAVILY_WEB_RESULTS),
  ]);
  return { news, web, video: [], image: [] };
}
