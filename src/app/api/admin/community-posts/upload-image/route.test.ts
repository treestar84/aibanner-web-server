import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("requires admin auth, not device post-token auth", () => {
  assert.match(routeSource, /requireAdminRequest\(req\)/);
  assert.doesNotMatch(routeSource, /import \{ requirePostToken \}/);
});

test("validates mime type and size the same way the public upload endpoint does", () => {
  assert.match(routeSource, /ALLOWED_MIME_TYPES = \["image\/jpeg", "image\/png", "image\/webp", "image\/gif"\]/);
  assert.match(routeSource, /MAX_FILE_SIZE_BYTES = 8 \* 1024 \* 1024/);
});

test("stores blobs under the same community-posts/ prefix as user uploads", () => {
  assert.match(routeSource, /`community-posts\/\$\{Date\.now\(\)\}/);
});

test("returns the blob url on success", () => {
  assert.match(routeSource, /NextResponse\.json\(\{ ok: true, imageUrl: blob\.url \}\)/);
});
