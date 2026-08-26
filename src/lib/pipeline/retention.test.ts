import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./retention.ts", import.meta.url), "utf8");

test("expert picks retention defaults to 90 days and is env-tunable like other retention windows", () => {
  assert.match(source, /RETENTION_EXPERT_PICKS_DAYS/);
  assert.match(source, /DEFAULT_EXPERT_PICKS_DAYS\s*=\s*90/);
});

test("expert picks cleanup deletes DB rows before deleting their blob image", () => {
  const fn = source.match(
    /async function cleanupExpiredExpertPicks[\s\S]*?\n}\n/,
  );
  assert.ok(fn, "cleanupExpiredExpertPicks function not found");
  const deleteCallIndex = fn![0].indexOf("deleteExpertPicksOlderThan");
  const blobDelIndex = fn![0].indexOf("del(pick.image_url)");
  assert.ok(deleteCallIndex >= 0 && blobDelIndex >= 0);
  assert.ok(
    deleteCallIndex < blobDelIndex,
    "must delete the DB row (and capture image_url via RETURNING) before deleting the blob",
  );
});

test("a single blob delete failure does not abort the rest of the cleanup batch", () => {
  const fn = source.match(
    /async function cleanupExpiredExpertPicks[\s\S]*?\n}\n/,
  );
  assert.ok(fn);
  assert.match(fn![0], /try \{[\s\S]*?del\(pick\.image_url\)[\s\S]*?\} catch/);
});

test("runRetentionPolicy result includes expert picks cleanup counts", () => {
  assert.match(source, /expertPicks: ExpertPicksRetentionResult/);
  assert.match(source, /const expertPicks = await cleanupExpiredExpertPicks/);
  assert.match(source, /return \{ \.\.\.counts, policy, expertPicks \}/);
});
