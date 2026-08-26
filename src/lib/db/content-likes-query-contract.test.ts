import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const queriesSource = readFileSync(
  new URL("./queries.ts", import.meta.url),
  "utf8",
);

test("likeContent dedups via content_like_events before incrementing content_likes", () => {
  const fn = queriesSource.match(/export async function likeContent[\s\S]*?\n}\n/);
  assert.ok(fn, "likeContent function not found");
  assert.match(
    fn![0],
    /INSERT INTO content_like_events[\s\S]*?ON CONFLICT \(content_type, content_id, viewer_hash\) DO NOTHING/,
    "must dedup per (content_type, content_id, viewer_hash) or one device can inflate a count",
  );
  assert.match(
    fn![0],
    /like_count = content_likes\.like_count \+ 1/,
    "a claimed like must increment the aggregate counter",
  );
  // 이미 좋아요한 상태에서 다시 좋아요를 보내면(중복 클라이언트 재시도 등)
  // INSERT가 conflict로 무시되므로 increment SQL 자체가 실행되지 않아야 한다.
  const insertIndex = fn![0].indexOf("INSERT INTO content_like_events");
  const changedCheckIndex = fn![0].indexOf("if (changed)");
  const incrementIndex = fn![0].indexOf("like_count = content_likes.like_count + 1");
  assert.ok(insertIndex >= 0 && changedCheckIndex >= 0 && incrementIndex >= 0);
  assert.ok(insertIndex < changedCheckIndex && changedCheckIndex < incrementIndex);
});

test("unlikeContent never lets like_count go negative", () => {
  const fn = queriesSource.match(/export async function unlikeContent[\s\S]*?\n}\n/);
  assert.ok(fn, "unlikeContent function not found");
  assert.match(fn![0], /DELETE FROM content_like_events/);
  assert.match(
    fn![0],
    /GREATEST\(like_count - 1, 0\)/,
    "must floor at 0 — a stray/duplicate unlike must not push the counter negative",
  );
});

test("getContentLikeCounts batches with ANY() instead of one query per id", () => {
  const fn = queriesSource.match(
    /export async function getContentLikeCounts[\s\S]*?\n}\n/,
  );
  assert.ok(fn, "getContentLikeCounts function not found");
  assert.match(fn![0], /content_id = ANY\(\$\{contentIds\}\)/);
});
