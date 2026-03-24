import { collectRssItems } from "./rss";
import { collectHnItems } from "./hn_source";
import { collectGdeltItems } from "./gdelt_source";
import { collectGithubItems } from "./github_source";
import { collectGithubMdItems } from "./github_md_source";
import { collectYoutubeItems } from "./youtube_source";
import { collectGithubReleaseItems } from "./github_releases_source";
import { collectChangelogItems } from "./changelog_source";
import { collectProductHuntTopItems } from "./product_hunt_top_source";
import type { RssItem } from "./rss";
import { normalizeKeywords } from "./keywords";
import { rankKeywords, calculateDeltaRanks } from "./scoring";
import type { ScoringProfile } from "./scoring";
import type { PipelineMode } from "./mode";
import { collectSources } from "./tavily";
import { generateSummaries, batchTranslateTitles } from "./summarize";
import { batchExtractOgImages } from "./og-parser";
import { determinePrimaryType, pickPrimarySource } from "./source_category";
import { resolveScheduleUtc, type ScheduleSlot } from "./schedule";
import {
  buildManualKeywordId,
  normalizeManualKeywordLookupKey,
  normalizeManualKeywordText,
} from "@/lib/manual-keywords";
import {
  insertSnapshot,
  deleteSnapshotIfEmpty,
  insertKeyword,
  insertSource,
  getPreviousRanks,
  getRecentSnapshots,
  findCachedKeyword,
  upsertKeywordAliases,
  getSourceIngestionStates,
  upsertSourceIngestionState,
  getActiveManualKeywords,
} from "@/lib/db/queries";
import type { Source, SourceIngestionState, ManualKeyword } from "@/lib/db/queries";

type RankedKeywordWithDelta = ReturnType<typeof calculateDeltaRanks>[number];
const RANKING_CANDIDATE_LIMIT = 20;
const DEFAULT_DETAILED_KEYWORD_LIMIT = 10;

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

function parsePositiveFloatEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}


const DETAILED_KEYWORD_LIMIT = parsePositiveIntEnv(
  process.env.PIPELINE_DETAILED_KEYWORDS,
  DEFAULT_DETAILED_KEYWORD_LIMIT,
  1,
  RANKING_CANDIDATE_LIMIT
);
const KEYWORD_CONCURRENCY = parsePositiveIntEnv(
  process.env.PIPELINE_KEYWORD_CONCURRENCY,
  3,
  1,
  10
);
const LIGHTWEIGHT_CONCURRENCY = parsePositiveIntEnv(
  process.env.PIPELINE_LIGHTWEIGHT_CONCURRENCY,
  5,
  1,
  20
);
const MANUAL_KEYWORD_TOTAL_BONUS = parsePositiveFloatEnv(
  process.env.PIPELINE_MANUAL_KEYWORD_TOTAL_BONUS,
  6,
  0,
  100
);
const MANUAL_KEYWORD_INTERNAL_BONUS = parsePositiveFloatEnv(
  process.env.PIPELINE_MANUAL_KEYWORD_INTERNAL_BONUS,
  3,
  0,
  100
);

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface SourceWindowProfile {
  minHours: number;
  fallbackHours: number;
  maxHours: number;
  overlapMinutes: number;
}

interface PipelineRuntimeProfile {
  mode: PipelineMode;
  scoring: ScoringProfile;
  scheduleUtc: ScheduleSlot[];
  sourceWindow: SourceWindowProfile;
  allowExternalEnrichmentForNewKeywords: boolean;
  detailedKeywordLimit: number;
}

interface SourcePlan {
  key: string;
  collect: (windowHours: number) => Promise<RssItem[]>;
}

const SOURCE_PLANS: SourcePlan[] = [
  { key: "product_hunt_top", collect: (windowHours) => collectProductHuntTopItems(windowHours) },
  { key: "rss", collect: (windowHours) => collectRssItems(windowHours) },
  { key: "hn", collect: (windowHours) => collectHnItems(windowHours) },
  { key: "gdelt", collect: (windowHours) => collectGdeltItems(windowHours) },
  { key: "github", collect: (windowHours) => collectGithubItems(windowHours) },
  { key: "github_md", collect: (windowHours) => collectGithubMdItems(windowHours) },
  { key: "youtube", collect: (windowHours) => collectYoutubeItems(windowHours) },
  { key: "github_releases", collect: (windowHours) => collectGithubReleaseItems(windowHours) },
  { key: "changelog", collect: (windowHours) => collectChangelogItems(windowHours) },
];

