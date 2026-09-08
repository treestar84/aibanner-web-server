import assert from "node:assert/strict";
import test from "node:test";
import { mapCommunityPost, parsePositivePostId } from "./community-post";

test("community post mapping replaces the raw device id with an anonymous author key", () => {
  const mapped = mapCommunityPost({ id: 12, body: "hello", author_device_id: "device-secret" });

  assert.equal("author_device_id" in mapped, false);
  assert.equal(mapped.author_key, "13dfe07f0da5");
  assert.equal(mapped.id, 12);
  assert.equal(mapped.body, "hello");
});

test("post ids accept only positive PostgreSQL integer values", () => {
  assert.equal(parsePositivePostId("1"), 1);
  assert.equal(parsePositivePostId("2147483647"), 2_147_483_647);
  for (const invalid of ["", "0", "-1", "+1", "1.0", "1abc", "2147483648"]) {
    assert.equal(parsePositivePostId(invalid), null, invalid);
  }
});
