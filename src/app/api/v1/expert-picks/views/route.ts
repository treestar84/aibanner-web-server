import { NextRequest, NextResponse } from "next/server";
import { normalizeExpertPickIds, trackExpertPickViews } from "@/lib/expert-pick-view-tracking";

export const runtime = "nodejs";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ids: unknown = body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });
    }

    const validIds = normalizeExpertPickIds(ids);
    if (validIds.length === 0) {
      return NextResponse.json({ error: "No valid ids provided" }, { status: 400 });
    }

    const result = await trackExpertPickViews(req, validIds);
    return NextResponse.json({
      ok: true,
      counted: result.counted,
      ignored: validIds.length - result.valid.length,
      trackingEnabled: result.trackingEnabled,
    });
  } catch (err) {
    console.error("[/api/v1/expert-picks/views]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
