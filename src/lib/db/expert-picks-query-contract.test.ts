import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const queriesSource = readFileSync(
  new URL("./queries.ts", import.meta.url),
  "utf8",
);

test("updateExpertPick uses optimistic locking on an integer version", () => {
  assert.match(
    queriesSource,
    /WHERE id = \$\{id\} AND version = \$\{expectedVersion\}/,
    "update must be scoped to the exact version the client last read, or it must silently overwrite concurrent edits",
  );
  assert.match(
    queriesSource,
    /version\s+= version \+ 1/,
    "each successful update must bump version, or the lock never advances",
  );
});

test("getExpertPickMaxUpdatedAt is not scoped to enabled rows", () => {
  const fn = queriesSource.match(
    /export async function getExpertPickMaxUpdatedAt[\s\S]*?\n}\n/,
  );
  assert.ok(fn, "getExpertPickMaxUpdatedAt function not found");
  // enabled = TRUE로 좁히면 최신 항목 비활성화 시 MAX가 과거로 되돌아가
  // If-Modified-Since가 영원히 304를 반환한다.
  assert.doesNotMatch(fn![0], /WHERE enabled = TRUE/);
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

test("listExpertPicks supports an optional LIMIT so public callers can cap unbounded growth", () => {
  const fn = queriesSource.match(
    /export async function listExpertPicks[\s\S]*?\n}\n/,
  );
  assert.ok(fn, "listExpertPicks function not found");
  assert.match(fn![0], /LIMIT \$\{limit\}/);
  // limit이 없을 때 여전히 무제한 조회(관리자 목록)를 지원해야 한다.
  assert.match(fn![0], /: await sql`/);
});

test("deleteExpertPicksOlderThan deletes by created_at and returns image_url for blob cleanup", () => {
  const fn = queriesSource.match(
    /export async function deleteExpertPicksOlderThan[\s\S]*?\n}\n/,
  );
  assert.ok(fn, "deleteExpertPicksOlderThan function not found");
  assert.match(fn![0], /DELETE FROM expert_picks/);
  assert.match(fn![0], /created_at < NOW\(\) - \(\$\{days\} \* INTERVAL '1 day'\)/);
  // 삭제한 행의 image_url을 못 받으면 호출부가 Blob 이미지를 못 지운다.
  assert.match(fn![0], /RETURNING id, image_url/);
});

test("claimExpertPickViewEvent uses ON CONFLICT DO NOTHING for dedup", () => {
  assert.match(
    queriesSource,
    /INSERT INTO expert_pick_view_events[\s\S]*?ON CONFLICT \(expert_pick_id, viewer_hash, bucket_start\) DO NOTHING/,
  );
});
