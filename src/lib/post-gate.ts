import { POST_FREQUENCY_BY_TIER } from "./tier";

export function canPostNow(
  tier: number,
  lastPostAt: Date | null,
  now: Date = new Date(),
): { allowed: boolean; nextAllowedAt?: Date } {
  const freq = POST_FREQUENCY_BY_TIER[tier];
  if (!freq || freq.perDay === 0) return { allowed: false };
  if (!lastPostAt) return { allowed: true };

  if (freq.cooldownDays > 0) {
    const nextAllowedAt = new Date(lastPostAt.getTime() + freq.cooldownDays * 86_400_000);
    return now >= nextAllowedAt ? { allowed: true } : { allowed: false, nextAllowedAt };
  }
  // 쿨다운 없는 등급: 같은 KST 날짜에 이미 perDay만큼 썼는지는 라우트가 DB COUNT로 확인(여기선 시각 비교만)
  return { allowed: true };
}
