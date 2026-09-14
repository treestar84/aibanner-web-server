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

test("the row is inserted as author_type='user' with no device, so it renders in the real community feed", () => {
  assert.match(routeSource, /VALUES\s*\(\s*\n\s*\$\{titleKo\}, \$\{bodyKo\}, \$\{bodyKo\}, 'user', NULL,/);
});

test("title is optional on create — empty/missing input stores title_ko = NULL", () => {
  assert.match(routeSource, /const titleKo = titleRaw\.length > 0 \? titleRaw : null;/);
});

test("GET requires admin auth and lists all visible posts regardless of author type", () => {
  const getFn = routeSource.match(/export async function GET[\s\S]*?\n}\n/)![0];
  assert.match(getFn, /requireAdminRequest\(req\)/);
  assert.match(getFn, /WHERE status = 'visible'/);
  assert.doesNotMatch(getFn, /author_type = 'editor'/);
});

test("GET supports an optional q search over title and body", () => {
  const getFn = routeSource.match(/export async function GET[\s\S]*?\n}\n/)![0];
  assert.match(getFn, /body_ko ILIKE/);
  assert.match(getFn, /title_ko ILIKE/);
});

test("GET caps the result count with LIST_LIMIT", () => {
  assert.match(routeSource, /const LIST_LIMIT = \d+/);
  assert.match(routeSource, /LIMIT \$\{LIST_LIMIT\}/);
});
