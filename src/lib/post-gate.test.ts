import assert from "node:assert/strict";
import test from "node:test";
import { canPostNow } from "./post-gate";

test("tier 1 can never post", () => {
  assert.equal(canPostNow(1, null).allowed, false);
});

test("tier 2 must wait out the 3-day cooldown after their last post", () => {
  const now = new Date("2026-08-28T00:00:00Z");
  const postedYesterday = new Date("2026-08-27T00:00:00Z");
  const result = canPostNow(2, postedYesterday, now);
  assert.equal(result.allowed, false);
  assert.ok(result.nextAllowedAt);
});

test("tier 2 can post again once 3 full days have passed", () => {
  const now = new Date("2026-08-30T00:00:01Z");
  const postedThreeDaysAgo = new Date("2026-08-27T00:00:00Z");
  assert.equal(canPostNow(2, postedThreeDaysAgo, now).allowed, true);
});

test("tier 5 with a recent post is still allowed (per-day count is checked by the route, not here)", () => {
  const now = new Date("2026-08-28T12:00:00Z");
  const postedMinutesAgo = new Date("2026-08-28T11:00:00Z");
  assert.equal(canPostNow(5, postedMinutesAgo, now).allowed, true);
});
