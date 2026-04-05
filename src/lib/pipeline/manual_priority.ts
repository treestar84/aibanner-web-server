import type { ManualKeyword } from "@/lib/db/queries";
import type { NormalizedKeyword } from "@/lib/pipeline/keywords";
import type { PipelineMode } from "@/lib/pipeline/mode";
import type { RankedKeyword } from "@/lib/pipeline/scoring";
import {
  buildManualKeywordId,
  normalizeManualKeywordLookupKey,
  normalizeManualKeywordText,
} from "@/lib/manual-keywords";

export interface RankedKeywordWithDelta extends RankedKeyword {
  deltaRank: number;
  isNew: boolean;
}

export interface ManualPriorityOptions {
  internalBonus: number;
  totalBonus: number;
}

export interface ManualPriorityResult {
  items: RankedKeywordWithDelta[];
  manualDeltaByKeywordId: Map<string, number>;
  insertedKeywordIds: Set<string>;
}

export function keywordLookupKeys(item: RankedKeywordWithDelta): string[] {
  const keys = new Set<string>();
  const primary = normalizeManualKeywordLookupKey(item.keyword.keyword);
  if (primary) keys.add(primary);
  for (const alias of item.keyword.aliases) {
    const normalizedAlias = normalizeManualKeywordLookupKey(alias);
    if (normalizedAlias) keys.add(normalizedAlias);
  }
  return [...keys];
}

export function createManualRankedItem(
  mode: PipelineMode,
  manualKeyword: ManualKeyword,
  options: ManualPriorityOptions
): RankedKeywordWithDelta {
  const now = new Date();
  const normalizedKeyword = normalizeManualKeywordText(manualKeyword.keyword);
  const normalized: NormalizedKeyword = {
    keywordId: buildManualKeywordId(mode, normalizedKeyword),
    keyword: normalizedKeyword,
    aliases: [],
    candidates: {
      text: normalizedKeyword,
      count: 1,
      domains: new Set(["manual"]),
      matchedItems: new Set<number>(),
      latestAt: now,
      tier: "P0_CURATED",
      domainBonus: 0,
      authorityOverride: 0,
    },
  };

  return {
    rank: 0,
    deltaRank: 0,
    isNew: true,
    keyword: normalized,
    score: {
      recency: 1,
      frequency: 1,
      authority: 1,
      velocity: 1,
      engagement: 1,
      internal: options.internalBonus,
      total: parseFloat((10 + options.totalBonus).toFixed(4)),
    },
  };
}

export function applyInternalDelta<T extends { score: { internal: number; total: number } }>(
  item: T,
  delta: number
): T {
  if (!Number.isFinite(delta) || delta === 0) return item;

  return {
    ...item,
    score: {
      ...item.score,
      internal: parseFloat((item.score.internal + delta).toFixed(4)),
      total: parseFloat((item.score.total + delta).toFixed(4)),
    },
  };
}

export function applyManualKeywordPriority(
  mode: PipelineMode,
  rankedKeywords: RankedKeywordWithDelta[],
  manualKeywords: ManualKeyword[],
  options: ManualPriorityOptions
): ManualPriorityResult {
  if (manualKeywords.length === 0) {
    return {
      items: rankedKeywords,
      manualDeltaByKeywordId: new Map(),
      insertedKeywordIds: new Set(),
    };
  }

  const uniqueManualKeywordKeys: string[] = [];
  const manualByKey = new Map<string, ManualKeyword>();
  for (const row of manualKeywords) {
    const key = normalizeManualKeywordLookupKey(row.keyword);
    if (!key || manualByKey.has(key)) continue;
    manualByKey.set(key, row);
    uniqueManualKeywordKeys.push(key);
  }
  if (uniqueManualKeywordKeys.length === 0) {
    return {
      items: rankedKeywords,
      manualDeltaByKeywordId: new Map(),
      insertedKeywordIds: new Set(),
    };
  }

  const manualDeltaByKeywordId = new Map<string, number>();

  const boostedKeywords = rankedKeywords.map((item) => {
    const matched = keywordLookupKeys(item).some((key) => manualByKey.has(key));
    if (!matched) return item;
    manualDeltaByKeywordId.set(item.keyword.keywordId, options.totalBonus);
    return {
      ...item,
      score: {
        ...item.score,
        internal: parseFloat((item.score.internal + options.internalBonus).toFixed(4)),
        total: parseFloat((item.score.total + options.totalBonus).toFixed(4)),
      },
    };
  });

  const prioritized: RankedKeywordWithDelta[] = [];
  const usedKeywordIds = new Set<string>();
  const usedManualKeys = new Set<string>();
  const insertedKeywordIds = new Set<string>();

  const pushUnique = (item: RankedKeywordWithDelta) => {
    const id = item.keyword.keywordId;
    if (usedKeywordIds.has(id)) return;
    const keys = keywordLookupKeys(item);
    const hasManualCollision = keys.some(
      (key) => manualByKey.has(key) && usedManualKeys.has(key)
    );
    if (hasManualCollision) return;

    prioritized.push(item);
    usedKeywordIds.add(id);
    for (const key of keys) usedManualKeys.add(key);
  };

  for (const key of uniqueManualKeywordKeys) {
    const existing = boostedKeywords.find((item) =>
      keywordLookupKeys(item).includes(key)
    );
    if (existing) {
      pushUnique(existing);
      continue;
    }

    const manualRow = manualByKey.get(key);
    if (!manualRow) continue;

    const inserted = createManualRankedItem(mode, manualRow, options);
    insertedKeywordIds.add(inserted.keyword.keywordId);
    manualDeltaByKeywordId.set(inserted.keyword.keywordId, options.totalBonus);
    pushUnique(inserted);
  }

  for (const item of boostedKeywords) {
    pushUnique(item);
  }

  return {
    items: prioritized,
    manualDeltaByKeywordId,
    insertedKeywordIds,
  };
}
