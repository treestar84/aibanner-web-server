import { NextRequest, NextResponse } from "next/server";
import { updatePromoContent, deletePromoContent } from "@/lib/db/queries";

export const runtime = "nodejs";
export const revalidate = 0;

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const item = await updatePromoContent(id, {
      slug: typeof body.slug === "string" ? body.slug : undefined,
      tag: typeof body.tag === "string" ? body.tag : undefined,
      tagColor: typeof body.tagColor === "string" ? body.tagColor : undefined,
      titleKo: typeof body.titleKo === "string" ? body.titleKo : undefined,
      titleEn: typeof body.titleEn === "string" ? body.titleEn : undefined,
      subtitleKo: typeof body.subtitleKo === "string" ? body.subtitleKo : undefined,
      subtitleEn: typeof body.subtitleEn === "string" ? body.subtitleEn : undefined,
      bodyKo: typeof body.bodyKo === "string" ? body.bodyKo : undefined,
      bodyEn: typeof body.bodyEn === "string" ? body.bodyEn : undefined,
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : undefined,
      gradientFrom: typeof body.gradientFrom === "string" ? body.gradientFrom : undefined,
      gradientTo: typeof body.gradientTo === "string" ? body.gradientTo : undefined,
      iconName: typeof body.iconName === "string" ? body.iconName : undefined,
      linkUrl: typeof body.linkUrl === "string" ? body.linkUrl : undefined,
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    });

    if (!item) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    console.error("[/api/admin/promo-contents/[id]][PUT]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const deleted = await deletePromoContent(id);
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/admin/promo-contents/[id]][DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
