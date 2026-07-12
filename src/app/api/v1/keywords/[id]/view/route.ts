import { NextRequest, NextResponse } from "next/server";
import { normalizeKeywordIds, trackKeywordViews } from "@/lib/keyword-view-tracking";

export const runtime = "nodejs";
export const revalidate = 0;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const keywordId = normalizeKeywordIds([id])[0];

    if (!keywordId) {
      return NextResponse.json({ error: "keyword id is required" }, { status: 400 });
    }

    const result = await trackKeywordViews(req, [keywordId]);
    if (result.valid.length === 0) {
      return NextResponse.json({ error: "Keyword not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      keywordId: result.valid[0],
      counted: result.counted,
      trackingEnabled: result.trackingEnabled,
    });
  } catch (err) {
    console.error("[/api/v1/keywords/:id/view]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
