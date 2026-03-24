import { NextRequest, NextResponse } from "next/server";
import {
  getSnapshotCandidates,
  getRankingWeights,
  upsertRankingWeights,
  getRecentSnapshots,
  getLatestSnapshotWithKeywords,
} from "@/lib/db/queries";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const snapshotIdParam = req.nextUrl.searchParams.get("snapshotId");

    // 최근 스냅샷 목록 (드롭다운용)
    const recentSnapshots = await getRecentSnapshots(10, "realtime");

    // 대상 스냅샷 결정
    let targetSnapshotId = snapshotIdParam;
    if (!targetSnapshotId) {
      // 후보가 있는 스냅샷 찾기 (최신부터)
      for (const snap of recentSnapshots) {
        const candidates = await getSnapshotCandidates(snap.snapshot_id);
        if (candidates.length > 0) {
          targetSnapshotId = snap.snapshot_id;
          break;
        }
      }
      // 후보가 있는 스냅샷이 없으면 최신 스냅샷 사용
      if (!targetSnapshotId) {
        const latest = await getLatestSnapshotWithKeywords("realtime");
        targetSnapshotId = latest?.snapshot_id ?? null;
      }
    }

    if (!targetSnapshotId) {
      return NextResponse.json({
        candidates: [],
        weights: await getRankingWeights(),
        snapshotId: null,
        updatedAt: null,
        recentSnapshots: recentSnapshots.map((s) => ({
          snapshot_id: s.snapshot_id,
          updated_at_utc: s.updated_at_utc,
          created_at: s.created_at,
        })),
      });
    }

    const [candidates, weights] = await Promise.all([
      getSnapshotCandidates(targetSnapshotId),
      getRankingWeights(),
    ]);

    const targetSnapshot = recentSnapshots.find(
      (s) => s.snapshot_id === targetSnapshotId
    );

    return NextResponse.json({
      candidates,
      weights,
      snapshotId: targetSnapshotId,
      updatedAt: targetSnapshot?.updated_at_utc ?? null,
      recentSnapshots: recentSnapshots.map((s) => ({
        snapshot_id: s.snapshot_id,
        updated_at_utc: s.updated_at_utc,
        created_at: s.created_at,
      })),
    });
  } catch (err) {
    console.error("[/api/admin/ranking-simulator][GET]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      recency?: unknown;
      frequency?: unknown;
      authority?: unknown;
      velocity?: unknown;
      internal?: unknown;
    } | null;

    if (!body) {
      return NextResponse.json(
        { error: "Request body is required" },
        { status: 400 }
      );
    }

    const parseWeight = (value: unknown, name: string): number => {
      const num = Number(value);
      if (!Number.isFinite(num) || num < 0 || num > 1) {
        throw new Error(`${name} must be a number between 0 and 1`);
      }
      return parseFloat(num.toFixed(4));
    };

    const weights = {
      w_recency: parseWeight(body.recency, "recency"),
      w_frequency: parseWeight(body.frequency, "frequency"),
      w_authority: parseWeight(body.authority, "authority"),
      w_velocity: parseWeight(body.velocity, "velocity"),
      w_internal: parseWeight(body.internal, "internal"),
    };

    const saved = await upsertRankingWeights(weights);

    return NextResponse.json({ ok: true, weights: saved });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    const status = message.includes("must be") ? 400 : 500;
    if (status === 500) {
      console.error("[/api/admin/ranking-simulator][PUT]", err);
    }
    return NextResponse.json({ error: message }, { status });
  }
}
