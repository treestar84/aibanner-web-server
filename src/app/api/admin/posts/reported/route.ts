import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { requireAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;

    const items = await sql`
      SELECT id, title_ko, body_ko, author_type, author_device_id, report_count, created_at
      FROM expert_picks
      WHERE status = 'hidden_by_report'
      ORDER BY report_count DESC, created_at ASC
    `;
    return NextResponse.json({ items, count: items.length });
  } catch (err) {
    console.error("[/api/admin/posts/reported][GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