function resolveSourceWindowProfile(): SourceWindowProfile {
  const legacyMin = process.env.PIPELINE_SOURCE_MIN_WINDOW_HOURS;
  const legacyFallback = process.env.PIPELINE_SOURCE_FALLBACK_WINDOW_HOURS;
  const legacyMax = process.env.PIPELINE_SOURCE_MAX_WINDOW_HOURS;
  const legacyOverlap = process.env.PIPELINE_SOURCE_OVERLAP_MINUTES;

  const minHours = parsePositiveIntEnv(
    process.env.PIPELINE_REALTIME_SOURCE_MIN_WINDOW_HOURS ?? legacyMin,
    6,
    1,
    168
  );
  const maxHours = parsePositiveIntEnv(
    process.env.PIPELINE_REALTIME_SOURCE_MAX_WINDOW_HOURS ?? legacyMax,
    96,
    6,
    720
  );
  const fallbackHours = parsePositiveIntEnv(
    process.env.PIPELINE_REALTIME_SOURCE_FALLBACK_WINDOW_HOURS ?? legacyFallback,
    24,
    1,
    720
  );
  const overlapMinutes = parsePositiveIntEnv(
    process.env.PIPELINE_REALTIME_SOURCE_OVERLAP_MINUTES ?? legacyOverlap,
    45,
    5,
    360
  );

  const normalizedMin = Math.min(minHours, maxHours);
  const normalizedMax = Math.max(minHours, maxHours);
  return {
    minHours: normalizedMin,
    fallbackHours: clampNumber(fallbackHours, normalizedMin, normalizedMax),
    maxHours: normalizedMax,
    overlapMinutes,
  };
}

function resolveRuntimeProfile(mode: PipelineMode): PipelineRuntimeProfile {
  const scheduleUtc = resolveScheduleUtc(mode);

  const scoring: ScoringProfile = {
    recencyHalfLifeHours: parsePositiveFloatEnv(
      process.env.PIPELINE_REALTIME_RECENCY_HALFLIFE_HOURS,
      9,
      1,
      168
    ),
    velocityRecentWindowHours: parsePositiveFloatEnv(
      process.env.PIPELINE_REALTIME_VELOCITY_RECENT_HOURS,
      6,
      1,
      24
    ),
    velocityBaselineWindowHours: parsePositiveFloatEnv(
      process.env.PIPELINE_REALTIME_VELOCITY_BASELINE_HOURS,
      18,
      1,
      96
    ),
    weights: {
      recency: 0.42,
      frequency: 0.16,
      authority: 0.10,
      velocity: 0.32,
      internal: 0,
    },
  };

  const detailedKeywordLimit = parsePositiveIntEnv(
    process.env.PIPELINE_REALTIME_DETAILED_KEYWORDS,
    DETAILED_KEYWORD_LIMIT,
    1,
    RANKING_CANDIDATE_LIMIT
  );

  return {
    mode,
    scoring,
    scheduleUtc,
    sourceWindow: resolveSourceWindowProfile(),
    allowExternalEnrichmentForNewKeywords: true,
    detailedKeywordLimit,
  };
}

// ─── Snapshot ID ──────────────────────────────────────────────────────────────

