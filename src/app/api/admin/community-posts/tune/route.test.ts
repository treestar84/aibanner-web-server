import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("tune endpoint requires admin auth and only bodyKo (community posts have no title)", () => {
  assert.match(routeSource, /requireAdminRequest\(req\)/);
  assert.match(routeSource, /body\.body\.trim\(\)/);
  assert.doesNotMatch(routeSource, /body\?\.titleKo/);
});

test("tune endpoint calls rewriteCommunityPost, not the expert-pick (titled) rewriter", () => {
  assert.match(routeSource, /import \{ rewriteCommunityPost \} from "@\/lib\/expert-picks-tuning"/);
  assert.match(routeSource, /rewriteCommunityPost\(bodyKo\)/);
  assert.doesNotMatch(routeSource, /import.*rewriteExpertPick/);
});

test("tune endpoint short-circuits with 503 when OPENAI_API_KEY is unset", () => {
  assert.match(routeSource, /!process\.env\.OPENAI_API_KEY/);
  assert.match(routeSource, /status: 503/);
});
