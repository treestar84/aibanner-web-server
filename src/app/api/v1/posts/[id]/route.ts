import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { requirePostToken } from "@/lib/post-token-auth";
import { mapCommunityPost, parsePositivePostId } from "@/lib/community-post";

export const runtime = "nodejs";
export const revalidate = 0;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const postId = parsePositivePostId(id);
    if (postId === null) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const rows = await sql`
      SELECT ep.id, ep.title_ko, ep.body_ko AS body, ep.image_url, ep.link_url,
             ep.link_domain, ep.author_type,
             COALESCE(dp.nickname, ep.author_label) AS author_nickname,
             dp.device_id AS author_device_id,
             (dp.device_id IS NULL) AS is_admin_authored,
             ep.created_at
      FROM expert_picks ep
      LEFT JOIN device_principals dp ON dp.device_id = ep.author_device_id
      WHERE ep.id = ${postId}
        AND ep.author_type IN ('user', 'editor')
        AND ep.status = 'visible'
      LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    return NextResponse.json({ item: mapCommunityPost(rows[0]) });
  } catch (err) {
    console.error("[/api/v1/posts/[id]][GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// 소프트 삭제: 본인이 작성한 author_type='user' 글만 status='removed_by_author'로 전환한다.
// 'removed_by_admin'은 관리자 전용 사유이므로 여기서는 사용하지 않는다. 실제 DELETE는 절대 하지 않는다.
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requirePostToken(req);
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;
    const postId = parsePositivePostId(id);
    if (postId === null) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const result = await sql`
      UPDATE expert_picks SET status = 'removed_by_author'
      WHERE id = ${postId} AND author_device_id = ${auth.deviceId} AND author_type = 'user'
      RETURNING id
    `;
    if (result.length === 0) {
      return NextResponse.json({ error: "Post not found or not owned by this device" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/v1/posts/[id]][DELETE]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
