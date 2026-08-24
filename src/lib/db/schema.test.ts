import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schemaSource = readFileSync(
  new URL("./schema.sql", import.meta.url),
  "utf8",
);

test("schema defines expert_picks table with raw-body and ai-tuned columns", () => {
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS expert_picks/);
  assert.match(schemaSource, /body_ko_raw\s+TEXT\s+NOT NULL/);
  assert.match(schemaSource, /ai_tuned\s+BOOLEAN\s+NOT NULL DEFAULT FALSE/);
  assert.match(schemaSource, /view_count\s+BIGINT\s+NOT NULL DEFAULT 0/);
});

test("schema adds an integer version column for optimistic locking", () => {
  assert.match(
    schemaSource,
    /ALTER TABLE expert_picks ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;/,
  );
});

test("schema defines expert_pick_view_events dedup table with composite PK", () => {
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS expert_pick_view_events/);
  assert.match(
    schemaSource,
    /PRIMARY KEY \(expert_pick_id, viewer_hash, bucket_start\)/,
  );
});
