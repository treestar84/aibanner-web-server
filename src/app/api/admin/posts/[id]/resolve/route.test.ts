import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("route is admin-authed via requireAdminRequest before touching the DB", () => {
  assert.match(routeSource, /const authError = await requireAdminRequest\(req\);/);
  assert.match(routeSource, /if \(authError\) return authError;/);
});

test("only 'remove' or 'restore' actions are accepted", () => {
  assert.match(routeSource, /action !== "remove" && action !== "restore"/);
});

test("remove sets status = 'removed_by_admin', never a hard DELETE", () => {
  assert.match(routeSource, /SET status = 'removed_by_admin'/);
  assert.doesNotMatch(routeSource, /DELETE FROM expert_picks/);
});

test("restore sets status back to 'visible'", () => {
  assert.match(routeSource, /SET status = 'visible'/);
});

test("both actions write a moderation_log row with actor='admin' and reason='admin_review'", () => {
  const inserts = routeSource.match(/INSERT INTO moderation_log[\s\S]*?'admin_review', 'admin'\)/g) ?? [];
  assert.equal(inserts.length, 2);
});

test("remove awards accurate_report points to every reporter with counts_toward_threshold = true", () => {
  assert.match(routeSource, /counts_toward_threshold = true/);
  assert.match(routeSource, /awardPoints\(row\.reporter_device_id as string, "accurate_report"\)/);
});

test("restore does not call awardPoints at all", () => {
  const restoreBranch = routeSource.split("} else {")[1] ?? "";
  assert.doesNotMatch(restoreBranch.split("return NextResponse.json")[0], /awardPoints/);
});

test("moderation_log rows use the post's actual prior status as from_status, not a hardcoded value", () => {
  assert.match(routeSource, /SELECT id, status FROM expert_picks WHERE id = \$\{postId\}/);
  assert.match(routeSource, /const fromStatus = postRows\[0\]\.status/);
  assert.match(routeSource, /VALUES \(\$\{postId\}, \$\{fromStatus\}, 'removed_by_admin', 'admin_review', 'admin'\)/);
  assert.match(routeSource, /VALUES \(\$\{postId\}, \$\{fromStatus\}, 'visible', 'admin_review', 'admin'\)/);
});

test("404s when the post does not exist", () => {
  assert.match(routeSource, /if \(postRows\.length === 0\)/);
  assert.match(routeSource, /status: 404/);
});

test("route uses async params per this codebase's Next.js convention", () => {
  assert.match(routeSource, /params: Promise<\{ id: string \}>/);
  assert.match(routeSource, /const \{ id: idParam \} = await params/);
});

test("wrapped in the repo's standard outer try/catch, converting errors to a 500 JSON response", () => {
  assert.match(routeSource, /export async function POST\(req: NextRequest, \{ params \}: RouteParams\) \{\s*\n\s*try \{/);
  assert.match(routeSource, /console\.error\("\[\/api\/admin\/posts\/\[id\]\/resolve\]\[POST\]", err\);/);
  assert.match(routeSource, /return NextResponse\.json\(\{ error: message \}, \{ status: 500 \}\);/);
});
