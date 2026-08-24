import { NextRequest, NextResponse } from "next/server";
import { listExpertPicks, insertExpertPick } from "@/lib/db/queries";
import { requireAdminRequest } from "@/lib/admin-auth";
import { parseExpertPickPaste } from "@/lib/expert-picks-parser";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;
    const items = await listExpertPicks(false);
    return NextResponse.json({ items, count: items.length });
  } catch (err) {
    console.error("[/api/admin/expert-picks][GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // 서버가 항상 붙여넣기 원문에서 제목/링크를 재파싱한다.
    // 클라이언트가 보낸 title/linkUrl은 "관리자가 고급 설정에서 수동 보정한 값"으로만 받아들인다.
    const rawBody = typeof body.bodyKoRaw === "string" ? body.bodyKoRaw : "";
    if (!rawBody.trim()) {
      return NextResponse.json({ error: "bodyKoRaw is required" }, { status: 400 });
    }
    const parsed = parseExpertPickPaste(rawBody);
    if (!parsed.title) {
      return NextResponse.json(
        { error: "본문에서 제목으로 쓸 첫 줄을 찾을 수 없습니다" },
        { status: 400 },
      );
    }

    const titleKo = typeof body.titleKo === "string" && body.titleKo.trim()
      ? body.titleKo.trim()
      : parsed.title;
    const linkUrl = typeof body.linkUrl === "string" && body.linkUrl.trim()
      ? body.linkUrl.trim()
      : parsed.linkUrl;
    const linkDomain = typeof body.linkDomain === "string" && body.linkDomain.trim()
      ? body.linkDomain.trim()
      : parsed.linkDomain;
    // AI 튜닝을 적용한 경우에만 bodyKo가 원문과 달라진다.
    // body_ko_raw는 어떤 경우에도 붙여넣기 원문(parsed.body)으로 고정한다.
    const bodyKo = typeof body.bodyKo === "string" && body.bodyKo.trim()
      ? body.bodyKo.trim()
      : parsed.body;

    const maxSort = await listExpertPicks(false).then((items) =>
      items.length > 0 ? Math.max(...items.map((i) => i.sort_order)) : -1,
    );

    const item = await insertExpertPick({
      titleKo,
      titleEn: typeof body.titleEn === "string" ? body.titleEn : "",
      bodyKo,
      bodyEn: typeof body.bodyEn === "string" ? body.bodyEn : "",
      bodyKoRaw: parsed.body,
      aiTuned: typeof body.aiTuned === "boolean" ? body.aiTuned : false,
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : "",
      linkUrl,
      linkDomain,
      authorLabel: typeof body.authorLabel === "string" ? body.authorLabel : "",
      sortOrder: maxSort + 1,
    });

    return NextResponse.json({ ok: true, item });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/admin/expert-picks][POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
