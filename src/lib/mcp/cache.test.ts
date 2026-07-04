import test from "node:test";
import assert from "node:assert/strict";

import { clearCache, getCached } from "@/lib/mcp/cache";

test.beforeEach(() => {
  clearCache();
});

test("getCached returns cached value within TTL without re-invoking loader", async () => {
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return { value: calls };
  };

  const first = await getCached("key-a", 60_000, loader);
  const second = await getCached("key-a", 60_000, loader);

  assert.equal(calls, 1);
  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(second, { value: 1 });
});

test("getCached re-invokes loader after TTL expires", async () => {
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return { value: calls };
  };

  const first = await getCached("key-b", 1, loader);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await getCached("key-b", 1, loader);

  assert.equal(calls, 2);
  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(second, { value: 2 });
});

test("getCached never caches null or undefined loader results", async () => {
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return null;
  };

  await getCached("key-c", 60_000, loader);
  await getCached("key-c", 60_000, loader);
  await getCached("key-c", 60_000, loader);

  assert.equal(calls, 3);
});

test("getCached evicts the oldest entry once MAX_ENTRIES (200) is exceeded", async () => {
  const loader = async (n: number) => ({ value: n });

  for (let i = 0; i < 200; i += 1) {
    await getCached(`bulk:${i}`, 60_000, () => loader(i));
  }

  // store is now at MAX_ENTRIES (200); inserting one more evicts bulk:0
  await getCached("bulk:200", 60_000, () => loader(200));

  let evictedLoaderCalls = 0;
  await getCached("bulk:0", 60_000, async () => {
    evictedLoaderCalls += 1;
    return { value: 0 };
  });
  assert.equal(evictedLoaderCalls, 1, "bulk:0 should have been evicted and reloaded");

  let survivingLoaderCalls = 0;
  await getCached("bulk:200", 60_000, async () => {
    survivingLoaderCalls += 1;
    return { value: 200 };
  });
  assert.equal(survivingLoaderCalls, 0, "bulk:200 should still be cached");
});
