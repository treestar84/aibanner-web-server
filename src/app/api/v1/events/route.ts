import { NextRequest, NextResponse } from "next/server";
import { parseClientMeta, parseEventItems } from "@/lib/api/client_reports";
import { recordAnalyticsEvents } from "@/lib/db/telemetry";

export const runtime = "nodejs";
export const revalidate = 0;

// 익명 애널리틱스 이벤트 배치 수신.
// 클라이언트가 이름별 카운트로 사전 집계해 보내며, 서버는 일 단위로만 저장한다
// (개별 행동 로그·타임스탬프·IP는 저장하지 않음).

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const meta = parseClientMeta(body);
    if (!meta) {
      return NextResponse.json({ error: "Invalid client meta" }, { status: 400 });
    }
    const items = parseEventItems((body as Record<string, unknown>).events);
    const accepted = await recordAnalyticsEvents(meta, items);
    return NextResponse.json({ ok: true, accepted });
  } catch (err) {
    console.error("[/api/v1/events]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
