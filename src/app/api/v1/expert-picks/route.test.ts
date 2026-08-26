import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("public list endpoint only returns enabled items and supports If-Modified-Since caching", () => {
  assert.match(routeSource, /listExpertPicks\(true, ?limit\)/);
  assert.match(routeSource, /if-modified-since/);
  assert.match(routeSource, /304/);
});

test("public list endpoint caps unbounded growth with a default+max limit", () => {
  // 과거 글이 무한정 쌓여도 앱 목록이 통째로 다 내려가지 않도록 기본값과
  // 상한을 둔다. 정확한 숫자보다 "제한이 존재한다"는 계약을 지킨다.
  assert.match(routeSource, /DEFAULT_LIMIT\s*=\s*\d+/);
  assert.match(routeSource, /MAX_LIMIT\s*=\s*\d+/);
  assert.match(routeSource, /function parseLimit/);
});

test("public list endpoint never exposes body_ko_raw or ai_tuned internals", () => {
  assert.doesNotMatch(routeSource, /body_ko_raw|aiTuned|ai_tuned/);
});
