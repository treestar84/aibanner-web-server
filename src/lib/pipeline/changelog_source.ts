import Parser from "rss-parser";
import { extractDomain, type RssItem } from "./rss";

interface ChangelogConfig {
  url: string;
  title: string;
  tier: RssItem["tier"];
  lang: "ko" | "en";
}

const FETCH_TIMEOUT_MS = 8000;

const rssParser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { "User-Agent": "Mozilla/5.0 (compatible; AI-Trend-Widget/1.0)" },
});

const CHANGELOG_SOURCES: ChangelogConfig[] = [
  { url: "https://openai.com/news/rss.xml", title: "OpenAI News", tier: "P0_CURATED", lang: "en" },
  // openrouter.ai/announcements/rss는 200을 주지만 본문이 SPA HTML이라 rss-parser가 실패 — 제외.
  { url: "https://www.warp.dev/blog/rss.xml", title: "Warp Blog", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://blog.google/technology/ai/rss/", title: "Google AI Blog", tier: "P1_CONTEXT", lang: "en" },
];

async function fetchRssChangelog(
  config: ChangelogConfig,
  cutoff: Date
): Promise<RssItem[]> {
  try {
    const feed = await rssParser.parseURL(config.url);
    const items: RssItem[] = [];
    for (const item of feed.items) {
      const dateStr = item.pubDate ?? item.isoDate;
      const pubDate = dateStr ? new Date(dateStr) : null;
      if (!pubDate || isNaN(pubDate.getTime()) || pubDate <= cutoff) continue;
      if (!item.title || !item.link) continue;
      items.push({
        title: item.title.trim(),
        link: item.link,
        publishedAt: pubDate,
        summary: (item.contentSnippet ?? item.content ?? item.summary ?? "").slice(0, 500),
        sourceDomain: extractDomain(item.link ?? config.url),
        feedTitle: config.title,
        tier: config.tier,
        lang: config.lang,
      });
    }
    return items;
  } catch (err) {
    console.warn(`[changelog] ${config.title}: ${(err as Error).message}`);
    return [];
  }
}

export async function collectChangelogItems(windowHours = 72): Promise<RssItem[]> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const results = await Promise.allSettled(
    CHANGELOG_SOURCES.map((src) => fetchRssChangelog(src, cutoff))
  );

  const all: RssItem[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      console.log(`[changelog] ${CHANGELOG_SOURCES[i].title}: ${r.value.length} items`);
      all.push(...r.value);
    }
  }

  const seen = new Set<string>();
  return all.filter((item) => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
}
