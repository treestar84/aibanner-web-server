import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { requireAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const revalidate = 0;

interface RouteParams {
  params: Promise<{ deviceId: string }>;
}

// 밴 상태를 SET하기만 한다 — 실제 차단 판정은 이미 post-token-auth.ts의
// requirePostToken()이 매 요청마다 banned_until/banned_permanently를 확인해 처리한다(Task 5).
// 여기서 차단 로직을 다시 구현하지 않는다.
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;

    const { deviceId } = await params;

    const body = await req.json().catch(() => null);
    if (!body || typeof body.permanently !== "boolean") {
      return NextResponse.json({ error: "permanently (boolean) is required" }, { status: 400 });
    }
    const untilDays =
      typeof body.untilDays === "number" && Number.isFinite(body.untilDays) ? body.untilDays : undefined;
    const bannedUntil = untilDays !== undefined ? new Date(Date.now() + untilDays * 24 * 60 * 60 * 1000) : null;

    const result = await sql`
      UPDATE device_principals
      SET banned_permanently = ${body.permanently}, banned_until = ${bannedUntil}
      WHERE device_id = ${deviceId}
      RETURNING device_id
    `;
    if (result.length === 0) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/admin/devices/[deviceId]/ban][POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
