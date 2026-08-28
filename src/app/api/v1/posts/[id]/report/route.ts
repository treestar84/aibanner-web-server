import { NextRequest, NextResponse } from "next/server";
import { NeonDbError } from "@neondatabase/serverless";
import { sql } from "@/lib/db/client";
import { computeTier, REPORT_THRESHOLD_BY_TIER } from "@/lib/tier";
import { requirePostToken } from "@/lib/post-token-auth";

export const runtime = "nodejs";
export const revalidate = 0;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requirePostToken(req);
    if (auth instanceof NextResponse) return auth;
    const { deviceId, firstSeenAt, pointsTotal } = auth;
    // auth의 tier 필드는 device_principals에 저장된 값이라 stale할 수 있다(Task 5와 동일한 이유).
    // 신고자의 등급은 현재 시점 기준으로 다시 계산한다.
    const reporterTier = computeTier(firstSeenAt, pointsTotal);
    const countsTowardThreshold = reporterTier >= 2; // 가입 7일 미만은 로그만, 임계치 미반영

    const { id } = await params;
    const postId = Number.parseInt(id, 10);
    const post = await sql`SELECT author_type FROM expert_picks WHERE id = ${postId}`;
    if (post.length === 0) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason.slice(0, 200) : "unspecified";

    try {
      await sql`
        INSERT INTO post_reports (post_id, reporter_device_id, reason, counts_toward_threshold)
        VALUES (${postId}, ${deviceId}, ${reason}, ${countsTowardThreshold})
      `;
    } catch (err) {
      // 23505 = Postgres unique_violation. post_reports의 UNIQUE(post_id, reporter_device_id)
      // 위반일 때만 409로 응답하고, 그 외 DB 에러(커넥션 끊김 등)는 바깥쪽 catch로 다시 던져 500 처리한다.
      if (err instanceof NeonDbError && err.code === "23505") {
        return NextResponse.json({ error: "Already reported by this device" }, { status: 409 });
      }
      throw err;
    }

    const countedRows = await sql`
      SELECT COUNT(*)::int AS cnt FROM post_reports
      WHERE post_id = ${postId} AND counts_toward_threshold = true
    `;
    const countedTotal = countedRows[0]?.cnt ?? 0;

    // 글 작성자의 "작성 시점" 등급이 아니라 현재 등급 기준(단순화 — 스펙에 작성 시점 고정 요구는 없었음, 운영 편의상 현재값 사용)
    const authorRows = await sql`SELECT dp.first_seen_at, dp.points_total FROM expert_picks ep JOIN device_principals dp ON dp.device_id = ep.author_device_id WHERE ep.id = ${postId}`;
    const authorTier = authorRows.length > 0 ? computeTier(authorRows[0].first_seen_at, authorRows[0].points_total) : 2;
    const threshold = REPORT_THRESHOLD_BY_TIER[authorTier] ?? 3;

    if (countedTotal >= threshold) {
      // status = 'visible' 조건에 걸려 실제로 행이 바뀐 경우에만 moderation_log를 남긴다.
      // 이미 hidden_by_report인 글에 신고가 계속 들어오면 countedTotal >= threshold는 매번 참이 되므로,
      // RETURNING 없이 무조건 INSERT하면 전환되지 않은 매 요청마다 가짜 visible→hidden 로그가 쌓인다.
      const updated = await sql`
        UPDATE expert_picks SET status = 'hidden_by_report', report_count = ${countedTotal}
        WHERE id = ${postId} AND status = 'visible'
        RETURNING id
      `;
      if (updated.length > 0) {
        await sql`INSERT INTO moderation_log (post_id, from_status, to_status, reason, actor) VALUES (${postId}, 'visible', 'hidden_by_report', 'report_threshold', 'system')`;
      } else {
        await sql`UPDATE expert_picks SET report_count = ${countedTotal} WHERE id = ${postId}`;
      }
    } else {
      await sql`UPDATE expert_picks SET report_count = ${countedTotal} WHERE id = ${postId}`;
    }

    return NextResponse.json({ ok: true, reportCount: countedTotal, threshold });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/v1/posts/[id]/report][POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
