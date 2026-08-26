import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("counts endpoint validates contentType and caps the batch size", () => {
  assert.match(routeSource, /isValidLikeContentType\(contentType\)/);
  assert.match(routeSource, /slice\(0, LIKE_COUNTS_MAX_BATCH_IDS\)/);
});

test("counts endpoint returns an empty object rather than querying with zero ids", () => {
  assert.match(routeSource, /ids\.length === 0/);
  assert.match(routeSource, /counts: \{\}/);
});
