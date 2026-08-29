import assert from "node:assert/strict";
import test from "node:test";
import { computeTier } from "./tier";

test("under 7 days is always tier 1 regardless of points", () => {
  const now = new Date("2026-08-28T00:00:00Z");
  const joinedYesterday = new Date("2026-08-27T00:00:00Z");
  assert.equal(computeTier(joinedYesterday, 999, now), 1);
});

test("7+ days with 0-99 points is tier 2", () => {
  const now = new Date("2026-08-28T00:00:00Z");
  const joined8DaysAgo = new Date("2026-08-20T00:00:00Z");
  assert.equal(computeTier(joined8DaysAgo, 50, now), 2);
});

test("7+ days with 700+ points is tier 5", () => {
  const now = new Date("2026-08-28T00:00:00Z");
  const joinedLongAgo = new Date("2026-01-01T00:00:00Z");
  assert.equal(computeTier(joinedLongAgo, 700, now), 5);
});
