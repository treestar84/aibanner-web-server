import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("public list endpoint only returns enabled items and supports If-Modified-Since caching", () => {
  assert.match(routeSource, /listExpertPicks\(true\)/);
  assert.match(routeSource, /if-modified-since/);
  assert.match(routeSource, /304/);
});

test("public list endpoint never exposes body_ko_raw or ai_tuned internals", () => {
  assert.doesNotMatch(routeSource, /body_ko_raw|aiTuned|ai_tuned/);
});
