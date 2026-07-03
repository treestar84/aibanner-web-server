import assert from "node:assert/strict";
import test from "node:test";

import { parseSearchQueryPlan } from "@/lib/pipeline/search_query_plan";

test("parseSearchQueryPlan parses a normal LLM response", () => {
  const content = JSON.stringify({
    disambiguation_terms: ["OpenAI", "GPT-5 launch"],
    event_summary: "OpenAI announced GPT-5 with new coding benchmarks.",
  });

  const plan = parseSearchQueryPlan(content, "GPT-5");

  assert.deepEqual(plan?.disambiguationTerms, ["OpenAI", "GPT-5 launch"]);
  assert.equal(plan?.eventSummary, "OpenAI announced GPT-5 with new coding benchmarks.");
});

test("parseSearchQueryPlan truncates to 3 terms and filters invalid lengths", () => {
  const content = JSON.stringify({
    disambiguation_terms: ["a", "OK term", "Second term", "Third term", "Fourth term"],
    event_summary: "Event summary.",
  });

  const plan = parseSearchQueryPlan(content, "keyword");

  assert.deepEqual(plan?.disambiguationTerms, ["OK term", "Second term", "Third term"]);
});

test("parseSearchQueryPlan removes terms duplicating the keyword (case-insensitive)", () => {
  const content = JSON.stringify({
    disambiguation_terms: ["GPT-5", "gpt-5", "OpenAI launch"],
    event_summary: "Event summary.",
  });

  const plan = parseSearchQueryPlan(content, "GPT-5");

  assert.deepEqual(plan?.disambiguationTerms, ["OpenAI launch"]);
});

test("parseSearchQueryPlan returns null for malformed JSON", () => {
  const plan = parseSearchQueryPlan("not json at all", "keyword");
  assert.equal(plan, null);
});

test("parseSearchQueryPlan returns null when terms and summary are both empty", () => {
  const content = JSON.stringify({ disambiguation_terms: [], event_summary: "" });
  const plan = parseSearchQueryPlan(content, "keyword");
  assert.equal(plan, null);
});
