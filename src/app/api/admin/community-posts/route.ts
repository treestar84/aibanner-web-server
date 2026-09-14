import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { requireAdminRequest } from "@/lib/admin-auth";
import { isAllowedBlobImageUrl } from "@/lib/blob-image-url";

export const runtime = "nodejs";
export const revalidate = 0;

const MAX_BODY_LENGTH = 1000;
const MAX_AUTHOR_LABEL_LENGTH = 40;
const MAX_TITLE_LENGTH = 100;
const LIST_LIMIT = 100;

// 관리자가 커뮤니티 피드 전체(에디터픽 + 관리자 테스트글 + 실제 사용자 글)를
// 훑어보고 수정 대상을 고를 수 있게 하는 목록 API. /api/admin/posts/reported와
// 달리 신고 여부와 무관하게 최신순으로 전부 보여준다 — "완전 편집" UI는
// 신고되지 않은 글도 고칠 수 있어야 하기 때문. 삭제된 글(status !=
// 'visible')은 편집 대상이 아니므로 제외한다.
export async function GET(req: NextRequest) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;

    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() ?? "";

    const rows = q
      ? await sql`
          SELECT id, title_ko, body_ko, image_url, link_url, link_domain,
                 author_type, author_device_id, author_label, created_at, updated_at, version
          FROM expert_picks
          WHERE status = 'visible' AND (body_ko ILIKE ${"%" + q + "%"} OR title_ko ILIKE ${"%" + q + "%"})
          ORDER BY created_at DESC
          LIMIT ${LIST_LIMIT}
        `
      : await sql`
          SELECT id, title_ko, body_ko, image_url, link_url, link_domain,
                 author_type, author_device_id, author_label, created_at, updated_at, version
          FROM expert_picks
          WHERE status = 'visible'
          ORDER BY created_at DESC
          LIMIT ${LIST_LIMIT}
        `;

    return NextResponse.json({ items: rows, count: rows.length });
  } catch (err) {
    console.error("[/api/admin/community-posts][GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// 관리자가 "일반 사용자 글쓰기"를 테스트하기 위한 전용 엔드포인트.
//
// /api/v1/posts(POST)와 달리 requirePostToken/computeTier/canPostNow를
// 전혀 거치지 않는다 — 관리자는 기기 인증(post_token) 없이 Basic Auth로만
// 인증되므로, tier 게이트(가입 7일 미만 작성 금지, 등급별 일일 한도/쿨다운)
// 자체가 적용될 대상(device_principals 행)이 없다. 즉 "관리자를 게이트에서
// 예외 처리"한 게 아니라, 애초에 게이트가 적용되는 경로(post_token 인증)를
// 타지 않는 구조다.
//
// author_type='user'로 삽입해 공개 커뮤니티 피드(GET /api/v1/posts)에 그대로
// 노출시킨다 — 실제 사용자 글과 동일한 스키마/조회 경로를 타야 "커뮤니티
// 글쓰기 테스트"로서 의미가 있다. author_device_id는 NULL로 두고(테스트
// 글에 실제 기기를 연결할 이유가 없다) author_label에 관리자가 지정한
// 임의의 표시 이름을 저장한다 — GET /api/v1/posts는 이제
// COALESCE(dp.nickname, ep.author_label)로 닉네임을 구하므로,
// author_device_id가 NULL인 이 글도 author_label을 닉네임으로 보여준다.
export async function POST(req: NextRequest) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;

    const body = await req.json().catch(() => null);
    const bodyKo = typeof body?.body === "string" ? body.body.trim() : "";
    if (!bodyKo) return NextResponse.json({ error: "body is required" }, { status: 400 });
    if (bodyKo.length > MAX_BODY_LENGTH) {
      return NextResponse.json(
        { error: `body exceeds ${MAX_BODY_LENGTH} characters` },
        { status: 400 },
      );
    }

    // title은 선택 — 안 보내거나 빈 문자열이면 기존과 동일하게 제목 없는
    // 글로 저장된다(title_ko = NULL). PUT(수정)이 title을 지원하는 것과
    // 맞춰, 생성 시점부터 제목 있는 관리자 글도 만들 수 있게 한다.
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

    const authorLabelRaw = typeof body?.authorLabel === "string" ? body.authorLabel.trim() : "";
    if (authorLabelRaw.length > MAX_AUTHOR_LABEL_LENGTH) {
      return NextResponse.json(
        { error: `authorLabel exceeds ${MAX_AUTHOR_LABEL_LENGTH} characters` },
        { status: 400 },
      );
    }
    const authorLabel = authorLabelRaw || "관리자(테스트)";

    const rows = await sql`
      INSERT INTO expert_picks (
        title_ko, body_ko, body_ko_raw, author_type, author_device_id,
        author_label, image_url, sort_order, enabled
      )
      VALUES (
        ${titleKo}, ${bodyKo}, ${bodyKo}, 'user', NULL,
        ${authorLabel}, ${imageUrl}, 0, true
      )
      RETURNING id
    `;

    return NextResponse.json({ ok: true, id: rows[0].id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/admin/community-posts][POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
