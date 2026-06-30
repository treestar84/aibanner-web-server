import test from "node:test";
import assert from "node:assert/strict";

import { mapHfModels } from "./huggingface_source";

const CUTOFF = new Date("2026-06-08T00:00:00.000Z");

test("mapHfModels keeps recent official-org models as P1_CONTEXT", () => {
  const items = mapHfModels(
    [
      {
        id: "google/diffusiongemma-26B-A4B-it",
        createdAt: "2026-06-09T00:00:00.000Z",
        likes: 191,
        pipeline_tag: "image-text-to-text",
      },
    ],
    CUTOFF
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].tier, "P1_CONTEXT");
  assert.equal(items[0].sourceDomain, "huggingface.co");
  assert.equal(items[0].link, "https://huggingface.co/google/diffusiongemma-26B-A4B-it");
  // 키워드 추출용 제목에 slash 없는 "org modelName" 형태 유지
  assert.ok(items[0].title.startsWith("google diffusiongemma-26B-A4B-it"));
  assert.deepEqual(items[0].engagement, { score: 191, comments: 0 });
});

test("mapHfModels drops trending models created before cutoff", () => {
  const items = mapHfModels(
    [
      { id: "deepseek-ai/DeepSeek-V4-Pro", createdAt: "2026-04-22T00:00:00.000Z", likes: 4758 },
    ],
    CUTOFF
  );
  assert.equal(items.length, 0);
});

test("mapHfModels gates community models by minimum likes", () => {
  const items = mapHfModels(
    [
      { id: "nex-agi/Nex-N2-Pro", createdAt: "2026-06-09T00:00:00.000Z", likes: 178 },
      { id: "some-user/tiny-model", createdAt: "2026-06-09T00:00:00.000Z", likes: 5 },
    ],
    CUTOFF
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].tier, "COMMUNITY");
  assert.ok(items[0].title.includes("Nex-N2-Pro"));
});

test("mapHfModels filters community remixes and quantized re-uploads", () => {
  const items = mapHfModels(
    [
      { id: "SomeUser/Qwen3.6-35B-Uncensored", createdAt: "2026-06-09T00:00:00.000Z", likes: 1630 },
      { id: "OBLITERATUS/Gemma-4-12B-OBLITERATED", createdAt: "2026-06-09T00:00:00.000Z", likes: 210 },
      { id: "unsloth/gemma-4-12b-it-GGUF", createdAt: "2026-06-09T00:00:00.000Z", likes: 548 },
    ],
    CUTOFF
  );
  assert.equal(items.length, 0);
});
