import {
  evaluateFreshnessEvidence,
  type FreshnessEvidenceReason,
} from "@/lib/pipeline/freshness_evidence";
import {
  calculateGenericKeywordDelta,
  capNegativeQualityDelta,
} from "@/lib/pipeline/generic_keyword_policy";
import { calculateRepeatExposureDelta } from "@/lib/pipeline/repeat_exposure_policy";
import { evaluateSourceQuality } from "@/lib/pipeline/source_quality";

export interface RankingQualityCandidate {
  readonly keywordId: string;
  readonly keyword: string;
  readonly score: {
    readonly total: number;
    readonly recency: number;
    readonly velocity: number;
    readonly engagement: number;
    readonly authority: number;
  };
  readonly sourceTexts: readonly string[];
  readonly sourceDomains: readonly string[];
  readonly latestSourceAt: string | null;
  readonly appearances: number;
  readonly isManual: boolean;
}

export interface RankingQualityFlags {
  readonly shadowOnly: boolean;
  readonly sourceQualityEnabled: boolean;
  readonly genericContextPolicyEnabled: boolean;
  readonly repeatExposurePolicyEnabled: boolean;
  readonly now: Date;
}

export interface RankingQualityDecision {
  readonly rawDelta: number;
  readonly appliedDelta: number;
  readonly reasons: readonly string[];
  readonly freshnessReasons: readonly FreshnessEvidenceReason[];
  readonly hasRelevantSource: boolean;
}

export interface RankingQualityPolicyResult<T extends RankingQualityCandidate> {
  readonly items: ReadonlyArray<T & { readonly qualityAdjustedTotal: number }>;
  readonly qualityByKeywordId: ReadonlyMap<string, RankingQualityDecision>;
}

const NEGATIVE_QUALITY_FLOOR = -0.12;

export function applyRankingQualityPolicy<T extends RankingQualityCandidate>(
  candidates: readonly T[],
  flags: RankingQualityFlags
): RankingQualityPolicyResult<T> {
  const decisions = new Map<string, RankingQualityDecision>();
  const items = candidates.map((candidate) => {
    const decision = evaluateRankingQualityCandidate(candidate, flags);
    decisions.set(candidate.keywordId, decision);
    return {
      ...candidate,
      qualityAdjustedTotal: Number((candidate.score.total + decision.appliedDelta).toFixed(4)),
    };
  });

  if (flags.shadowOnly) {
    return { items, qualityByKeywordId: decisions };
  }

  return {
    items: [...items].sort((a, b) => b.qualityAdjustedTotal - a.qualityAdjustedTotal),
    qualityByKeywordId: decisions,
  };
}

export function evaluateRankingQualityCandidate(
  candidate: RankingQualityCandidate,
  flags: RankingQualityFlags
): RankingQualityDecision {
  const freshness = evaluateFreshnessEvidence({
    keyword: candidate.keyword,
    score_recency: candidate.score.recency,
    score_velocity: candidate.score.velocity,
    score_engagement: candidate.score.engagement,
    score_authority: candidate.score.authority,
    now: flags.now,
    sources: buildFreshnessSources(candidate),
    first_seen_at_utc: null,
    previous_top10_appearances: candidate.appearances,
  });
  const hasRelevantSource = hasRelevantSourceEvidence(candidate);
  const deltas: number[] = [];
  const reasons: string[] = [...freshness.reasons.map((reason) => `freshness:${reason}`)];

  if (flags.sourceQualityEnabled && !hasRelevantSource) {
    deltas.push(-0.04);
    reasons.push("source:missing_relevant_source");
  }
  if (!freshness.eligible && hasAnyQualityPolicyEnabled(flags)) {
    deltas.push(-0.05);
  }
  if (flags.genericContextPolicyEnabled) {
    const generic = calculateGenericKeywordDelta({
      keyword: candidate.keyword,
      sourceTexts: candidate.sourceTexts,
      freshnessReasons: freshness.reasons,
      authority: candidate.score.authority,
      engagement: candidate.score.engagement,
    });
    deltas.push(generic.delta);
    reasons.push(...generic.reasons.map((reason) => `generic:${reason}`));
  }
  if (flags.repeatExposurePolicyEnabled) {
    const repeatDelta = calculateRepeatExposureDelta({
      appearances: candidate.appearances,
      score_velocity: candidate.score.velocity,
      score_engagement: candidate.score.engagement,
      score_authority: candidate.score.authority,
      freshnessReasons: freshness.reasons,
      isBroadGeneric: candidate.keyword === "MCP server" || candidate.keyword === "AI coding agent",
      hasRelevantSource,
    });
    deltas.push(repeatDelta);
    if (repeatDelta !== 0) reasons.push(`repeat:${repeatDelta.toFixed(4)}`);
  }

  const rawDelta = capNegativeQualityDelta(deltas, NEGATIVE_QUALITY_FLOOR);
  const appliedDelta = flags.shadowOnly || candidate.isManual ? 0 : rawDelta;
  return {
    rawDelta,
    appliedDelta,
    reasons,
    freshnessReasons: freshness.reasons,
    hasRelevantSource,
  };
}

export function parseRankingQualityFlags(now = new Date()): RankingQualityFlags {
  return {
    shadowOnly: process.env.PIPELINE_QUALITY_SHADOW_ONLY !== "0",
    sourceQualityEnabled: process.env.PIPELINE_SOURCE_QUALITY_ENABLED === "1",
    genericContextPolicyEnabled:
      process.env.PIPELINE_GENERIC_CONTEXT_POLICY_ENABLED === "1",
    repeatExposurePolicyEnabled:
      process.env.PIPELINE_REPEAT_EXPOSURE_POLICY_ENABLED === "1",
    now,
  };
}

function buildFreshnessSources(candidate: RankingQualityCandidate) {
  return candidate.sourceTexts.map((text, index) => ({
    title: text,
    url: "",
    domain: candidate.sourceDomains[index] ?? "",
    published_at_utc: candidate.latestSourceAt,
    tier: "P1_CONTEXT" as const,
  }));
}

function hasRelevantSourceEvidence(candidate: RankingQualityCandidate): boolean {
  return candidate.sourceTexts.some((text, index) =>
    evaluateSourceQuality({
      keyword: candidate.keyword,
      title: text,
      snippet: text,
      url: "",
      domain: candidate.sourceDomains[index] ?? null,
      category: "news",
    }).passesThreshold
  );
}

function hasAnyQualityPolicyEnabled(flags: RankingQualityFlags): boolean {
  return (
    flags.sourceQualityEnabled ||
    flags.genericContextPolicyEnabled ||
    flags.repeatExposurePolicyEnabled
  );
}
