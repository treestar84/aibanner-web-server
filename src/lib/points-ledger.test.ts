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
