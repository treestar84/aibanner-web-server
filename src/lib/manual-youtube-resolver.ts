import { getYoutubeVideoByVideoId } from "@/lib/db/queries";
import {
  buildYoutubeThumbnailUrl,
  normalizeYoutubeVideoUrl,
} from "@/lib/manual-youtube";

interface YoutubeOEmbedResponse {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

export interface ResolvedManualYoutubeLink {
  videoId: string;
  videoUrl: string;
  title: string;
  channelName: string;
  publishedAt: string;
  thumbnailUrl: string;
}

async function fetchYoutubeOEmbed(
  videoUrl: string
): Promise<YoutubeOEmbedResponse | null> {
  const endpoint = new URL("https://www.youtube.com/oembed");
  endpoint.searchParams.set("url", videoUrl);
  endpoint.searchParams.set("format", "json");

  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        "User-Agent": "AI-Trend-Widget/1.0",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as YoutubeOEmbedResponse;
  } catch {
    return null;
  }
}

export async function resolveManualYoutubeLink(
  rawVideoUrl: string
): Promise<ResolvedManualYoutubeLink> {
  const normalizedUrl = normalizeYoutubeVideoUrl(rawVideoUrl);
  if (normalizedUrl.error || !normalizedUrl.videoId || !normalizedUrl.url) {
    throw new Error(normalizedUrl.error ?? "유효한 YouTube 링크를 입력해 주세요.");
  }

  const { videoId, url } = normalizedUrl;
  const existingVideo = await getYoutubeVideoByVideoId(videoId);
  if (existingVideo) {
    return {
      videoId,
      videoUrl: url,
      title: existingVideo.title,
      channelName: existingVideo.channel_name,
      publishedAt: existingVideo.published_at,
      thumbnailUrl: existingVideo.thumbnail_url,
    };
  }

  const oembed = await fetchYoutubeOEmbed(url);
  return {
    videoId,
    videoUrl: url,
    title: oembed?.title?.trim() || `YouTube 영상 ${videoId}`,
    channelName: oembed?.author_name?.trim() || "",
    publishedAt: new Date().toISOString(),
    thumbnailUrl: oembed?.thumbnail_url?.trim() || buildYoutubeThumbnailUrl(videoId),
  };
}
