import test from "node:test";
import assert from "node:assert/strict";
import { buildFreshness } from "./freshness";
test("scheduled freshness reports delayed data after a 15 minute grace period", () => {
  const now = new Date("2026-10-22T06:30:00Z");
  assert.equal(
    buildFreshness("2026-10-22T04:10:00Z", "2026-10-22T06:10:00Z", now)
      .scheduleStatus,
    "delayed",
  );
  assert.equal(
    buildFreshness("2026-10-22T06:10:00Z", "2026-10-23T00:10:00Z", now)
      .scheduleStatus,
    "on_schedule",
  );
  assert.equal(
    buildFreshness("invalid", undefined, now).scheduleStatus,
    "unknown",
  );
});
