import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const middlewareSource = readFileSync(new URL("./middleware.ts", import.meta.url), "utf8");

test("expert-picks views endpoint has its own tighter rate limit than the general list endpoint", () => {
  assert.match(middlewareSource, /\["\/api\/v1\/expert-picks\/views",\s*\d+\]/);
  assert.match(middlewareSource, /\["\/api\/v1\/expert-picks",\s*\d+\]/);
});
