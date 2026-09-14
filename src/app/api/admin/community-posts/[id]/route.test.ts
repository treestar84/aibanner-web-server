import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("both handlers require admin auth", () => {
  const matches = routeSource.match(/requireAdminRequest\(req\)/g) ?? [];
  assert.equal(matches.length, 2, "PUT and DELETE both need the admin gate");
});

test("PUT can edit any visible post, including real user posts (admin has full editorial control)", () => {
  const putFn = routeSource.match(/export async function PUT[\s\S]*?\n}\n/)![0];
  assert.match(putFn, /WHERE id = \$\{postId\} AND status = 'visible'/);
  assert.doesNotMatch(putFn, /author_device_id IS NULL/);
});

test("DELETE can remove any visible post, and soft-deletes rather than hard-deleting", () => {
  const deleteFn = routeSource.match(/export async function DELETE[\s\S]*?\n}\n/)![0];
  assert.match(deleteFn, /UPDATE expert_picks SET status = 'removed_by_admin'/);
  assert.match(deleteFn, /WHERE id = \$\{postId\} AND status = 'visible'/);
  assert.doesNotMatch(deleteFn, /DELETE FROM expert_picks/);
  assert.doesNotMatch(deleteFn, /author_device_id IS NULL/);
});

test("PUT rejects a missing/empty body the same way the composer endpoints do", () => {
  assert.match(routeSource, /if \(!bodyKo\) return NextResponse\.json\(\{ error: "body is required" \}, \{ status: 400 \}\);/);
  assert.match(routeSource, /bodyKo\.length > MAX_BODY_LENGTH/);
});

test("PUT accepts an optional title so editor-picks-style posts keep (or gain) a headline", () => {
  assert.match(routeSource, /const titleKo = titleRaw\.length > 0 \? titleRaw : null;/);
});

test("PUT validates imageUrl against the blob host, not trusting the client", () => {
  assert.match(routeSource, /import \{ isAllowedBlobImageUrl \} from "@\/lib\/blob-image-url"/);
  assert.match(routeSource, /if \(imageUrl && !isAllowedBlobImageUrl\(imageUrl\)\)/);
});

test("a PUT/DELETE that matches no row (real user post, wrong id, already removed) returns 404, not a silent success", () => {
  const putFn = routeSource.match(/export async function PUT[\s\S]*?\n}\n/)![0];
  const deleteFn = routeSource.match(/export async function DELETE[\s\S]*?\n}\n/)![0];
  assert.match(putFn, /if \(rows\.length === 0\)/);
  assert.match(deleteFn, /if \(rows\.length === 0\)/);
  assert.match(putFn, /status: 404/);
  assert.match(deleteFn, /status: 404/);
});

test("both handlers are wrapped in the repo's standard outer try/catch", () => {
  assert.match(routeSource, /export async function PUT\(req: NextRequest, \{ params \}: RouteParams\) \{\s*\n\s*try \{/);
  assert.match(routeSource, /export async function DELETE\(req: NextRequest, \{ params \}: RouteParams\) \{\s*\n\s*try \{/);
  const handlers = routeSource.match(/return NextResponse\.json\(\{ error: message \}, \{ status: 500 \}\);/g) ?? [];
  assert.equal(handlers.length, 2, "each handler needs its own 500 fallback");
});
