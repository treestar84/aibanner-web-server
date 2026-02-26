import { load } from "cheerio";
import type { RssItem } from "./rss";

// ─── Changelog page definitions ─────────────────────────────────────────────

interface ChangelogConfig {
  url: string;
  title: string;
  tier: RssItem["tier"];
  lang: "ko" | "en";
  parser: (html: string, cutoff: Date, config: ChangelogConfig) => RssItem[];
}

const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = "Mozilla/5.0 (compatible; AI-Trend-Widget/1.0)";

// ─── Per-source parsers ─────────────────────────────────────────────────────

function parseOpenAIChangelog(html: string, cutoff: Date, config: ChangelogConfig): RssItem[] {
  const $ = load(html);
  const items: RssItem[] = [];

  // OpenAI changelog uses article/section entries with dates
  $("article, [class*='changelog'], [class*='entry'], section").each((_, el) => {
    const $el = $(el);
    const title = $el.find("h1, h2, h3").first().text().trim();
    const dateText = $el.find("time, [datetime], [class*='date']").first().attr("datetime")
      || $el.find("time, [class*='date']").first().text().trim();
    const link = $el.find("a").first().attr("href");
    const summary = $el.find("p").first().text().trim();

    if (!title || !dateText) return;

    const pubDate = new Date(dateText);
    if (isNaN(pubDate.getTime()) || pubDate <= cutoff) return;

    items.push({
      title,
      link: link ? new URL(link, config.url).href : config.url,
      publishedAt: pubDate,
      summary: summary.slice(0, 500),
      sourceDomain: new URL(config.url).hostname.replace(/^www\./, ""),
      feedTitle: config.title,
      tier: config.tier,
      lang: config.lang,
    });
  });

  return items;
}

function parseGenericChangelog(html: string, cutoff: Date, config: ChangelogConfig): RssItem[] {
  const $ = load(html);
  const items: RssItem[] = [];

  // Generic: look for date headings (h2/h3) followed by content
  $("h2, h3").each((_, el) => {
    const $el = $(el);
    const heading = $el.text().trim();

    // Try to parse date from heading (e.g. "February 25, 2026", "2026-02-25", "v0.45 - Feb 25, 2026")
    const dateMatch = heading.match(
      /(\d{4}[-/]\d{1,2}[-/]\d{1,2})|([A-Z][a-z]+ \d{1,2},?\s*\d{4})|(\d{1,2}\s+[A-Z][a-z]+\s+\d{4})/
    );
    if (!dateMatch) return;

    const pubDate = new Date(dateMatch[0]);
    if (isNaN(pubDate.getTime()) || pubDate <= cutoff) return;

    // Collect text until next heading
    let summary = "";
    let next = $el.next();
    while (next.length && !next.is("h2, h3")) {
      summary += next.text().trim() + " ";
      next = next.next();
    }

    const link = $el.find("a").first().attr("href");

    items.push({
      title: `${config.title}: ${heading}`,
      link: link ? new URL(link, config.url).href : config.url,
      publishedAt: pubDate,
      summary: summary.trim().slice(0, 500),
      sourceDomain: new URL(config.url).hostname.replace(/^www\./, ""),
      feedTitle: config.title,
      tier: config.tier,
      lang: config.lang,
    });
  });

  return items;
}

function parseCursorChangelog(html: string, cutoff: Date, config: ChangelogConfig): RssItem[] {
  const $ = load(html);
  const items: RssItem[] = [];

  // Cursor changelog: version entries with dates
  $("[class*='changelog'], article, [class*='release'], [class*='entry'], section > div").each((_, el) => {
    const $el = $(el);
    const title = $el.find("h1, h2, h3").first().text().trim();
    if (!title) return;

    // Look for date in various formats
    const dateText = $el.find("time").first().attr("datetime")
      || $el.find("[class*='date'], time, small").first().text().trim();

    if (!dateText) return;

    const pubDate = new Date(dateText);
    if (isNaN(pubDate.getTime()) || pubDate <= cutoff) return;

    const summary = $el.find("p, li").map((_, p) => $(p).text().trim()).get().join(" ");
    const link = $el.find("a[href*='changelog']").first().attr("href");

    items.push({
      title: `Cursor: ${title}`,
      link: link ? new URL(link, config.url).href : config.url,
      publishedAt: pubDate,
      summary: summary.slice(0, 500),
      sourceDomain: "cursor.com",
      feedTitle: config.title,
      tier: config.tier,
      lang: config.lang,
    });
  });

  return items;
}

// ─── Changelog sources ──────────────────────────────────────────────────────

const CHANGELOG_SOURCES: ChangelogConfig[] = [
  {
    url: "https://developers.openai.com/changelog/",
    title: "OpenAI Developers Changelog",
    tier: "P0_CURATED",
    lang: "en",
    parser: parseOpenAIChangelog,
  },
  {
    url: "https://cursor.com/changelog",
    title: "Cursor Changelog",
    tier: "P1_CONTEXT",
    lang: "en",
    parser: parseCursorChangelog,
  },
  {
    url: "https://docs.warp.dev/changelog",
    title: "Warp Changelog",
    tier: "P1_CONTEXT",
    lang: "en",
    parser: parseGenericChangelog,
  },
  {
    url: "https://ai.google.dev/gemini-api/docs/changelog",
    title: "Gemini API Changelog",
    tier: "P1_CONTEXT",
    lang: "en",
    parser: parseGenericChangelog,
  },
  {
    url: "https://openrouter.ai/announcements",
    title: "OpenRouter Announcements",
    tier: "P1_CONTEXT",
    lang: "en",
    parser: parseGenericChangelog,
  },
];

// ─── Fetch + parse ──────────────────────────────────────────────────────────

async function fetchChangelog(config: ChangelogConfig, cutoff: Date): Promise<RssItem[]> {
  try {
    const res = await fetch(config.url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn(`[changelog] ${config.title}: HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();
    const items = config.parser(html, cutoff, config);
    return items;
  } catch (err) {
    console.warn(`[changelog] Failed ${config.title}: ${(err as Error).message}`);
    return [];
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function collectChangelogItems(windowHours = 72): Promise<RssItem[]> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const results = await Promise.allSettled(
    CHANGELOG_SOURCES.map((src) => fetchChangelog(src, cutoff))
  );

  const all: RssItem[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      console.log(`[changelog] ${CHANGELOG_SOURCES[i].title}: ${r.value.length} items`);
      all.push(...r.value);
    }
  }

  // URL 기준 중복 제거
  const seen = new Set<string>();
  return all.filter((item) => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
}
