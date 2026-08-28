import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { computeTier } from "@/lib/tier";
import { canPostNow } from "@/lib/post-gate";
import { requirePostToken } from "@/lib/post-token-auth";

export const runtime = "nodejs";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  const auth = await requirePostToken(req);
  if (auth instanceof NextResponse) return auth;
  const { deviceId, firstSeenAt, pointsTotal, lastPostAt, nickname } = auth;

  const tier = computeTier(firstSeenAt, pointsTotal);
  const gate = canPostNow(tier, lastPostAt);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "Posting not allowed yet", nextAllowedAt: gate.nextAllowedAt ?? null },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const bodyKo = typeof body?.body === "string" ? body.body.trim() : "";
  if (!bodyKo) return NextResponse.json({ error: "body is required" }, { status: 400 });
  if (bodyKo.length > 1000) {
    return NextResponse.json({ error: "body exceeds 1000 characters" }, { status: 400 });
  }

  // author_nickname은 저장하지 않는다: 닉네임은 device_principals에서 조회 시점에 JOIN해
  // 최신 값을 보여준다(닉네임은 7일에 1회 변경 가능하므로 게시 시점 값을 박아넣으면
  // 이후 닉네임 변경 시 옛 글에 stale한 닉네임이 남는다).
  const inserted = await sql`
    INSERT INTO expert_picks (title_ko, body_ko, body_ko_raw, author_type, author_device_id, image_url, link_url, link_domain, sort_order, enabled)
    VALUES (NULL, ${bodyKo}, ${bodyKo}, 'user', ${deviceId}, ${body?.imageUrl ?? ""}, ${body?.linkUrl ?? ""}, ${body?.linkDomain ?? ""}, 0, true)
    RETURNING id
  `;
  await sql`UPDATE device_principals SET last_post_at = NOW() WHERE device_id = ${deviceId}`;

  return NextResponse.json({ ok: true, id: inserted[0].id, nickname });
}
