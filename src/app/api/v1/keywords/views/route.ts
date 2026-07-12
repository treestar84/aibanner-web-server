import { NextRequest, NextResponse } from "next/server";
import { normalizeKeywordIds, trackKeywordViews } from "@/lib/keyword-view-tracking";

export const runtime = "nodejs";
export const revalidate = 0;

const MAX_BATCH_SIZE = 20;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ids: unknown = body?.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });
    }

    const validIds = normalizeKeywordIds(ids).slice(0, MAX_BATCH_SIZE);

    if (validIds.length === 0) {
      return NextResponse.json({ error: "No valid ids provided" }, { status: 400 });
    }

    const result = await trackKeywordViews(req, validIds);
    return NextResponse.json({
      ok: true,
      counted: result.counted,
      ignored: validIds.length - result.valid.length,
      trackingEnabled: result.trackingEnabled,
    });
  } catch (err) {
    console.error("[/api/v1/keywords/views]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
