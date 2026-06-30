import type { FreshnessEvidenceReason } from "@/lib/pipeline/freshness_evidence";

export interface RepeatExposureInput {
  readonly appearances: number;
  readonly score_velocity: number;
  readonly score_engagement: number;
  readonly score_authority: number;
  readonly freshnessReasons: readonly FreshnessEvidenceReason[];
  readonly isBroadGeneric: boolean;
  readonly hasRelevantSource: boolean;
}

export function calculateRepeatExposureDelta(input: RepeatExposureInput): number {
  if (input.appearances < 8) {
    return 0;
  }

  const strongBreakout = isStrongBreakout(input);
  if (input.appearances < 12) {
    return strongBreakout ? 0.015 : 0.005;
  }

  if (input.freshnessReasons.includes("stale_no_evidence")) {
    return -0.12;
  }

  const hasReignition = input.freshnessReasons.includes("reignition");
  if (input.isBroadGeneric && (!hasReignition || !input.hasRelevantSource)) {
    return -0.11;
  }

  if (hasReignition && input.hasRelevantSource && strongBreakout) {
    return input.isBroadGeneric ? -0.03 : -0.02;
  }

  if (strongBreakout && input.hasRelevantSource) {
    return -0.05;
  }

  return -0.1;
}

function isStrongBreakout(input: RepeatExposureInput): boolean {
  return (
    input.score_velocity >= 0.45 ||
    input.score_engagement >= 0.45 ||
    input.score_authority >= 0.84
  );
}
