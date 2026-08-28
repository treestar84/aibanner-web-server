import assert from "node:assert/strict";
import test from "node:test";
import { POINT_RULES, DAILY_POINT_CAP } from "./points-ledger";

test("individual action point/cap values match the spec table", () => {
  assert.deepEqual(POINT_RULES.attendance, { points: 5, dailyCountCap: 1 });
  assert.deepEqual(POINT_RULES.like_given, { points: 1, dailyCountCap: 5 });
  assert.deepEqual(POINT_RULES.like_received, { points: 2, dailyCountCap: 10 });
  assert.deepEqual(POINT_RULES.accurate_report, { points: 5, dailyCountCap: 2 });
  assert.deepEqual(POINT_RULES.post_survived_24h, { points: 10, dailyCountCap: 5 });
});

test("sum of per-action caps exceeds the daily total cap (forces mixing actions)", () => {
  const sumOfCaps = Object.values(POINT_RULES)
    .reduce((acc, r) => acc + r.points * r.dailyCountCap, 0);
  assert.ok(sumOfCaps > DAILY_POINT_CAP);
});
