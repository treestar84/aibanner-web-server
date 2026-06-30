import test from "node:test";
import assert from "node:assert/strict";

import {
  type BskyPost,
  filterCuratedPosts,
  filterSearchPosts,
  mapBskyPost,
} from "./bluesky_source";

const CUTOFF = new Date("2026-06-08T00:00:00.000Z");

function buildPost(overrides: Partial<BskyPost> = {}): BskyPost {
  return {
    uri: "at://did:plc:abc/app.bsky.feed.post/3xyz",
    author: { handle: "unsloth.ai" },
    record: {
      text: "Google releases DiffusionGemma. The new 26B diffusion text model runs locally.",
      createdAt: "2026-06-10T00:00:00.000Z",
    },
    likeCount: 48,
    repostCount: 4,
    replyCount: 2,
    ...overrides,
  };
}

test("mapBskyPost maps post to COMMUNITY RssItem with engagement", () => {
  const item = mapBskyPost(buildPost());

  assert.ok(item);
  assert.equal(item.tier, "COMMUNITY");
  assert.equal(item.sourceDomain, "bsky.app");
  assert.equal(item.link, "https://bsky.app/profile/unsloth.ai/post/3xyz");
  assert.deepEqual(item.engagement, { score: 52, comments: 2 });
  assert.ok(item.title.includes("DiffusionGemma"));
});

test("mapBskyPost returns null for incomplete posts", () => {
  assert.equal(mapBskyPost(buildPost({ record: { text: "", createdAt: "2026-06-10T00:00:00.000Z" } })), null);
  assert.equal(mapBskyPost(buildPost({ author: { handle: "" } })), null);
});

test("filterSearchPosts enforces engagement floor and AI relevance", () => {
  const lowEngagement = buildPost({ likeCount: 1, repostCount: 0 });
  const offTopic = buildPost({
    record: { text: "My cat painted a miniature today", createdAt: "2026-06-10T00:00:00.000Z" },
  });
  const valid = buildPost();

  const items = filterSearchPosts([lowEngagement, offTopic, valid], CUTOFF);
  assert.equal(items.length, 1);
  assert.ok(items[0].title.includes("DiffusionGemma"));
});

test("filterCuratedPosts skips engagement floor but keeps cutoff and relevance", () => {
  const lowEngagement = buildPost({ likeCount: 0, repostCount: 0 });
  const stale = buildPost({
    record: { text: "Old AI model news", createdAt: "2026-05-01T00:00:00.000Z" },
  });

  const items = filterCuratedPosts([lowEngagement, stale], CUTOFF);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].engagement, { score: 0, comments: 2 });
});
