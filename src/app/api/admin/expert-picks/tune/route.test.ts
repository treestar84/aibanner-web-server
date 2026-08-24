import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("tune route requires admin auth and never writes to the DB directly", () => {
  assert.match(routeSource, /requireAdminRequest\(req\)/);
  assert.doesNotMatch(routeSource, /updateExpertPick|insertExpertPick/);
});

test("tune route falls back gracefully when OPENAI_API_KEY is missing", () => {
  assert.match(routeSource, /status:\s*503/);
});
