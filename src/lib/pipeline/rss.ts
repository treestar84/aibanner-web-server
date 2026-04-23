import Parser from "rss-parser";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RssFeedConfig {
  url: string;
  title: string;
  tier: "P0_CURATED" | "P1_CONTEXT" | "P2_RAW" | "COMMUNITY";
  lang?: "ko" | "en" | "ja" | "zh" | "other";
}

export interface RssRankingSignal {
  sourceKey: string;
  authorityOverride?: number;
  domainBonus?: number;
  rank?: number | null;
}

export interface RssEngagement {
  score: number;      // upvotes, points, stars
  comments: number;   // comment count
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
  rankingSignals?: RssRankingSignal[];
  engagement?: RssEngagement;
}

// ─── RSS Feed list (AI-focused) ───────────────────────────────────────────────

export const RSS_FEEDS: RssFeedConfig[] = [
  // ── P0_CURATED: 공식 블로그 + 고품질 큐레이션 ─────────────────────────────
  { url: "https://openai.com/blog/rss.xml", title: "OpenAI Blog", tier: "P0_CURATED", lang: "en" },
  { url: "https://www.anthropic.com/rss.xml", title: "Anthropic Blog", tier: "P0_CURATED", lang: "en" },
  { url: "https://huggingface.co/blog/feed.xml", title: "HuggingFace Blog", tier: "P0_CURATED", lang: "en" },
  { url: "https://bullrich.dev/tldr-rss/ai.rss", title: "TLDR AI", tier: "P0_CURATED", lang: "en" },
  // 리서치 페이퍼 (일간 AI 논문)
  { url: "https://papers.takara.ai/api/feed", title: "HF Daily Papers (Takara)", tier: "P0_CURATED", lang: "en" },
  // 뉴스레터 (큐레이션)
  { url: "https://www.bensbites.com/feed", title: "Ben's Bites", tier: "P0_CURATED", lang: "en" },
  // 개발 플랫폼 공식 블로그
  { url: "https://github.blog/feed/", title: "GitHub Blog", tier: "P0_CURATED", lang: "en" },
  // 바이브코딩 에디터 / 배포 플랫폼 changelog (audit-A#L205-220)
  { url: "https://zed.dev/blog.rss", title: "Zed Blog", tier: "P0_CURATED", lang: "en" },
  { url: "https://blog.replit.com/rss", title: "Replit Blog", tier: "P0_CURATED", lang: "en" },
  { url: "https://vercel.com/changelog/rss.xml", title: "Vercel Changelog", tier: "P0_CURATED", lang: "en" },
  // 한국 기술 블로그 (audit-A#L259-265)
  { url: "https://toss.tech/rss.xml", title: "토스 기술 블로그", tier: "P0_CURATED", lang: "ko" },
  { url: "https://news.hada.io/rss/blog", title: "GeekNews Blog", tier: "P0_CURATED", lang: "ko" },
  { url: "https://techblog.woowahan.com/feed/", title: "우아한형제들 기술블로그", tier: "P0_CURATED", lang: "ko" },
  // 추가 한국 매체 (한국어 비중 ≥18% 목표 충족, audit-A 한국 카탈로그)
  { url: "https://d2.naver.com/d2.atom", title: "네이버 D2", tier: "P1_CONTEXT", lang: "ko" },
  { url: "https://tech.kakao.com/feed/", title: "카카오 기술블로그", tier: "P1_CONTEXT", lang: "ko" },
  { url: "https://engineering.linecorp.com/ko/feed/", title: "LINE Engineering", tier: "P1_CONTEXT", lang: "ko" },
  { url: "https://yozm.wishket.com/magazine/rss/", title: "요즘IT", tier: "P1_CONTEXT", lang: "ko" },

  // ── P1_CONTEXT: AI 뉴스/분석/체인지로그 ───────────────────────────────────
  { url: "https://techcrunch.com/category/artificial-intelligence/feed/", title: "TechCrunch AI", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://venturebeat.com/category/ai/feed/", title: "VentureBeat AI", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://www.theverge.com/ai-artificial-intelligence/rss/index.xml", title: "The Verge AI", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://arstechnica.com/ai/feed/", title: "Ars Technica AI", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://tensorfeed.ai/feed.xml", title: "TensorFeed", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://simonwillison.net/atom/everything/", title: "Simon Willison", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://www.latent.space/feed", title: "Latent Space", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://www.semianalysis.com/feed", title: "SemiAnalysis", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://lastweekin.ai/feed", title: "Last Week in AI", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://www.interconnects.ai/feed", title: "Interconnects", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://developer.nvidia.com/blog/feed", title: "NVIDIA Technical Blog", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://news.hada.io/rss/news", title: "GeekNews", tier: "P1_CONTEXT", lang: "ko" },
  // P0 → P1 강등 (audit-A#L289-290): 발행 빈도 낮음 / 바이브코딩 직결성 약함
  { url: "https://research.google/blog/rss/", title: "Google Research Blog", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://www.technologyreview.com/feed/", title: "MIT Technology Review", tier: "P1_CONTEXT", lang: "en" },
  // 오픈소스/프레임워크 체인지로그
  { url: "https://changelog.langchain.com/feed", title: "LangChain Changelog", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://github.com/crewAIInc/crewAI/releases.atom", title: "CrewAI Releases", tier: "P1_CONTEXT", lang: "en" },
  // 개발자 도구 전문 매체
  { url: "https://lobste.rs/rss", title: "Lobsters", tier: "P1_CONTEXT", lang: "en" },
  { url: "https://changelog.com/feed", title: "Changelog", tier: "P1_CONTEXT", lang: "en" },
  // 제거 (audit-A#L283-286):
  //   - LogRocket Blog (마케팅 콘텐츠 편향)
  //   - Phoronix (리눅스 벤치마크, AI 무관)
  //   - Product Hunt RSS (Product Hunt GraphQL `product_hunt_top_source.ts`와 중복)
  // 앱/에이전트/배포 생태계
  { url: "https://vercel.com/atom", title: "Vercel Blog", tier: "P1_CONTEXT", lang: "en" },
  // 코드 인텔리전스/Cody
  { url: "https://sourcegraph.com/blog/rss.xml", title: "Sourcegraph Blog", tier: "P1_CONTEXT", lang: "en" },
  // AI 실전 분석/교육
  { url: "https://sebastianraschka.com/rss_feed.xml", title: "Sebastian Raschka", tier: "P1_CONTEXT", lang: "en" },
  // 개발자 업계 분석
  { url: "https://newsletter.pragmaticengineer.com/feed", title: "The Pragmatic Engineer", tier: "P1_CONTEXT", lang: "en" },
  // AI 코딩/에이전트 블로그
  { url: "https://baoyu.io/feed.xml", title: "宝玉", tier: "P1_CONTEXT", lang: "en" },

  // ── P2_RAW: 한국어 AI 뉴스 ────────────────────────────────────────────────
  // AI타임스: 2026-04-09 기준 RSS 404 → 제거
  // 전자신문 AI: 2026-04-09 기준 WAF 차단 → 제거
  { url: "https://zdnet.co.kr/rss/news.xml", title: "ZDNet Korea", tier: "P2_RAW", lang: "ko" },

  // ── COMMUNITY: Dev.to, HN (Reddit은 reddit_source.ts에서 JSON API로 수집) ──
  { url: "https://dev.to/feed/tag/ai", title: "Dev.to AI", tier: "COMMUNITY", lang: "en" },
  { url: "https://dev.to/feed/tag/vibecoding", title: "Dev.to Vibe Coding", tier: "COMMUNITY", lang: "en" },
  { url: "https://towardsai.net/feed", title: "Towards AI", tier: "COMMUNITY", lang: "en" },
  // 제거 (audit-A#L283): HackerNews AI (hnrss) — `hn_source.ts` Algolia 경로와 100% 중복
  // 추가 (audit-A#L199-200): Show HN / GitHub Trending RSS
  { url: "https://hnrss.org/show?points=30", title: "Show HN (AI/Dev)", tier: "COMMUNITY", lang: "en" },
  { url: "https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml", title: "GitHub Trending", tier: "COMMUNITY", lang: "en" },
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

async function fetchFeed(config: RssFeedConfig, cutoff: Date): Promise<RssItem[]> {
  try {
    const feed = await parser.parseURL(config.url);

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
  windowHours = 72,
  feeds: RssFeedConfig[] = RSS_FEEDS
): Promise<RssItem[]> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const results = await Promise.allSettled(feeds.map((feed) => fetchFeed(feed, cutoff)));

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
