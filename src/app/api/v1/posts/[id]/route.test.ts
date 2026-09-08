import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("public detail only returns visible user/editor posts using the feed-safe mapping", () => {
  assert.match(routeSource, /export async function GET/);
  assert.match(routeSource, /ep\.author_type IN \('user', 'editor'\)/);
  assert.match(routeSource, /ep\.status = 'visible'/);
  assert.match(routeSource, /\{ item: mapCommunityPost\(rows\[0\]\) \}/);
  assert.doesNotMatch(routeSource.match(/export async function GET[\s\S]*?\n}\n/)![0], /is_mine/);
});

test("public detail validates a strict positive integer id and hides database errors", () => {
  const getFn = routeSource.match(/export async function GET[\s\S]*?\n}\n/)![0];
  assert.match(getFn, /parsePositivePostId\(id\)/);
  assert.match(getFn, /status: 400/);
  assert.match(getFn, /status: 404/);
  assert.match(getFn, /\{ error: "Internal server error" \}, \{ status: 500 \}/);
});

test("delete only soft-deletes and scopes to the requesting device's own posts", () => {
  assert.match(routeSource, /status = 'removed_by_author'/);
  assert.match(routeSource, /author_device_id = \$\{auth\.deviceId\}/);
  assert.match(routeSource, /author_type = 'user'/);
  assert.doesNotMatch(routeSource, /DELETE FROM expert_picks/);
});

test("post not found or not owned by this device returns 404", () => {
  assert.match(routeSource, /result\.length === 0/);
  assert.match(routeSource, /status: 404/);
});

test("route uses async params per this codebase's Next.js convention", () => {
  assert.match(routeSource, /params: Promise<\{ id: string \}>/);
  assert.match(routeSource, /const \{ id \} = await params/);
});

test("delete also rejects malformed or out-of-range ids", () => {
  const deleteFn = routeSource.match(/export async function DELETE[\s\S]*$/)![0];
  assert.match(deleteFn, /parsePositivePostId\(id\)/);
  assert.match(deleteFn, /postId === null/);
});

test("route requires a valid postToken via requirePostToken", () => {
  assert.match(routeSource, /requirePostToken\(req\)/);
  assert.match(routeSource, /auth instanceof NextResponse/);
});

test("the whole handler is wrapped in this repo's standard outer try/catch, converting rethrown errors to a 500 JSON response", () => {
  assert.match(routeSource, /export async function DELETE\(req: NextRequest, \{ params \}: RouteParams\) \{\s*\n\s*try \{/);
  assert.match(routeSource, /\} catch \(err\) \{\s*\n\s*const message = err instanceof Error \? err\.message : "Internal server error";/);
  assert.match(routeSource, /return NextResponse\.json\(\{ error: message \}, \{ status: 500 \}\);/);
});
