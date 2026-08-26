import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("toggle endpoint validates contentType, contentId, and liked before touching the DB", () => {
  assert.match(routeSource, /isValidLikeContentType\(contentType\)/);
  assert.match(routeSource, /contentId\.length > LIKE_CONTENT_ID_MAX_LENGTH/);
  assert.match(routeSource, /typeof liked !== "boolean"/);
});

test("toggle endpoint skips aggregation entirely when the HMAC secret is unconfigured", () => {
  // 조회수 트래킹과 동일한 원칙: 익명 신원을 검증할 수 없으면 아예 집계하지
  // 않는다 — 검증 없이 집계했다간 누구나 스크립트로 카운트를 조작할 수 있다.
  assert.match(routeSource, /if \(!viewerHash\)/);
  assert.match(routeSource, /trackingEnabled: false/);
});

test("toggle endpoint calls likeContent or unlikeContent based on the requested final state", () => {
  assert.match(routeSource, /liked\s*\?\s*await likeContent/);
  assert.match(routeSource, /:\s*await unlikeContent/);
});
