import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { rewriteCommunityPost } from "@/lib/expert-picks-tuning";

export const runtime = "nodejs";
export const revalidate = 0;

// /api/admin/expert-picks/tune의 본문 전용(제목 없음) 버전. 커뮤니티 글은
// title_ko가 없으므로 rewriteExpertPick(titleKo 필수)을 재사용할 수 없어
// 별도 함수(rewriteCommunityPost)를 쓴다.
export async function POST(req: NextRequest) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "AI tuning is not configured on server" },
        { status: 503 },
      );
    }

    const body = await req.json().catch(() => null);
    const bodyKo = typeof body?.body === "string" ? body.body.trim() : "";
    if (!bodyKo) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }

    const { body: tunedBody } = await rewriteCommunityPost(bodyKo);

    return NextResponse.json({ ok: true, tunedBody });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/admin/community-posts/tune][POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
