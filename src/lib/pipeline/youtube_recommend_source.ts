import Parser from "rss-parser";
import { sql } from "@/lib/db/client";

interface YouTubeRecommendChannel {
  channelId: string;
  name: string;
  handle: string;
}

// ─── Recommend Channel List ──────────────────────────────────────────────────

const RECOMMEND_CHANNELS: YouTubeRecommendChannel[] = [
  { channelId: "UCQNE2JmbasNYbjGAcuBiRRg", name: "조코딩 JoCoding", handle: "@JoCoding" },
  { channelId: "UCxj3eVTAv9KLdrowXcuCFDQ", name: "빌더 조쉬 Builder Josh", handle: "@builderJosh" },
  { channelId: "UCxZ2AlaT0hOmxzZVbF_j_Sw", name: "코드팩토리", handle: "@codefactory" },
  { channelId: "UC6xro-nRXlpa4A5UoeFKUDA", name: "커서맛피아", handle: "@cursormafia" },
  { channelId: "UCztt42h03X49HFRGW9--Bhg", name: "AI 보좌관", handle: "@aiadjunct" },
  { channelId: "UCLR3sD0KB_dWpvcsrLP0aUg", name: "오늘코드", handle: "@todaycode" },
  { channelId: "UCGU_CgteEqNSjiXcF0QfaKg", name: "데이터팝콘", handle: "@data.popcorn" },
  { channelId: "UCifUR1eEHhhXxK_Q_XoArPQ", name: "큐제이씨", handle: "@qjc_qjc" },
  { channelId: "UC86HxrAQ4GS1Iq8LIvUYigQ", name: "소스놀이터", handle: "@sourcePlayground" },
  { channelId: "UCZ4mb62ECiTMw8DcbBcMLmA", name: "엔드플랜", handle: "@ENDPLAN" },
  { channelId: "UCA6KbBMswPWk6sMTVxDa5xg", name: "텐빌더", handle: "@ten-builder" },
  { channelId: "UC6VbqOLKkdDhdtnhuTYPKxA", name: "SV 개발자", handle: "@sv.developer" },
  { channelId: "UCZ30aWiMw5C8mGcESlAGQbA", name: "짐코딩", handle: "@gymcoding" },
  { channelId: "UCeN2YeJcBCRJoXgzF_OU3qw", name: "언리얼테크", handle: "@unrealtech" },
  { channelId: "UCFmYIak2sRBXt2M3ep6U3QA", name: "제이초이", handle: "@jayychoii" },
  { channelId: "UC0WxGJnTB_04ViIrxPvFRmg", name: "메이커에반", handle: "@maker-evan" },
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

function extractVideoId(url: string): string | null {
  const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];
  const idMatch = url.match(/\/([a-zA-Z0-9_-]{11})$/);
  return idMatch ? idMatch[1] : null;
}

interface YouTubeVideoRow {
  video_id: string;
  channel_id: string;
  channel_name: string;
  title: string;
  thumbnail_url: string;
  video_url: string;
  published_at: string;
}

async function fetchChannelVideos(
  channel: YouTubeRecommendChannel,
  cutoff: Date
): Promise<YouTubeVideoRow[]> {
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
        const videoId = extractVideoId(item.link ?? "") ?? item.id ?? "";
        return {
          video_id: videoId,
          channel_id: channel.channelId,
          channel_name: channel.name,
          title: (item.title ?? "").trim(),
          thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          video_url: item.link ?? `https://www.youtube.com/watch?v=${videoId}`,
          published_at: new Date(dateStr!).toISOString(),
        };
      })
      .filter((v) => v.video_id.length > 0);
  } catch (err) {
    console.warn(`[yt-recommend] Failed to fetch ${channel.name}: ${(err as Error).message}`);
    return [];
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function collectAndStoreYoutubeRecommendations(
  windowHours = 72
): Promise<{ inserted: number; skipped: number }> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  let inserted = 0;
  let skipped = 0;

  for (const channel of RECOMMEND_CHANNELS) {
    const videos = await fetchChannelVideos(channel, cutoff);
    console.log(`[yt-recommend] ${channel.name}: ${videos.length} videos found`);

    for (const video of videos) {
      try {
        await sql`
          INSERT INTO youtube_videos (video_id, channel_id, channel_name, title, thumbnail_url, video_url, published_at)
          VALUES (${video.video_id}, ${video.channel_id}, ${video.channel_name}, ${video.title}, ${video.thumbnail_url}, ${video.video_url}, ${video.published_at})
          ON CONFLICT (video_id) DO UPDATE SET
            title = EXCLUDED.title,
            thumbnail_url = EXCLUDED.thumbnail_url
        `;
        inserted++;
      } catch (err) {
        console.warn(`[yt-recommend] Failed to insert ${video.video_id}: ${(err as Error).message}`);
        skipped++;
      }
    }
  }

  return { inserted, skipped };
}

export async function cleanOldYoutubeVideos(retentionDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await sql`
    DELETE FROM youtube_videos WHERE published_at < ${cutoff.toISOString()}
  `;
  return Array.isArray(result) ? result.length : 0;
}
