import OpenAI from "openai";

import { parsePositiveIntEnv } from "./tavily_client_pool";
import type { TavilySource } from "./tavily";

export interface EventRelevanceScoreMap {
  readonly [index: string]: number;
}

function parseBooleanEnv(value: string | undefined, fallback = true): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

const ENABLE_EVENT_RELEVANCE_GATE = parseBooleanEnv(
  process.env.ENABLE_EVENT_RELEVANCE_GATE,
  true
);
const EVENT_RELEVANCE_MIN = parsePositiveIntEnv(
  process.env.EVENT_RELEVANCE_MIN,
  5,
  1,
  10
);

export function selectByEventRelevance<T>(
  candidates: readonly T[],
  scores: EventRelevanceScoreMap,
  minScore: number
): T[] {
  return candidates.filter((_, index) => {
    const score = scores[String(index)];
    // 점수 누락·비숫자 응답은 fail-open (후보 유지)
    if (typeof score !== "number" || Number.isNaN(score)) return true;
    return score >= minScore;
  });
}

export async function filterByEventRelevance(
  keyword: string,
  eventSummary: string,
  candidates: TavilySource[]
): Promise<TavilySource[]> {
  if (!ENABLE_EVENT_RELEVANCE_GATE) return candidates;
  if (eventSummary === "" || candidates.length === 0) return candidates;

  const client = new OpenAI();

  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Keyword "${keyword}" is trending because of this event: ${eventSummary}
Score each candidate 0-10 for how directly it covers THIS SPECIFIC event
(not merely the same words or the same product in a different context).
Old news about the same product from a different event scores low (0-3).
Output STRICT JSON mapping index → score, e.g. {"0": 8, "1": 2}. Include ALL indices.`,
        },
        {
          role: "user",
          content: JSON.stringify(
            candidates.map((candidate, index) => ({
              i: index,
              title: candidate.title.slice(0, 120),
              snippet: (candidate.snippet ?? "").slice(0, 200),
              domain: candidate.domain,
              publishedAt: candidate.publishedAt,
            }))
          ),
        },
      ],
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return candidates;

    const scores = JSON.parse(jsonMatch[0]) as EventRelevanceScoreMap;
    const selected = selectByEventRelevance(candidates, scores, EVENT_RELEVANCE_MIN);

    const selectedSet = new Set(selected);
    candidates.forEach((candidate, index) => {
      if (selectedSet.has(candidate)) return;
      const score = scores[String(index)];
      console.log(
        `[sources] DROP(event_relevance=${score}): ${candidate.domain} ${candidate.title.slice(0, 60)}`
      );
    });

    return selected;
  } catch (err) {
    console.warn("[sources] Event relevance gate failed, skipping:", (err as Error).message);
    return candidates;
  }
}
