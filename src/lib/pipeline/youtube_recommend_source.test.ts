import assert from "node:assert/strict";
import test from "node:test";
import { readLimitedResponsePrefixText } from "@/lib/youtube-fetch";
import { parseDurationSecondsFromWatchHtml } from "@/lib/youtube-video-type";

test("readLimitedResponsePrefixText keeps the readable prefix when metadata page exceeds the byte cap", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"lengthSeconds":"52"}'));
      controller.enqueue(new Uint8Array(2 * 1024 * 1024).fill(65));
      controller.close();
    },
  });

  const html = await readLimitedResponsePrefixText(new Response(stream), 1024);

  assert.equal(parseDurationSecondsFromWatchHtml(html), 52);
  assert.ok(new TextEncoder().encode(html).byteLength <= 1024);
});
