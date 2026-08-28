import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

test("expert_picks gains author_type/status/report_count and title_ko becomes nullable", () => {
  assert.match(schema, /ALTER TABLE expert_picks ADD COLUMN IF NOT EXISTS author_type/);
  assert.match(schema, /ALTER TABLE expert_picks ALTER COLUMN title_ko DROP NOT NULL/);
});

test("device_principals stores only a token hash, never the raw postToken", () => {
  assert.match(schema, /post_token_hash TEXT NOT NULL/);
  assert.doesNotMatch(schema, /post_token\s+TEXT/);
});

test("post_reports enforces one report per device per post", () => {
  assert.match(schema, /UNIQUE \(post_id, reporter_device_id\)/);
});
