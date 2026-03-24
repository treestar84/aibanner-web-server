import type { PipelineMode } from "@/lib/pipeline/mode";

export const MANUAL_KEYWORD_TTL_OPTIONS = [6, 12, 24] as const;

type ManualKeywordTtlHours = (typeof MANUAL_KEYWORD_TTL_OPTIONS)[number];

const MANUAL_KEYWORD_TTL_SET = new Set<number>(MANUAL_KEYWORD_TTL_OPTIONS);

export function normalizeManualKeywordText(keyword: string): string {
  return keyword.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizeManualKeywordLookupKey(value: string): string {
  return normalizeManualKeywordText(value).toLowerCase();
}

function hashToBase36(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function addHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function normalizeDateInput(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function sanitizeManualKeywordTtlHours(ttlHours: number): ManualKeywordTtlHours {
  if (MANUAL_KEYWORD_TTL_SET.has(ttlHours)) {
    return ttlHours as ManualKeywordTtlHours;
  }
  return 6;
}

export function parseManualKeywordTtlHours(
  value: unknown
): { ttlHours?: ManualKeywordTtlHours; error?: string } {
  if (value === undefined || value === null || value === "") {
    return {};
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return { error: "ttlHours must be a number" };
  }
  if (!MANUAL_KEYWORD_TTL_SET.has(parsed)) {
    return { error: "ttlHours must be one of: 6, 12, 24" };
  }
  return { ttlHours: parsed as ManualKeywordTtlHours };
}

export function buildManualKeywordId(mode: PipelineMode, keyword: string): string {
  const normalized = normalizeManualKeywordLookupKey(keyword) || keyword.normalize("NFKC").trim();
  return `manual_${mode}_${hashToBase36(normalized)}`;
}

export function isManualKeywordId(keywordId: string): boolean {
  return /^manual_realtime_[a-z0-9]+$/i.test(keywordId.trim());
}

export function filterActiveSnapshotKeywords<T extends { keyword_id: string }>(
  keywords: T[],
  activeManualKeywordIds: Set<string>
): T[] {
  return keywords.filter((keyword) => {
    if (!isManualKeywordId(keyword.keyword_id)) return true;
    return activeManualKeywordIds.has(keyword.keyword_id);
  });
}

export function buildManualKeywordWindow(
  ttlHours: number,
  now: Date = new Date()
): { startsAt: string; expiresAt: string } {
  const sanitizedTtlHours = sanitizeManualKeywordTtlHours(ttlHours);
  const startsAt = new Date(now.getTime());
  return {
    startsAt: startsAt.toISOString(),
    expiresAt: addHours(startsAt, sanitizedTtlHours).toISOString(),
  };
}

export function buildExtendedManualKeywordWindow(
  current: {
    enabled: boolean;
    startsAt?: Date | string | null;
    expiresAt?: Date | string | null;
  },
  ttlHours: number,
  now: Date = new Date()
): { startsAt: string; expiresAt: string } {
  const sanitizedTtlHours = sanitizeManualKeywordTtlHours(ttlHours);
  const currentStartsAt = normalizeDateInput(current.startsAt);
  const currentExpiresAt = normalizeDateInput(current.expiresAt);
  const isStillActive =
    current.enabled &&
    currentExpiresAt !== null &&
    currentExpiresAt.getTime() > now.getTime();

  const startsAt = isStillActive && currentStartsAt ? currentStartsAt : new Date(now.getTime());
  const base = isStillActive && currentExpiresAt ? currentExpiresAt : new Date(now.getTime());

  return {
    startsAt: startsAt.toISOString(),
    expiresAt: addHours(base, sanitizedTtlHours).toISOString(),
  };
}
