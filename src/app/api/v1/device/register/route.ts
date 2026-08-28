import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import { verifyIntegrityToken } from "@/lib/play-integrity";
import { sql } from "@/lib/db/client";

export const runtime = "nodejs";
export const revalidate = 0;

function generateNickname(): string {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `익명전문가${n}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
    const integrityToken = typeof body?.integrityToken === "string" ? body.integrityToken : "";
    if (!deviceId || !integrityToken) {
      return NextResponse.json({ error: "deviceId and integrityToken are required" }, { status: 400 });
    }

    const { ok, verdict } = await verifyIntegrityToken(integrityToken);
    if (!ok) {
      return NextResponse.json({ error: "Device integrity check failed", verdict }, { status: 403 });
    }

    const existing = await sql`SELECT device_id, nickname FROM device_principals WHERE device_id = ${deviceId}`;
    if (existing.length > 0) {
      // 재등록(토큰 재발급) — 닉네임은 유지, 새 postToken만 발급
      const postToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(postToken).digest("hex");
      await sql`UPDATE device_principals SET post_token_hash = ${tokenHash}, play_integrity_verdict = ${verdict} WHERE device_id = ${deviceId}`;
      return NextResponse.json({ ok: true, postToken, nickname: existing[0].nickname });
    }

    const nickname = generateNickname();
    const postToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(postToken).digest("hex");
    await sql`
      INSERT INTO device_principals (device_id, post_token_hash, nickname, play_integrity_verdict)
      VALUES (${deviceId}, ${tokenHash}, ${nickname}, ${verdict})
    `;
    return NextResponse.json({ ok: true, postToken, nickname });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/v1/device/register][POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
