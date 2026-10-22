import test from "node:test";
import assert from "node:assert/strict";
import { limitedJson } from "./limited-json";
import { parseErrorItems, MAX_ERRORS_PER_BATCH, MAX_STACK_LENGTH, MAX_MESSAGE_LENGTH } from "./client_reports";
test("existing maximum error batches fit even with escaped control characters", async () => {
  const body = { clientId: "12345678", errors: Array.from({ length: MAX_ERRORS_PER_BATCH }, (_, i) => ({
    fingerprint: `error_${i}`, message: "가".repeat(MAX_MESSAGE_LENGTH), stack: "\u0000".repeat(MAX_STACK_LENGTH), count: 1,
  })) };
  const parsed = await limitedJson(new Request("https://app.test", { method: "POST", body: JSON.stringify(body) })) as typeof body;
  assert.equal(parseErrorItems(parsed.errors).length, 20);
});
test("oversized JSON is rejected before parsing; malformed JSON keeps validation behavior", async () => {
  await assert.rejects(limitedJson(new Request("https://app.test", { method: "POST", body: '"' + "x".repeat(1024 * 1024) + '"' })));
  assert.equal(await limitedJson(new Request("https://app.test", { method: "POST", body: "{" })), null);
});
