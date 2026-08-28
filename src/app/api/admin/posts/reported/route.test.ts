import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("route is admin-authed via requireAdminRequest before touching the DB", () => {
  assert.match(routeSource, /const authError = await requireAdminRequest\(req\);/);
  assert.match(routeSource, /if \(authError\) return authError;/);
});

test("lists only hidden_by_report posts", () => {
  assert.match(routeSource, /WHERE status = 'hidden_by_report'/);
});

test("ordered by report_count descending", () => {
  assert.match(routeSource, /ORDER BY report_count DESC/);
});

test("wrapped in the repo's standard outer try/catch, converting errors to a 500 JSON response", () => {
  assert.match(routeSource, /export async function GET\(req: NextRequest\) \{\s*\n\s*try \{/);
  assert.match(routeSource, /console\.error\("\[\/api\/admin\/posts\/reported\]\[GET\]", err\);/);
  assert.match(routeSource, /return NextResponse\.json\(\{ error: "Internal server error" \}, \{ status: 500 \}\);/);
});
