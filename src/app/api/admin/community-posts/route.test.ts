import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("endpoint requires admin auth and never touches the device post-token/tier gate", () => {
  assert.match(routeSource, /requireAdminRequest\(req\)/);
  assert.match(routeSource, /authError = await requireAdminRequest/);
  assert.doesNotMatch(routeSource, /import.*requirePostToken/);
  assert.doesNotMatch(routeSource, /import.*computeTier/);
  assert.doesNotMatch(routeSource, /import.*canPostNow/);
});

test("body length is capped the same as the regular composer", () => {
  assert.match(routeSource, /bodyKo\.length > MAX_BODY_LENGTH/);
  assert.match(routeSource, /MAX_BODY_LENGTH = 1000/);
});

test("imageUrl is still validated against the blob host, not trusted from the client", () => {
  assert.match(routeSource, /import \{ isAllowedBlobImageUrl \} from "@\/lib\/blob-image-url"/);
  assert.match(routeSource, /if \(imageUrl && !isAllowedBlobImageUrl\(imageUrl\)\)/);
});

test("authorLabel is admin-supplied free text with a length cap and a default fallback", () => {
  assert.match(routeSource, /MAX_AUTHOR_LABEL_LENGTH = 40/);
  assert.match(routeSource, /authorLabelRaw\.length > MAX_AUTHOR_LABEL_LENGTH/);
  assert.match(routeSource, /const authorLabel = authorLabelRaw \|\| "관리자\(테스트\)"/);
});

test("the row is inserted as author_type='user' with no device and no title, so it renders in the real community feed", () => {
  assert.match(routeSource, /VALUES\s*\(\s*\n\s*NULL, \$\{bodyKo\}, \$\{bodyKo\}, 'user', NULL,/);
});
