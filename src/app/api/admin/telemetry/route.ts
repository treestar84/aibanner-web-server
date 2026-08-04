import { NextRequest, NextResponse } from "next/server";
import { getTelemetrySummary } from "@/lib/db/telemetry";

export const runtime = "nodejs";
export const revalidate = 0;

// 관리자 전용 (미들웨어 Basic Auth 뒤). 에러 그룹/이벤트 집계/DAU 요약 조회.
//   curl -u admin:*** "https://<host>/api/admin/telemetry?days=14"

export async function GET(req: NextRequest) {
  try {
    const daysParam = new URL(req.url).searchParams.get("days");
    const days = Math.min(90, Math.max(1, Number.parseInt(daysParam ?? "14", 10) || 14));
    const summary = await getTelemetrySummary(days);
    return NextResponse.json({ days, ...summary });
  } catch (err) {
    console.error("[/api/admin/telemetry]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
