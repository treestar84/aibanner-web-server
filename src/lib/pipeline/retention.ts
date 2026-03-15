import { applyRetentionPolicy, type RetentionCounts } from "@/lib/db/queries";

export interface RetentionPolicy {
  detailedDays: number;
  aggregateDays: number;
  keywordViewLifecycleDays: number;
}

export interface RetentionRunResult extends RetentionCounts {
  policy: RetentionPolicy;
}

const DEFAULT_DETAILED_DAYS = 90;
const DEFAULT_AGGREGATE_DAYS = 365;
const DEFAULT_KEYWORD_VIEW_LIFECYCLE_DAYS = 3;

function parsePositiveIntEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

export function resolveRetentionPolicy(): RetentionPolicy {
  const detailedDays = parsePositiveIntEnv(
    process.env.RETENTION_DETAILED_DAYS,
    DEFAULT_DETAILED_DAYS,
    7,
    3650
  );
  const aggregateDaysRaw = parsePositiveIntEnv(
    process.env.RETENTION_AGGREGATE_DAYS,
    DEFAULT_AGGREGATE_DAYS,
    30,
    3650
  );
  const aggregateDays = Math.max(aggregateDaysRaw, detailedDays);
  const keywordViewLifecycleDays = parsePositiveIntEnv(
    process.env.RETENTION_KEYWORD_VIEW_DAYS,
    DEFAULT_KEYWORD_VIEW_LIFECYCLE_DAYS,
    1,
    30
  );

  return { detailedDays, aggregateDays, keywordViewLifecycleDays };
}

export async function runRetentionPolicy(): Promise<RetentionRunResult> {
  const policy = resolveRetentionPolicy();
  const counts = await applyRetentionPolicy(
    policy.detailedDays,
    policy.aggregateDays,
    policy.keywordViewLifecycleDays
  );
  return { ...counts, policy };
}
