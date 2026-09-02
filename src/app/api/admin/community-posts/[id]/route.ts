import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { requireAdminRequest } from "@/lib/admin-auth";
import { isAllowedBlobImageUrl } from "@/lib/blob-image-url";

export const runtime = "nodejs";
export const revalidate = 0;

const MAX_BODY_LENGTH = 1000;
const MAX_TITLE_LENGTH = 100;

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 관리자가 커뮤니티 피드의 글을 수정한다. 대상은 author_device_id가
// NULL인 글(에디터픽 + /api/admin/community-posts로 올린 관리자 테스트글)
// 뿐이다 — 실제 사용자가 기기로 작성한 글은 신고/차단으로만 대응하고
// 내용 자체를 관리자가 고치지 않는다(WHERE 절이 그 경계를 강제한다).
//
// 에디터픽처럼 제목이 있는 글은 title을 그대로 유지/수정할 수 있고, 원래
// 제목이 없던 관리자 테스트글도 title을 새로 붙일 수 있다 — title을 아예
// 안 보내거나 빈 문자열로 보내면 제목 없는 글로 저장된다(title_ko = NULL).
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;

    const { id } = await params;
    const postId = Number.parseInt(id, 10);
    if (!Number.isFinite(postId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const bodyKo = typeof body?.body === "string" ? body.body.trim() : "";
    if (!bodyKo) return NextResponse.json({ error: "body is required" }, { status: 400 });
    if (bodyKo.length > MAX_BODY_LENGTH) {
      return NextResponse.json(
        { error: `body exceeds ${MAX_BODY_LENGTH} characters` },
        { status: 400 },
      );
    }

    const titleRaw = typeof body?.title === "string" ? body.title.trim() : "";
    if (titleRaw.length > MAX_TITLE_LENGTH) {
      return NextResponse.json(
        { error: `title exceeds ${MAX_TITLE_LENGTH} characters` },
        { status: 400 },
      );
    }
    const titleKo = titleRaw.length > 0 ? titleRaw : null;

    const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl.trim() : "";
    if (imageUrl && !isAllowedBlobImageUrl(imageUrl)) {
      return NextResponse.json(
        { error: "imageUrl must be an image uploaded via /api/v1/posts/upload-image" },
        { status: 400 },
      );
    }
    const linkUrl = typeof body?.linkUrl === "string" ? body.linkUrl.trim() : "";
    const linkDomain = typeof body?.linkDomain === "string" ? body.linkDomain.trim() : "";

    const rows = await sql`
      UPDATE expert_picks
      SET title_ko = ${titleKo}, body_ko = ${bodyKo}, body_ko_raw = ${bodyKo},
          image_url = ${imageUrl}, link_url = ${linkUrl}, link_domain = ${linkDomain},
          updated_at = NOW(), version = version + 1
      WHERE id = ${postId} AND author_device_id IS NULL AND status = 'visible'
      RETURNING id
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Post not found, already removed, or not editable by admin" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/admin/community-posts/[id]][PUT]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// 소프트 삭제 — /api/v1/posts/[id](사용자 자진 삭제)와 동일하게 실제
// DELETE는 하지 않는다. post_reports가 expert_picks(id)를 FK로 참조하므로
// 하드 삭제하면 그 글이 신고된 적 있을 때 FK 위반이 날 수 있다.
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;

    const { id } = await params;
    const postId = Number.parseInt(id, 10);
    if (!Number.isFinite(postId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const rows = await sql`
      UPDATE expert_picks SET status = 'removed_by_admin'
      WHERE id = ${postId} AND author_device_id IS NULL AND status = 'visible'
      RETURNING id
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Post not found, already removed, or not deletable by admin" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/admin/community-posts/[id]][DELETE]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
