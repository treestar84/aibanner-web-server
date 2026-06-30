import test from "node:test";
import assert from "node:assert/strict";

import {
  VENDOR_FORUMS,
  mapDiscourseTopics,
} from "./vendor_announcements_source";

const CURSOR = VENDOR_FORUMS[0];
const CUTOFF = new Date("2026-06-08T00:00:00.000Z");

test("VENDOR_FORUMS includes Cursor and OpenAI announcement categories", () => {
  assert.ok(VENDOR_FORUMS.some((f) => f.vendor === "Cursor"));
  assert.ok(VENDOR_FORUMS.some((f) => f.vendor === "OpenAI"));
});

test("mapDiscourseTopics maps recent topics with vendor prefix and P0 tier", () => {
  const items = mapDiscourseTopics(
    [
      {
        id: 123,
        title: "Bugbot is now 3x faster",
        slug: "bugbot-is-now-3x-faster",
        created_at: "2026-06-11T00:00:00.000Z",
        like_count: 1,
        posts_count: 1,
      },
    ],
    CURSOR,
    CUTOFF
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Cursor: Bugbot is now 3x faster");
  assert.equal(items[0].tier, "P0_CURATED");
  assert.equal(items[0].sourceDomain, "forum.cursor.com");
  assert.equal(items[0].link, "https://forum.cursor.com/t/bugbot-is-now-3x-faster/123");
  assert.deepEqual(items[0].engagement, { score: 1, comments: 0 });
});

test("mapDiscourseTopics skips vendor prefix when title already mentions vendor", () => {
  const items = mapDiscourseTopics(
    [
      {
        id: 7,
        title: "Introducing the Cursor Python SDK",
        slug: "cursor-python-sdk",
        created_at: "2026-06-10T00:00:00.000Z",
      },
    ],
    CURSOR,
    CUTOFF
  );

  assert.equal(items[0].title, "Introducing the Cursor Python SDK");
});

test("mapDiscourseTopics filters pinned old topics by created_at", () => {
  const items = mapDiscourseTopics(
    [
      {
        id: 1,
        title: "Welcome to the forum",
        slug: "welcome",
        created_at: "2025-01-01T00:00:00.000Z",
      },
      { id: 2, title: "", slug: "empty", created_at: "2026-06-10T00:00:00.000Z" },
    ],
    CURSOR,
    CUTOFF
  );

  assert.equal(items.length, 0);
});
