import type { NormalizedKeyword } from "./keywords";

/**
 * Same normalization used both when persisting aliases (queries.ts::upsertKeywordAliases)
 * and when looking them up here — if these two ever drift apart, cross-day identity
 * matching silently breaks again, which is the exact bug this module fixes.
 */
export function normalizeAliasKey(text: string): string {
  return text.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function compactAliasKey(text: string): string {
  return normalizeAliasKey(text).replace(/\s+/g, "");
}

export function buildAliasLookupKeys(text: string): string[] {
  const spaced = normalizeAliasKey(text);
  const compact = compactAliasKey(text);
  return [...new Set([spaced, compact])].filter((key) => key.length >= 2);
}

export function collectAliasLookupKeys(keywords: readonly NormalizedKeyword[]): string[] {
  const keys = new Set<string>();
  for (const keyword of keywords) {
    for (const key of buildAliasLookupKeys(keyword.keyword)) keys.add(key);
    for (const alias of keyword.aliases) {
      for (const key of buildAliasLookupKeys(alias)) keys.add(key);
    }
  }
  return [...keys];
}

export interface CanonicalResolutionResult {
  readonly resolved: NormalizedKeyword[];
  readonly remappedCount: number;
}

/**
 * Reassigns keywordId to a prior day's canonical ID when today's keyword text/aliases
 * match an existing keyword_aliases entry, so appearance-count-based evergreen
 * detection (repeat_exposure_policy.ts) accumulates history correctly across surface
 * text drift instead of resetting every run.
 */
export function resolveCanonicalKeywordIds(
  keywords: readonly NormalizedKeyword[],
  aliasCanonicalMap: ReadonlyMap<string, string>
): CanonicalResolutionResult {
  const ownKeywordIds = new Set(keywords.map((keyword) => keyword.keywordId));
  const usedCanonicalIds = new Set<string>();
  let remappedCount = 0;

  const resolved = keywords.map((keyword) => {
    const lookupKeys = [
      ...buildAliasLookupKeys(keyword.keyword),
      ...keyword.aliases.flatMap((alias) => buildAliasLookupKeys(alias)),
    ];

    let canonicalId: string | undefined;
    for (const key of lookupKeys) {
      const candidate = aliasCanonicalMap.get(key);
      if (
        candidate &&
        !usedCanonicalIds.has(candidate) &&
        !ownKeywordIds.has(candidate)
      ) {
        canonicalId = candidate;
        break;
      }
    }

    if (!canonicalId) {
      usedCanonicalIds.add(keyword.keywordId);
      return keyword;
    }

    usedCanonicalIds.add(canonicalId);
    remappedCount += 1;
    return { ...keyword, keywordId: canonicalId };
  });

  return { resolved, remappedCount };
}
