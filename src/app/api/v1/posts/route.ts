import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { computeTier, POST_FREQUENCY_BY_TIER } from "@/lib/tier";
import { canPostNow } from "@/lib/post-gate";
import { requirePostToken } from "@/lib/post-token-auth";

export const runtime = "nodejs";
export const revalidate = 0;

// points-ledger.ts의 kstDayBucket과 같은 이유: 서버는 UTC로 동작하므로 "오늘"을
// KST 기준으로 판정하려면 KST 자정에 해당하는 UTC 시각을 직접 계산해야 한다.
function kstMidnightUtc(now: Date): Date {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const kstMidnightMs =
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 60 * 60 * 1000;
  return new Date(kstMidnightMs);
}

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

  // canPostNow는 쿨다운 없는 등급(3~5)에 대해 시각 비교만 하고 오늘자 개수는 보지 않는다.
  // 여기서 오늘(KST) expert_picks INSERT 수를 다시 세어 perDay 상한을 강제한다.
  const freq = POST_FREQUENCY_BY_TIER[tier];
  if (freq.cooldownDays === 0 && freq.perDay > 0) {
    const todayStart = kstMidnightUtc(new Date());
    const todayCountRows = await sql`
      SELECT COUNT(*)::int AS cnt FROM expert_picks
      WHERE author_device_id = ${deviceId}
        AND author_type = 'user'
        AND created_at >= ${todayStart.toISOString()}
    `;
    const todayCount = todayCountRows[0]?.cnt ?? 0;
    if (todayCount >= freq.perDay) {
      return NextResponse.json(
        { error: "Daily post limit reached for your tier", perDay: freq.perDay },
        { status: 429 },
      );
    }
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

export async function GET(req: NextRequest) {
  const cursor = req.nextUrl.searchParams.get("cursor");
  const cursorId = cursor ? Number.parseInt(cursor, 10) : null;
  const rows = await sql`
    SELECT ep.id, ep.body_ko AS body, ep.image_url, ep.link_url, ep.link_domain,
           dp.nickname AS author_nickname, ep.created_at
    FROM expert_picks ep
    JOIN device_principals dp ON dp.device_id = ep.author_device_id
    WHERE ep.author_type = 'user' AND ep.status = 'visible'
      AND (${cursorId}::int IS NULL OR ep.id < ${cursorId}::int)
    ORDER BY ep.id DESC
    LIMIT 20
  `;
  return NextResponse.json({ items: rows });
}
