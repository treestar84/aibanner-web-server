import test from "node:test";
import assert from "node:assert/strict";

import { mapOpenRouterModels } from "./openrouter_source";

const CUTOFF = new Date("2026-06-08T00:00:00.000Z");
const RECENT = Math.floor(new Date("2026-06-09T12:00:00.000Z").getTime() / 1000);
const OLD = Math.floor(new Date("2026-05-01T00:00:00.000Z").getTime() / 1000);

test("mapOpenRouterModels keeps only models created after cutoff", () => {
  const items = mapOpenRouterModels(
    [
      { id: "anthropic/claude-fable-5", name: "Anthropic: Claude Fable 5", created: RECENT, context_length: 1000000 },
      { id: "google/gemini-3.5-flash", name: "Google: Gemini 3.5 Flash", created: OLD, context_length: 1048576 },
    ],
    CUTOFF
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].link, "https://openrouter.ai/anthropic/claude-fable-5");
  assert.equal(items[0].tier, "P1_CONTEXT");
  assert.equal(items[0].sourceDomain, "openrouter.ai");
  assert.ok(items[0].title.includes("Claude Fable 5"));
  assert.ok(items[0].summary.includes("1000K"));
});

test("mapOpenRouterModels merges :free variants into the base model", () => {
  const items = mapOpenRouterModels(
    [
      { id: "nvidia/nemotron-3-ultra:free", name: "NVIDIA: Nemotron 3 Ultra (free)", created: RECENT },
      { id: "nvidia/nemotron-3-ultra", name: "NVIDIA: Nemotron 3 Ultra", created: RECENT },
    ],
    CUTOFF
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].link, "https://openrouter.ai/nvidia/nemotron-3-ultra");
  // "(free)" suffix는 제목에서 제거
  assert.ok(!items[0].title.includes("(free)"));
});

test("mapOpenRouterModels skips routing aliases and invalid entries", () => {
  const items = mapOpenRouterModels(
    [
      { id: "~anthropic/claude-fable-latest", name: "Anthropic: Claude Fable Latest", created: RECENT },
      { id: "vendor/no-created-field", name: "No Created" },
    ],
    CUTOFF
  );

  assert.equal(items.length, 0);
});
