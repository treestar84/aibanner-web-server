import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  normalizeImage,
  InvalidImage,
  MAX_FILE_SIZE_BYTES,
} from "./image-validation";

test("real photo is resized and reencoded without EXIF metadata", async () => {
  const input = await sharp({
    create: { width: 2000, height: 1800, channels: 3, background: "#abcdef" },
  })
    .withMetadata()
    .jpeg()
    .toBuffer();
  const output = await normalizeImage(input);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.height, 1440);
  assert.equal(metadata.exif, undefined);
});
test("HTML/SVG disguised as an image and oversized bytes are rejected", async () => {
  for (const input of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    Buffer.from("<html>not a jpeg</html>"),
    Buffer.alloc(MAX_FILE_SIZE_BYTES + 1),
  ]) {
    await assert.rejects(normalizeImage(input), InvalidImage);
  }
});
test("a valid header with truncated pixel data is rejected", async () => {
  const input = await sharp({
    create: { width: 100, height: 100, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  await assert.rejects(normalizeImage(input.subarray(0, 45)), InvalidImage);
});
test("small GIF remains accepted", async () => {
  const input = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "red" },
  })
    .gif()
    .toBuffer();
  assert.equal(
    (await sharp(await normalizeImage(input)).metadata()).format,
    "webp",
  );
});

test("phone orientation is applied before metadata is stripped", async () => {
  const input = await sharp({
    create: { width: 40, height: 20, channels: 3, background: "red" },
  }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const metadata = await sharp(await normalizeImage(input)).metadata();
  assert.equal(metadata.width, 20);
  assert.equal(metadata.height, 40);
  assert.equal(metadata.orientation, undefined);
});

test("transparent images and multi-frame GIFs keep their presentation", async () => {
  const input = await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer();
  assert.equal((await sharp(await normalizeImage(input)).metadata()).hasAlpha, true);
  const frames = Buffer.concat([Buffer.alloc(8 * 8 * 3, 0), Buffer.alloc(8 * 8 * 3, 255)]);
  const gif = await sharp(frames, {
    raw: { width: 8, height: 16, channels: 3, pageHeight: 8 },
  }).gif({ delay: [100, 200], loop: 0 }).toBuffer();
  const metadata = await sharp(await normalizeImage(gif), { animated: true }).metadata();
  assert.equal(metadata.pages, 2);
  assert.deepEqual(metadata.delay, [100, 200]);
});
