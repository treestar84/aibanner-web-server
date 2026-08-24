import { NextRequest, NextResponse } from "next/server";
import { getExpertPickById } from "@/lib/db/queries";

export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const lang = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "ko";
    const { id: idParam } = await params;
    const id = Number.parseInt(idParam, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const item = await getExpertPickById(id);
    if (!item || !item.enabled) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: item.id,
      title: lang === "en" ? item.title_en || item.title_ko : item.title_ko,
      body: lang === "en" ? item.body_en || item.body_ko : item.body_ko,
      imageUrl: item.image_url,
      linkUrl: item.link_url,
      linkDomain: item.link_domain,
      authorLabel: item.author_label,
      viewCount: item.view_count,
      createdAt: item.created_at,
    });
  } catch (err) {
    console.error("[/api/v1/expert-picks/[id]][GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
