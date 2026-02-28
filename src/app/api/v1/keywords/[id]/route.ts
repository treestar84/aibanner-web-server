import { NextRequest, NextResponse } from "next/server";
import {
  getLatestSnapshotWithKeywords,
  getSnapshotById,
  getKeywordById,
  getKeywordInLatestSnapshot,
  getSourcesByKeyword,
} from "@/lib/db/queries";
import { classifySourceCategory } from "@/lib/pipeline/source_category";

export const runtime = "nodejs";
export const revalidate = 0;

type SourceType = "news" | "social" | "data";
const SOURCE_TYPES: SourceType[] = ["news", "social", "data"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const snapshotIdParam = url.searchParams.get("snapshotId");
    const lang = url.searchParams.get("lang") === "en" ? "en" : "ko";

    let snapshotId: string;
    if (snapshotIdParam) {
      const snap = await getSnapshotById(snapshotIdParam);
      if (!snap) {
        return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
      }
      snapshotId = snap.snapshot_id;
    } else {
      const latest = await getLatestSnapshotWithKeywords();
      if (!latest) {
        return NextResponse.json(
          { error: "No snapshot available yet" },
          { status: 404 }
        );
      }
      snapshotId = latest.snapshot_id;
    }

    const keyword = snapshotIdParam
      ? await getKeywordById(id, snapshotId)
      : await getKeywordInLatestSnapshot(id);

    if (!keyword) {
      return NextResponse.json({ error: "Keyword not found" }, { status: 404 });
    }

    const sources = await getSourcesByKeyword(keyword.snapshot_id, id);

    const categorized: Record<SourceType, typeof sources> = {
      news: [],
      social: [],
      data: [],
    };
    for (const source of sources) {
      const category = classifySourceCategory(source);
      categorized[category].push(source);
    }

    const grouped = SOURCE_TYPES.map((type) => ({
      type,
      items: categorized[type]
        .map((s) => ({
          title: lang === "en"
            ? (s.title_en || s.title)
            : (s.title_ko || s.title),
          url: s.url,
          source: s.domain,
          publishedAt: s.published_at_utc,
          snippet: s.snippet ?? "",
          imageUrl: s.image_url,
        })),
    })).filter((g) => g.items.length > 0);

    return NextResponse.json(
      {
        snapshotId: keyword.snapshot_id,
        id: keyword.keyword_id,
        keyword: keyword.keyword,
        updatedAt: keyword.created_at,
        summary: lang === "en"
          ? (keyword.summary_short_en || keyword.summary_short)
          : keyword.summary_short,
        sources: grouped,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=300",
        },
      }
    );
  } catch (err) {
    console.error("[/api/v1/keywords/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
