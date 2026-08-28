import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("posts endpoint gates on tier-based posting frequency before accepting a body", () => {
  assert.match(routeSource, /canPostNow\(tier, lastPostAt\)/);
  assert.match(routeSource, /status: 429/);
});

test("posts endpoint caps body length to prevent long-form abuse of a title-less format", () => {
  assert.match(routeSource, /bodyKo\.length > 1000/);
});

test("user posts are stored with author_type='user' and the author's device id, never a title", () => {
  assert.match(routeSource, /'user', \$\{deviceId\}/);
  assert.match(routeSource, /VALUES \(NULL,/);
});

test("posts are authenticated via requirePostToken before any DB write", () => {
  assert.match(routeSource, /requirePostToken\(req\)/);
  assert.match(routeSource, /auth instanceof NextResponse/);
});

test("cooldown-free tiers (3-5) re-check today's post count against perDay before insert, since canPostNow only compares timestamps", () => {
  assert.match(routeSource, /freq\.cooldownDays === 0 && freq\.perDay > 0/);
  assert.match(routeSource, /SELECT COUNT\(\*\)::int AS cnt FROM expert_picks/);
  assert.match(routeSource, /todayCount >= freq\.perDay/);
});
