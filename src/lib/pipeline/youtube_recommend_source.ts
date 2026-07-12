import { sql } from "@/lib/db/client";
import { listYoutubeRecommendChannels } from "@/lib/db/queries";
import {
  classifyYouTubeVideo,
  parseYouTubeIsoDurationSeconds,
  type YouTubeVideoType,
} from "@/lib/youtube-video-type";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const MAX_RESULTS = 50;

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

interface YouTubeApiResponse<T> {
  items?: T[];
  error?: { message?: string };
}

interface PlaylistItem {
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
}

interface VideoItem {
  id?: string;
  contentDetails?: { duration?: string };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function youtubeGet<T>(
  path: string,
  params: Record<string, string>,
  apiKey: string,
): Promise<T> {
  const url = new URL(`${YOUTUBE_API_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("key", apiKey);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json" },
  });
  const body = (await response.json()) as YouTubeApiResponse<T>;
  if (!response.ok) {
    throw new Error(body.error?.message ?? `YouTube API HTTP ${response.status}`);
  }
  return body as T;
}

async function fetchChannelVideos(
  channel: { channelId: string; name: string },
  cutoff: Date,
  apiKey: string,
): Promise<YouTubeVideoRow[]> {
  try {
    const channelResponse = await youtubeGet<YouTubeApiResponse<{
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }>>("channels", { part: "contentDetails", id: channel.channelId }, apiKey);
    const uploadsPlaylistId = channelResponse.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) return [];

    const playlistResponse = await youtubeGet<YouTubeApiResponse<PlaylistItem>>(
      "playlistItems",
      { part: "snippet,contentDetails", playlistId: uploadsPlaylistId, maxResults: String(MAX_RESULTS) },
      apiKey,
    );
    const recentItems = (playlistResponse.items ?? []).filter((item) => {
      const publishedAt = item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt;
      return Boolean(item.contentDetails?.videoId && publishedAt && new Date(publishedAt) > cutoff);
    });
    const ids = recentItems.flatMap((item) => item.contentDetails?.videoId ? [item.contentDetails.videoId] : []);
    if (ids.length === 0) return [];

    const videoResponse = await youtubeGet<YouTubeApiResponse<VideoItem>>(
      "videos",
      { part: "contentDetails", id: ids.join(",") },
      apiKey,
    );
    const durations = new Map(
      (videoResponse.items ?? []).flatMap((video) => video.id
        ? [[video.id, parseYouTubeIsoDurationSeconds(video.contentDetails?.duration)] as const]
        : []),
    );

    return recentItems.flatMap((item) => {
      const videoId = item.contentDetails?.videoId;
      const publishedAt = item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt;
      if (!videoId || !publishedAt) return [];
      const durationSeconds = durations.get(videoId) ?? null;
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const thumbnails = item.snippet?.thumbnails ?? {};
      return [{
        video_id: videoId,
        channel_id: channel.channelId,
        channel_name: item.snippet?.channelTitle?.trim() || channel.name,
        title: item.snippet?.title?.trim() || "Untitled YouTube video",
        thumbnail_url: thumbnails.maxres?.url ?? thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        video_url: videoUrl,
        published_at: new Date(publishedAt).toISOString(),
        duration_seconds: durationSeconds,
        video_type: classifyYouTubeVideo({ videoUrl, durationSeconds }),
      }];
    });
  } catch (err) {
    console.warn(`[yt-recommend] Failed to fetch ${channel.name}: ${errorMessage(err)}`);
    return [];
  }
}

export async function collectAndStoreYoutubeRecommendations(
  windowHours = 72,
): Promise<{ inserted: number; skipped: number }> {
  const apiKey = process.env.YOUTUBE_DATA_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[yt-recommend] YOUTUBE_DATA_API_KEY is not configured; official API collection skipped");
    return { inserted: 0, skipped: 0 };
  }

  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  let inserted = 0;
  let skipped = 0;
  const channels = await listYoutubeRecommendChannels();

  for (const channel of channels.map((item) => ({ channelId: item.channel_id, name: item.channel_name }))) {
    const videos = await fetchChannelVideos(channel, cutoff, apiKey);
    console.log(`[yt-recommend] ${channel.name}: ${videos.length} videos found`);

    for (const video of videos) {
      try {
        await sql`
          INSERT INTO youtube_videos (
            video_id, channel_id, channel_name, title, thumbnail_url, video_url,
            published_at, duration_seconds, video_type
          ) VALUES (
            ${video.video_id}, ${video.channel_id}, ${video.channel_name}, ${video.title},
            ${video.thumbnail_url}, ${video.video_url}, ${video.published_at},
            ${video.duration_seconds}, ${video.video_type}
          )
          ON CONFLICT (video_id) DO UPDATE SET
            title = EXCLUDED.title,
            thumbnail_url = EXCLUDED.thumbnail_url,
            duration_seconds = EXCLUDED.duration_seconds,
            video_type = EXCLUDED.video_type
        `;
        inserted++;
      } catch (err) {
        console.warn(`[yt-recommend] Failed to insert ${video.video_id}: ${errorMessage(err)}`);
        skipped++;
      }
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
