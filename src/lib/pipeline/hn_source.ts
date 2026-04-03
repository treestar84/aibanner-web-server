import type { RssItem } from "./rss";
import { buildDynamicQuery } from "./dynamic_query";

interface HnHit {
  objectID: string;
  title: string;
  url?: string;
  created_at_i: number;
  points?: number;
  num_comments?: number;
}

interface HnResponse {
  hits: HnHit[];
}

function mapHit(h: HnHit, tier: RssItem["tier"], feedTitle: string): RssItem {
  return {
    title: h.title,
    link: h.url!,
    publishedAt: new Date(h.created_at_i * 1000),
    summary: "",
    sourceDomain: new URL(h.url!).hostname.replace(/^www\./, ""),
    feedTitle,
    tier,
    lang: "en",
    engagement:
      h.points != null || h.num_comments != null
        ? { score: h.points ?? 0, comments: h.num_comments ?? 0 }
        : undefined,
  };
}

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
      .map((h) => mapHit(h, "P1_CONTEXT", "HackerNews FrontPage"));
  } catch (err) {
    console.warn("[hn_source] FrontPage failed:", (err as Error).message);
    return [];
  }
}

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

    const searchItems = data.hits
      .filter((h) => h.url && h.title)
      .map((h) => mapHit(h, "COMMUNITY", "HackerNews"));

    // URL 중복 제거 (front_page 우선 — tier가 높음)
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
