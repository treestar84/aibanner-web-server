import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("tune endpoint requires both titleKo and bodyKo (title is rewritten too, not copied)", () => {
  assert.match(routeSource, /titleKo\.trim\(\)/);
  assert.match(routeSource, /bodyKo\.trim\(\)/);
  assert.match(routeSource, /!titleKo \|\| !bodyKo/);
});

test("tune endpoint calls rewriteExpertPick and returns tunedTitleKo/tunedBodyKo", () => {
  assert.match(routeSource, /import \{ rewriteExpertPick \} from "@\/lib\/expert-picks-tuning"/);
  assert.match(routeSource, /rewriteExpertPick\(\s*titleKo,\s*bodyKo,?\s*\)/);
  assert.match(routeSource, /tunedTitleKo,\s*tunedBodyKo/);
});

test("tune endpoint short-circuits with 503 when OPENAI_API_KEY is unset", () => {
  assert.match(routeSource, /!process\.env\.OPENAI_API_KEY/);
  assert.match(routeSource, /status: 503/);
});
