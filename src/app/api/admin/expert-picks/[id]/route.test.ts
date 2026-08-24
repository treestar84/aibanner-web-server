import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("PUT requires expectedUpdatedAt and returns 409 on conflict", () => {
  assert.match(routeSource, /expectedUpdatedAt/);
  assert.match(routeSource, /status:\s*409/);
});

test("PUT and DELETE both call requireAdminRequest", () => {
  const putFn = routeSource.match(/export async function PUT[\s\S]*?\n}\n/)![0];
  const deleteFn = routeSource.match(/export async function DELETE[\s\S]*?\n}\n/)![0];
  assert.match(putFn, /requireAdminRequest\(req\)/);
  assert.match(deleteFn, /requireAdminRequest\(req\)/);
});
