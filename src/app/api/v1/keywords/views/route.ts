import { NextRequest, NextResponse } from "next/server";
import { incrementKeywordViewCountBatch } from "@/lib/db/queries";

export const runtime = "nodejs";
export const revalidate = 0;

const MAX_BATCH_SIZE = 20;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ids: unknown = body?.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });
    }

    const validIds = ids
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .slice(0, MAX_BATCH_SIZE);

    if (validIds.length === 0) {
      return NextResponse.json({ error: "No valid ids provided" }, { status: 400 });
    }

    await incrementKeywordViewCountBatch(validIds);
    return NextResponse.json({ ok: true, counted: validIds.length });
  } catch (err) {
    console.error("[/api/v1/keywords/views]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
