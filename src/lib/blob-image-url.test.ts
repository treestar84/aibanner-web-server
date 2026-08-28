import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedBlobImageUrl } from "./blob-image-url";

test("accepts a URL of the shape @vercel/blob's put() actually returns", () => {
  assert.equal(
    isAllowedBlobImageUrl(
      "https://abc123xyz.public.blob.vercel-storage.com/community-posts/1756000000000-k3j9.jpg",
    ),
    true,
  );
});

test("rejects an arbitrary external image URL", () => {
  assert.equal(isAllowedBlobImageUrl("https://evil.example.com/tracker.gif"), false);
  assert.equal(isAllowedBlobImageUrl("https://i.imgur.com/abc.png"), false);
});

test("rejects non-https schemes, including data: and javascript:", () => {
  assert.equal(
    isAllowedBlobImageUrl("http://abc.public.blob.vercel-storage.com/a.jpg"),
    false,
  );
  assert.equal(isAllowedBlobImageUrl("data:image/png;base64,iVBORw0KGgo="), false);
  assert.equal(isAllowedBlobImageUrl("javascript:alert(1)"), false);
});

test("rejects hostnames that merely contain the allowed suffix as a prefix or path", () => {
  assert.equal(
    isAllowedBlobImageUrl("https://public.blob.vercel-storage.com.evil.example/a.jpg"),
    false,
  );
  assert.equal(
    isAllowedBlobImageUrl("https://evil.example/public.blob.vercel-storage.com/a.jpg"),
    false,
  );
});

test("rejects the private (non-public) blob host, since the upload route only writes public blobs", () => {
  assert.equal(isAllowedBlobImageUrl("https://abc.blob.vercel-storage.com/a.jpg"), false);
});

test("rejects garbage that is not a URL at all", () => {
  assert.equal(isAllowedBlobImageUrl("not a url"), false);
  assert.equal(isAllowedBlobImageUrl(""), false);
});
