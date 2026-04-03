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
  keyword: string
): Promise<Record<SourceType, TavilySource[]>> {
  const client = getClient();
  const exact = exactMatchKeyword(keyword);

  const newsQuery = `${exact} (news OR blog OR analysis OR article OR interview)`;
  const socialQuery = `${exact} (site:threads.net OR site:reddit.com OR site:dev.to OR site:x.com OR site:twitter.com OR site:facebook.com OR site:instagram.com OR site:tiktok.com OR site:clien.net)`;
  const dataQuery = `${exact} (site:youtube.com OR site:youtu.be OR site:docs.google.com OR site:drive.google.com OR site:arxiv.org OR site:openreview.net OR filetype:pdf OR dataset OR research paper OR benchmark)`;

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
    fetchByQuery(client, exact, "news", {
      maxResults: TAVILY_BROAD_RESULTS,
      timeRange: "month",
    }),
  ]);

  const merged = dedupeByUrl([...newsSeed, ...socialSeed, ...dataSeed, ...broadSeed]);
  const relevant = filterRelevantSources(merged, keyword);

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

  for (const source of relevant) {
    const category = classifySourceCategory(source);
    if (buckets[category].length >= limits[category]) continue;
    buckets[category].push({
      ...source,
      type: category,
    });
  }

  return buckets;
}

/**
 * 수집된 소스 중 키워드와 실제 관련 없는 항목을 필터링합니다.
 * 제목+snippet에 키워드가 exact match로 포함되지 않는 경우,
 * 단어 재배열/부분 매칭으로 혼동된 결과일 가능성이 높습니다.
 */
function filterRelevantSources(
  sources: TavilySource[],
  keyword: string
): TavilySource[] {
  const kw = keyword.trim().toLowerCase();
  const kwWords = kw.split(/\s+/);

  // 단일 단어 키워드는 기존 로직으로 충분 (exact match 위험 없음)
  if (kwWords.length <= 1) return sources;

  return sources.filter((source) => {
    const text = `${source.title} ${source.snippet}`.toLowerCase();

    // 1) exact match: "mode ai"가 텍스트에 그대로 존재
    if (text.includes(kw)) return true;

    // 2) 인접 단어 매칭: 키워드 단어들이 가까이(5단어 이내) 위치
    const textWords = text.split(/\s+/);
    const firstWordIndexes: number[] = [];
    for (let i = 0; i < textWords.length; i++) {
      if (textWords[i].includes(kwWords[0])) firstWordIndexes.push(i);
    }
    for (const startIdx of firstWordIndexes) {
      const window = textWords.slice(startIdx, startIdx + kwWords.length + 3).join(" ");
      if (kwWords.every((w) => window.includes(w))) return true;
    }

    return false;
  });
}
