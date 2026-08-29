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

// ── C1: expert_picks는 편집자 글과 사용자 글을 공유하는 테이블이므로,
// 전문가픽 조회/변경 경로는 전부 author_type='editor'로 좁혀야 한다.

test("listExpertPicks never returns user posts, in either the public or the admin variant", () => {
  const fn = queriesSource.match(
    /export async function listExpertPicks[\s\S]*?\n}\n/,
  );
  assert.ok(fn, "listExpertPicks function not found");
  const selects = fn![0].match(/SELECT \* FROM expert_picks[\s\S]*?ORDER BY/g);
  assert.ok(selects && selects.length === 4, "expected all 4 query branches");
  for (const q of selects!) {
    assert.match(
      q,
      /author_type = 'editor'/,
      `every listExpertPicks branch must exclude user posts: ${q}`,
    );
  }
});

test("listExpertPicks public branches (enabledOnly) also exclude moderated rows", () => {
  const fn = queriesSource.match(
    /export async function listExpertPicks[\s\S]*?\n}\n/,
  );
  const publicBranches = fn![0].match(
    /WHERE enabled = TRUE[^\n]*/g,
  );
  assert.ok(publicBranches && publicBranches.length === 2);
  for (const q of publicBranches!) {
    assert.match(q, /status = 'visible'/, `public branch must hide moderated rows: ${q}`);
  }
});

test("getExpertPickById is the public-safe variant: editor-authored AND visible only", () => {
  const fn = queriesSource.match(
    /export async function getExpertPickById\(id: number\)[\s\S]*?\n}\n/,
  );
  assert.ok(fn, "getExpertPickById function not found");
  assert.match(fn![0], /author_type = 'editor'/);
  assert.match(fn![0], /status = 'visible'/);
});

test("getExpertPickByIdForAdmin keeps hidden editor rows reachable but still excludes user posts", () => {
  const fn = queriesSource.match(
    /export async function getExpertPickByIdForAdmin[\s\S]*?\n}\n/,
  );
  assert.ok(fn, "getExpertPickByIdForAdmin function not found");
  assert.match(fn![0], /author_type = 'editor'/);
  // 관리자는 신고로 숨겨진 편집자 글을 다시 보이게 되돌릴 수 있어야 하므로
  // status 필터는 일부러 걸지 않는다.
  assert.doesNotMatch(fn![0], /status = 'visible'/);
});

test("admin mutations resolve the row through the admin-scoped getter, not the public one", () => {
  const fn = queriesSource.match(
    /export async function updateExpertPick[\s\S]*?\n}\n/,
  );
  assert.ok(fn, "updateExpertPick function not found");
  assert.match(fn![0], /getExpertPickByIdForAdmin\(id\)/);
});

test("update/delete statements are themselves scoped to editor rows, not just their pre-read", () => {
  const update = queriesSource.match(
    /export async function updateExpertPick[\s\S]*?\n}\n/,
  );
  assert.match(update![0], /AND author_type = 'editor'/);
  const del = queriesSource.match(
    /export async function deleteExpertPick\(id: number\)[\s\S]*?\n}\n/,
  );
  assert.ok(del, "deleteExpertPick function not found");
  assert.match(del![0], /AND author_type = 'editor'/);
});

test("getExpertPickMaxUpdatedAt only tracks editor rows so user posts cannot bust the public feed cache", () => {
  const fn = queriesSource.match(
    /export async function getExpertPickMaxUpdatedAt[\s\S]*?\n}\n/,
  );
  assert.match(fn![0], /WHERE author_type = 'editor'/);
});

test("expert-pick retention never physically deletes user posts (FK-referenced by post_reports)", () => {
  const fn = queriesSource.match(
    /export async function deleteExpertPicksOlderThan[\s\S]*?\n}\n/,
  );
  assert.match(fn![0], /AND author_type = 'editor'/);
});

test("claimExpertPickViewEvent uses ON CONFLICT DO NOTHING for dedup", () => {
  assert.match(
    queriesSource,
    /INSERT INTO expert_pick_view_events[\s\S]*?ON CONFLICT \(expert_pick_id, viewer_hash, bucket_start\) DO NOTHING/,
  );
});
