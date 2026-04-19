import type { PrimaryType } from "./source_category";

type SourceType = PrimaryType;

interface NaverSearchItem {
  title?: string;
  link?: string;
  originallink?: string;
  description?: string;
  pubDate?: string;
  postdate?: string;
}

interface NaverSearchResponse {
  items?: NaverSearchItem[];
}

interface NaverSource {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  imageUrl: string | null;
  publishedAt: string | null;
  type: SourceType;
  provider: "naver";
}

function parseBooleanEnv(
  value: string | undefined,
  fallback = true
): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return fallback;
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

const NAVER_SEARCH_ENABLED = parseBooleanEnv(
  process.env.NAVER_SEARCH_ENABLED,
  true
);
const NAVER_NEWS_RESULTS = parsePositiveIntEnv(
  process.env.NAVER_NEWS_RESULTS,
  2,
  0,
  10
);
const NAVER_BLOG_RESULTS = parsePositiveIntEnv(
  process.env.NAVER_BLOG_RESULTS,
  2,
  0,
  10
);
const NAVER_CAFE_RESULTS = parsePositiveIntEnv(
  process.env.NAVER_CAFE_RESULTS,
  2,
  0,
  10
);

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function stripNaverHtml(value: string | undefined): string {
  return (value ?? "")
    .replace(/<\/?b>/gi, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseNaverPublishedAt(item: NaverSearchItem): string | null {
  if (item.pubDate) {
    const date = new Date(item.pubDate);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  if (item.postdate && /^\d{8}$/.test(item.postdate)) {
    const year = Number.parseInt(item.postdate.slice(0, 4), 10);
    const month = Number.parseInt(item.postdate.slice(4, 6), 10) - 1;
    const day = Number.parseInt(item.postdate.slice(6, 8), 10);
    return new Date(Date.UTC(year, month, day)).toISOString();
  }

  return null;
}

function toSource(item: NaverSearchItem, type: SourceType): NaverSource | null {
  const url = item.originallink || item.link;
  if (!url) return null;

  const title = stripNaverHtml(item.title);
  if (!title) return null;

  return {
    title,
    url,
    domain: extractDomain(url),
    snippet: stripNaverHtml(item.description).slice(0, 220),
    imageUrl: null,
    publishedAt: parseNaverPublishedAt(item),
    type,
    provider: "naver",
  };
}

async function fetchNaverSearch(
  endpoint: "news" | "blog" | "cafearticle",
  keyword: string,
  type: SourceType,
  display: number
): Promise<NaverSource[]> {
  if (display <= 0) return [];

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!NAVER_SEARCH_ENABLED || !clientId || !clientSecret) return [];

  const url = new URL(`https://openapi.naver.com/v1/search/${endpoint}.json`);
  url.searchParams.set("query", keyword);
  url.searchParams.set("display", String(display));
  url.searchParams.set("start", "1");
  url.searchParams.set("sort", "date");

  try {
    const res = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
      },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as NaverSearchResponse;
    return (data.items ?? [])
      .map((item) => toSource(item, type))
      .filter((source): source is NaverSource => source != null);
  } catch {
    return [];
  }
}

export async function collectNaverSources(
  keyword: string
): Promise<Record<SourceType, NaverSource[]>> {
  const [news, blog, cafe] = await Promise.all([
    fetchNaverSearch("news", keyword, "news", NAVER_NEWS_RESULTS),
    fetchNaverSearch("blog", keyword, "social", NAVER_BLOG_RESULTS),
    fetchNaverSearch("cafearticle", keyword, "social", NAVER_CAFE_RESULTS),
  ]);

  return {
    news,
    social: [...blog, ...cafe],
    data: [],
  };
}
