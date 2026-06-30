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

test("resolveYoutubeChannel caps oversized channel responses", async () => {
  const originalFetch = globalThis.fetch;
  const mockedFetch: typeof fetch = async (_input, init) => {
    assert.equal(init?.redirect, "manual");
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response("", {
      headers: {
        "content-length": String(1024 * 1024 + 1),
      },
      status: 200,
    });
  };
  globalThis.fetch = mockedFetch;

  try {
    await assert.rejects(
      resolveYoutubeChannel(`https://www.youtube.com/channel/${CHANNEL_ID}`),
      /채널 응답이 너무 큽니다/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
