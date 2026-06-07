import OpenAI from "openai";

import type { NormalizedKeyword } from "./keywords";
import type { RssItem } from "./rss";

const MINIMUM_RANKED_KEYWORD_COUNT = 20;
const RELEVANCE_MIN = 7;
const NOVELTY_MIN = 6;
const LEGACY_RELEVANCE_MIN = 5;

const AUDIENCE_RELEVANCE_PROMPT = `Score each keyword on TWO separate axes for vibe coders — developers who use Claude Code, Cursor, Copilot, Codex CLI, Windsurf daily.

## Axis 1: RELEVANCE (1-10)
How directly useful/interesting is this topic to a vibe coder?
- 9-10: Core daily tools (Claude Code, Cursor, Copilot, MCP, AI coding APIs)
- 7-8:  AI developer tools, model releases, dev infrastructure
- 4-6:  General AI news that affects developers indirectly
- 1-3:  Policy, regulation, healthcare, business deals, non-developer topics

## Axis 2: NOVELTY (1-10)
Is this keyword anchored to something NEW happening RIGHT NOW, or is it always-relevant?
- 9-10: Clear new event: specific version number, launch announcement, named release (e.g. "Composer 2.5", "Gemini CLI launch")
- 7-8:  Significant update with clear evidence in titles (new feature, breaking change, new spec)
- 4-6:  Some new angle, but the keyword itself is a known category
- 1-3:  Perennial/evergreen — could have been searched 6 months ago with equally relevant results

NOVELTY=LOW examples (score 1-3) — these are ALWAYS-PRESENT, not trending:
- Bare tool/API names with no version or event: "Claude API", "MCP server", "GitHub Copilot"
- Generic category phrases: "AI-powered assistant", "AI agent skills", "knowledge platform", "AI document assistant"
- Anything composed only of: AI + adjective + category noun

NOVELTY=HIGH requires at least ONE of:
- Explicit version number (Composer 2.5, Qwen3.7-Max, GPT-5)
- Named launch/release event (Gemini CLI launch, Codex CLI 출시)
- Specific named initiative or product (Google Antigravity 2.0, AgentCo-op)

Input: JSON array of objects. Each has "keyword" (string) and "titles" (array of 1-2 article titles).
Use titles to judge novelty — look for version numbers, launch verbs (launches, releases, announces, introduces), or named events.

Output: JSON object mapping keyword → {"relevance": number, "novelty": number}. Include ALL keywords.
Example: {
  "Google Antigravity 2.0": {"relevance": 9, "novelty": 10},
  "Claude API": {"relevance": 9, "novelty": 2},
  "AI-powered assistant": {"relevance": 5, "novelty": 1},
  "MCP server": {"relevance": 8, "novelty": 2},
  "Qwen3.7-Max": {"relevance": 9, "novelty": 9},
  "AI 반도체 수출규제": {"relevance": 2, "novelty": 5}
}`;

type AudienceScore = number | {
  readonly relevance?: number;
  readonly novelty?: number;
};

type AudienceScoreMap = Readonly<Record<string, AudienceScore>>;

interface SelectionOptions {
  readonly minimumKeywordCount?: number;
}

interface ScoredKeyword {
  readonly keyword: NormalizedKeyword;
  readonly index: number;
  readonly relevant: boolean;
  readonly quality: number;
}

export function selectAudienceRelevantKeywords(
  keywords: readonly NormalizedKeyword[],
  scores: AudienceScoreMap,
  options: SelectionOptions = {}
): NormalizedKeyword[] {
  const minimumKeywordCount = options.minimumKeywordCount ?? MINIMUM_RANKED_KEYWORD_COUNT;
  const scored = keywords.map((keyword, index) => scoreKeyword(keyword, scores, index));
  const visible = scored.filter((entry) => entry.relevant);

  if (visible.length >= minimumKeywordCount || visible.length === keywords.length) {
    return visible.map((entry) => entry.keyword);
  }

  const selectedIds = new Set(visible.map((entry) => entry.keyword.keywordId));
  const backfill = scored
    .filter((entry) => !selectedIds.has(entry.keyword.keywordId))
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .slice(0, minimumKeywordCount - visible.length);

  const backfillIds = new Set(backfill.map((entry) => entry.keyword.keywordId));
  return scored
    .filter((entry) => entry.relevant || backfillIds.has(entry.keyword.keywordId))
    .map((entry) => entry.keyword);
}

export async function filterByAudienceRelevance(
  keywords: NormalizedKeyword[],
  items: RssItem[]
): Promise<NormalizedKeyword[]> {
  if (keywords.length <= 5) return keywords;

  const keywordContexts = keywords.map((keyword) => ({
    keyword: keyword.keyword,
    titles: buildKeywordTitles(keyword, items),
  }));

  const client = new OpenAI();

  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [
        { role: "system", content: AUDIENCE_RELEVANCE_PROMPT },
        { role: "user", content: JSON.stringify(keywordContexts) },
      ],
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return keywords;

    const scores = JSON.parse(jsonMatch[0]) as AudienceScoreMap;
    const selected = selectAudienceRelevantKeywords(keywords, scores);
    logAudienceSelection(keywords, selected, scores);
    return selected;
  } catch (err) {
    console.warn("[keywords] Audience relevance check failed, skipping:", (err as Error).message);
    return keywords;
  }
}

function scoreKeyword(
  keyword: NormalizedKeyword,
  scores: AudienceScoreMap,
  index: number
): ScoredKeyword {
  const score = scores[keyword.keyword];
  if (score == null) {
    return { keyword, index, relevant: true, quality: 100 };
  }

  if (typeof score === "number") {
    return {
      keyword,
      index,
      relevant: score >= LEGACY_RELEVANCE_MIN,
      quality: score,
    };
  }

  const relevance = score.relevance ?? 10;
  const novelty = score.novelty ?? 10;
  return {
    keyword,
    index,
    relevant: relevance >= RELEVANCE_MIN && novelty >= NOVELTY_MIN,
    quality: relevance + novelty / 10,
  };
}

function buildKeywordTitles(keyword: NormalizedKeyword, items: readonly RssItem[]): string[] {
  const titledItems = [...keyword.candidates.matchedItems]
    .map((index) => items[index])
    .filter((item): item is RssItem => item != null)
    .sort((a, b) => tierOrder(a.tier) - tierOrder(b.tier));

  return titledItems.slice(0, 2).map((item) => item.title.trim());
}

function tierOrder(tier: string): number {
  switch (tier) {
    case "P0_CURATED":
      return 0;
    case "P1_CONTEXT":
      return 1;
    case "P2_RAW":
      return 2;
    case "COMMUNITY":
      return 3;
    default:
      return 9;
  }
}

function logAudienceSelection(
  keywords: readonly NormalizedKeyword[],
  selected: readonly NormalizedKeyword[],
  scores: AudienceScoreMap
): void {
  const selectedIds = new Set(selected.map((keyword) => keyword.keywordId));
  for (const keyword of keywords) {
    if (selectedIds.has(keyword.keywordId)) continue;
    const score = scores[keyword.keyword];
    if (typeof score === "number") {
      console.log(`[keywords] DROP(low_relevance=${score}): "${keyword.keyword}"`);
      continue;
    }
    console.log(
      `[keywords] DROP(relevance=${score?.relevance ?? 10},novelty=${score?.novelty ?? 10}): "${keyword.keyword}"`
    );
  }
}
