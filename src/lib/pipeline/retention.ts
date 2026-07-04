import { applyRetentionPolicy, type RetentionCounts } from "@/lib/db/queries";

export interface RetentionPolicy {
  detailedDays: number;
  aggregateDays: number;
  keywordViewLifecycleDays: number;
  naverSourceDays: number;
  youtubeVideoDays: number;
}

export interface RetentionRunResult extends RetentionCounts {
  policy: RetentionPolicy;
}

const DEFAULT_DETAILED_DAYS = 90;
const DEFAULT_AGGREGATE_DAYS = 365;
const DEFAULT_KEYWORD_VIEW_LIFECYCLE_DAYS = 3;
// 네이버 검색 API 유래 소스는 원 정책상 단기 보관만 허용되어 7일로 별도 단축
const DEFAULT_NAVER_SOURCE_DAYS = 7;
// YouTube Data API 이용 정책상 응답 데이터 캐싱은 30일로 제한
const DEFAULT_YOUTUBE_VIDEO_DAYS = 30;

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
  const naverSourceDays = parsePositiveIntEnv(
    process.env.RETENTION_NAVER_SOURCE_DAYS,
    DEFAULT_NAVER_SOURCE_DAYS,
    1,
    90
  );
  const youtubeVideoDays = parsePositiveIntEnv(
    process.env.RETENTION_YOUTUBE_VIDEO_DAYS,
    DEFAULT_YOUTUBE_VIDEO_DAYS,
    1,
    30
  );

  return {
    detailedDays,
    aggregateDays,
    keywordViewLifecycleDays,
    naverSourceDays,
    youtubeVideoDays,
  };
}

export async function runRetentionPolicy(): Promise<RetentionRunResult> {
  const policy = resolveRetentionPolicy();
  const counts = await applyRetentionPolicy(
    policy.detailedDays,
    policy.aggregateDays,
    policy.keywordViewLifecycleDays,
    policy.naverSourceDays,
    policy.youtubeVideoDays
  );
  return { ...counts, policy };
}
