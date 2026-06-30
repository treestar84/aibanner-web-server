import Parser from "rss-parser";
import { sql } from "@/lib/db/client";
import { listYoutubeRecommendChannels } from "@/lib/db/queries";
import { readLimitedResponsePrefixText } from "@/lib/youtube-fetch";
import {
  classifyYouTubeVideo,
  parseDurationSecondsFromWatchHtml,
  toSafeYouTubeMetadataUrl,
  type YouTubeVideoType,
} from "@/lib/youtube-video-type";

// ─── Parser ──────────────────────────────────────────────────────────────────

const parser = new Parser({
  timeout: 8000,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; AI-Trend-Widget/1.0)",
  },
});

const MAX_METADATA_BYTES = 1024 * 1024;
const VIDEO_METADATA_CONCURRENCY = 4;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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
  duration_seconds: number | null;
  video_type: YouTubeVideoType;
}

async function fetchVideoMetadata(videoUrl: string): Promise<{
  durationSeconds: number | null;
  videoType: YouTubeVideoType;
}> {
  const metadataUrl = toSafeYouTubeMetadataUrl(videoUrl);
  if (!metadataUrl) {
    return {
      durationSeconds: null,
      videoType: classifyYouTubeVideo({ videoUrl }),
    };
  }

  try {
    const response = await fetch(metadataUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AI-Trend-Widget/1.0; +https://ai-news)",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
      return {
        durationSeconds: null,
        videoType: classifyYouTubeVideo({ videoUrl }),
      };
    }

    const html = await readLimitedResponsePrefixText(
      response,
      MAX_METADATA_BYTES,
    );
    const durationSeconds = parseDurationSecondsFromWatchHtml(html);
    return {
      durationSeconds,
      videoType: classifyYouTubeVideo({ videoUrl, durationSeconds }),
    };
  } catch (err) {
    console.warn(
      `[yt-recommend] Failed to classify ${videoUrl}: ${errorMessage(err)}`,
    );
    return {
      durationSeconds: null,
      videoType: classifyYouTubeVideo({ videoUrl }),
    };
  }
}


async function fetchChannelVideos(
  channel: { channelId: string; name: string },
  cutoff: Date,
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
          duration_seconds: null,
          video_type: "unknown" as YouTubeVideoType,
        };
      })
      .filter((v) => v.video_id.length > 0);
  } catch (err) {
    console.warn(
      `[yt-recommend] Failed to fetch ${channel.name}: ${errorMessage(err)}`,
    );
    return [];
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function collectAndStoreYoutubeRecommendations(
  windowHours = 72,
): Promise<{ inserted: number; skipped: number }> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  let inserted = 0;
  let skipped = 0;
  const channels = await listYoutubeRecommendChannels();

  for (const channel of channels.map((item) => ({
    channelId: item.channel_id,
    name: item.channel_name,
  }))) {
    const videos = await fetchChannelVideos(channel, cutoff);
    console.log(
      `[yt-recommend] ${channel.name}: ${videos.length} videos found`,
    );

    for (
      let index = 0;
      index < videos.length;
      index += VIDEO_METADATA_CONCURRENCY
    ) {
      const batch = videos.slice(index, index + VIDEO_METADATA_CONCURRENCY);
      const outcomes = await Promise.all(
        batch.map(async (video) => {
          try {
            const metadata = await fetchVideoMetadata(video.video_url);
            await sql`
          INSERT INTO youtube_videos (
            video_id,
            channel_id,
            channel_name,
            title,
            thumbnail_url,
            video_url,
            published_at,
            duration_seconds,
            video_type
          )
          VALUES (
            ${video.video_id},
            ${video.channel_id},
            ${video.channel_name},
            ${video.title},
            ${video.thumbnail_url},
            ${video.video_url},
            ${video.published_at},
            ${metadata.durationSeconds},
            ${metadata.videoType}
          )
          ON CONFLICT (video_id) DO UPDATE SET
            title = EXCLUDED.title,
            thumbnail_url = EXCLUDED.thumbnail_url,
            duration_seconds = COALESCE(EXCLUDED.duration_seconds, youtube_videos.duration_seconds),
            video_type = CASE
              WHEN EXCLUDED.video_type <> 'unknown' THEN EXCLUDED.video_type
              ELSE youtube_videos.video_type
            END
        `;
            return "inserted" as const;
          } catch (err) {
            console.warn(
              `[yt-recommend] Failed to insert ${video.video_id}: ${errorMessage(err)}`,
            );
            return "skipped" as const;
          }
        }),
      );
      inserted += outcomes.filter((outcome) => outcome === "inserted").length;
      skipped += outcomes.filter((outcome) => outcome === "skipped").length;
    }
  }

  return { inserted, skipped };
}

export async function cleanOldYoutubeVideos(
  retentionDays = 90,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await sql`
    DELETE FROM youtube_videos WHERE published_at < ${cutoff.toISOString()}
  `;
  return Array.isArray(result) ? result.length : 0;
}
