import assert from "node:assert/strict";
import test from "node:test";
import { resolveYoutubeChannel } from "@/lib/youtube-channel-resolver";

const CHANNEL_ID = "UCaaaaaaaaaaaaaaaaaaaaaa";

test("resolveYoutubeChannel rejects unsafe channel URLs before fetch", async () => {
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  const mockedFetch: typeof fetch = async () => {
    fetchCount += 1;
    return new Response("");
  };
  globalThis.fetch = mockedFetch;

  try {
    await assert.rejects(
      resolveYoutubeChannel(`http://www.youtube.com/channel/${CHANNEL_ID}`),
      /유효한 YouTube 채널 링크/,
    );
    await assert.rejects(
      resolveYoutubeChannel(
        "https://www.youtube.com/redirect?q=https://example.com",
      ),
      /유효한 YouTube 채널 링크/,
    );
    await assert.rejects(
      resolveYoutubeChannel("https://youtu.be/dQw4w9WgXcQ"),
      /유효한 YouTube 채널 링크/,
    );
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveYoutubeChannel requires a configured official Data API key", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.YOUTUBE_DATA_API_KEY;
  globalThis.fetch = async () => {
    throw new Error("fetch must not be called without an API key");
  };
  delete process.env.YOUTUBE_DATA_API_KEY;

  try {
    await assert.rejects(
      resolveYoutubeChannel(`https://www.youtube.com/channel/${CHANNEL_ID}`),
      /YOUTUBE_DATA_API_KEY/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey == null) delete process.env.YOUTUBE_DATA_API_KEY;
    else process.env.YOUTUBE_DATA_API_KEY = previousKey;
  }
});
