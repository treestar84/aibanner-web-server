import OpenAI from "openai";

import type { NormalizedKeyword } from "./keywords";
import type { RssItem } from "./rss";

const MINIMUM_RANKED_KEYWORD_COUNT = 20;
const RELEVANCE_MIN = 7;
const NOVELTY_MIN = 6;
const LEGACY_RELEVANCE_MIN = 5;
// 커뮤니티(engagement 보유) 화제 키워드는 버전/출시 이벤트가 없어도 트렌드일 수 있어
// novelty 하한을 완화한다. (SNS 바이럴 데모/논쟁류 누락 방지)
const NOVELTY_MIN_HIGH_ENGAGEMENT = 4;
// score + comments*2 합산이 이 값 이상이면 high-engagement로 간주
const HIGH_ENGAGEMENT_COMBINED = 300;
// 명시적으로 novelty ≤ 3 (evergreen 판정)을 받은 키워드는 백필로도 부활 금지
// ("MCP server" 같은 generic 용어가 한산한 날 Top20에 재진입하는 누수 차단)
const BACKFILL_NOVELTY_CUTOFF = 3;
// LLM 응답에서 점수가 누락된 키워드: 자동 통과 대신 백필 최우선 후보로만 취급
const MISSING_SCORE_BACKFILL_QUALITY = 50;

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
  /** engagement 합산이 높은 키워드 ID 집합 — novelty 하한 완화 대상 */
  readonly highEngagementKeywordIds?: ReadonlySet<string>;
}

interface ScoredKeyword {
  readonly keyword: NormalizedKeyword;
  readonly index: number;
  readonly relevant: boolean;
  readonly quality: number;
  /** false면 minimum 미달 시에도 백필로 재진입 불가 (명시적 evergreen 판정) */
  readonly backfillEligible: boolean;
}

export function selectAudienceRelevantKeywords(
  keywords: readonly NormalizedKeyword[],
  scores: AudienceScoreMap,
  options: SelectionOptions = {}
): NormalizedKeyword[] {
  const minimumKeywordCount = options.minimumKeywordCount ?? MINIMUM_RANKED_KEYWORD_COUNT;
  const highEngagementIds = options.highEngagementKeywordIds ?? new Set<string>();
  const scored = keywords.map((keyword, index) =>
    scoreKeyword(keyword, scores, index, highEngagementIds.has(keyword.keywordId))
  );
  const visible = scored.filter((entry) => entry.relevant);

  if (visible.length >= minimumKeywordCount || visible.length === keywords.length) {
    return visible.map((entry) => entry.keyword);
  }

  const selectedIds = new Set(visible.map((entry) => entry.keyword.keywordId));
  const backfill = scored
    .filter(
      (entry) =>
        !selectedIds.has(entry.keyword.keywordId) && entry.backfillEligible
    )
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

  const highEngagementKeywordIds = buildHighEngagementKeywordIds(keywords, items);

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
    const selected = selectAudienceRelevantKeywords(keywords, scores, {
      highEngagementKeywordIds,
    });
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
  index: number,
  highEngagement: boolean
): ScoredKeyword {
  const score = scores[keyword.keyword];
  if (score == null) {
    // LLM이 점수를 누락한 키워드: 무조건 통과시키지 않고
    // minimum 미달 시 백필 최우선 후보로만 살린다.
    return {
      keyword,
      index,
      relevant: false,
      quality: MISSING_SCORE_BACKFILL_QUALITY,
      backfillEligible: true,
    };
  }

  if (typeof score === "number") {
    return {
      keyword,
      index,
      relevant: score >= LEGACY_RELEVANCE_MIN,
      quality: score,
      backfillEligible: score > BACKFILL_NOVELTY_CUTOFF,
    };
  }

  const relevance = score.relevance ?? 10;
  const novelty = score.novelty ?? 10;
  const noveltyMin = highEngagement ? NOVELTY_MIN_HIGH_ENGAGEMENT : NOVELTY_MIN;
  return {
    keyword,
    index,
    relevant: relevance >= RELEVANCE_MIN && novelty >= noveltyMin,
    quality: relevance + novelty / 10,
    backfillEligible: novelty > BACKFILL_NOVELTY_CUTOFF,
  };
}

function buildHighEngagementKeywordIds(
  keywords: readonly NormalizedKeyword[],
  items: readonly RssItem[]
): Set<string> {
  const ids = new Set<string>();
  for (const keyword of keywords) {
    let combined = 0;
    for (const index of keyword.candidates.matchedItems) {
      const engagement = items[index]?.engagement;
      if (!engagement) continue;
      combined += engagement.score + engagement.comments * 2;
    }
    if (combined >= HIGH_ENGAGEMENT_COMBINED) {
      ids.add(keyword.keywordId);
    }
  }
  return ids;
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
