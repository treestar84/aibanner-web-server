import { getYoutubeVideoByVideoId } from "@/lib/db/queries";
import {
  buildYoutubeThumbnailUrl,
  normalizeYoutubeVideoUrl,
  resolveManualVideoType,
} from "@/lib/manual-youtube";
import { readLimitedResponseText } from "@/lib/youtube-fetch";
import {
  classifyYouTubeVideo,
  type YouTubeVideoType,
} from "@/lib/youtube-video-type";

interface YoutubeOEmbedResponse {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

const OEMBED_MAX_BYTES = 64 * 1024;

export interface ResolvedManualYoutubeLink {
  videoId: string;
  videoUrl: string;
  title: string;
  channelName: string;
  publishedAt: string;
  thumbnailUrl: string;
  videoType: YouTubeVideoType;
}

interface ResolveManualYoutubeLinkOptions {
  existingManualVideoId?: string;
  existingManualVideoType?: YouTubeVideoType;
}

function parseYoutubeOEmbedResponse(
  text: string,
): YoutubeOEmbedResponse | null {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") return null;
  const title = Reflect.get(parsed, "title");
  const authorName = Reflect.get(parsed, "author_name");
  const thumbnailUrl = Reflect.get(parsed, "thumbnail_url");
  return {
    title: typeof title === "string" ? title : undefined,
    author_name: typeof authorName === "string" ? authorName : undefined,
    thumbnail_url: typeof thumbnailUrl === "string" ? thumbnailUrl : undefined,
  };
}

async function fetchYoutubeOEmbed(
  videoUrl: string,
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
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const text = await readLimitedResponseText(res, OEMBED_MAX_BYTES);
    if (!text) return null;
    return parseYoutubeOEmbedResponse(text);
  } catch (err) {
    if (err instanceof Error) return null;
    return null;
  }
}

export async function resolveManualYoutubeLink(
  rawVideoUrl: string,
  options: ResolveManualYoutubeLinkOptions = {},
): Promise<ResolvedManualYoutubeLink> {
  const normalizedUrl = normalizeYoutubeVideoUrl(rawVideoUrl);
  if (normalizedUrl.error || !normalizedUrl.videoId || !normalizedUrl.url) {
    throw new Error(
      normalizedUrl.error ?? "유효한 YouTube 링크를 입력해 주세요.",
    );
  }

  const { videoId, url } = normalizedUrl;
  const inputVideoType = classifyYouTubeVideo({ videoUrl: rawVideoUrl });
  const existingVideo = await getYoutubeVideoByVideoId(videoId);
  if (existingVideo) {
    return {
      videoId,
      videoUrl: url,
      title: existingVideo.title,
      channelName: existingVideo.channel_name,
      publishedAt: existingVideo.published_at,
      thumbnailUrl: existingVideo.thumbnail_url,
      videoType: resolveManualVideoType({
        inputVideoType,
        videoId,
        existingVideoType: existingVideo.video_type,
        existingManualVideoId: options.existingManualVideoId,
        existingManualVideoType: options.existingManualVideoType,
      }),
    };
  }

  const oembed = await fetchYoutubeOEmbed(url);
  return {
    videoId,
    videoUrl: url,
    title: oembed?.title?.trim() || `YouTube 영상 ${videoId}`,
    channelName: oembed?.author_name?.trim() || "",
    publishedAt: new Date().toISOString(),
    thumbnailUrl:
      oembed?.thumbnail_url?.trim() || buildYoutubeThumbnailUrl(videoId),
    videoType: resolveManualVideoType({
      inputVideoType,
      videoId,
      existingManualVideoId: options.existingManualVideoId,
      existingManualVideoType: options.existingManualVideoType,
    }),
  };
}
