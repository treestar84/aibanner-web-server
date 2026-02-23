import Parser from "rss-parser";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RssFeedConfig {
  url: string;
  title: string;
  tier: "P0_CURATED" | "P0_RELEASES" | "P1_CONTEXT" | "P2_RAW" | "COMMUNITY";
  lang?: "ko" | "en";
}

export interface RssItem {
  title: string;
  link: string;
  publishedAt: Date;
  summary: string;
  sourceDomain: string;
  feedTitle: string;
  tier: RssFeedConfig["tier"];
  lang: string;
}

// ─── RSS Feed list (AI-focused) ───────────────────────────────────────────────

export const RSS_FEEDS: RssFeedConfig[] = [
  // P0_CURATED: 고품질 AI 큐레이션
  { url: "https://openai.com/blog/rss.xml", title: "OpenAI Blog", tier: "P0_CURATED", lang: "en" },
  { url: "https://www.anthropic.com/rss.xml", title: "Anthropic Blog", tier: "P0_CURATED", lang: "en" },
  { url: "https://huggingface.co/blog/feed.xml", title: "HuggingFace Blog", tier: "P0_CURATED", lang: "en" },
  { url: "https://research.google/blog/rss/", title: "Google Research Blog", tier: "P0_CURATED", lang: "en" },
  // P0_RELEASES: AI 모델/라이브러리 릴리즈
  { url: "https://github.com/openai/openai-python/releases.atom", title: "OpenAI Python Releases", tier: "P0_RELEASES", lang: "en" },
  { url: "https://github.com/anthropics/anthropic-sdk-python/releases.atom", title: "Anthropic SDK Releases", tier: "P0_RELEASES", lang: "en" },
  { url: "https://github.com/langchain-ai/langchain/releases.atom", title: "LangChain Releases", tier: "P0_RELEASES", lang: "en" },
  { url: "https://github.com/microsoft/autogen/releases.atom", title: "AutoGen Releases", tier: "P0_RELEASES", lang: "en" },
  // P1_CONTEXT: AI 뉴스/분석
  { url: "https://techcrunch.com/category/artificial-intelligence/feed/", title: "TechCrunch AI", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://venturebeat.com/category/ai/feed/", title: "VentureBeat AI", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://www.theverge.com/ai-artificial-intelligence/rss/index.xml", title: "The Verge AI", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://arstechnica.com/ai/feed/", title: "Ars Technica AI", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://feeds.feedburner.com/AIWeekly", title: "AI Weekly", tier: "P1_CONTEXT", lang: "en" },
  // P2_RAW: 한국어 AI 뉴스
  { url: "https://www.aitimes.com/rss/allArticle.xml", title: "AI타임스", tier: "P2_RAW", lang: "ko" },
  { url: "https://www.etnews.com/rss/section.xml?id=150", title: "전자신문 AI", tier: "P2_RAW", lang: "ko" },
  { url: "https://zdnet.co.kr/rss/news.xml", title: "ZDNet Korea", tier: "P2_RAW", lang: "ko" },
  // COMMUNITY: Reddit, HN
  { url: "https://www.reddit.com/r/MachineLearning/.rss", title: "r/MachineLearning", tier: "COMMUNITY", lang: "en" },
  { url: "https://www.reddit.com/r/artificial/.rss", title: "r/artificial", tier: "COMMUNITY", lang: "en" },
  { url: "https://hnrss.org/newest?q=LLM+AI&points=10", title: "HackerNews AI", tier: "COMMUNITY", lang: "en" },
];

// ─── Parser ───────────────────────────────────────────────────────────────────

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; AI-Trend-Widget/1.0)",
  },
  customFields: {
    item: [["media:thumbnail", "mediaThumbnail"]],
  },
});

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function fetchFeed(config: RssFeedConfig): Promise<RssItem[]> {
  try {
    const feed = await parser.parseURL(config.url);
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48h

    return feed.items
      .filter((item) => {
        // pubDate(RSS) 또는 isoDate(Atom) 둘 다 시도
        const dateStr = item.pubDate ?? item.isoDate;
        const pubDate = dateStr ? new Date(dateStr) : null;
        return pubDate && pubDate > cutoff && item.title && item.link;
      })
      .map((item) => {
        const dateStr = item.pubDate ?? item.isoDate;
        return {
          title: (item.title ?? "").trim(),
          link: item.link ?? "",
          publishedAt: new Date(dateStr!),
          summary: (item.contentSnippet ?? item.content ?? item.summary ?? "").slice(0, 500),
          sourceDomain: extractDomain(item.link ?? config.url),
          feedTitle: config.title,
          tier: config.tier,
          lang: config.lang ?? "en",
        };
      });
  } catch (err) {
    console.warn(`[RSS] Failed to fetch ${config.title}: ${(err as Error).message}`);
    return [];
  }
}

export async function collectRssItems(
  feeds: RssFeedConfig[] = RSS_FEEDS
): Promise<RssItem[]> {
  const results = await Promise.allSettled(feeds.map(fetchFeed));

  const all: RssItem[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      console.log(`[RSS] ${feeds[i].title}: ${r.value.length} items`);
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
