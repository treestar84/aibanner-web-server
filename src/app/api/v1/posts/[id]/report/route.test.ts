import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("reports from devices under tier 2 (joined <7 days) are logged but never counted toward the threshold", () => {
  assert.match(routeSource, /countsTowardThreshold = reporterTier >= 2/);
  assert.match(routeSource, /counts_toward_threshold = true/);
});

test("editor picks cannot be hidden through the crowd-report path", () => {
  // author_type을 조회만 하고 쓰지 않으면 편집자 큐레이션 글도 신고 임계치로
  // 내려간다. 신고 적재/카운트 이전에 걸러야 한다.
  assert.match(routeSource, /post\[0\]\.author_type !== "user"/);
  const fn = routeSource.match(/export async function POST[\s\S]*?\n}\n/)![0];
  const gateIndex = fn.indexOf('post[0].author_type !== "user"');
  const insertIndex = fn.indexOf("INSERT INTO post_reports");
  const countIndex = fn.indexOf("SELECT COUNT(*)::int AS cnt FROM post_reports");
  assert.ok(gateIndex > 0, "author_type gate not found");
  assert.ok(
    gateIndex < insertIndex && gateIndex < countIndex,
    "the gate must run before any report insert or threshold counting",
  );
});

test("threshold breach hides the post, it does not delete it", () => {
  assert.match(routeSource, /status = 'hidden_by_report'/);
  assert.doesNotMatch(routeSource, /DELETE FROM expert_picks/);
});

test("duplicate reports from the same device are rejected via the UNIQUE constraint, not app-level dedup logic", () => {
  assert.match(routeSource, /status: 409/);
});

test("every hide transition is written to moderation_log", () => {
  assert.match(routeSource, /INSERT INTO moderation_log/);
});

test("moderation_log is only written when the UPDATE actually flips status to hidden (RETURNING id gate), never unconditionally on threshold breach", () => {
  assert.match(routeSource, /WHERE id = \$\{postId\} AND status = 'visible'\s*\n\s*RETURNING id/);
  assert.match(routeSource, /if \(updated\.length > 0\) \{/);
});

test("duplicate-report catch only swallows the unique_violation (23505), other DB errors are rethrown", () => {
  assert.match(routeSource, /err\.code === "23505"/);
  assert.match(routeSource, /throw err;/);
});

test("the whole handler is wrapped in this repo's standard outer try/catch, converting rethrown DB errors to a 500 JSON response", () => {
  assert.match(routeSource, /export async function POST\(req: NextRequest, \{ params \}: RouteParams\) \{\s*\n\s*try \{/);
  assert.match(routeSource, /\} catch \(err\) \{\s*\n\s*const message = err instanceof Error \? err\.message : "Internal server error";/);
  assert.match(routeSource, /console\.error\("\[\/api\/v1\/posts\/\[id\]\/report\]\[POST\]", err\);/);
  assert.match(routeSource, /return NextResponse\.json\(\{ error: message \}, \{ status: 500 \}\);/);
});

test("reporter tier is recomputed live rather than trusted from the auth object", () => {
  assert.match(routeSource, /computeTier\(firstSeenAt, pointsTotal\)/);
  assert.doesNotMatch(routeSource, /auth\.tier/);
});

test("route uses async params per this codebase's Next.js convention", () => {
  assert.match(routeSource, /params: Promise<\{ id: string \}>/);
  assert.match(routeSource, /const \{ id \} = await params/);
});
