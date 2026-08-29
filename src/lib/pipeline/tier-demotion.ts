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
export async function runPostSurvivalPointsBatch(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const rows = await sql`
    SELECT id, author_device_id FROM expert_picks
    WHERE author_type = 'user' AND status = 'visible' AND point_awarded_survival = FALSE
      AND created_at <= ${cutoff}
      AND author_device_id IS NOT NULL
  `;

  for (const row of rows) {
    await awardPoints(row.author_device_id as string, "post_survived_24h", now);
    // 지급 여부와 무관하게 플래그를 세운다 — points-ledger.ts의 일일/액션 상한에
    // 걸려 실제로는 0점이 지급됐더라도, 이 플래그는 "같은 글을 다시 처리하지
    // 않는다"는 의미이지 "포인트를 다시 받을 수 있다"는 의미가 아니다.
    await sql`
      UPDATE expert_picks SET point_awarded_survival = TRUE WHERE id = ${row.id}
    `;
  }

  return rows.length;
}
