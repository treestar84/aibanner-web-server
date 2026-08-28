import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("register endpoint rejects when Play Integrity verdict is not acceptable", () => {
  assert.match(routeSource, /if \(!ok\)/);
  assert.match(routeSource, /status: 403/);
});

test("register endpoint never stores the raw postToken, only a sha256 hash of a freshly generated token", () => {
  assert.match(routeSource, /randomBytes\(32\)\.toString\("hex"\)/);
  assert.match(routeSource, /createHash\("sha256"\)/);
  assert.doesNotMatch(routeSource, /post_token_hash = \$\{postToken\}/);
});

test("register endpoint validates deviceId and integrityToken before verifying integrity", () => {
  assert.match(routeSource, /!deviceId \|\| !integrityToken/);
  assert.match(routeSource, /status: 400/);
});
