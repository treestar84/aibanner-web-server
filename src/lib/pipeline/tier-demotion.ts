import { sql } from "../db/client";
import { awardPoints } from "../points-ledger";

// 최근 30일 활동(게시/좋아요/신고 등 point_ledger 기록)이 없고, 등급을
// 얻은 지 2주가 지난 기기를 한 단계 강등한다. 호출부는
// src/app/api/cron/snapshot/route.ts — retention과 같은 하루 1회
// (UTC 00:10 = KST 09:10) 패스에서만 돈다.
export async function runTierDemotionBatch(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const result = await sql`
    UPDATE device_principals
    SET tier = GREATEST(tier - 1, 2)
    WHERE tier > 2
      AND created_at < ${new Date(now.getTime() - 14 * 86_400_000).toISOString()}
      AND device_id NOT IN (
        SELECT DISTINCT device_id FROM point_ledger WHERE created_at > ${cutoff}
      )
    RETURNING device_id
  `;
  return result.length;
}

// 게시 후 24시간이 지난 사용자 글 중 아직 status='visible'(신고로 안 지워짐)인
// 글의 작성자에게 post_survived_24h 포인트를 지급한다. 이미 지급한 글에
// 중복 지급하지 않도록 posts 테이블에 별도 플래그가 없으므로, expert_picks에
// point_awarded_survival BOOLEAN DEFAULT FALSE 컬럼을 하나 추가해 지급 여부를
// 표시한다(멱등성 보장 — 크론이 여러 번 돌아도 중복 지급 안 됨).
//
// 2026-09-13 스케일 점검 이후 재작성: 원래는 건마다 "지급 → 플래그 세우기"를
// 순차로(await 루프) 돌았다. 사용자 글이 많아지면 이 순차 왕복 누적이 같은
// 함수 안에서 도는 트렌드 갱신 크론의 maxDuration=300을 잠식해, 최악의 경우
// 트렌드 갱신 자체가 타임아웃으로 실패할 수 있었다. 세 가지를 바꿨다:
//
// 1) LIMIT + ORDER BY created_at ASC — 한 번에 처리할 건수를 상한선 아래로
//    묶는다. 상한을 넘는 나머지는 point_awarded_survival이 FALSE로 남아
//    다음 크론(몇 시간 후)에서 오래된 순서대로 마저 처리된다. "24시간 생존
//    보상"은 초 단위 정확도가 필요 없는 보상이라 몇 시간 지연은 무해하다.
// 2) 서로 다른 기기(device_id)는 완전히 독립적이라 동시에 처리해도 안전하다
//    (awardPoints의 원자적 CTE가 device_id로 스코프됨 — points-ledger.ts
//    참고). 같은 기기가 배치 안에 여러 건 있는 경우만 기기별로 묶어 순차
//    처리해, "정확히 동시에 시작한 두 문장은 서로의 커밋을 못 본다"는 좁은
//    경합 창을 피한다.
// 3) "지급 → 플래그" 순서를 "플래그 선점(원자적 UPDATE...RETURNING) → 지급"
//    으로 뒤집었다. 원래 순서는 지급 성공 후 플래그 UPDATE가 실패하면 같은
//    글이 다음 실행에서 다시 지급 대상이 될 수 있었다(중복 지급 위험).
//    뒤집으면 최악의 경우에도 "이 글은 포인트를 못 받는다"에 그친다 —
//    보상 지급에서는 중복 지급보다 훨씬 안전한 실패 모드다. 한 건이
//    실패해도(claim 실패든 지급 실패든) try/catch로 흡수해 같은 배치의
//    다른 글/기기 처리를 막지 않는다.
const SURVIVAL_BATCH_LIMIT = 200;
const SURVIVAL_CONCURRENCY = 10;

type SurvivalRow = { id: unknown; author_device_id: unknown };

export async function runPostSurvivalPointsBatch(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const rows = (await sql`
    SELECT id, author_device_id FROM expert_picks
    WHERE author_type = 'user' AND status = 'visible' AND point_awarded_survival = FALSE
      AND created_at <= ${cutoff}
      AND author_device_id IS NOT NULL
    ORDER BY created_at ASC
    LIMIT ${SURVIVAL_BATCH_LIMIT}
  `) as SurvivalRow[];

  const rowsByDevice = new Map<string, SurvivalRow[]>();
  for (const row of rows) {
    const deviceId = row.author_device_id as string;
    const bucket = rowsByDevice.get(deviceId);
    if (bucket) bucket.push(row);
    else rowsByDevice.set(deviceId, [row]);
  }

  async function processRow(row: SurvivalRow): Promise<void> {
    try {
      const claimed = await sql`
        UPDATE expert_picks
        SET point_awarded_survival = TRUE
        WHERE id = ${row.id} AND point_awarded_survival = FALSE
        RETURNING id
      `;
      if (claimed.length === 0) return; // 다른 실행이 이미 선점(정상적인 동시성 방어)
      await awardPoints(row.author_device_id as string, "post_survived_24h", now);
    } catch (err) {
      console.error(
        `[runPostSurvivalPointsBatch] failed for expert_picks.id=${row.id}:`,
        err
      );
    }
  }

  async function processDeviceRowsSequentially(deviceRows: SurvivalRow[]): Promise<void> {
    for (const row of deviceRows) {
      await processRow(row);
    }
  }

  const deviceBuckets = Array.from(rowsByDevice.values());
  for (let i = 0; i < deviceBuckets.length; i += SURVIVAL_CONCURRENCY) {
    const chunk = deviceBuckets.slice(i, i + SURVIVAL_CONCURRENCY);
    await Promise.all(chunk.map(processDeviceRowsSequentially));
  }

  return rows.length;
}
