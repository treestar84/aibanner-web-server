import Parser from "rss-parser";
import { extractDomain, type RssItem } from "./rss";

type GoogleAlertsTier = Extract<RssItem["tier"], "P1_CONTEXT" | "P2_RAW" | "COMMUNITY">;

interface GoogleAlertFeedConfig {
  url?: string;
  query: string;
  title: string;
  tier: GoogleAlertsTier;
  lang: "ko" | "en" | "ja" | "zh" | "other";
}

type ConfiguredGoogleAlertFeed = GoogleAlertFeedConfig & { url: string };

const FETCH_TIMEOUT_MS = 8000;
const DEFAULT_TIER: GoogleAlertsTier = "P2_RAW";

// Google Alerts RSS URL은 쿼리만으로 생성할 수 없다.
// google.com/alerts에서 각 query로 Alert를 만든 뒤 "Deliver to: RSS Feed"로 설정하고,
// 생성된 feed URL을 아래 url에 하드코딩해야 실제 수집된다.
export const GOOGLE_ALERTS_FEEDS: GoogleAlertFeedConfig[] = [
  {
    query: '"Claude Code" OR "Claude Agent"',
    title: "Google Alerts: Claude Code",
    url: "",
    tier: "P2_RAW",
    lang: "en",
  },
  {
    query: '"OpenAI" ("agents" OR "Responses API" OR "Codex" OR "ChatGPT")',
    title: "Google Alerts: OpenAI Agents",
    url: "",
    tier: "P2_RAW",
    lang: "en",
  },
  {
    query: '"Google" ("Gemini" OR "Gemini CLI" OR "AI Studio" OR "DeepMind")',
    title: "Google Alerts: Google Gemini",
    url: "",
    tier: "P2_RAW",
    lang: "en",
  },
  {
    query: '"xAI" OR "Grok" OR "Grok 4" OR "Grok Code"',
    title: "Google Alerts: xAI Grok",
    url: "",
    tier: "P2_RAW",
    lang: "en",
  },
  {
    query: '"GitHub Copilot" OR "Copilot Workspace" OR "Microsoft Copilot"',
    title: "Google Alerts: Copilot",
    url: "",
    tier: "P2_RAW",
    lang: "en",
  },
  {
    query: '"DeepSeek" OR "Qwen" OR "Kimi K2" OR "Moonshot AI"',
    title: "Google Alerts: China AI Models",
    url: "",
    tier: "P2_RAW",
    lang: "en",
  },
  {
    query: '"GLM" "Zhipu" OR "MiniMax" OR "Hunyuan" OR "ERNIE" "Baidu"',
    title: "Google Alerts: China AI Labs",
    url: "",
    tier: "P2_RAW",
    lang: "en",
  },
  {
    query: '"AI 에이전트" OR "코딩 에이전트" OR "바이브코딩"',
    title: "Google Alerts: Korea AI Agents",
    url: "",
    tier: "P2_RAW",
    lang: "ko",
  },
];

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; AI-Trend-Widget/1.0)",
    Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
  },
});

function normalizeTier(value: unknown): GoogleAlertsTier {
  if (value === "P1_CONTEXT" || value === "P2_RAW" || value === "COMMUNITY") return value;
  return DEFAULT_TIER;
}

function normalizeLang(value: unknown): GoogleAlertFeedConfig["lang"] {
  if (value === "ko" || value === "en" || value === "ja" || value === "zh" || value === "other") {
    return value;
  }
  return "en";
}

function normalizeConfig(input: GoogleAlertFeedConfig, index: number): ConfiguredGoogleAlertFeed | null {
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!url) return null;

  const query = typeof input.query === "string" && input.query.trim()
    ? input.query.trim()
    : `Google Alerts ${index + 1}`;

  const title = typeof input.title === "string" && input.title.trim()
    ? input.title.trim()
    : `Google Alerts: ${query}`;

  return {
    url,
    query,
    title,
    tier: normalizeTier(input.tier),
    lang: normalizeLang(input.lang),
  };
}

export function getConfiguredGoogleAlertsFeeds(
  feeds: GoogleAlertFeedConfig[] = GOOGLE_ALERTS_FEEDS
): ConfiguredGoogleAlertFeed[] {
  const configs: ConfiguredGoogleAlertFeed[] = [];
  const seen = new Set<string>();
  feeds.forEach((item, index) => {
    const config = normalizeConfig(item, index);
    if (!config?.url || seen.has(config.url)) return;
    seen.add(config.url);
    configs.push(config);
  });

  return configs;
}

async function fetchGoogleAlertFeed(
  config: ConfiguredGoogleAlertFeed,
  cutoff: Date
): Promise<RssItem[]> {
  try {
    const feed = await parser.parseURL(config.url);
    const items: RssItem[] = [];

    for (const item of feed.items) {
      const dateStr = item.pubDate ?? item.isoDate;
      const publishedAt = dateStr ? new Date(dateStr) : null;
      if (!publishedAt || isNaN(publishedAt.getTime()) || publishedAt <= cutoff) continue;
      if (!item.title || !item.link) continue;

      items.push({
        title: item.title.trim(),
        link: item.link,
        publishedAt,
        summary: (item.contentSnippet ?? item.content ?? item.summary ?? "").slice(0, 500),
        sourceDomain: extractDomain(item.link),
        feedTitle: config.title,
        tier: config.tier,
        lang: config.lang,
      });
    }

    return items;
  } catch (err) {
    console.warn(`[google-alerts] ${config.title}: ${(err as Error).message}`);
    return [];
  }
}

export async function collectGoogleAlertsItems(windowHours = 72): Promise<RssItem[]> {
  const feeds = getConfiguredGoogleAlertsFeeds();
  if (feeds.length === 0) return [];

  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const results = await Promise.allSettled(feeds.map((feed) => fetchGoogleAlertFeed(feed, cutoff)));
  const all: RssItem[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status !== "fulfilled") continue;
    console.log(`[google-alerts] ${feeds[i].title}: ${result.value.length} items`);
    all.push(...result.value);
  }

  const seen = new Set<string>();
  return all.filter((item) => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
}
