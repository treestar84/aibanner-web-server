import { NextRequest, NextResponse } from "next/server";
import { getLatestSnapshot, getLatestSnapshotWithKeywords } from "@/lib/db/queries";
import { parsePipelineMode } from "@/lib/pipeline/mode";
import { buildFreshness, cacheControlByMode } from "@/lib/api/freshness";
import { scheduleKstForMode } from "@/lib/pipeline/schedule";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const requestedMode = parsePipelineMode(
      req.nextUrl.searchParams.get("mode"),
      "realtime"
    );
    const snapshot =
      (await getLatestSnapshotWithKeywords(requestedMode)) ??
      (await getLatestSnapshot(requestedMode)) ??
      (await getLatestSnapshotWithKeywords()) ??
      (await getLatestSnapshot());
    if (!snapshot) {
      return NextResponse.json(
        { error: "No snapshot available yet" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        mode: snapshot.pipeline_mode,
        freshness: buildFreshness(snapshot.updated_at_utc),
        latestSnapshotId: snapshot.snapshot_id,
        updatedAt: snapshot.updated_at_utc,
        nextUpdateAt: snapshot.next_update_at_utc,
        scheduleKst: scheduleKstForMode(snapshot.pipeline_mode),
      },
      {
        headers: {
          "Cache-Control": cacheControlByMode(snapshot.pipeline_mode, "meta"),
        },
      }
    );
  } catch (err) {
    console.error("[/api/v1/meta]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
