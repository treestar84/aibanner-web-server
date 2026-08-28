import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { sql } from "./db/client";

export interface AuthedDevice {
  deviceId: string;
  firstSeenAt: Date;
  pointsTotal: number;
  tier: number;
  lastPostAt: Date | null;
  nickname: string;
}

// Authorization: Bearer <postToken> 헤더를 받아 해시 비교로 기기를 식별한다.
// 실패 시 NextResponse(401)를 반환하고, 성공 시 AuthedDevice를 반환한다.
// 호출부는 `const auth = await requirePostToken(req); if (auth instanceof NextResponse) return auth;`
// 패턴으로 분기한다.
export async function requirePostToken(req: NextRequest): Promise<AuthedDevice | NextResponse> {
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) {
    return NextResponse.json({ error: "Missing or malformed Authorization header" }, { status: 401 });
  }
  const postToken = match[1];
  const tokenHash = createHash("sha256").update(postToken).digest("hex");

  const rows = await sql`
    SELECT device_id, first_seen_at, points_total, tier, last_post_at, nickname,
           banned_until, banned_permanently
    FROM device_principals WHERE post_token_hash = ${tokenHash}
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Invalid or expired postToken" }, { status: 401 });
  }
  const row = rows[0];
  if (row.banned_permanently || (row.banned_until && new Date(row.banned_until) > new Date())) {
    return NextResponse.json({ error: "This device is banned" }, { status: 403 });
  }
  return {
    deviceId: row.device_id,
    firstSeenAt: new Date(row.first_seen_at),
    pointsTotal: row.points_total,
    tier: row.tier,
    lastPostAt: row.last_post_at ? new Date(row.last_post_at) : null,
    nickname: row.nickname,
  };
}
