import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const queriesSource = readFileSync(
  new URL("./queries.ts", import.meta.url),
  "utf8",
);

test("updateExpertPick uses optimistic locking on updated_at", () => {
  assert.match(
    queriesSource,
    /WHERE id = \$\{id\} AND updated_at = \$\{expectedUpdatedAt\}/,
    "update must be scoped to the exact updated_at the client last read, or it must silently overwrite concurrent edits",
  );
});

test("insertExpertPick never writes to body_ko_raw from a later update", () => {
  assert.match(
    queriesSource,
    /INSERT INTO expert_picks \(/,
  );
  // updateExpertPick's SET list must not include body_ko_raw at all —
  // the raw original is immutable after creation.
  const updateFnMatch = queriesSource.match(
    /export async function updateExpertPick[\s\S]*?\n}\n/,
  );
  assert.ok(updateFnMatch, "updateExpertPick function not found");
  assert.doesNotMatch(updateFnMatch![0], /body_ko_raw\s*=/);
});

test("claimExpertPickViewEvent uses ON CONFLICT DO NOTHING for dedup", () => {
  assert.match(
    queriesSource,
    /INSERT INTO expert_pick_view_events[\s\S]*?ON CONFLICT \(expert_pick_id, viewer_hash, bucket_start\) DO NOTHING/,
  );
});
