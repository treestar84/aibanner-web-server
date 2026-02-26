import Parser from "rss-parser";
import type { RssItem } from "./rss";

// ─── YouTube Channel List ────────────────────────────────────────────────────

interface YouTubeChannel {
  channelId: string;
  name: string;
}

const YOUTUBE_CHANNELS: YouTubeChannel[] = [
  // ── AI 기업 공식 채널 ──────────────────────────────────────────────────────
  { channelId: "UCXZCJLdBC09xxGZ6gcdrc6A", name: "OpenAI" },
  { channelId: "UCrDwWp7EBBv4NwvScIpBDOA", name: "Anthropic" },
  { channelId: "UCP7jMXSY2xbc3KCAE0MHQ-A", name: "Google DeepMind" },
  { channelId: "UC8butISFwT-Wl7EV0hUK0BQ", name: "GitHub" },
  // ── AI 뉴스/분석 영어 ─────────────────────────────────────────────────────
  { channelId: "UChpleBmo18P08aKCIgti38g", name: "Matt Wolfe" },
  { channelId: "UCqcbQf6yw5KzRoDDcZ_wBSw", name: "Wes Roth" },
  { channelId: "UCMwVTLZIRRUyyVrkjDpn4pA", name: "Cole Medin" },
  { channelId: "UCNJ1Ymd5yFuUPtn21xtRbbw", name: "AI Explained" },
  { channelId: "UC_x36zCEGilGpB1m-V4gmjg", name: "IndyDevDan" },
  { channelId: "UCXZFVVCFahewxr3est7aT7Q", name: "McKay Wrigley" },
  { channelId: "UCsBjURrPoezykLs9EqgamOA", name: "Fireship" },
  { channelId: "UCHhYXsLBEVVnbvsq57n1MTQ", name: "The AI Advantage" },
  { channelId: "UCjqXiO67iUfqD5RppPXIqqg", name: "World of AI" },
  { channelId: "UCOXRjenlq9PmlTqd_JhAbMQ", name: "EricWTech" },
  { channelId: "UCw_B1AMdUph-BVZ2ZC6do7A", name: "Evan Does AI" },
  // ── 한국어 AI 개발 ────────────────────────────────────────────────────────
  { channelId: "UCt2wAAXgm87ACiQnDHQEW6Q", name: "테디노트 TeddyNote" },
  { channelId: "UCQNE2JmbasNYbjGAcuBiRRg", name: "조코딩 JoCoding" },
  { channelId: "UCxj3eVTAv9KLdrowXcuCFDQ", name: "빌더 조쉬 Builder Josh" },
  { channelId: "UCxZ2AlaT0hOmxzZVbF_j_Sw", name: "코드팩토리" },
];

// ─── Parser ──────────────────────────────────────────────────────────────────

const parser = new Parser({
  timeout: 8000,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; AI-Trend-Widget/1.0)",
  },
});

function buildFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

async function fetchChannel(
  channel: YouTubeChannel,
  cutoff: Date
): Promise<RssItem[]> {
  try {
    const feed = await parser.parseURL(buildFeedUrl(channel.channelId));

    return feed.items
      .filter((item) => {
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
          summary: (item.contentSnippet ?? item.content ?? "").slice(0, 500),
          sourceDomain: "youtube.com",
          feedTitle: `YouTube: ${channel.name}`,
          tier: "COMMUNITY" as const,
          lang: channel.name.match(/[가-힣]/) ? "ko" : "en",
        };
      });
  } catch (err) {
    console.warn(
      `[youtube] Failed to fetch ${channel.name}: ${(err as Error).message}`
    );
    return [];
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function collectYoutubeItems(
  windowHours = 72
): Promise<RssItem[]> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const results = await Promise.allSettled(
    YOUTUBE_CHANNELS.map((ch) => fetchChannel(ch, cutoff))
  );

  const all: RssItem[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      console.log(
        `[youtube] ${YOUTUBE_CHANNELS[i].name}: ${r.value.length} items`
      );
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
