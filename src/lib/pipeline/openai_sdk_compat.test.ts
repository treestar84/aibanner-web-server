import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { generateSummaries } from "./summarize";

test("summary generation retains its Chat Completions wire contract after the SDK upgrade", async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  const previousModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = "unit-test-key";
  process.env.OPENAI_MODEL = "compat-test-model";
  const requests: Record<string, unknown>[] = [];
  try {
    global.fetch = (async (input, init) => {
      assert.equal(String(input), "https://api.openai.com/v1/chat/completions");
      assert.equal(init?.method, "POST");
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        id: "chatcmpl-test", object: "chat.completion", created: 0, model: "compat-test-model",
        choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ summary: "검증된 요약", bullets: ["변경 사항"] }) }, finish_reason: "stop" }],
      }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const result = await generateSummaries("Test Model 2", [{
      title: "Official Test Model 2 release", url: "https://example.com/release", domain: "example.com",
      snippet: "A verified release.", publishedAt: "2026-10-31T00:00:00Z", imageUrl: null, type: "news",
    }]);
    assert.equal(result.ko.summary, "검증된 요약");
    assert.deepEqual(result.ko.bullets, ["#변경 사항"]);
    assert.ok(requests.length >= 1 && requests.length <= 2);
    for (const request of requests) {
      assert.equal(request.model, "compat-test-model");
      assert.equal(request.max_tokens, 800);
      assert.equal(request.temperature, 0.3);
      assert.ok(JSON.stringify(request.messages).includes("Official Test Model 2 release"));
    }
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previousModel;
  }
});

test("JSON-mode editor requests preserve response_format and response extraction", async () => {
  let calls = 0;
  const client = new OpenAI({
    apiKey: "unit-test-key",
    fetch: async (_input, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.response_format, { type: "json_object" });
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: '{"title":"새 제목","body":"새 본문"}' } }],
      }), { headers: { "content-type": "application/json" } });
    },
  });
  const response = await client.chat.completions.create({
    model: "compat-test-model", messages: [{ role: "user", content: "Return JSON" }],
    response_format: { type: "json_object" },
  });
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(response.choices[0].message.content!), { title: "새 제목", body: "새 본문" });
});
