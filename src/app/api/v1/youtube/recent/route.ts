import { NextRequest, NextResponse } from "next/server";
import { getRecentYoutubeVideos } from "@/lib/db/queries";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const limit = Math.min(50, Math.max(1, parseInt(limitParam ?? "20", 10)));

    const videos = await getRecentYoutubeVideos(limit);

    return NextResponse.json(
      {
        items: videos.map((v) => ({
          videoId: v.video_id,
          channelName: v.channel_name,
          title: v.title,
          thumbnailUrl: v.thumbnail_url,
          videoUrl: v.video_url,
          publishedAt: v.published_at,
          viewCount: v.view_count,
          likeCount: v.like_count,
        })),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=600, stale-while-revalidate=300",
        },
      }
    );
  } catch (err) {
    console.error("[/api/v1/youtube/recent]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
