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
    fetchNews(client, keyword),
    fetchWeb(client, keyword),
  ]);
  return { news, web, video: [], image: [] };
}
