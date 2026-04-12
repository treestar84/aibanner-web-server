import { NextRequest, NextResponse } from "next/server";
import { listPromoContents, getPromoMaxUpdatedAt } from "@/lib/db/queries";

export const runtime = "edge";
export const revalidate = 3600; // 1시간

export async function GET(req: NextRequest) {
  try {
    const lang = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "ko";

    // If-Modified-Since 체크
    const ifModifiedSince = req.headers.get("if-modified-since");
    const maxUpdatedAt = await getPromoMaxUpdatedAt();

    if (ifModifiedSince && maxUpdatedAt) {
      const clientDate = new Date(ifModifiedSince).getTime();
      const serverDate = new Date(maxUpdatedAt).getTime();
      if (!isNaN(clientDate) && serverDate <= clientDate) {
        return new NextResponse(null, { status: 304 });
      }
    }

    const rows = await listPromoContents(true);

    const items = rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      tag: r.tag,
      tagColor: r.tag_color,
      title: lang === "en" ? r.title_en : r.title_ko,
      subtitle: lang === "en" ? r.subtitle_en : r.subtitle_ko,
      body: lang === "en" ? r.body_en : r.body_ko,
      imageUrl: r.image_url,
      gradientFrom: r.gradient_from,
      gradientTo: r.gradient_to,
      iconName: r.icon_name,
      linkUrl: r.link_url,
    }));

    const headers: Record<string, string> = {
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    };
    if (maxUpdatedAt) {
      headers["Last-Modified"] = new Date(maxUpdatedAt).toUTCString();
    }

    return NextResponse.json(
      { items, updatedAt: maxUpdatedAt },
      { headers }
    );
  } catch (err) {
    console.error("[/api/v1/promos][GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
