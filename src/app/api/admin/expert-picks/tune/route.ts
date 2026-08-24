import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { tuneExpertPickBody, translateExpertPickBody } from "@/lib/expert-picks-tuning";

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
    const bodyKo = typeof body?.bodyKo === "string" ? body.bodyKo.trim() : "";
    if (!bodyKo) {
      return NextResponse.json({ error: "bodyKo is required" }, { status: 400 });
    }

    const tunedKo = await tuneExpertPickBody(bodyKo);

    if (body?.includeEnglish) {
      const { titleEn, bodyEn } = await translateExpertPickBody(tunedKo);
      return NextResponse.json({ ok: true, tunedKo, tunedTitleEn: titleEn, tunedBodyEn: bodyEn });
    }

    return NextResponse.json({ ok: true, tunedKo });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/admin/expert-picks/tune][POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
