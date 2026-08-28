export const TIER_POINT_THRESHOLDS = [0, 0, 100, 300, 700] as const; // index = tier-1, tier1은 미사용(가입일수로만 게이트)
export const MIN_DAYS_FOR_POSTING = 7;

export const POST_FREQUENCY_BY_TIER: Record<number, { perDay: number; cooldownDays: number }> = {
  1: { perDay: 0, cooldownDays: 0 },
  2: { perDay: 1, cooldownDays: 3 }, // 3일에 최대 1회
  3: { perDay: 1, cooldownDays: 0 },
  4: { perDay: 2, cooldownDays: 0 },
  5: { perDay: 3, cooldownDays: 0 },
};

export const REPORT_THRESHOLD_BY_TIER: Record<number, number> = {
  2: 3, 3: 5, 4: 7, 5: 10,
};

export function daysSince(firstSeenAt: Date, now: Date): number {
  return Math.floor((now.getTime() - firstSeenAt.getTime()) / 86_400_000);
}

export function computeTier(firstSeenAt: Date, pointsTotal: number, now: Date = new Date()): number {
  if (daysSince(firstSeenAt, now) < MIN_DAYS_FOR_POSTING) return 1;
  // 포인트 조건을 만족하는 가장 높은 등급 (2~5)
  for (let tier = 5; tier >= 2; tier--) {
    if (pointsTotal >= TIER_POINT_THRESHOLDS[tier - 1]) return tier;
  }
  return 2;
}
