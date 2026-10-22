import test from "node:test";
import assert from "node:assert/strict";
import {
  publicHttpUrl,
  isPublicAddress,
  assertPublicAddresses,
  readLimitedBody,
  safeFetchBytes,
} from "./safe-fetch";

test("blocks loopback, private, metadata, IPv4-mapped IPv6 and non-http destinations", async () => {
  for (const url of [
    "http://127.1",
    "http://2130706433",
    "http://10.0.0.1",
    "http://169.254.169.254/latest",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "file:///etc/passwd",
    "http://localhost",
    "https://name:password@example.com",
    "http://example.com:8080",
  ]) {
    assert.throws(() => publicHttpUrl(url), Error, url);
    await assert.rejects(safeFetchBytes(url));
  }
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("fc00::1"), false);
  assert.equal(isPublicAddress("100.64.1.1"), false);
});
test("stream byte limit applies even without or with a lying content-length and cancels reading", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(100));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    readLimitedBody(
      new Response(body, { headers: { "content-length": "1" } }),
      150,
    ),
  );
  assert.equal(cancelled, true);
  assert.equal(
    (await readLimitedBody(new Response("abc"), 3)).toString(),
    "abc",
  );
});
test("redirect targets are independently rejected before another connection", () => {
  const next = new URL(
    "//169.254.169.254/secret",
    publicHttpUrl("https://example.com"),
  );
  assert.throws(() => publicHttpUrl(next.href));
});

test("socket DNS validation refuses empty and mixed public/private answers", () => {
  assert.throws(() => assertPublicAddresses([]));
  assert.throws(() =>
    assertPublicAddresses([{ address: "8.8.8.8" }, { address: "127.0.0.1" }]),
  );
  assert.doesNotThrow(() =>
    assertPublicAddresses([{ address: "8.8.8.8" }, { address: "1.1.1.1" }]),
  );
});
