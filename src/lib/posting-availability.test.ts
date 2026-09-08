import assert from "node:assert/strict";
import test from "node:test";
import { kstMidnightUtc, postingAvailability } from "./posting-availability";

test("KST day starts at the preceding 15:00 UTC", () => {
  assert.equal(
    kstMidnightUtc(new Date("2026-09-05T14:59:59Z")).toISOString(),
    "2026-09-04T15:00:00.000Z",
  );
  assert.equal(
    kstMidnightUtc(new Date("2026-09-05T15:00:00Z")).toISOString(),
    "2026-09-05T15:00:00.000Z",
  );
});

test("tier 1 exposes the exact seven-day posting-ready timestamp", () => {
  const result = postingAvailability(
    new Date("2026-09-01T03:04:05Z"),
    1,
    null,
    0,
    new Date("2026-09-05T00:00:00Z"),
  );

  assert.deepEqual(result, {
    canPost: false,
    nextAllowedAt: "2026-09-08T03:04:05.000Z",
    postsRemainingToday: 0,
    perDay: 0,
  });
});

test("daily exhaustion uses next KST midnight while preserving the tier limit", () => {
  const result = postingAvailability(
    new Date("2026-01-01T00:00:00Z"),
    4,
    null,
    2,
    new Date("2026-09-05T14:00:00Z"),
  );

  assert.deepEqual(result, {
    canPost: false,
    nextAllowedAt: "2026-09-05T15:00:00.000Z",
    postsRemainingToday: 0,
    perDay: 2,
  });
});

test("when both limits apply, nextAllowedAt is the later of cooldown and KST reset", () => {
  const result = postingAvailability(
    new Date("2026-01-01T00:00:00Z"),
    2,
    new Date("2026-09-04T20:00:00Z"),
    1,
    new Date("2026-09-05T00:00:00Z"),
  );

  assert.equal(result.canPost, false);
  assert.equal(result.nextAllowedAt, "2026-09-07T20:00:00.000Z");
  assert.equal(result.postsRemainingToday, 0);
  assert.equal(result.perDay, 1);
});
