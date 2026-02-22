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

// ─── Per-type queries (PRD §5.1) ─────────────────────────────────────────────

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

async function fetchVideo(
  client: ReturnType<typeof tavily>,
  keyword: string,
  maxResults = 5
): Promise<TavilySource[]> {
  try {
    const res = await client.search(
      `${keyword} site:youtube.com OR site:vimeo.com`,
      {
        searchDepth: "basic",
        maxResults,
        includeImages: false,
      }
    );
    return res.results.map((r) => ({
      title: r.title,
      url: r.url,
      domain: extractDomain(r.url),
      snippet: (r.content ?? "").slice(0, 220),
      imageUrl: null,
      publishedAt: r.publishedDate ?? null,
      type: "video" as SourceType,
    }));
  } catch {
    return [];
  }
}

async function fetchImages(
  client: ReturnType<typeof tavily>,
  keyword: string,
  maxResults = 5
): Promise<TavilySource[]> {
  try {
    const res = await client.search(keyword, {
      searchDepth: "basic",
      maxResults,
      includeImages: true,
    });

    const images = res.images ?? [];
    return images.slice(0, maxResults).map((img) => ({
      title: typeof img === "string" ? keyword : (img as { description?: string }).description ?? keyword,
      url: typeof img === "string" ? img : (img as { url: string }).url,
      domain: extractDomain(typeof img === "string" ? img : (img as { url: string }).url),
      snippet: "",
      imageUrl: typeof img === "string" ? img : (img as { url: string }).url,
      publishedAt: null,
      type: "image" as SourceType,
    }));
  } catch {
    return [];
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function collectSources(
  keyword: string
): Promise<Record<SourceType, TavilySource[]>> {
  const client = getClient();

  const [news, web, video, images] = await Promise.all([
    fetchNews(client, keyword),
    fetchWeb(client, keyword),
    fetchVideo(client, keyword),
    fetchImages(client, keyword),
  ]);

  return { news, web, video, image: images };
}
