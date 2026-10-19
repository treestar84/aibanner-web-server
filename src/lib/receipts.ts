import { sql } from "./db/client";
import {
  communityPostIdFromKey,
  generateReceiptCode,
  isValidReceiptCode,
  kstDayBucket,
  RECEIPT_DAILY_CAP,
  FLYING_SHARE_DAILY_CAP,
  type ShareChannel,
} from "./receipts-policy";

export * from "./receipts-policy";

export interface FlyingTotals {
  shares: number;
  opens: number;
  total: number;
}

export async function createReceipt(
  deviceId: string,
  body: string,
  itemCount: number,
  contentKeys: string[] = [],
  now: Date = new Date(),
): Promise<{ code: string } | { error: "daily_cap" }> {
  const dayStart = new Date(`${kstDayBucket(now)}T00:00:00+09:00`);
  const countRows = await sql`
    SELECT COUNT(*)::int AS count FROM receipts
    WHERE device_id = ${deviceId} AND created_at >= ${dayStart.toISOString()}
  `;
  if (Number(countRows[0]?.count ?? 0) >= RECEIPT_DAILY_CAP) {
    return { error: "daily_cap" };
  }
  // 코드 충돌은 사실상 없지만(56^8) UNIQUE 위반 시 한 번 더 시도한다.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateReceiptCode();
    const rows = await sql`
      INSERT INTO receipts (code, device_id, body, item_count, content_keys)
      VALUES (${code}, ${deviceId}, ${body}, ${itemCount}, ${contentKeys})
      ON CONFLICT (code) DO NOTHING
      RETURNING code
    `;
    if (rows.length > 0) return { code: rows[0].code as string };
  }
  throw new Error("Failed to allocate receipt code");
}

export interface PublicReceipt {
  id: number;
  code: string;
  body: string;
  itemCount: number;
  createdAt: string;
  openCount: number;
  contentKeys: string[];
}

export async function getReceiptByCode(code: string): Promise<PublicReceipt | null> {
  if (!isValidReceiptCode(code)) return null;
  const rows = await sql`
    SELECT r.id, r.code, r.body, r.item_count, r.created_at, r.content_keys,
           (SELECT COUNT(*)::int FROM receipt_opens o WHERE o.receipt_id = r.id) AS open_count
    FROM receipts r
    WHERE r.code = ${code}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    code: row.code,
    body: row.body,
    itemCount: Number(row.item_count),
    createdAt: new Date(row.created_at).toISOString(),
    openCount: Number(row.open_count ?? 0),
    contentKeys: Array.isArray(row.content_keys) ? row.content_keys : [],
  };
}

/// 영수증에 담긴 커뮤니티 글 중 지금은 삭제됐거나 숨김(신고·관리자 처리)
/// 상태인 항목의 순번(0부터). 공개 페이지가 그 항목을 가린다.
export async function findRemovedCommunityItems(contentKeys: string[]): Promise<Set<number>> {
  const wanted = contentKeys
    .map((key, index) => ({ index, id: communityPostIdFromKey(key) }))
    .filter((entry): entry is { index: number; id: number } => entry.id !== null);
  if (wanted.length === 0) return new Set();
  const ids = wanted.map((entry) => entry.id);
  const rows = await sql`
    SELECT id FROM expert_picks WHERE id = ANY(${ids}) AND status = 'visible'
  `;
  const visible = new Set(rows.map((row) => Number(row.id)));
  return new Set(wanted.filter((entry) => !visible.has(entry.id)).map((entry) => entry.index));
}

/// 같은 방문자는 영수증당 한 번만 센다. 새로 집계됐으면 true.
export async function recordReceiptOpen(receiptId: number, visitorHash: string): Promise<boolean> {
  const rows = await sql`
    INSERT INTO receipt_opens (receipt_id, visitor_hash)
    VALUES (${receiptId}, ${visitorHash})
    ON CONFLICT DO NOTHING
    RETURNING receipt_id
  `;
  return rows.length > 0;
}

/// 같은 콘텐츠는 하루 한 번만, 하루 최대 [FLYING_SHARE_DAILY_CAP]건까지 센다.
export async function recordFlyingShare(
  deviceId: string,
  contentKey: string,
  channel: ShareChannel,
  now: Date = new Date(),
): Promise<boolean> {
  const day = kstDayBucket(now);
  const rows = await sql`
    WITH today AS (
      SELECT COUNT(*)::int AS count FROM flying_shares
      WHERE device_id = ${deviceId} AND day_bucket = ${day}::date
    )
    INSERT INTO flying_shares (device_id, content_key, channel, day_bucket)
    SELECT ${deviceId}, ${contentKey}, ${channel}, ${day}::date
    FROM today t
    WHERE t.count < ${FLYING_SHARE_DAILY_CAP}::int
    ON CONFLICT DO NOTHING
    RETURNING device_id
  `;
  return rows.length > 0;
}

export async function getFlyingTotals(deviceId: string): Promise<FlyingTotals> {
  const rows = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM flying_shares WHERE device_id = ${deviceId}) AS shares,
      (SELECT COUNT(*)::int FROM receipt_opens o
         JOIN receipts r ON r.id = o.receipt_id
        WHERE r.device_id = ${deviceId}) AS opens
  `;
  const shares = Number(rows[0]?.shares ?? 0);
  const opens = Number(rows[0]?.opens ?? 0);
  return { shares, opens, total: shares + opens };
}
