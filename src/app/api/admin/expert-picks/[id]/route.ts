import { NextRequest, NextResponse } from "next/server";
import { updateExpertPick, deleteExpertPick } from "@/lib/db/queries";
import { requireAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const revalidate = 0;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;

    const { id: idParam } = await params;
    const id = Number.parseInt(idParam, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body.expectedUpdatedAt !== "string") {
      return NextResponse.json(
        { error: "expectedUpdatedAt is required for optimistic locking" },
        { status: 400 },
      );
    }

    const result = await updateExpertPick(id, body.expectedUpdatedAt, {
      titleKo: typeof body.titleKo === "string" ? body.titleKo : undefined,
      titleEn: typeof body.titleEn === "string" ? body.titleEn : undefined,
      bodyKo: typeof body.bodyKo === "string" ? body.bodyKo : undefined,
      bodyEn: typeof body.bodyEn === "string" ? body.bodyEn : undefined,
      aiTuned: typeof body.aiTuned === "boolean" ? body.aiTuned : undefined,
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : undefined,
      linkUrl: typeof body.linkUrl === "string" ? body.linkUrl : undefined,
      linkDomain: typeof body.linkDomain === "string" ? body.linkDomain : undefined,
      authorLabel: typeof body.authorLabel === "string" ? body.authorLabel : undefined,
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    });

    if (result === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (result === "conflict") {
      return NextResponse.json(
        { error: "다른 곳에서 먼저 수정되었습니다. 최신 내용을 다시 불러온 뒤 재시도하세요." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, item: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/admin/expert-picks/[id]][PUT]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;

    const { id: idParam } = await params;
    const id = Number.parseInt(idParam, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const deleted = await deleteExpertPick(id);
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/admin/expert-picks/[id]][DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
