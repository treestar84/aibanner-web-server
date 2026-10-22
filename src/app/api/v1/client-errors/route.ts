import { limitedJson } from "@/lib/api/limited-json";
import { NextRequest, NextResponse } from "next/server";
import { parseClientMeta, parseErrorItems } from "@/lib/api/client_reports";
import { recordClientErrors } from "@/lib/db/telemetry";

export const runtime = "nodejs";
export const revalidate = 0;

// Flutter 앱의 크래시/에러 배치 리포트 수신.
// (fingerprint, day, app_version) 단위로 그룹 집계 — 원시 이벤트는 저장하지 않는다.

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try { body = await limitedJson(req); }
    catch { return NextResponse.json({ error: "Payload too large" }, { status: 413 }); }
    const meta = parseClientMeta(body);
    if (!meta) {
      return NextResponse.json({ error: "Invalid client meta" }, { status: 400 });
    }
    const items = parseErrorItems((body as Record<string, unknown>).errors);
    if (items.length === 0) {
      return NextResponse.json({ ok: true, accepted: 0 });
    }
    const accepted = await recordClientErrors(meta, items);
    return NextResponse.json({ ok: true, accepted });
  } catch (err) {
    console.error("[/api/v1/client-errors]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
