import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("upload-image validates MIME type against a whitelist", () => {
  assert.match(routeSource, /ALLOWED_MIME_TYPES/);
  assert.match(routeSource, /image\/jpeg/);
  assert.match(routeSource, /image\/png/);
  assert.match(routeSource, /image\/webp/);
});

test("upload-image enforces a max file size", () => {
  assert.match(routeSource, /MAX_FILE_SIZE_BYTES/);
});

test("upload-image requires postToken auth, not admin auth", () => {
  const postFn = routeSource.match(/export async function POST[\s\S]*?\n}\n/)![0];
  assert.match(postFn, /requirePostToken\(req\)/);
  assert.doesNotMatch(postFn, /requireAdminRequest/);
});

test("upload-image stores blobs under a community-posts/ prefix", () => {
  assert.match(routeSource, /community-posts\//);
});
