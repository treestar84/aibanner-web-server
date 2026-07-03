import OpenAI from "openai";

import type { EventContextArticle } from "./event_context";

const MAX_DISAMBIGUATION_TERMS = 3;
const MIN_TERM_LENGTH = 2;
const MAX_TERM_LENGTH = 40;

export interface SearchQueryPlan {
  readonly disambiguationTerms: readonly string[];
  readonly eventSummary: string;
}

const SEARCH_QUERY_PLAN_PROMPT = `A keyword is trending RIGHT NOW because of a specific event described by the article titles below.
1) Give up to 3 short disambiguation search terms that pin web search results to THIS event
   (company name, product name, version number, event verb). Do NOT repeat the keyword itself.
   Do NOT use site: or other search operators.
2) Summarize the event in one English sentence.
Output STRICT JSON: {"disambiguation_terms": ["..."], "event_summary": "..."}`;

function parseBooleanEnv(value: string | undefined, fallback = true): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

const ENABLE_QUERY_CONTEXTUALIZATION = parseBooleanEnv(
  process.env.ENABLE_QUERY_CONTEXTUALIZATION,
  true
);

export function parseSearchQueryPlan(
  content: string,
  keyword: string
): SearchQueryPlan | null {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const raw = parsed as { disambiguation_terms?: unknown; event_summary?: unknown };

  const keywordLower = keyword.trim().toLowerCase();
  const rawTerms = Array.isArray(raw.disambiguation_terms) ? raw.disambiguation_terms : [];
  const terms = rawTerms
    .filter((term): term is string => typeof term === "string")
    .map((term) => term.trim())
    .filter((term) => term.length >= MIN_TERM_LENGTH && term.length <= MAX_TERM_LENGTH)
    .filter((term) => term.toLowerCase() !== keywordLower)
    .slice(0, MAX_DISAMBIGUATION_TERMS);

  const eventSummary = typeof raw.event_summary === "string" ? raw.event_summary.trim() : "";

  if (terms.length === 0 && eventSummary === "") return null;

  return { disambiguationTerms: terms, eventSummary };
}

export async function buildSearchQueryPlanViaLlm(
  keyword: string,
  articles: readonly EventContextArticle[]
): Promise<SearchQueryPlan | null> {
  if (articles.length === 0) return null;
  if (!ENABLE_QUERY_CONTEXTUALIZATION) return null;

  const client = new OpenAI();

  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [
        { role: "system", content: SEARCH_QUERY_PLAN_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            keyword,
            titles: articles.slice(0, 3).map((article) => article.title),
          }),
        },
      ],
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content ?? "";
    return parseSearchQueryPlan(content, keyword);
  } catch (err) {
    console.warn(
      "[sources] Search query plan generation failed, skipping:",
      (err as Error).message
    );
    return null;
  }
}
