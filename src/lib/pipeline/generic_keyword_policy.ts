import type { FreshnessEvidenceReason } from "@/lib/pipeline/freshness_evidence";

export type GenericKeywordReason =
  | "not_generic"
  | "generic_unanchored"
  | "generic_anchored"
  | "specific_context_protected";

export interface GenericKeywordPolicyInput {
  readonly keyword: string;
  readonly sourceTexts: readonly string[];
  readonly freshnessReasons: readonly FreshnessEvidenceReason[];
  readonly authority: number;
  readonly engagement: number;
}

export interface GenericKeywordPolicyResult {
  readonly delta: number;
  readonly reasons: readonly GenericKeywordReason[];
}

const BROAD_KEYWORDS = new Set([
  "mcp server",
  "mcp 서버",
  "ai coding agent",
  "ai 코딩 에이전트",
  "vibe coding",
  "바이브코딩",
  "ai 지침 파일",
]);

const contextAnchorPattern =
  /\b(?:snowflake|claroty|claude|codex|cursor|windsurf|gemini|github|vercel|openai|anthropic|plugin|tracker|memory|integration|incident|outage|release|changelog|sdk|cli|api|v?\d+\.\d+(?:\.\d+)?|canary|alpha|beta|rc)\b/i;
const protectedSpecificPattern =
  /(?:claude code|claude-memory|plugin tracker|v?\d+\.\d+(?:\.\d+)?|canary|github|npm)/i;

export function calculateGenericKeywordDelta(
  input: GenericKeywordPolicyInput
): GenericKeywordPolicyResult {
  const normalizedKeyword = normalizeSurface(input.keyword);
  if (!BROAD_KEYWORDS.has(normalizedKeyword) && protectedSpecificPattern.test(input.keyword)) {
    return { delta: 0, reasons: ["specific_context_protected"] };
  }
  if (!BROAD_KEYWORDS.has(normalizedKeyword)) {
    return { delta: 0, reasons: ["not_generic"] };
  }

  if (hasContextAnchor(input)) {
    return { delta: 0, reasons: ["generic_anchored"] };
  }

  const weakFreshness = input.freshnessReasons.includes("stale_no_evidence");
  const weakInterest = input.authority < 0.45 && input.engagement < 0.2;
  return {
    delta: weakFreshness || weakInterest ? -0.07 : -0.04,
    reasons: ["generic_unanchored"],
  };
}

export function capNegativeQualityDelta(
  deltas: readonly number[],
  negativeFloor: number
): number {
  const total = deltas.reduce((sum, delta) => sum + delta, 0);
  return Number(Math.max(total, negativeFloor).toFixed(4));
}

function hasContextAnchor(input: GenericKeywordPolicyInput): boolean {
  if (
    input.freshnessReasons.some(
      (reason) =>
        reason === "recent_source" ||
        reason === "structured_release" ||
        reason === "reignition"
    ) &&
    (input.authority >= 0.6 || input.engagement >= 0.3)
  ) {
    return true;
  }

  return input.sourceTexts.some((text) => contextAnchorPattern.test(text));
}

function normalizeSurface(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_\-·/@:]+/g, " ")
    .replace(/[“”"'`~!#$%^&*()+=[\]{}|\\;<>?,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
