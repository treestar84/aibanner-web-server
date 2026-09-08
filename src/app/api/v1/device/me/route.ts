import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { requirePostToken } from "@/lib/post-token-auth";
import { computeTier, daysSince, TIER_POINT_THRESHOLDS } from "@/lib/tier";
import { awardPoints } from "@/lib/points-ledger";
import { kstMidnightUtc, postingAvailability } from "@/lib/posting-availability";

export const runtime = "nodejs";
export const revalidate = 0;

// 앱이 세션 시작(앱 오픈)마다 호출하는 것을 전제로 attendance 포인트를 적립한다.
// awardPoints는 point_ledger의 dailyCountCap(=1)로 하루 1회만 적립되도록 자체 방어하므로,
// 여기서는 별도 멱등성 체크 없이 매 호출마다 무조건 호출한다 — 이미 오늘 적립했다면 no-op.
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePostToken(req);
    if (auth instanceof NextResponse) return auth;

    // awardPoints가 적립(혹은 이미 오늘 적립되어 no-op) 후의 최신 points_total을 돌려주므로,
    // requirePostToken 시점의 stale한 auth.pointsTotal 대신 이 값을 신뢰한다.
    const { newTotal } = await awardPoints(auth.deviceId, "attendance");

    const now = new Date();
    const tier = computeTier(auth.firstSeenAt, newTotal, now);
    const nextThreshold = TIER_POINT_THRESHOLDS[tier] ?? null; // tier가 5면 null(최고 등급)
    const todayStart = kstMidnightUtc(now);
    const countRows = await sql`
      SELECT COUNT(*)::int AS post_count
      FROM expert_picks
      WHERE author_device_id = ${auth.deviceId}
        AND author_type = 'user'
        AND created_at >= ${todayStart.toISOString()}
    `;
    const availability = postingAvailability(
      auth.firstSeenAt,
      tier,
      auth.lastPostAt,
      Number(countRows[0]?.post_count ?? 0),
      now,
    );

    return NextResponse.json({
      nickname: auth.nickname,
      tier,
      pointsTotal: newTotal,
      pointsToNextTier: nextThreshold !== null ? Math.max(0, nextThreshold - newTotal) : 0,
      joinedDaysAgo: daysSince(auth.firstSeenAt, now),
      ...availability,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/v1/device/me][GET]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
