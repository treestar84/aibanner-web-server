import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const validationSource = readFileSync("src/lib/image-validation.ts", "utf8");
const uploadSource = readFileSync("src/lib/image-upload.ts", "utf8");
const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("requires admin auth, not device post-token auth", () => {
  assert.match(routeSource, /requireAdminRequest\(req\)/);
  assert.doesNotMatch(routeSource, /import \{ requirePostToken \}/);
});

test("validates mime type and size the same way the public upload endpoint does", () => {
  assert.match(validationSource, /ALLOWED_MIME_TYPES/);
  assert.match(validationSource, /MAX_FILE_SIZE_BYTES = 4 \* 1024 \* 1024/);
});

test("stores blobs under the same community-posts/ prefix as user uploads", () => {
  assert.match(routeSource, /uploadImage\(req, "community-posts"\)/);
});

test("returns the blob url on success", () => {
  assert.match(uploadSource, /NextResponse\.json\(\{ ok: true, imageUrl: blob\.url \}\)/);
});
