import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const middlewareSource = readFileSync(new URL("./middleware.ts", import.meta.url), "utf8");

test("expert-picks views endpoint has its own tighter rate limit than the general list endpoint", () => {
  assert.match(middlewareSource, /\["\/api\/v1\/expert-picks\/views",\s*\d+\]/);
  assert.match(middlewareSource, /\["\/api\/v1\/expert-picks",\s*\d+\]/);
});

test("content-likes toggle endpoint is rate-limited tighter than its batch counts read", () => {
  const countsMatch = middlewareSource.match(
    /\["\/api\/v1\/content-likes\/counts",\s*(\d+)\]/,
  );
  const toggleMatch = middlewareSource.match(
    /\["\/api\/v1\/content-likes",\s*(\d+)\]/,
  );
  assert.ok(countsMatch, "content-likes/counts rate limit entry not found");
  assert.ok(toggleMatch, "content-likes rate limit entry not found");
  const countsRpm = Number(countsMatch![1]);
  const toggleRpm = Number(toggleMatch![1]);
  assert.ok(
    toggleRpm < countsRpm,
    "a single-tap toggle endpoint should be capped tighter than a batch read",
  );

  // 더 구체적인 prefix(counts)가 배열에서 더 앞에 있어야 한다 — 뒤에 있으면
  // startsWith 매칭에서 "/api/v1/content-likes"에 먼저 걸려 counts 전용
  // 제한이 절대 적용되지 않는다.
  const countsIndex = middlewareSource.indexOf('"/api/v1/content-likes/counts"');
  const toggleIndex = middlewareSource.indexOf('"/api/v1/content-likes"');
  assert.ok(countsIndex >= 0 && toggleIndex >= 0);
  assert.ok(countsIndex < toggleIndex);
});

test("device register endpoint is rate-limited tighter than posts endpoints", () => {
  const deviceMatch = middlewareSource.match(
    /\["\/api\/v1\/device\/register",\s*(\d+)\]/,
  );
  const postsMatch = middlewareSource.match(
    /\["\/api\/v1\/posts",\s*(\d+)\]/,
  );
  assert.ok(deviceMatch, "device/register rate limit entry not found");
  assert.ok(postsMatch, "posts rate limit entry not found");
  const deviceRpm = Number(deviceMatch![1]);
  const postsRpm = Number(postsMatch![1]);
  assert.ok(
    deviceRpm < postsRpm,
    "registration endpoint should be capped much tighter than general posts endpoint",
  );
});

test("posts top endpoint comes before posts general endpoint in RATE_LIMITS array", () => {
  // 더 구체적인 prefix(posts/top)가 배열에서 더 앞에 있어야 한다 — 뒤에 있으면
  // startsWith 매칭에서 "/api/v1/posts"에 먼저 걸려 posts/top 전용
  // 제한이 절대 적용되지 않는다.
  const topIndex = middlewareSource.indexOf('"/api/v1/posts/top"');
  const postsIndex = middlewareSource.indexOf('"/api/v1/posts"');
  assert.ok(topIndex >= 0 && postsIndex >= 0);
  assert.ok(topIndex < postsIndex, "posts/top must appear before posts in the array");
});
