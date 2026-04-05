import { NextRequest, NextResponse } from "next/server";
import {
  getLatestSnapshot,
  getLatestSnapshotWithKeywords,
  listManualYoutubeLinks,
  getRecentYoutubeVideos,
} from "@/lib/db/queries";

export const runtime = "nodejs";
export const revalidate = 0;

function pickLatestIso(...values: Array<string | undefined>): string {
  let latest = "";
  let latestMs = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    if (!value) continue;
    const ms = new Date(value).getTime();
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latest = value;
    }
  }

  return latest;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const limit = Math.min(50, Math.max(1, parseInt(limitParam ?? "20", 10)));

    const [videos, snapshot, manualLinks] = await Promise.all([
      getRecentYoutubeVideos(limit),
      getLatestSnapshotWithKeywords("realtime").then(
        (resolved) => resolved ?? getLatestSnapshot("realtime")
      ),
      listManualYoutubeLinks(),
    ]);

    const manualItems = manualLinks.map((item) => ({
      video_id: item.video_id,
      channel_name: item.channel_name,
      title: item.title,
      thumbnail_url: item.thumbnail_url,
      video_url: item.video_url,
      published_at: item.published_at,
      view_count: null as number | null,
      like_count: null as number | null,
      is_manual: true,
    }));

    const seenVideoIds = new Set<string>();
    const mergedItems = [...manualItems, ...videos.map((video) => ({
      ...video,
      is_manual: false,
    }))].filter((item) => {
      const key = item.video_id || item.video_url;
      if (!key) return false;
      if (seenVideoIds.has(key)) return false;
      seenVideoIds.add(key);
      return true;
    }).slice(0, limit);

    const updatedAt = pickLatestIso(
      snapshot?.updated_at_utc,
      manualLinks[0]?.updated_at,
      mergedItems[0]?.published_at
    );
    const nextUpdateAt = snapshot?.next_update_at_utc ?? "";

    return NextResponse.json(
      {
        updatedAt,
        nextUpdateAt,
        items: mergedItems.map((v) => ({
          videoId: v.video_id,
          channelName: v.channel_name,
          title: v.title,
          thumbnailUrl: v.thumbnail_url,
          videoUrl: v.video_url,
          publishedAt: v.published_at,
          viewCount: v.view_count,
          likeCount: v.like_count,
          isManual: v.is_manual,
        })),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err) {
    console.error("[/api/v1/youtube/recent]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
