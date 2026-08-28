import { sql } from "./db/client"; // 기존 Neon 커넥션 헬퍼 재사용

export const POINT_RULES: Record<string, { points: number; dailyCountCap: number }> = {
  attendance: { points: 5, dailyCountCap: 1 },
  like_given: { points: 1, dailyCountCap: 5 },
  like_received: { points: 2, dailyCountCap: 10 },
  accurate_report: { points: 5, dailyCountCap: 2 },
  post_survived_24h: { points: 10, dailyCountCap: 5 },
};

export const DAILY_POINT_CAP = 40;

function kstDayBucket(date: Date): string {
  // KST(UTC+9) 기준 날짜 문자열(YYYY-MM-DD) — 서버는 UTC로 동작하므로 9시간 보정 후 날짜만 추출
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export async function awardPoints(
  deviceId: string,
  action: keyof typeof POINT_RULES,
  now: Date = new Date(),
): Promise<{ awarded: number; newTotal: number }> {
  const rule = POINT_RULES[action];
  if (!rule) throw new Error(`Unknown point action: ${action}`);
  const dayBucket = kstDayBucket(now);

  // 오늘 이미 이 액션으로 몇 번 적립했는지 카운트
  const countRows = await sql`
    SELECT COUNT(*)::int AS cnt FROM point_ledger
    WHERE device_id = ${deviceId} AND action = ${action} AND day_bucket = ${dayBucket}
  `;
  const actionCountToday = countRows[0]?.cnt ?? 0;
  if (actionCountToday >= rule.dailyCountCap) {
    return { awarded: 0, newTotal: await getPointsTotal(deviceId) };
  }

  // 오늘 전체 합산 상한 확인
  const sumRows = await sql`
    SELECT COALESCE(SUM(points), 0)::int AS total FROM point_ledger
    WHERE device_id = ${deviceId} AND day_bucket = ${dayBucket}
  `;
  const todayTotal = sumRows[0]?.total ?? 0;
  const remaining = DAILY_POINT_CAP - todayTotal;
  if (remaining <= 0) {
    return { awarded: 0, newTotal: await getPointsTotal(deviceId) };
  }

  const awarded = Math.min(rule.points, remaining);
  await sql`
    INSERT INTO point_ledger (device_id, action, points, day_bucket)
    VALUES (${deviceId}, ${action}, ${awarded}, ${dayBucket})
  `;
  await sql`
    UPDATE device_principals SET points_total = points_total + ${awarded}
    WHERE device_id = ${deviceId}
  `;
  return { awarded, newTotal: await getPointsTotal(deviceId) };
}

async function getPointsTotal(deviceId: string): Promise<number> {
  const rows = await sql`SELECT points_total FROM device_principals WHERE device_id = ${deviceId}`;
  return rows[0]?.points_total ?? 0;
}
