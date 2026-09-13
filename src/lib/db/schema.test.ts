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

test("schema defines content_likes with a composite (content_type, content_id) primary key", () => {
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS content_likes/);
  assert.match(schemaSource, /like_count\s+INTEGER\s+NOT NULL DEFAULT 0/);
  assert.match(
    schemaSource,
    /PRIMARY KEY \(content_type, content_id\)/,
  );
});

test("schema defines content_like_events dedup table with composite PK including viewer_hash", () => {
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS content_like_events/);
  assert.match(
    schemaSource,
    /PRIMARY KEY \(content_type, content_id, viewer_hash\)/,
  );
});

// 2026-09-14: 적대적 재검토(F1)에서 발견 — LIMIT+ORDER BY created_at ASC로
// 바뀐 포인트 배치 쿼리(tier-demotion.ts)가 지급 완료 글까지 매번 다시
// 스캔하지 않으려면, "아직 지급 안 한 글만" 담는 부분 인덱스가 필수다.
test("schema defines a partial index over only not-yet-awarded survival posts", () => {
  assert.match(
    schemaSource,
    /CREATE INDEX IF NOT EXISTS idx_expert_picks_survival_pending\s*\n\s*ON expert_picks\(created_at\)\s*\n\s*WHERE point_awarded_survival = FALSE AND author_type = 'user' AND status = 'visible';/,
  );
});
