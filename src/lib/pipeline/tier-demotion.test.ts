import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./tier-demotion.ts", import.meta.url),
  "utf8"
);

const fn = source.match(
  /export async function runPostSurvivalPointsBatch[\s\S]*?\n}\n/
)![0];

test("caps the batch size so it cannot dominate the shared cron time budget", () => {
  assert.match(source, /const SURVIVAL_BATCH_LIMIT = \d+/);
  assert.match(fn, /LIMIT \$\{SURVIVAL_BATCH_LIMIT\}/);
});

test("processes the oldest-eligible posts first so a capped batch drains in order", () => {
  assert.match(fn, /ORDER BY created_at ASC/);
});

test("claims the idempotency flag before awarding points, not after", () => {
  const claimIndex = fn.indexOf("point_awarded_survival = TRUE");
  const awardIndex = fn.indexOf("awardPoints(");
  assert.ok(claimIndex >= 0, "claim UPDATE not found");
  assert.ok(awardIndex >= 0, "awardPoints call not found");
  assert.ok(
    claimIndex < awardIndex,
    "the flag must be claimed before awardPoints runs, so a failure after the claim can only under-award, never double-award"
  );
});

test("the claim is a conditional compare-and-swap, not an unconditional write", () => {
  assert.match(
    fn,
    /WHERE id = \$\{row\.id\} AND point_awarded_survival = FALSE\s*\n\s*RETURNING id/
  );
});

test("skips awarding when the claim did not win the row", () => {
  assert.match(fn, /if \(claimed\.length === 0\) return/);
});

test("groups rows by device so the same device is always processed sequentially", () => {
  assert.match(source, /rowsByDevice/);
  assert.match(source, /processDeviceRowsSequentially/);
});

test("bounds concurrency across distinct devices instead of running them all at once", () => {
  assert.match(source, /const SURVIVAL_CONCURRENCY = \d+/);
  assert.match(fn, /deviceBuckets\.slice\(i, i \+ SURVIVAL_CONCURRENCY\)/);
});

test("isolates a single row's failure so it cannot abort the rest of the batch", () => {
  assert.match(fn, /async function processRow[\s\S]*?try\s*\{[\s\S]*?\}\s*catch/);
});

test("tier demotion batch is untouched by this change", () => {
  const demotionFn = source.match(
    /export async function runTierDemotionBatch[\s\S]*?\n}\n/
  )![0];
  assert.match(demotionFn, /UPDATE device_principals/);
  assert.match(demotionFn, /GREATEST\(tier - 1, 2\)/);
});
