import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyYouTubeVideo,
  isVisibleForYouTubeFilter,
  parseDurationSecondsFromWatchHtml,
  parseYouTubeRecentLimit,
  parseYouTubeVideoFilter,
  toSafeYouTubeMetadataUrl,
} from "./youtube-video-type";

describe("youtube video type helpers", () => {
  it("defaults invalid API filters to longform", () => {
    assert.equal(parseYouTubeVideoFilter(null), "longform");
    assert.equal(parseYouTubeVideoFilter(""), "longform");
    assert.equal(parseYouTubeVideoFilter("shorts"), "shorts");
    assert.equal(parseYouTubeVideoFilter("all"), "all");
  });

  it("sanitizes public recent limits before DB queries", () => {
    assert.equal(parseYouTubeRecentLimit(null), 20);
    assert.equal(parseYouTubeRecentLimit("abc"), 20);
    assert.equal(parseYouTubeRecentLimit("0"), 1);
    assert.equal(parseYouTubeRecentLimit("99"), 50);
    assert.equal(parseYouTubeRecentLimit("12"), 12);
  });

  it("classifies shorts by URL and duration", () => {
    assert.equal(
      classifyYouTubeVideo({
        videoUrl: "https://www.youtube.com/shorts/abcdefghijk",
        durationSeconds: 300,
      }),
      "shorts",
    );
    assert.equal(
      classifyYouTubeVideo({
        videoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
        durationSeconds: 60,
      }),
      "shorts",
    );
    assert.equal(
      classifyYouTubeVideo({
        videoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
        durationSeconds: 180,
      }),
      "shorts",
    );
    assert.equal(
      classifyYouTubeVideo({
        videoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
        durationSeconds: 181,
      }),
      "longform",
    );
  });

  it("allows only canonical YouTube metadata fetch URLs", () => {
    assert.equal(
      toSafeYouTubeMetadataUrl("https://www.youtube.com/watch?v=abcdefghijk"),
      "https://www.youtube.com/watch?v=abcdefghijk",
    );
    assert.equal(
      toSafeYouTubeMetadataUrl("https://youtu.be/abcdefghijk"),
      "https://www.youtube.com/watch?v=abcdefghijk",
    );
    assert.equal(
      toSafeYouTubeMetadataUrl("https://www.youtube.com/shorts/abcdefghijk"),
      "https://www.youtube.com/shorts/abcdefghijk",
    );
    assert.equal(
      toSafeYouTubeMetadataUrl("http://www.youtube.com/watch?v=abcdefghijk"),
      null,
    );
    assert.equal(
      toSafeYouTubeMetadataUrl("https://example.com/watch?v=abcdefghijk"),
      null,
    );
    assert.equal(
      toSafeYouTubeMetadataUrl(
        "https://www.youtube.com/redirect?q=https://example.com",
      ),
      null,
    );
  });

  it("keeps unclassified legacy rows in the default longform feed", () => {
    assert.equal(isVisibleForYouTubeFilter("unknown", "longform"), true);
    assert.equal(isVisibleForYouTubeFilter("unknown", "shorts"), false);
    assert.equal(isVisibleForYouTubeFilter("shorts", "all"), true);
  });

  it("extracts duration from common watch page metadata shapes", () => {
    assert.equal(
      parseDurationSecondsFromWatchHtml('{"lengthSeconds":"123"}'),
      123,
    );
    assert.equal(parseDurationSecondsFromWatchHtml('{"lengthSeconds":45}'), 45);
    assert.equal(
      parseDurationSecondsFromWatchHtml('{"approxDurationMs":"120000"}'),
      120,
    );
  });
});
