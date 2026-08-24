import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("PUT requires a numeric expectedVersion and returns 409 on conflict", () => {
  assert.match(routeSource, /body\.expectedVersion !== "number"/);
  assert.match(routeSource, /status:\s*409/);
  // 타임스탬프 기반 잠금은 JSON 왕복에서 밀리초로 잘려 항상 실패했다. 되돌아가지 않도록 막는다.
  assert.doesNotMatch(routeSource, /expectedUpdatedAt/);
});

test("PUT and DELETE both call requireAdminRequest", () => {
  const putFn = routeSource.match(/export async function PUT[\s\S]*?\n}\n/)![0];
  const deleteFn = routeSource.match(/export async function DELETE[\s\S]*?\n}\n/)![0];
  assert.match(putFn, /requireAdminRequest\(req\)/);
  assert.match(deleteFn, /requireAdminRequest\(req\)/);
});
