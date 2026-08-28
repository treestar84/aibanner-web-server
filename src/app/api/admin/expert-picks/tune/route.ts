import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { rewriteExpertPick } from "@/lib/expert-picks-tuning";

export const runtime = "nodejs";
export const revalidate = 0;

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
    const titleKo = typeof body?.titleKo === "string" ? body.titleKo.trim() : "";
    const bodyKo = typeof body?.bodyKo === "string" ? body.bodyKo.trim() : "";
    if (!titleKo || !bodyKo) {
      return NextResponse.json(
        { error: "titleKo and bodyKo are required" },
        { status: 400 },
      );
    }

    const { title: tunedTitleKo, body: tunedBodyKo } = await rewriteExpertPick(
      titleKo,
      bodyKo,
    );

    return NextResponse.json({ ok: true, tunedTitleKo, tunedBodyKo });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/admin/expert-picks/tune][POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
