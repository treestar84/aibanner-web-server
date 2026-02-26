import Parser from "rss-parser";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RssFeedConfig {
  url: string;
  title: string;
  tier: "P0_CURATED" | "P1_CONTEXT" | "P2_RAW" | "COMMUNITY";
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
  // ── P0_CURATED: 공식 블로그 + 고품질 큐레이션 ─────────────────────────────
  { url: "https://openai.com/blog/rss.xml", title: "OpenAI Blog", tier: "P0_CURATED", lang: "en" },
  { url: "https://www.anthropic.com/rss.xml", title: "Anthropic Blog", tier: "P0_CURATED", lang: "en" },
  { url: "https://huggingface.co/blog/feed.xml", title: "HuggingFace Blog", tier: "P0_CURATED", lang: "en" },
  { url: "https://research.google/blog/rss/", title: "Google Research Blog", tier: "P0_CURATED", lang: "en" },
  { url: "https://bullrich.dev/tldr-rss/ai.rss", title: "TLDR AI", tier: "P0_CURATED", lang: "en" },
  { url: "https://www.technologyreview.com/feed/", title: "MIT Technology Review", tier: "P0_CURATED", lang: "en" },
  // 리서치 페이퍼 (일간 AI 논문)
  { url: "https://papers.takara.ai/api/feed", title: "HF Daily Papers (Takara)", tier: "P0_CURATED", lang: "en" },
  // 뉴스레터 (큐레이션)
  { url: "https://www.bensbites.com/feed", title: "Ben's Bites", tier: "P0_CURATED", lang: "en" },

  // ── P1_CONTEXT: AI 뉴스/분석/체인지로그 ───────────────────────────────────
  { url: "https://techcrunch.com/category/artificial-intelligence/feed/", title: "TechCrunch AI", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://venturebeat.com/category/ai/feed/", title: "VentureBeat AI", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://www.theverge.com/ai-artificial-intelligence/rss/index.xml", title: "The Verge AI", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://arstechnica.com/ai/feed/", title: "Ars Technica AI", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://simonwillison.net/atom/everything/", title: "Simon Willison", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://www.latent.space/feed", title: "Latent Space", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://www.semianalysis.com/feed", title: "SemiAnalysis", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://lastweekin.ai/feed", title: "Last Week in AI", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://www.interconnects.ai/feed", title: "Interconnects", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://developer.nvidia.com/blog/feed", title: "NVIDIA Technical Blog", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://news.hada.io/rss/news", title: "GeekNews", tier: "P1_CONTEXT", lang: "ko" },
  // 오픈소스/프레임워크 체인지로그
  { url: "https://changelog.langchain.com/feed", title: "LangChain Changelog", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://github.com/crewAIInc/crewAI/releases.atom", title: "CrewAI Releases", tier: "P1_CONTEXT", lang: "en" },
  // 개발자 도구 전문 매체
  { url: "https://lobste.rs/rss", title: "Lobsters", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://changelog.com/feed", title: "Changelog", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://blog.logrocket.com/feed/", title: "LogRocket Blog", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://www.phoronix.com/rss.php", title: "Phoronix", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://www.producthunt.com/feed", title: "Product Hunt", tier: "P1_CONTEXT", lang: "en" },

  // ── P2_RAW: 한국어 AI 뉴스 ────────────────────────────────────────────────
  { url: "https://www.aitimes.com/rss/allArticle.xml", title: "AI타임스", tier: "P2_RAW", lang: "ko" },
  { url: "https://www.etnews.com/rss/section.xml?id=150", title: "전자신문 AI", tier: "P2_RAW", lang: "ko" },
  { url: "https://zdnet.co.kr/rss/news.xml", title: "ZDNet Korea", tier: "P2_RAW", lang: "ko" },

  // ── COMMUNITY: Reddit, HN, Dev.to ─────────────────────────────────────────
  { url: "https://www.reddit.com/r/MachineLearning/.rss", title: "r/MachineLearning", tier: "COMMUNITY", lang: "en" },
  { url: "https://www.reddit.com/r/artificial/.rss", title: "r/artificial", tier: "COMMUNITY", lang: "en" },
  { url: "https://www.reddit.com/r/LocalLLaMA/.rss", title: "r/LocalLLaMA", tier: "COMMUNITY", lang: "en" },
  { url: "https://www.reddit.com/r/vibecoding/.rss", title: "r/vibecoding", tier: "COMMUNITY", lang: "en" },
  { url: "https://www.reddit.com/r/PromptEngineering/.rss", title: "r/PromptEngineering", tier: "COMMUNITY", lang: "en" },
  { url: "https://www.reddit.com/r/cursor/.rss", title: "r/cursor", tier: "COMMUNITY", lang: "en" },
  { url: "https://www.reddit.com/r/ClaudeAI/.rss", title: "r/ClaudeAI", tier: "COMMUNITY", lang: "en" },
  { url: "https://www.reddit.com/r/ChatGPTCoding/.rss", title: "r/ChatGPTCoding", tier: "COMMUNITY", lang: "en" },
  { url: "https://www.reddit.com/r/ollama/.rss", title: "r/ollama", tier: "COMMUNITY", lang: "en" },
  { url: "https://dev.to/feed/tag/ai", title: "Dev.to AI", tier: "COMMUNITY", lang: "en" },
  { url: "https://hnrss.org/newest?q=LLM+AI", title: "HackerNews AI", tier: "COMMUNITY", lang: "en" },
];

// ─── Parser ───────────────────────────────────────────────────────────────────

const parser = new Parser({
  timeout: 8000,
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
    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000); // 72h

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
