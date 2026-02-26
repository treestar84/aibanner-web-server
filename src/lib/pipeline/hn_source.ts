import type { RssItem } from "./rss";

const HN_QUERY =
  "AI OR LLM OR GPT OR Claude OR Gemini OR OpenAI OR Anthropic OR DeepSeek";

interface HnHit {
  objectID: string;
  title: string;
  url?: string;
  created_at_i: number;
}

interface HnResponse {
  hits: HnHit[];
}

export async function collectHnItems(windowHours = 72): Promise<RssItem[]> {
  try {
    const since = Math.floor(
      (Date.now() - windowHours * 60 * 60 * 1000) / 1000
    );
    const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(HN_QUERY)}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=100`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
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
        feedTitle: "HackerNews",
        tier: "COMMUNITY" as const,
        lang: "en",
      }));
  } catch (err) {
    console.warn("[hn_source] Failed:", (err as Error).message);
    return [];
  }
}
