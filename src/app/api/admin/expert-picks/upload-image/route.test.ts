import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const validationSource = readFileSync("src/lib/image-validation.ts", "utf8");
const uploadSource = readFileSync("src/lib/image-upload.ts", "utf8");
const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("upload-image validates MIME type against a whitelist", () => {
  assert.match(validationSource, /ALLOWED_MIME_TYPES/);
  assert.match(validationSource, /image\/jpeg/);
  assert.match(validationSource, /image\/png/);
  assert.match(validationSource, /image\/webp/);
});

test("upload-image enforces a max file size", () => {
  assert.match(validationSource, /MAX_FILE_SIZE_BYTES/);
});

test("upload-image requires admin auth", () => {
  const postFn = routeSource.match(/export async function POST[\s\S]*?\n}\n/)![0];
  assert.match(postFn, /requireAdminRequest\(req\)/);
});
