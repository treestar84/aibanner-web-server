import assert from "node:assert/strict";
import test from "node:test";
import { buildTuningPrompt } from "./expert-picks-tuning";

test("tuning prompt instructs the model to preserve facts and paragraph structure", () => {
  const { system } = buildTuningPrompt("아무 텍스트");
  assert.match(system, /사실|fact/i);
  assert.match(system, /줄바꿈|paragraph/i);
});

test("tuning prompt embeds the original body verbatim in the user message", () => {
  const bodyKo = "오픈AI가\n새 모델을 발표했다.";
  const { user } = buildTuningPrompt(bodyKo);
  assert.match(user, /오픈AI가\n새 모델을 발표했다\./);
});
