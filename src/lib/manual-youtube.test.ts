import test from "node:test";
import assert from "node:assert/strict";
import {
  buildYoutubeThumbnailUrl,
  extractYoutubeVideoId,
  normalizeYoutubeVideoUrl,
  resolveManualVideoType,
} from "@/lib/manual-youtube";

test("extractYoutubeVideoId supports watch, shortlink, shorts, and raw id", () => {
  assert.equal(
    extractYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  assert.equal(
    extractYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ?si=abc"),
    "dQw4w9WgXcQ",
  );
  assert.equal(
    extractYoutubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  assert.equal(extractYoutubeVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("normalizeYoutubeVideoUrl canonicalizes valid input and rejects invalid input", () => {
  assert.deepEqual(normalizeYoutubeVideoUrl("https://youtu.be/dQw4w9WgXcQ"), {
    videoId: "dQw4w9WgXcQ",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });

  assert.equal(
    normalizeYoutubeVideoUrl("not-a-youtube-url").error,
    "유효한 YouTube 링크 또는 영상 ID를 입력해 주세요.",
  );
});

test("buildYoutubeThumbnailUrl creates hqdefault thumbnail url", () => {
  assert.equal(
    buildYoutubeThumbnailUrl("dQw4w9WgXcQ"),
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  );
});

test("resolveManualVideoType preserves manual shorts when the same watch URL is saved again", () => {
  assert.equal(
    resolveManualVideoType({
      inputVideoType: "unknown",
      videoId: "dQw4w9WgXcQ",
      existingVideoType: "longform",
      existingManualVideoId: "dQw4w9WgXcQ",
      existingManualVideoType: "shorts",
    }),
    "shorts",
  );

  assert.equal(
    resolveManualVideoType({
      inputVideoType: "unknown",
      videoId: "abcdefghijk",
      existingManualVideoId: "dQw4w9WgXcQ",
      existingManualVideoType: "shorts",
    }),
    "unknown",
  );
});
