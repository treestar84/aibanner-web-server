import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("route is admin-authed via requireAdminRequest before touching the DB", () => {
  assert.match(routeSource, /const authError = await requireAdminRequest\(req\);/);
  assert.match(routeSource, /if \(authError\) return authError;/);
});

test("requires a boolean 'permanently' field in the body", () => {
  assert.match(routeSource, /typeof body\.permanently !== "boolean"/);
});

test("computes banned_until from optional untilDays, in days from now", () => {
  assert.match(routeSource, /untilDays \* 24 \* 60 \* 60 \* 1000/);
});

test("sets banned_permanently and banned_until on device_principals", () => {
  assert.match(routeSource, /UPDATE device_principals/);
  assert.match(routeSource, /SET banned_permanently = \$\{body\.permanently\}, banned_until = \$\{bannedUntil\}/);
});

test("does not duplicate the ban-enforcement check — that already lives in post-token-auth.ts", () => {
  assert.doesNotMatch(routeSource, /banned_permanently \|\|/);
  assert.doesNotMatch(routeSource, /This device is banned/);
});

test("404s when the device does not exist", () => {
  assert.match(routeSource, /RETURNING device_id/);
  assert.match(routeSource, /if \(result\.length === 0\)/);
  assert.match(routeSource, /status: 404/);
});

test("route uses async params keyed by deviceId per this codebase's Next.js convention", () => {
  assert.match(routeSource, /params: Promise<\{ deviceId: string \}>/);
  assert.match(routeSource, /const \{ deviceId \} = await params/);
});

test("wrapped in the repo's standard outer try/catch, converting errors to a 500 JSON response", () => {
  assert.match(routeSource, /export async function POST\(req: NextRequest, \{ params \}: RouteParams\) \{\s*\n\s*try \{/);
  assert.match(routeSource, /console\.error\("\[\/api\/admin\/devices\/\[deviceId\]\/ban\]\[POST\]", err\);/);
  assert.match(routeSource, /return NextResponse\.json\(\{ error: message \}, \{ status: 500 \}\);/);
});
