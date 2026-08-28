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

  // ── 경합 방지 설계 ─────────────────────────────────────────────────────
  // 예전 구현은 SELECT COUNT → SELECT SUM → INSERT를 세 번의 왕복으로 나눠서
  // 했다. 두 요청이 동시에 들어오면 둘 다 "아직 상한 안 찼다"를 읽고 둘 다
  // INSERT해서 일일 상한을 넘길 수 있었다.
  //
  // @neondatabase/serverless의 sql.transaction()은 **non-interactive**다:
  // 쿼리 배열을 한 번에 보내는 방식이라 앞 쿼리 결과를 보고 뒤 쿼리를 바꿀 수
  // 없어서, check-then-insert를 그대로 트랜잭션으로 감쌀 수 없다. 그래서
  // 카운트·합산·삽입·잔액갱신을 CTE 하나로 묶어 단일 왕복 원자 문장으로
  // 바꿨다. 이렇게 하면 왕복 사이의 긴 경합 창은 사라진다.
  //
  // 다만 단일 문장도 READ COMMITTED이라, 정확히 동시에 시작한 두 문장은
  // 서로의 미커밋 INSERT를 못 본다. 그래서 진짜 백스톱은 schema.sql의
  // 부분 UNIQUE 인덱스(uq_point_ledger_once_per_day)다 — dailyCountCap=1인
  // 액션은 (device_id, action, day_bucket) 중복 삽입 자체가 DB에서 막힌다.
  // ON CONFLICT DO NOTHING이 그 위반을 "이미 지급됨"으로 흡수한다.
  // dailyCountCap > 1인 액션(accurate_report=2, post_survived_24h=5)은
  // 행 단위 UNIQUE로 표현할 수 없어 여전히 극단적 동시성에서 1건 초과가
  // 가능하다 — 알려진 한계이고, 두 액션 모두 자체 멱등 장치가 있어
  // (post_survived_24h는 expert_picks.point_awarded_survival 플래그,
  // accurate_report는 post_reports의 UNIQUE(post_id, reporter_device_id))
  // 실제 초과 폭은 최대 1건으로 제한된다.
  const rows = (await sql`
    WITH today AS (
      SELECT
        COUNT(*) FILTER (WHERE action = ${action})::int AS action_count,
        COALESCE(SUM(points), 0)::int AS day_total
      FROM point_ledger
      WHERE device_id = ${deviceId} AND day_bucket = ${dayBucket}::date
    ),
    ins AS (
      INSERT INTO point_ledger (device_id, action, points, day_bucket)
      SELECT
        ${deviceId},
        ${action},
        LEAST(${rule.points}::int, ${DAILY_POINT_CAP}::int - t.day_total),
        ${dayBucket}::date
      FROM today t
      WHERE t.action_count < ${rule.dailyCountCap}::int
        AND t.day_total < ${DAILY_POINT_CAP}::int
      ON CONFLICT DO NOTHING
      RETURNING points
    ),
    upd AS (
      UPDATE device_principals
      SET points_total = points_total + (SELECT points FROM ins)
      WHERE device_id = ${deviceId} AND EXISTS (SELECT 1 FROM ins)
      RETURNING points_total
    )
    SELECT
      COALESCE((SELECT points FROM ins), 0)::int AS awarded,
      COALESCE(
        (SELECT points_total FROM upd),
        (SELECT points_total FROM device_principals WHERE device_id = ${deviceId}),
        0
      )::int AS new_total
  `) as { awarded: number; new_total: number }[];

  return { awarded: rows[0]?.awarded ?? 0, newTotal: rows[0]?.new_total ?? 0 };
}
