import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { uploadImage } from "./image-upload";

function request(bytes: Buffer, type = "image/jpeg") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], "photo.jpg", { type }));
  return new Request("https://app.test/api/v1/posts/upload-image", { method: "POST", body: form });
}
test("legacy multipart upload keeps ok/imageUrl response and only stores validated bytes", async () => {
  const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } }).jpeg().toBuffer();
  let saved = 0;
  const response = await uploadImage(request(bytes), "community-posts", {
    configured: () => true,
    async save(path, image) {
      saved++;
      assert.match(path, /^community-posts\/[a-f0-9-]+\.webp$/);
      assert.equal((await sharp(image).metadata()).format, "webp");
      return { url: "https://example.public.blob.vercel-storage.com/new.webp" };
    },
  });
  assert.equal(response.status, 200); assert.equal(saved, 1);
  assert.deepEqual(await response.json(), { ok: true, imageUrl: "https://example.public.blob.vercel-storage.com/new.webp" });
});
test("bad MIME, disguised HTML and oversized bodies never reach storage", async () => {
  for (const req of [request(Buffer.from("bad"), "image/svg+xml"), request(Buffer.from("<html>fake</html>")),
    new Request("https://app.test/upload", { method: "POST", body: new Uint8Array(4 * 1024 * 1024 + 65537) })]) {
    const response = await uploadImage(req, "expert-picks", {
      configured: () => true, save: async () => { assert.fail("invalid image stored"); },
    });
    assert.ok([400, 413].includes(response.status));
  }
});
test("storage failure returns a stable error without internal credentials", async () => {
  const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } }).png().toBuffer();
  const response = await uploadImage(request(bytes, "image/png"), "expert-picks", {
    configured: () => true, save: async () => { throw Error("sensitive provider detail"); },
  });
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /sensitive/);
});
