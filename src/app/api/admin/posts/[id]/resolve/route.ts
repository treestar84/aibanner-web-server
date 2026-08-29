import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { requireAdminRequest } from "@/lib/admin-auth";
import { awardPoints } from "@/lib/points-ledger";

export const runtime = "nodejs";
export const revalidate = 0;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;

    const { id: idParam } = await params;
    const postId = Number.parseInt(idParam, 10);
    if (!Number.isFinite(postId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const action = body?.action;
    if (action !== "remove" && action !== "restore") {
      return NextResponse.json({ error: "action must be 'remove' or 'restore'" }, { status: 400 });
    }

    const postRows = await sql`SELECT id, status FROM expert_picks WHERE id = ${postId}`;
    if (postRows.length === 0) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    const fromStatus = postRows[0].status as string;

    if (action === "remove") {
      await sql`UPDATE expert_picks SET status = 'removed_by_admin' WHERE id = ${postId}`;
      await sql`
        INSERT INTO moderation_log (post_id, from_status, to_status, reason, actor)
        VALUES (${postId}, ${fromStatus}, 'removed_by_admin', 'admin_review', 'admin')
      `;

      // 신고가 정확했음이 확인됐으므로, 이 글을 counts_toward_threshold=true로 신고한
      // 모든 기기에 accurate_report 포인트를 지급한다. awardPoints 자체의 일일 카운트 상한
      // (2회/일)이 대량 신고를 통한 포인트 파밍을 막아주므로 여기서 별도 방어는 불필요하다.
      const reporterRows = await sql`
        SELECT reporter_device_id FROM post_reports
        WHERE post_id = ${postId} AND counts_toward_threshold = true
      `;
      for (const row of reporterRows) {
        await awardPoints(row.reporter_device_id as string, "accurate_report");
      }
    } else {
      await sql`UPDATE expert_picks SET status = 'visible' WHERE id = ${postId}`;
      await sql`
        INSERT INTO moderation_log (post_id, from_status, to_status, reason, actor)
        VALUES (${postId}, ${fromStatus}, 'visible', 'admin_review', 'admin')
      `;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/admin/posts/[id]/resolve][POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
