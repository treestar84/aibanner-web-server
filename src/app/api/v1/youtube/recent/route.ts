import { NextRequest, NextResponse } from "next/server";
import {
  getLatestSnapshot,
  getLatestSnapshotWithKeywords,
  listManualYoutubeLinks,
  getRecentYoutubeVideos,
} from "@/lib/db/queries";
import {
  isVisibleForYouTubeFilter,
  parseYouTubeVideoFilter,
  parseYouTubeRecentLimit,
} from "@/lib/youtube-video-type";

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
    const limit = parseYouTubeRecentLimit(url.searchParams.get("limit"));
    const filter = parseYouTubeVideoFilter(url.searchParams.get("type"));

    const [videos, snapshot, manualLinks] = await Promise.all([
      getRecentYoutubeVideos(limit, filter),
      getLatestSnapshotWithKeywords("realtime").then(
        (resolved) => resolved ?? getLatestSnapshot("realtime"),
      ),
      listManualYoutubeLinks(),
    ]);

    const manualItems = manualLinks
      .map((item) => ({
        video_id: item.video_id,
        channel_name: item.channel_name,
        title: item.title,
        thumbnail_url: item.thumbnail_url,
        video_url: item.video_url,
        published_at: item.published_at,
        view_count: null as number | null,
        like_count: null as number | null,
        duration_seconds: null as number | null,
        video_type: item.video_type,
        is_manual: true,
      }))
      .filter((item) => isVisibleForYouTubeFilter(item.video_type, filter));

    const seenVideoIds = new Set<string>();
    const mergedItems = [
      ...manualItems,
      ...videos.map((video) => ({
        ...video,
        is_manual: false,
      })),
    ]
      .filter((item) => {
        const key = item.video_id || item.video_url;
        if (!key) return false;
        if (seenVideoIds.has(key)) return false;
        seenVideoIds.add(key);
        return true;
      })
      .slice(0, limit);

    const updatedAt = pickLatestIso(
      snapshot?.updated_at_utc,
      manualLinks[0]?.updated_at,
      mergedItems[0]?.published_at,
    );
    const nextUpdateAt = snapshot?.next_update_at_utc ?? "";

    return NextResponse.json(
      {
        updatedAt,
        nextUpdateAt,
        type: filter,
        items: mergedItems.map((v) => ({
          videoId: v.video_id,
          channelName: v.channel_name,
          title: v.title,
          thumbnailUrl: v.thumbnail_url,
          videoUrl: v.video_url,
          publishedAt: v.published_at,
          viewCount: v.view_count,
          likeCount: v.like_count,
          durationSeconds: v.duration_seconds,
          videoType: v.video_type,
          isManual: v.is_manual,
        })),
      },
      {
        headers: {
          // 스냅샷 주기(하루 4회)로만 바뀌는 데이터 — trends와 동일하게 CDN 캐시 허용
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=15",
          "CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=15",
        },
      },
    );
  } catch (err) {
    console.error("[/api/v1/youtube/recent]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
