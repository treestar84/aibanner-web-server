import type { RankingSimulatorCandidate } from "@/lib/admin/ranking_simulator";

export type RankingQualityClass = "protected_good" | "known_noise" | "neutral";

export interface RankingQualityFixture extends RankingSimulatorCandidate {
  readonly expected_quality: RankingQualityClass;
  readonly quality_notes: readonly string[];
  readonly top_source_url: string | null;
  readonly latest_source_at: string | null;
  readonly summary_short: string | null;
}

const protectedInputs = [
  {
    keyword: "Ideogram 4.0",
    keyword_normalized: "ideogram_4_0",
    scores: [0.86, 0.72, 0.42, 0.39, 0.61],
    source: ["Ideogram 4.0 introduces improved image generation", "ideogram.ai", "https://ideogram.ai/blog/ideogram-4", "2026-06-03T16:00:00.000Z", 4],
    notes: ["recent official release", "specific versioned product"],
  },
  {
    keyword: "Claude Code v2.1.165",
    keyword_normalized: "claude_code_v2_1_165",
    scores: [0.82, 0.79, 0.51, 0.44, 0.65],
    source: ["Claude Code package update v2.1.165", "npmjs.com", "https://www.npmjs.com/package/@anthropic-ai/claude-code", "2026-06-05T05:22:42.188Z", 3],
    notes: ["fresh npm release", "specific version"],
  },
  {
    keyword: "vercel/ai ai@7.0.0-canary.165",
    keyword_normalized: "vercel_ai_7_0_0_canary_165",
    scores: [0.78, 0.76, 0.47, 0.41, 0.62],
    source: ["ai@7.0.0-canary.165 package release", "npmjs.com", "https://www.npmjs.com/package/ai", "2026-06-05T04:39:36.779Z", 2],
    notes: ["fresh npm release", "specific developer package"],
  },
  {
    keyword: "Gemma 4 12B",
    keyword_normalized: "gemma_4_12b",
    scores: [0.74, 0.7, 0.49, 0.46, 0.59],
    source: ["Gemma 4 12B developer model release", "developers.googleblog.com", "https://developers.googleblog.com/", "2026-06-03T10:00:00.000Z", 3],
    notes: ["recent model release", "specific model size"],
  },
  {
    keyword: "Project Solara",
    keyword_normalized: "project_solara",
    scores: [0.58, 0.62, 0.56, 0.53, 0.57],
    source: ["Project Solara draws renewed Build developer interest", "microsoft.com", "https://blogs.microsoft.com/", "2026-06-03T20:30:00.000Z", 5],
    notes: ["reignition", "developer event context"],
  },
  {
    keyword: "claude-memory",
    keyword_normalized: "claude_memory",
    scores: [0.69, 0.59, 0.45, 0.48, 0.55],
    source: ["claude-memory repository gains coding-agent usage", "github.com", "https://github.com/", "2026-06-04T12:00:00.000Z", 2],
    notes: ["specific repo", "coding-agent workflow"],
  },
] as const;

const noiseInputs = [
  {
    keyword: "dx-aem-flow",
    keyword_normalized: "dx_aem_flow",
    source: ["DXC Technology finance update", "finance.yahoo.com", "https://finance.yahoo.com/", "2026-06-05T13:00:00.000Z", 1],
    notes: ["off-topic finance source", "weak coding relevance"],
  },
  {
    keyword: "Phoenix Code",
    keyword_normalized: "phoenix_code",
    source: ["Eurovision performer Phoenix code name story", "eurovision.tv", "https://eurovision.tv/", "2026-06-05T09:00:00.000Z", 1],
    notes: ["entertainment source", "keyword collision"],
  },
  {
    keyword: "Minimi",
    keyword_normalized: "minimi",
    source: ["Celebrity Minimi entertainment news", "sports.chosun.com", "https://sports.chosun.com/", "2026-06-04T08:00:00.000Z", 1],
    notes: ["entertainment source", "no AI coding context"],
  },
  {
    keyword: "MCP server",
    keyword_normalized: "mcp_server",
    source: [null, null, null, null, 0],
    notes: ["generic-only phrase", "missing fresh source"],
  },
  {
    keyword: "AI coding agent",
    keyword_normalized: "ai_coding_agent",
    source: [null, null, null, null, 0],
    notes: ["generic-only phrase", "missing named anchor"],
  },
] as const;

export function buildAuditQualityFixtures(): readonly RankingQualityFixture[] {
  return [
    ...protectedInputs.map((input) =>
      buildFixture(input.keyword, input.keyword_normalized, "protected_good", input.source, input.notes, input.scores)
    ),
    ...noiseInputs.map((input) =>
      buildFixture(input.keyword, input.keyword_normalized, "known_noise", input.source, input.notes)
    ),
  ];
}

function buildFixture(
  keyword: string,
  keywordNormalized: string,
  expectedQuality: RankingQualityClass,
  source: readonly [string | null, string | null, string | null, string | null, number],
  qualityNotes: readonly string[],
  scores: readonly [number, number, number, number, number] = [0.12, 0.18, 0.04, 0.08, 0.18]
): RankingQualityFixture {
  return {
    snapshot_id: "20260606_0638_KST",
    keyword,
    keyword_normalized: keywordNormalized,
    score_recency: scores[0],
    score_frequency: 0.16,
    score_authority: scores[1],
    score_velocity: scores[2],
    score_engagement: scores[3],
    score_internal: 0,
    total_score: scores[4],
    source_count: source[4],
    top_source_title: source[0],
    top_source_domain: source[1],
    is_manual: false,
    policy_delta: 0,
    stability_delta: 0,
    manual_delta: 0,
    family_key: null,
    family_label: null,
    family_source: null,
    keyword_kind: null,
    version_kind: null,
    internal_reason: null,
    expected_quality: expectedQuality,
    quality_notes: qualityNotes,
    top_source_url: source[2],
    latest_source_at: source[3],
    summary_short: expectedQuality === "protected_good" ? `${keyword} has current developer relevance.` : null,
  };
}
