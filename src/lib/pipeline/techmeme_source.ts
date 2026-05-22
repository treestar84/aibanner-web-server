import Parser from "rss-parser";
import { extractDomain, type RssItem } from "./rss";

const TECHMEME_FEED_URL = "https://www.techmeme.com/feed.xml";
const FETCH_TIMEOUT_MS = 8000;

const BIG_TECH_TERMS = [
  "google",
  "deepmind",
  "alphabet",
  "microsoft",
  "openai",
  "anthropic",
  "apple",
  "meta",
  "facebook",
  "instagram",
  "whatsapp",
  "amazon",
  "aws",
  "nvidia",
  "tesla",
  "xai",
  "x.ai",
  "bytedance",
  "tiktok",
];

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; AI-Trend-Widget/1.0)",
    Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
  },
});

function isBigTechItem(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase();
  return BIG_TECH_TERMS.some((term) => text.includes(term));
}

export const __private__ = {
  isBigTechItem,
};

export async function collectTechmemeItems(windowHours = 72): Promise<RssItem[]> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  try {
    const feed = await parser.parseURL(TECHMEME_FEED_URL);
    const items: RssItem[] = [];

    for (const item of feed.items) {
      const dateStr = item.pubDate ?? item.isoDate;
      const publishedAt = dateStr ? new Date(dateStr) : null;
      if (!publishedAt || isNaN(publishedAt.getTime()) || publishedAt <= cutoff) continue;
      if (!item.title || !item.link) continue;

      const title = item.title.trim();
      const summary = (item.contentSnippet ?? item.content ?? item.summary ?? "").slice(0, 500);
      if (!isBigTechItem(title, summary)) continue;

      items.push({
        title,
        link: item.link,
        publishedAt,
        summary,
        sourceDomain: extractDomain(item.link),
        feedTitle: "Techmeme Big Tech",
        tier: "P1_CONTEXT",
        lang: "en",
      });
    }

    console.log(`[techmeme] Big Tech: ${items.length} items`);
    return items;
  } catch (err) {
    console.warn(`[techmeme] Failed to fetch Techmeme: ${(err as Error).message}`);
    return [];
  }
}
