import { NextRequest, NextResponse } from "next/server";
import {
  getRecentYoutubeVideos,
  listManualYoutubeLinks,
  upsertManualYoutubeLink,
} from "@/lib/db/queries";
import { resolveManualYoutubeLink } from "@/lib/manual-youtube-resolver";

export const runtime = "nodejs";
export const revalidate = 0;

function parseRequiredText(
  value: unknown,
  field: string,
  maxLength: number
): { value?: string; error?: string } {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { error: `${field} is required` };
  if (text.length > maxLength) {
    return { error: `${field} must be ${maxLength} chars or fewer` };
  }
  return { value: text };
}

export async function GET() {
  try {
    const [items, recentVideos] = await Promise.all([
      listManualYoutubeLinks(),
      getRecentYoutubeVideos(24),
    ]);
    const manualVideoIds = new Set(items.map((item) => item.video_id));
    const manualByVideoId = new Map(items.map((item) => [item.video_id, item]));
    const displayItems = [
      ...items.map((item) => ({
        id: item.id,
        manual_id: item.id,
        video_id: item.video_id,
        channel_name: item.channel_name,
        title: item.title,
        thumbnail_url: item.thumbnail_url,
        video_url: item.video_url,
        published_at: item.published_at,
        source: "manual" as const,
      })),
      ...recentVideos
        .filter((video) => !manualVideoIds.has(video.video_id))
        .map((video) => ({
          id: video.id,
          manual_id: null,
          video_id: video.video_id,
          channel_name: video.channel_name,
          title: video.title,
          thumbnail_url: video.thumbnail_url,
          video_url: video.video_url,
          published_at: video.published_at,
          source: "auto" as const,
        })),
    ];

    return NextResponse.json({
      items,
      count: items.length,
      displayItems,
      recentVideos: recentVideos.map((video) => ({
        ...video,
        manual_id: manualByVideoId.get(video.video_id)?.id ?? null,
        is_in_manual_list: manualVideoIds.has(video.video_id),
      })),
    });
  } catch (err) {
    console.error("[/api/admin/manual-youtube-links][GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | {
          videoUrl?: unknown;
        }
      | null;

    const videoUrlResult = parseRequiredText(body?.videoUrl, "videoUrl", 500);
    if (videoUrlResult.error) {
      return NextResponse.json({ error: videoUrlResult.error }, { status: 400 });
    }

    const resolved = await resolveManualYoutubeLink(videoUrlResult.value ?? "");

    const item = await upsertManualYoutubeLink({
      videoId: resolved.videoId,
      videoUrl: resolved.videoUrl,
      title: resolved.title,
      channelName: resolved.channelName,
      publishedAt: resolved.publishedAt,
    });

    return NextResponse.json({ ok: true, item });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message.includes("required") || message.includes("등록된") ? 400 : 500;
    if (status === 500) {
      console.error("[/api/admin/manual-youtube-links][POST]", err);
    }
    return NextResponse.json({ error: message }, { status });
  }
}
