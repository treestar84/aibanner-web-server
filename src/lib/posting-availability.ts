import { canPostNow } from "./post-gate";
import { MIN_DAYS_FOR_POSTING, POST_FREQUENCY_BY_TIER } from "./tier";

export interface PostingAvailability {
  canPost: boolean;
  nextAllowedAt: string | null;
  postsRemainingToday: number;
  perDay: number;
}

export function kstMidnightUtc(now: Date): Date {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 60 * 60 * 1000,
  );
}

function nextKstMidnightUtc(now: Date): Date {
  const today = kstMidnightUtc(now);
  return new Date(today.getTime() + 86_400_000);
}

export function postingAvailability(
  firstSeenAt: Date,
  tier: number,
  lastPostAt: Date | null,
  postsToday: number,
  now: Date = new Date(),
): PostingAvailability {
  const freq = POST_FREQUENCY_BY_TIER[tier] ?? { perDay: 0, cooldownDays: 0 };
  const postsRemainingToday = Math.max(0, freq.perDay - postsToday);
  const timeGate = canPostNow(tier, lastPostAt, now);
  const canPost = timeGate.allowed && postsRemainingToday > 0;

  if (canPost) {
    return { canPost, nextAllowedAt: null, postsRemainingToday, perDay: freq.perDay };
  }

  const candidates: Date[] = [];
  if (tier === 1) {
    candidates.push(new Date(firstSeenAt.getTime() + MIN_DAYS_FOR_POSTING * 86_400_000));
  }
  if (timeGate.nextAllowedAt) candidates.push(timeGate.nextAllowedAt);
  if (freq.perDay > 0 && postsRemainingToday === 0) candidates.push(nextKstMidnightUtc(now));

  const nextAllowedAt = candidates.length > 0
    ? new Date(Math.max(...candidates.map((candidate) => candidate.getTime()))).toISOString()
    : null;

  return { canPost, nextAllowedAt, postsRemainingToday, perDay: freq.perDay };
}
