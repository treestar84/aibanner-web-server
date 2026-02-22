import { NextResponse } from "next/server";
import { getLatestSnapshot } from "@/lib/db/queries";
import { cachedMeta } from "@/lib/kv/cache";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET() {
  try {
    const data = await cachedMeta(async () => {
      const snapshot = await getLatestSnapshot();
      if (!snapshot) {
        return null;
      }
      return {
        latestSnapshotId: snapshot.snapshot_id,
        updatedAt: snapshot.updated_at_utc,
        nextUpdateAt: snapshot.next_update_at_utc,
        scheduleKst: ["09:00", "12:00", "18:00", "21:00"],
      };
    });

    if (!data) {
      return NextResponse.json(
        { error: "No snapshot available yet" },
        { status: 404 }
      );
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
      },
    });
  } catch (err) {
    console.error("[/api/v1/meta]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
