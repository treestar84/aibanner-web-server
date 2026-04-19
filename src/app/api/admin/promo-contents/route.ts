import { NextRequest, NextResponse } from "next/server";
import { listPromoContents, insertPromoContent } from "@/lib/db/queries";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET() {
  try {
    const items = await listPromoContents(false);
    return NextResponse.json({ items, count: items.length });
  } catch (err) {
    console.error("[/api/admin/promo-contents][GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const titleKo = typeof body.titleKo === "string" ? body.titleKo.trim() : "";

    if (!titleKo) {
      return NextResponse.json(
        { error: "titleKo is required" },
        { status: 400 }
      );
    }

    const slug = typeof body.slug === "string" && body.slug.trim()
      ? body.slug.trim()
      : `promo-${Date.now()}`;
    const bodyKo = typeof body.bodyKo === "string" ? body.bodyKo : "";
    const subtitleKo = typeof body.subtitleKo === "string" && body.subtitleKo
      ? body.subtitleKo
      : bodyKo.trim().match(/^.+?[.!?。]\s*/)?.[0]?.trim() || bodyKo.slice(0, 80);

    const item = await insertPromoContent({
      slug,
      tag: typeof body.tag === "string" ? body.tag : "INFO",
      tagColor: typeof body.tagColor === "string" ? body.tagColor : "#7C3AED",
      titleKo,
      titleEn: typeof body.titleEn === "string" && body.titleEn ? body.titleEn : titleKo,
      subtitleKo,
      subtitleEn: typeof body.subtitleEn === "string" && body.subtitleEn ? body.subtitleEn : subtitleKo,
      bodyKo,
      bodyEn: typeof body.bodyEn === "string" && body.bodyEn ? body.bodyEn : bodyKo,
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : "",
      gradientFrom: typeof body.gradientFrom === "string" ? body.gradientFrom : "#7C3AED",
      gradientTo: typeof body.gradientTo === "string" ? body.gradientTo : "#4F46E5",
      iconName: typeof body.iconName === "string" ? body.iconName : "info",
      linkUrl: typeof body.linkUrl === "string" ? body.linkUrl : "",
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
    });

    return NextResponse.json({ ok: true, item });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/admin/promo-contents][POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
