import { NextRequest, NextResponse } from "next/server";
import {
  getLatestSnapshot,
  getSnapshotById,
  getKeywordById,
  getKeywordInLatestSnapshot,
  getSourcesByKeyword,
} from "@/lib/db/queries";
import { cachedKeywordDetail } from "@/lib/kv/cache";

export const runtime = "nodejs";
export const revalidate = 0;

type SourceType = "news" | "web" | "video" | "image";
const SOURCE_TYPES: SourceType[] = ["news", "web", "video", "image"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const snapshotIdParam = url.searchParams.get("snapshotId");

    // snapshotId 결정
    let snapshotId: string;
    if (snapshotIdParam) {
      const snap = await getSnapshotById(snapshotIdParam);
      if (!snap) {
        return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
      }
      snapshotId = snap.snapshot_id;
    } else {
      const latest = await getLatestSnapshot();
      if (!latest) {
        return NextResponse.json(
          { error: "No snapshot available yet" },
          { status: 404 }
        );
      }
      snapshotId = latest.snapshot_id;
    }

    const data = await cachedKeywordDetail(id, snapshotId, async () => {
      const keyword = snapshotIdParam
        ? await getKeywordById(id, snapshotId)
        : await getKeywordInLatestSnapshot(id);

      if (!keyword) return null;

      const sources = await getSourcesByKeyword(snapshotId, id);

      // 타입별로 그룹핑
      const grouped = SOURCE_TYPES.map((type) => ({
        type,
        items: sources
          .filter((s) => s.type === type)
          .map((s) => ({
            title: s.title,
            url: s.url,
            source: s.domain,
            publishedAt: s.published_at_utc,
            snippet: s.snippet ?? "",
            imageUrl: s.image_url,
          })),
      })).filter((g) => g.items.length > 0);

      return {
        snapshotId: keyword.snapshot_id,
        id: keyword.keyword_id,
        keyword: keyword.keyword,
        updatedAt: keyword.created_at,
        summary: keyword.summary_short,
        sources: grouped,
      };
    });

    if (!data) {
      return NextResponse.json({ error: "Keyword not found" }, { status: 404 });
    }

    return NextResponse.json(data, {
      headers: {
        // 스냅샷 불변 → 캐시 친화적
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    console.error("[/api/v1/keywords/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
