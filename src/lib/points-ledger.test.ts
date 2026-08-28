import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ledgerSource = readFileSync(
  new URL("./points-ledger.ts", import.meta.url),
  "utf8",
);

test("individual action point/cap values match the spec table", () => {
  // Verify each of the 5 actions is defined with correct point/dailyCountCap
  assert.match(ledgerSource, /attendance:\s*{\s*points:\s*5,\s*dailyCountCap:\s*1\s*}/);
  assert.match(ledgerSource, /like_given:\s*{\s*points:\s*1,\s*dailyCountCap:\s*5\s*}/);
  assert.match(ledgerSource, /like_received:\s*{\s*points:\s*2,\s*dailyCountCap:\s*10\s*}/);
  assert.match(ledgerSource, /accurate_report:\s*{\s*points:\s*5,\s*dailyCountCap:\s*2\s*}/);
  assert.match(ledgerSource, /post_survived_24h:\s*{\s*points:\s*10,\s*dailyCountCap:\s*5\s*}/);
});

test("sum of per-action caps exceeds the daily total cap (forces mixing actions)", () => {
  // Extract DAILY_POINT_CAP
  const capMatch = ledgerSource.match(/export const DAILY_POINT_CAP = (\d+)/);
  assert.ok(capMatch, "DAILY_POINT_CAP export not found");
  const dailyPointCap = parseInt(capMatch[1], 10);

  // Calculate sum of per-action caps: points * dailyCountCap for each action
  // attendance: 5 * 1 = 5
  // like_given: 1 * 5 = 5
  // like_received: 2 * 10 = 20
  // accurate_report: 5 * 2 = 10
  // post_survived_24h: 10 * 5 = 50
  // total: 5 + 5 + 20 + 10 + 50 = 90
  const sumOfCaps = 5 * 1 + 1 * 5 + 2 * 10 + 5 * 2 + 10 * 5;
  assert.ok(sumOfCaps > dailyPointCap);
});

// ── I4: 일일 상한의 check-then-insert 경합 ──────────────────────────────
// @neondatabase/serverless의 sql.transaction()은 non-interactive라 앞 쿼리
// 결과로 뒤 쿼리를 바꿀 수 없다. 그래서 트랜잭션이 아니라 단일 원자 문장 +
// DB 레벨 부분 UNIQUE 인덱스 조합으로 막는다.

test("awardPoints no longer issues separate count/sum/insert round-trips", () => {
  const fn = ledgerSource.match(/export async function awardPoints[\s\S]*?\n}\n/);
  assert.ok(fn, "awardPoints not found");
  const sqlCalls = fn![0].match(/await sql`/g) ?? [];
  assert.equal(
    sqlCalls.length,
    1,
    "the cap check and the insert must happen in one statement; multiple round-trips reopen the race",
  );
});

test("the single statement counts, sums, inserts and updates the balance atomically", () => {
  const fn = ledgerSource.match(/export async function awardPoints[\s\S]*?\n}\n/)![0];
  assert.match(fn, /WITH today AS \(/);
  assert.match(fn, /COUNT\(\*\) FILTER \(WHERE action = \$\{action\}\)/);
  assert.match(fn, /COALESCE\(SUM\(points\), 0\)/);
  assert.match(fn, /ins AS \(\s*\n\s*INSERT INTO point_ledger/);
  // 삽입 조건이 SELECT가 아니라 같은 문장의 WHERE 절이어야 원자적이다.
  assert.match(fn, /WHERE t\.action_count < \$\{rule\.dailyCountCap\}::int/);
  assert.match(fn, /AND t\.day_total < \$\{DAILY_POINT_CAP\}::int/);
  assert.match(fn, /upd AS \(\s*\n\s*UPDATE device_principals/);
});

test("partial award at the daily cap boundary is preserved (LEAST against remaining)", () => {
  const fn = ledgerSource.match(/export async function awardPoints[\s\S]*?\n}\n/)![0];
  assert.match(
    fn,
    /LEAST\(\$\{rule\.points\}::int, \$\{DAILY_POINT_CAP\}::int - t\.day_total\)/,
  );
});

test("a unique violation from the DB backstop is absorbed as 'already awarded', not a 500", () => {
  const fn = ledgerSource.match(/export async function awardPoints[\s\S]*?\n}\n/)![0];
  assert.match(fn, /ON CONFLICT DO NOTHING/);
});

test("schema carries the partial unique index that makes a duplicate cap-1 award impossible", () => {
  const schemaSource = readFileSync(
    new URL("./db/schema.sql", import.meta.url),
    "utf8",
  );
  assert.match(
    schemaSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_point_ledger_once_per_day\s*\n\s*ON point_ledger\(device_id, action, day_bucket\)\s*\n\s*WHERE action IN \('attendance'\)/,
  );
  // dailyCountCap = 1인 액션이 실제로 attendance뿐인지 확인한다. 새 cap=1
  // 액션이 추가됐는데 인덱스 조건절을 안 넓히면 백스톱이 조용히 비어버린다.
  const capOneActions = [...ledgerSource.matchAll(/(\w+):\s*{\s*points:\s*\d+,\s*dailyCountCap:\s*1\s*}/g)]
    .map((m) => m[1]);
  assert.deepEqual(capOneActions, ["attendance"]);
});