function buildSnapshotId(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const min = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${min}_KST`;
}

function nextScheduledTime(scheduleUtc: ScheduleSlot[]): Date {
  const now = new Date();
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const next = new Date(now);

  const sameDaySlot = scheduleUtc.find(
    (slot) => slot.hour * 60 + slot.minute > nowMinutes
  );
  if (sameDaySlot) {
    next.setUTCHours(sameDaySlot.hour, sameDaySlot.minute, 0, 0);
    return next;
  }

  const first = scheduleUtc[0];
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(first.hour, first.minute, 0, 0);
  return next;
}

function parseUtcMillis(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return null;
  return ms;
}

function resolveIncrementalWindowHours(
  sourceWindow: SourceWindowProfile,
  state: SourceIngestionState | undefined
): number {
  if (!state?.last_success_at_utc) {
    return sourceWindow.fallbackHours;
  }

  const nowMs = Date.now();
  const lastSuccessMs = parseUtcMillis(state.last_success_at_utc);
  if (lastSuccessMs === null || lastSuccessMs >= nowMs) {
    return sourceWindow.fallbackHours;
  }

  const overlapMs = sourceWindow.overlapMinutes * 60 * 1000;
  const elapsedMs = nowMs - lastSuccessMs + overlapMs;
  const dynamicWindowHours = Math.ceil(elapsedMs / (1000 * 60 * 60));

  return clampNumber(
    dynamicWindowHours,
    sourceWindow.minHours,
    sourceWindow.maxHours
  );
}

function pickLatestPublishedAt(items: RssItem[]): string | null {
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const publishedMs = item.publishedAt.getTime();
    if (Number.isFinite(publishedMs) && publishedMs > latestMs) {
      latestMs = publishedMs;
    }
  }

  if (!Number.isFinite(latestMs)) return null;
  return new Date(latestMs).toISOString();
}

async function collectWithIncrementalWindow(
  profile: PipelineRuntimeProfile,
  plan: SourcePlan,
  stateMap: Map<string, SourceIngestionState>
): Promise<RssItem[]> {
  const stateKey = `${profile.mode}:${plan.key}`;
  const windowHours = resolveIncrementalWindowHours(
    profile.sourceWindow,
    stateMap.get(stateKey)
  );

  try {
    const items = await plan.collect(windowHours);
    const latestPublishedAt = pickLatestPublishedAt(items);

    try {
      await upsertSourceIngestionState({
        source_key: stateKey,
        last_success_at_utc: new Date().toISOString(),
        last_published_at_utc: latestPublishedAt,
        last_item_count: items.length,
        last_window_hours: windowHours,
      });
    } catch (stateErr) {
      console.warn(
        `[snapshot] [${profile.mode}] [source:${plan.key}] State upsert failed: ${(stateErr as Error).message}`
      );
    }

    console.log(
      `[snapshot] [${profile.mode}] [source:${plan.key}] windowHours=${windowHours}, items=${items.length}`
    );
    return items;
  } catch (err) {
    console.warn(
      `[snapshot] [${profile.mode}] [source:${plan.key}] Failed: ${(err as Error).message}`
    );
    return [];
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  if (items.length === 0) return [];

  const cappedConcurrency = Math.min(concurrency, items.length);
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }

      try {
        const value = await mapper(items[index], index);
        results[index] = { status: "fulfilled", value };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: cappedConcurrency }, () => worker()));
  return results;
}

const KOREAN_TEXT_RE = /[\uAC00-\uD7AF\u3130-\u318F\u1100-\u11FF]/;

function hasKoreanText(text: string): boolean {
  return KOREAN_TEXT_RE.test(text);
}

async function ensureLocalizedKeyword(
  keyword: string,
  existingKo?: string | null,
  existingEn?: string | null
): Promise<{ ko: string; en: string }> {
  const fallback = keyword.trim() || keyword;
  let ko = (existingKo ?? "").trim();
  let en = (existingEn ?? "").trim();
  const fallbackHasKorean = hasKoreanText(fallback);

  if (fallbackHasKorean) {
    if (!ko) ko = fallback;
    const needEnTranslation = !en || en === fallback;
    if (needEnTranslation) {
      en = (await batchTranslateTitles([keyword], "en"))[0] ?? fallback;
    }
  } else {
    if (!en) en = fallback;
    const needKoTranslation = !ko || ko === fallback;
    if (needKoTranslation) {
      ko = (await batchTranslateTitles([keyword], "ko"))[0] ?? fallback;
    }
  }

  return {
    ko: ko || fallback,
    en: en || fallback,
  };
}

async function localizeTitlesBilingually(
  titles: string[]
): Promise<Array<{ ko: string; en: string }>> {
  if (titles.length === 0) return [];

  const result = titles.map((title) => ({ ko: title, en: title }));
  const needsKoIndexes: number[] = [];
  const needsEnIndexes: number[] = [];

  for (let i = 0; i < titles.length; i++) {
    if (hasKoreanText(titles[i])) {
      needsEnIndexes.push(i);
    } else {
      needsKoIndexes.push(i);
    }
  }

  const [translatedKo, translatedEn] = await Promise.all([
    needsKoIndexes.length > 0
      ? batchTranslateTitles(needsKoIndexes.map((i) => titles[i]), "ko")
      : Promise.resolve([]),
    needsEnIndexes.length > 0
      ? batchTranslateTitles(needsEnIndexes.map((i) => titles[i]), "en")
      : Promise.resolve([]),
  ]);

  needsKoIndexes.forEach((originalIndex, translatedIndex) => {
    result[originalIndex].ko = translatedKo[translatedIndex] ?? titles[originalIndex];
  });

  needsEnIndexes.forEach((originalIndex, translatedIndex) => {
    result[originalIndex].en = translatedEn[translatedIndex] ?? titles[originalIndex];
  });

  return result;
}

async function ensureLocalizedStoredSources(sources: Source[]): Promise<Source[]> {
  if (sources.length === 0) return sources;

  const flags = sources.map((source) => {
    const baseTitle = source.title.trim();
    const baseHasKorean = hasKoreanText(baseTitle);
    const koValue = source.title_ko?.trim() ?? "";
    const enValue = source.title_en?.trim() ?? "";
    return {
      needKo: !koValue || (!baseHasKorean && koValue === baseTitle),
      needEn: !enValue || (baseHasKorean && enValue === baseTitle),
    };
  });
  const needsBackfill = flags.some((flag) => flag.needKo || flag.needEn);
  if (!needsBackfill) return sources;

  const localizedTitles = await localizeTitlesBilingually(sources.map((source) => source.title));
  return sources.map((source, index) => ({
    ...source,
    title_ko: flags[index].needKo
      ? localizedTitles[index].ko
      : source.title_ko,
    title_en: flags[index].needEn
      ? localizedTitles[index].en
      : source.title_en,
  }));
}

function keywordLookupKeys(item: RankedKeywordWithDelta): string[] {
  const keys = new Set<string>();
  const primary = normalizeManualKeywordLookupKey(item.keyword.keyword);
  if (primary) keys.add(primary);
  for (const alias of item.keyword.aliases) {
    const normalizedAlias = normalizeManualKeywordLookupKey(alias);
    if (normalizedAlias) keys.add(normalizedAlias);
  }
  return [...keys];
}

function createManualRankedItem(
  mode: PipelineMode,
  manualKeyword: ManualKeyword
): RankedKeywordWithDelta {
  const now = new Date();
  const normalizedKeyword = normalizeManualKeywordText(manualKeyword.keyword);
  return {
    rank: 0,
    deltaRank: 0,
    isNew: true,
    keyword: {
      keywordId: buildManualKeywordId(mode, normalizedKeyword),
      keyword: normalizedKeyword,
      aliases: [],
      candidates: {
        text: normalizedKeyword,
        count: 1,
        domains: new Set(["manual"]),
        matchedItems: new Set(),
        latestAt: now,
        tier: "P0_CURATED",
        domainBonus: 0,
        authorityOverride: 0,
      },
    },
    score: {
      recency: 1,
      frequency: 1,
      authority: 1,
      velocity: 1,
      internal: MANUAL_KEYWORD_INTERNAL_BONUS,
      total: parseFloat((10 + MANUAL_KEYWORD_TOTAL_BONUS).toFixed(4)),
    },
  };
}

function applyManualKeywordPriority(
  mode: PipelineMode,
  rankedKeywords: RankedKeywordWithDelta[],
  manualKeywords: ManualKeyword[]
): RankedKeywordWithDelta[] {
  if (manualKeywords.length === 0) return rankedKeywords;

  const uniqueManualKeywordKeys: string[] = [];
  const manualByKey = new Map<string, ManualKeyword>();
  for (const row of manualKeywords) {
    const key = normalizeManualKeywordLookupKey(row.keyword);
    if (!key || manualByKey.has(key)) continue;
    manualByKey.set(key, row);
    uniqueManualKeywordKeys.push(key);
  }
  if (uniqueManualKeywordKeys.length === 0) return rankedKeywords;

  const boostedKeywords = rankedKeywords.map((item) => {
    const matched = keywordLookupKeys(item).some((key) => manualByKey.has(key));
    if (!matched) return item;

    return {
      ...item,
      score: {
        ...item.score,
        internal: parseFloat(
          (item.score.internal + MANUAL_KEYWORD_INTERNAL_BONUS).toFixed(4)
        ),
        total: parseFloat(
          (item.score.total + MANUAL_KEYWORD_TOTAL_BONUS).toFixed(4)
        ),
      },
    };
  });

  const prioritized: RankedKeywordWithDelta[] = [];
  const usedKeywordIds = new Set<string>();
  const usedManualKeys = new Set<string>();

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
    for (const key of keys) {
      usedManualKeys.add(key);
    }
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
    pushUnique(createManualRankedItem(mode, manualRow));
  }

  for (const item of boostedKeywords) {
    pushUnique(item);
  }

  return prioritized;
}

// ─── Per-keyword processor ────────────────────────────────────────────────────

async function processKeyword(
  item: RankedKeywordWithDelta,
  snapshotId: string,
  recentSnapshotIds: string[],
  defaultImage: string,
  allowExternalEnrichmentForNewKeywords: boolean,
  forceExternalEnrichmentForKeyword: boolean
): Promise<{ reused: boolean }> {
  const kw = item.keyword;
  const keywordAliases = [kw.keyword, ...kw.aliases];

  // ── 캐시 조회 (최근 4 스냅샷) ──────────────────────────────────
  const cached = await findCachedKeyword(kw.keywordId, recentSnapshotIds);

  if (cached) {
    const localizedKeyword = await ensureLocalizedKeyword(
      kw.keyword,
      cached.keyword.keyword_ko,
      cached.keyword.keyword_en
    );
    const localizedSources = await ensureLocalizedStoredSources(cached.sources);
    const primaryType = determinePrimaryType(localizedSources);
    const topSource = pickPrimarySource(localizedSources, primaryType);

    console.log(`[snapshot] [REUSE] ${kw.keyword} (rank ${item.rank})`);
    await insertKeyword({
      snapshot_id: snapshotId,
      keyword_id: kw.keywordId,
      keyword: kw.keyword,
      keyword_ko: localizedKeyword.ko,
      keyword_en: localizedKeyword.en,
      rank: item.rank,
      delta_rank: item.deltaRank,
      is_new: false,
      score: item.score.total,
      score_recency: item.score.recency,
      score_frequency: item.score.frequency,
      score_authority: item.score.authority,
      score_velocity: item.score.velocity,
      score_internal: item.score.internal,
      summary_short: cached.keyword.summary_short,
      summary_short_en: cached.keyword.summary_short_en,
      primary_type: primaryType,
      top_source_title: topSource?.title ?? cached.keyword.top_source_title,
      top_source_title_ko:
        topSource?.title_ko ??
        cached.keyword.top_source_title_ko ??
        topSource?.title ??
        cached.keyword.top_source_title,
      top_source_title_en:
        topSource?.title_en ??
        cached.keyword.top_source_title_en ??
        topSource?.title ??
        cached.keyword.top_source_title,
      top_source_url: topSource?.url ?? cached.keyword.top_source_url,
      top_source_domain: topSource?.domain ?? cached.keyword.top_source_domain,
      top_source_image_url: topSource?.image_url ?? cached.keyword.top_source_image_url,
    });
    await upsertKeywordAliases(kw.keywordId, [
      ...keywordAliases,
      localizedKeyword.ko,
      localizedKeyword.en,
    ]);

    // source insert 병렬화
    await Promise.all(
      localizedSources.map((src) =>
        insertSource({
          snapshot_id: snapshotId,
          keyword_id: kw.keywordId,
          type: src.type,
          title: src.title,
          url: src.url,
          domain: src.domain,
          published_at_utc: src.published_at_utc,
          snippet: src.snippet,
          image_url: src.image_url,
          title_ko: src.title_ko,
          title_en: src.title_en,
        })
      )
    );
    return { reused: true };
  }

  const allowExternalEnrichment =
    allowExternalEnrichmentForNewKeywords || forceExternalEnrichmentForKeyword;

  if (!allowExternalEnrichment) {
    const localizedKeyword = await ensureLocalizedKeyword(kw.keyword);
    await insertKeyword({
      snapshot_id: snapshotId,
      keyword_id: kw.keywordId,
      keyword: kw.keyword,
      keyword_ko: localizedKeyword.ko,
      keyword_en: localizedKeyword.en,
      rank: item.rank,
      delta_rank: item.deltaRank,
      is_new: item.isNew,
      score: item.score.total,
      score_recency: item.score.recency,
      score_frequency: item.score.frequency,
      score_authority: item.score.authority,
      score_velocity: item.score.velocity,
      score_internal: item.score.internal,
      summary_short: "",
      summary_short_en: "",
      primary_type: "news",
      top_source_title: null,
      top_source_title_ko: null,
      top_source_title_en: null,
      top_source_url: null,
      top_source_domain: null,
      top_source_image_url: null,
    });
    await upsertKeywordAliases(kw.keywordId, [
      ...keywordAliases,
      localizedKeyword.ko,
      localizedKeyword.en,
    ]);
    return { reused: false };
  }

  // ── 신규: Tavily 수집 ────────────────────────────────────────────
  console.log(`[snapshot] [NEW]   ${kw.keyword} (rank ${item.rank})`);
  const sourcesMap = await collectSources(kw.keyword);
  const allSources = [
    ...sourcesMap.news,
    ...sourcesMap.social,
    ...sourcesMap.data,
  ];

  const urlsToFetch = allSources.filter((s) => !s.imageUrl).slice(0, 10).map((s) => s.url);
  const ogMap = await batchExtractOgImages(urlsToFetch);
  for (const source of allSources) {
    if (!source.imageUrl && ogMap.has(source.url)) {
      source.imageUrl = ogMap.get(source.url) ?? null;
    }
  }

  const summaries = await generateSummaries(
    kw.keyword,
    sourcesMap.news.length > 0 ? sourcesMap.news : allSources.slice(0, 5)
  );
  const localizedKeyword = await ensureLocalizedKeyword(kw.keyword);
  const primaryType = determinePrimaryType(allSources);
  const topSource = pickPrimarySource(allSources, primaryType);

  // 소스 제목 번역 (배치)
  const sourceEntries = Object.entries(sourcesMap).flatMap(([type, typeItems]) =>
    typeItems.slice(0, 8).map((source) => ({ type, source }))
  );
  const originalTitles = sourceEntries.map((entry) => entry.source.title);
  const localizedTitles = await localizeTitlesBilingually(originalTitles);
  const localizedByUrl = new Map<string, { ko: string; en: string }>();
  sourceEntries.forEach(({ source }, index) => {
    localizedByUrl.set(source.url, localizedTitles[index]);
  });
  const topSourceLocalized = topSource
    ? localizedByUrl.get(topSource.url) ?? (await localizeTitlesBilingually([topSource.title]))[0]
    : null;

  await insertKeyword({
    snapshot_id: snapshotId,
    keyword_id: kw.keywordId,
    keyword: kw.keyword,
    keyword_ko: localizedKeyword.ko,
    keyword_en: localizedKeyword.en,
    rank: item.rank,
    delta_rank: item.deltaRank,
    is_new: item.isNew,
    score: item.score.total,
    score_recency: item.score.recency,
    score_frequency: item.score.frequency,
    score_authority: item.score.authority,
    score_velocity: item.score.velocity,
    score_internal: item.score.internal,
    summary_short: summaries.ko,
    summary_short_en: summaries.en,
    primary_type: primaryType,
    top_source_title: topSource?.title ?? null,
    top_source_title_ko: topSourceLocalized?.ko ?? topSource?.title ?? null,
    top_source_title_en: topSourceLocalized?.en ?? topSource?.title ?? null,
    top_source_url: topSource?.url ?? null,
    top_source_domain: topSource?.domain ?? null,
    top_source_image_url: topSource?.imageUrl ?? null,
  });
  await upsertKeywordAliases(kw.keywordId, [
    ...keywordAliases,
    localizedKeyword.ko,
    localizedKeyword.en,
  ]);

  // source insert 병렬화
  await Promise.all(
    sourceEntries.map(({ type, source }, idx) =>
      insertSource({
        snapshot_id: snapshotId,
        keyword_id: kw.keywordId,
        type: type as "news" | "social" | "data",
        title: source.title,
        url: source.url,
        domain: source.domain,
        published_at_utc: source.publishedAt,
        snippet: source.snippet || null,
        image_url: source.imageUrl ?? defaultImage,
        title_ko: localizedTitles[idx]?.ko ?? source.title,
        title_en: localizedTitles[idx]?.en ?? source.title,
      })
    )
  );

  return { reused: false };
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

interface RunSnapshotPipelineOptions {
  mode?: PipelineMode;
}

export async function runSnapshotPipeline(
  _options: RunSnapshotPipelineOptions = {}
): Promise<{
  snapshotId: string;
  keywordCount: number;
  reusedCount: number;
  mode: PipelineMode;
}> {
  const mode: PipelineMode = "realtime";
  const profile = resolveRuntimeProfile(mode);
  const startedAt = Date.now();
  console.log(`[snapshot] Pipeline started (mode=${mode})`);
  console.log(
    `[snapshot] Config: mode=${mode}, detailedLimit=${profile.detailedKeywordLimit}, keywordConcurrency=${KEYWORD_CONCURRENCY}, lightweightConcurrency=${LIGHTWEIGHT_CONCURRENCY}, scheduleUtc=${profile.scheduleUtc.map((slot) => `${String(slot.hour).padStart(2, "0")}:${String(slot.minute).padStart(2, "0")}`).join(",")}, recencyHalfLifeHours=${profile.scoring.recencyHalfLifeHours}, velocityWindow=${profile.scoring.velocityRecentWindowHours}h+${profile.scoring.velocityBaselineWindowHours}h, enrichmentForNew=${profile.allowExternalEnrichmentForNewKeywords}`
  );

  // 최근 4개 스냅샷 조회 (캐시 범위 48h)
  const CACHE_SNAPSHOTS = 4;
  const recentSnapshots = await getRecentSnapshots(CACHE_SNAPSHOTS, mode);
  const prevSnapshot = recentSnapshots[0] ?? null; // delta rank 계산용
  const recentSnapshotIds = recentSnapshots.map((s) => s.snapshot_id);

  // 1) 전체 소스 병렬 수집
  console.log("[snapshot] Step 1: Collecting items from all sources...");
  const sourceStates = await getSourceIngestionStates();
  const sourceStateMap = new Map<string, SourceIngestionState>(
    sourceStates.map((state) => [state.source_key, state])
  );
  const [
    productHuntTopItems,
    rssItems,
    hnItems,
    gdeltItems,
    githubItems,
    githubMdItems,
    youtubeItems,
    githubReleaseItems,
    changelogItems,
  ] = await Promise.all(
    SOURCE_PLANS.map((plan) =>
      collectWithIncrementalWindow(profile, plan, sourceStateMap)
    )
  );

  // URL 기준 중복 제거 후 합산 (P0_CURATED 소스 우선)
  const seenUrls = new Set<string>();
  const allItems = [
    ...productHuntTopItems,
    ...rssItems,
    ...githubMdItems,
    ...githubReleaseItems,
    ...changelogItems,
    ...youtubeItems,
    ...hnItems,
    ...gdeltItems,
    ...githubItems,
  ].filter((item) => {
    if (seenUrls.has(item.link)) return false;
    seenUrls.add(item.link);
    return true;
  });
  console.log(
    `[snapshot] Got ${allItems.length} items (productHuntTop=${productHuntTopItems.length}, rss=${rssItems.length}, githubMd=${githubMdItems.length}, githubRel=${githubReleaseItems.length}, changelog=${changelogItems.length}, youtube=${youtubeItems.length}, hn=${hnItems.length}, gdelt=${gdeltItems.length}, github=${githubItems.length})`
  );

  // 2~3) 키워드 추출 + 정규화 (AI 클러스터링)
  console.log("[snapshot] Step 2-3: Normalizing keywords...");
  const normalizedKeywords = await normalizeKeywords(allItems, { mode });
  console.log(`[snapshot] Got ${normalizedKeywords.length} normalized keywords`);
  const activeManualKeywords = await getActiveManualKeywords(mode);
  const activeManualKeywordKeySet = new Set<string>(
    activeManualKeywords.map((row) => normalizeManualKeywordLookupKey(row.keyword))
  );
  const rankingLimit = Math.min(
    60,
    Math.max(RANKING_CANDIDATE_LIMIT, activeManualKeywords.length + 10)
  );
  console.log(
    `[snapshot] Manual keywords: active=${activeManualKeywords.length}, rankingLimit=${rankingLimit}`
  );

  // 4~6) 스코어링 + Top N 선별
  console.log("[snapshot] Step 4-6: Scoring and ranking...");
  const ranked = rankKeywords(normalizedKeywords, {
    limit: rankingLimit,
    sourceItems: allItems,
    profile: profile.scoring,
  });

  // 이전 스냅샷 rank 조회
  const snapshotId = buildSnapshotId();
  const prevRankMap = prevSnapshot
    ? await getPreviousRanks(
        prevSnapshot.snapshot_id,
        ranked.map((r) => r.keyword.keywordId)
      )
    : new Map<string, number>();
  const rankedWithDelta = calculateDeltaRanks(ranked, prevRankMap);

  // Novelty 보너스: 새로 등장한 키워드에 +0.15 적용
  const NOVELTY_BONUS = 0.15;
  const rankedWithNovelty = rankedWithDelta
    .map((item) =>
      item.isNew
        ? { ...item, score: { ...item.score, total: item.score.total + NOVELTY_BONUS } }
        : item
    )
    .sort((a, b) => b.score.total - a.score.total);

  const finalRanked = applyManualKeywordPriority(
    mode,
    rankedWithNovelty,
    activeManualKeywords
  )
    .slice(0, rankingLimit)
    .map((item, idx) => ({ ...item, rank: idx + 1 }));

  if (finalRanked.length === 0) {
    throw new Error(
      "[snapshot] No ranked keywords generated; aborting snapshot write to avoid empty snapshot."
    );
  }

  // 7) 스냅샷 저장
  console.log("[snapshot] Step 7: Saving snapshot...");
  const now = new Date();
  await insertSnapshot({
    snapshot_id: snapshotId,
    pipeline_mode: mode,
    updated_at_utc: now.toISOString(),
    next_update_at_utc: nextScheduledTime(profile.scheduleUtc).toISOString(),
  });

  const detailedRanked = finalRanked.slice(0, profile.detailedKeywordLimit);
  const lightweightRanked = finalRanked.slice(profile.detailedKeywordLimit);

  // 8) 상세 키워드 처리 — 병렬 실행
  console.log(
    `[snapshot] Step 8: Processing top ${detailedRanked.length} keywords in parallel...`
  );
  const DEFAULT_IMAGE = "/images/default-thumbnail.png";
  const kwResults = await mapWithConcurrency(
    detailedRanked,
    KEYWORD_CONCURRENCY,
    (item) => {
      const forceExternalEnrichmentForKeyword = keywordLookupKeys(item).some(
        (key) => activeManualKeywordKeySet.has(key)
      );
      return processKeyword(
        item,
        snapshotId,
        recentSnapshotIds,
        DEFAULT_IMAGE,
        profile.allowExternalEnrichmentForNewKeywords,
        forceExternalEnrichmentForKeyword
      );
    }
  );

  // 9) 나머지 키워드는 검색 화면 노출용으로 lightweight 저장
  console.log("[snapshot] Step 9: Saving lightweight keywords for search chips...");
  const lightweightResults = await mapWithConcurrency(
    lightweightRanked,
    LIGHTWEIGHT_CONCURRENCY,
    async (item) => {
      const localizedKeyword = await ensureLocalizedKeyword(item.keyword.keyword);
      await insertKeyword({
        snapshot_id: snapshotId,
        keyword_id: item.keyword.keywordId,
        keyword: item.keyword.keyword,
        keyword_ko: localizedKeyword.ko,
        keyword_en: localizedKeyword.en,
        rank: item.rank,
        delta_rank: item.deltaRank,
        is_new: item.isNew,
        score: item.score.total,
        score_recency: item.score.recency,
        score_frequency: item.score.frequency,
        score_authority: item.score.authority,
        score_velocity: item.score.velocity,
        score_internal: item.score.internal,
        summary_short: "",
        summary_short_en: "",
        primary_type: "news",
        top_source_title: null,
        top_source_title_ko: null,
        top_source_title_en: null,
        top_source_url: null,
        top_source_domain: null,
        top_source_image_url: null,
      });
      await upsertKeywordAliases(item.keyword.keywordId, [
        item.keyword.keyword,
        ...item.keyword.aliases,
        localizedKeyword.ko,
        localizedKeyword.en,
      ]);
    }
  );

  let keywordCount = 0;
  let reusedCount = 0;
  let lightweightCount = 0;
  for (const r of kwResults) {
    if (r.status === "fulfilled") {
      keywordCount++;
      if (r.value.reused) reusedCount++;
    } else {
      console.error("[snapshot] Keyword processing failed:", r.reason);
    }
  }
  for (const r of lightweightResults) {
    if (r.status === "fulfilled") {
      lightweightCount++;
    } else {
      console.error("[snapshot] Lightweight keyword save failed:", r.reason);
    }
  }

  if (keywordCount + lightweightCount === 0) {
    const deleted = await deleteSnapshotIfEmpty(snapshotId);
    throw new Error(
      `[snapshot] No keywords were persisted for snapshot ${snapshotId} (deletedEmptySnapshot=${deleted}).`
    );
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[snapshot] Pipeline complete: mode=${mode}, snapshotId=${snapshotId}, keywords=${keywordCount} (reused=${reusedCount}, new=${keywordCount - reusedCount}, lightweight=${lightweightCount}), elapsedMs=${elapsedMs}`
  );
  return { snapshotId, keywordCount, reusedCount, mode };
}
