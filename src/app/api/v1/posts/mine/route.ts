import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { mapCommunityPost, parsePositivePostId } from "@/lib/community-post";
import { requirePostToken } from "@/lib/post-token-auth";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePostToken(req);
    if (auth instanceof NextResponse) return auth;

    const cursor = req.nextUrl.searchParams.get("cursor");
    let cursorId: number | null = null;
    if (cursor !== null) {
      cursorId = parsePositivePostId(cursor);
      if (cursorId === null) {
        return NextResponse.json({ error: "cursor must be a positive integer" }, { status: 400 });
      }
    }

    const rows = await sql`
      SELECT ep.id, ep.title_ko, ep.body_ko AS body, ep.image_url, ep.link_url,
             ep.link_domain, ep.author_type,
             dp.nickname AS author_nickname,
             dp.device_id AS author_device_id,
             false AS is_admin_authored,
             ep.created_at
      FROM expert_picks ep
      JOIN device_principals dp ON dp.device_id = ep.author_device_id
      WHERE ep.author_device_id = ${auth.deviceId}
        AND ep.author_type = 'user'
        AND ep.status = 'visible'
        AND (${cursorId}::int IS NULL OR ep.id < ${cursorId}::int)
      ORDER BY ep.id DESC
      LIMIT 20
    `;

    return NextResponse.json({
      items: rows.map((row) => ({ ...mapCommunityPost(row), is_mine: true })),
    });
  } catch (err) {
    console.error("[/api/v1/posts/mine][GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
