import assert from "node:assert/strict";
import test from "node:test";
import { parseYouTubeIsoDurationSeconds } from "@/lib/youtube-video-type";

test("parseYouTubeIsoDurationSeconds uses official Data API duration values", () => {
  assert.equal(parseYouTubeIsoDurationSeconds("PT52S"), 52);
  assert.equal(parseYouTubeIsoDurationSeconds("PT1M30S"), 90);
  assert.equal(parseYouTubeIsoDurationSeconds("PT2H3M4S"), 7384);
  assert.equal(parseYouTubeIsoDurationSeconds("invalid"), null);
});
