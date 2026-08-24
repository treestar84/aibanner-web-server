import { NextRequest, NextResponse } from "next/server";
import { listExpertPicks, getExpertPickMaxUpdatedAt } from "@/lib/db/queries";

export const runtime = "edge";
export const revalidate = 3600;

export async function GET(req: NextRequest) {
  try {
    const lang = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "ko";

    const ifModifiedSince = req.headers.get("if-modified-since");
    const maxUpdatedAt = await getExpertPickMaxUpdatedAt();

    if (ifModifiedSince && maxUpdatedAt) {
      const clientDate = new Date(ifModifiedSince).getTime();
      const serverDate = new Date(maxUpdatedAt).getTime();
      if (!isNaN(clientDate) && serverDate <= clientDate) {
        return new NextResponse(null, { status: 304 });
      }
    }

    const rows = await listExpertPicks(true);
    const items = rows.map((r) => ({
      id: r.id,
      title: lang === "en" ? r.title_en || r.title_ko : r.title_ko,
      body: lang === "en" ? r.body_en || r.body_ko : r.body_ko,
      imageUrl: r.image_url,
      linkUrl: r.link_url,
      linkDomain: r.link_domain,
      authorLabel: r.author_label,
      viewCount: r.view_count,
      createdAt: r.created_at,
    }));

    const headers: Record<string, string> = {
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    };
    if (maxUpdatedAt) headers["Last-Modified"] = new Date(maxUpdatedAt).toUTCString();

    return NextResponse.json({ items, updatedAt: maxUpdatedAt }, { headers });
  } catch (err) {
    console.error("[/api/v1/expert-picks][GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
