import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("mine requires post-token auth and only selects the requesting user's visible posts", () => {
  assert.match(routeSource, /requirePostToken\(req\)/);
  assert.match(routeSource, /ep\.author_device_id = \$\{auth\.deviceId\}/);
  assert.match(routeSource, /ep\.author_type = 'user'/);
  assert.match(routeSource, /ep\.status = 'visible'/);
});

test("mine returns a latest-id page of 20 and marks every item as owned", () => {
  assert.match(routeSource, /ep\.id < \$\{cursorId\}::int/);
  assert.match(routeSource, /ORDER BY ep\.id DESC/);
  assert.match(routeSource, /LIMIT 20/);
  assert.match(routeSource, /is_mine: true/);
});

test("mine validates its cursor before querying and never exposes raw device ids", () => {
  assert.match(routeSource, /if \(cursor !== null\)/);
  assert.match(routeSource, /parsePositivePostId\(cursor\)/);
  assert.match(routeSource, /cursor must be a positive integer/);
  assert.match(routeSource, /mapCommunityPost\(row\)/);
});

test("mine uses a generic 500 response", () => {
  assert.match(routeSource, /console\.error\("\[\/api\/v1\/posts\/mine\]\[GET\]", err\)/);
  assert.match(routeSource, /\{ error: "Internal server error" \}, \{ status: 500 \}/);
});
