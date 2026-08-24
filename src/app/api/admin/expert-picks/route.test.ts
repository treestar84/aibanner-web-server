import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("GET and POST both call requireAdminRequest before touching the DB", () => {
  const getFn = routeSource.match(/export async function GET[\s\S]*?\n}\n/)![0];
  const postFn = routeSource.match(/export async function POST[\s\S]*?\n}\n/)![0];
  assert.match(getFn, /requireAdminRequest\(req\)/);
  assert.match(postFn, /requireAdminRequest\(req\)/);
});

test("POST rejects a paste with no non-empty line for a title", () => {
  assert.match(routeSource, /if \(!parsed\.title\)/);
});

test("POST uses parseExpertPickPaste to derive title/link, never trusts a raw client-sent title", () => {
  assert.match(routeSource, /parseExpertPickPaste\(rawBody\)/);
});

test("POST lets bodyKo be overridden by an AI-tuned version but pins bodyKoRaw to the paste", () => {
  const postFn = routeSource.match(/export async function POST[\s\S]*?\n}\n/)![0];
  assert.match(postFn, /const bodyKo = typeof body\.bodyKo === "string"/);
  assert.match(postFn, /:\s*parsed\.body;/);
  // 원문 보존: 클라이언트가 보낸 bodyKo가 body_ko_raw로 새어 들어가면 안 된다.
  assert.match(postFn, /bodyKoRaw:\s*parsed\.body,/);
  assert.match(postFn, /aiTuned:\s*typeof body\.aiTuned === "boolean"/);
});
