import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { authorKeyFor } from "@/lib/author-key";

export const runtime = "nodejs";
export const revalidate = 60;

export async function GET(req: NextRequest) {
  try {
    const scope = req.nextUrl.searchParams.get("scope");
    if (scope !== "user" && scope !== "editor") {
      return NextResponse.json({ error: "scope must be 'user' or 'editor'" }, { status: 400 });
    }
    const limit = Math.min(Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "10", 10) || 10, 10);

    // author_nickname은 저장된 컬럼이 없다: user 글은 device_principals를 LEFT JOIN해
    // 조회 시점 닉네임을 붙인다. editor 글은 author_device_id가 NULL이라 LEFT JOIN이 아니면
    // (INNER JOIN이면) 편집자 글이 통째로 사라지므로 반드시 LEFT JOIN이어야 한다.
    const rows = await sql`
      SELECT ep.id, ep.title_ko, ep.body_ko AS body, ep.image_url, ep.link_url, ep.link_domain,
             ep.author_type, dp.nickname AS author_nickname, dp.device_id AS author_device_id,
             COALESCE(cl.like_count, 0) AS like_count
      FROM expert_picks ep
      LEFT JOIN device_principals dp ON dp.device_id = ep.author_device_id
      LEFT JOIN content_likes cl ON cl.content_type = 'expertPicks' AND cl.content_id = ep.id::text
      WHERE ep.status = 'visible' AND ep.author_type = ${scope}
      ORDER BY like_count DESC, ep.id DESC
      LIMIT ${limit}
    `;
    // editor 글은 author_device_id가 NULL이라 authorKeyFor도 null을 그대로
    // 돌려준다 — user 스코프만 실질적으로 차단 가능한 키를 받는다.
    const items = rows.map(({ author_device_id, ...rest }) => ({
      ...rest,
      author_key: authorKeyFor(author_device_id as string | null),
    }));
    return NextResponse.json({ items, scope });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/v1/posts/top][GET]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
