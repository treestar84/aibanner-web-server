import { collectRssItems } from "./rss";
import { collectHnItems } from "./hn_source";
import { collectGdeltItems } from "./gdelt_source";
import { collectGithubItems } from "./github_source";
import { collectGithubMdItems } from "./github_md_source";
import { collectYoutubeItems } from "./youtube_source";
import { collectGithubReleaseItems } from "./github_releases_source";
import { collectChangelogItems } from "./changelog_source";
import { collectProductHuntTopItems } from "./product_hunt_top_source";
import { collectRedditItems } from "./reddit_source";
import { collectTechmemeItems } from "./techmeme_source";
import { collectGoogleAlertsItems } from "./google_alerts_source";
import { collectOpenRouterItems } from "./openrouter_source";
import { collectHuggingFaceItems } from "./huggingface_source";
import { collectVendorAnnouncementItems } from "./vendor_announcements_source";
import { collectBlueskyItems } from "./bluesky_source";
import type { RssItem } from "./rss";
import { normalizeKeywords } from "./keywords";
import { collectAliasLookupKeys, resolveCanonicalKeywordIds } from "./keyword_identity";
import { rankKeywords } from "./scoring";
import type { ScoringProfile } from "./scoring";
import type { PipelineMode } from "./mode";
import { collectSources } from "./tavily";
import { buildEventContext } from "./event_context";
import { generateSummaries, batchTranslateTitles, classifyKeywordType, naturalizeKeywordKo } from "./summarize";
import type { KeywordLocaleAction } from "./summarize";
import { fetchTopSourceFullTexts } from "./jina_reader";
import { batchExtractOgImages } from "./og-parser";
import { determinePrimaryType, pickPrimarySource } from "./source_category";
import { resolveScheduleUtc, type ScheduleSlot } from "./schedule";
import {
  buildKeywordPolicyMap,
  calculateKeywordPolicyDelta,
  calculateStabilityDelta,
  suppressVersionFamilyDuplicates,
  type RankingHistoryStats,
} from "./ranking_policy";
import {
  applyInternalDelta,
  applyManualKeywordPriority,
  keywordLookupKeys,
  type RankedKeywordWithDelta,
} from "./manual_priority";
import {
  buildRankingCandidateDebug,
  calculateFixedCandidateBonus,
} from "./ranking_candidate_debug";
import {
  evaluateRankingQualityCandidate,
  parseRankingQualityFlags,
} from "./ranking_quality_policy";
import { buildRankingQualityCandidate } from "./snapshot_quality_adapter";
import { normalizeManualKeywordLookupKey } from "@/lib/manual-keywords";
import {
  insertSnapshot,
  deleteSnapshotIfEmpty,
  insertKeyword,
  insertSource,
  getPreviousRanks,
  getRecentSnapshots,
  getTopKeywords,
  findCachedKeyword,
  upsertKeywordAliases,
  getSourceIngestionStates,
  upsertSourceIngestionState,
  getActiveManualKeywords,
  insertSnapshotCandidates,
  getRankingWeights,
  getCanonicalKeywordIdsByAliases,
} from "@/lib/db/queries";
import type { Keyword, Source, SourceIngestionState } from "@/lib/db/queries";
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
  { key: "techmeme", collect: (windowHours) => collectTechmemeItems(windowHours) },
  { key: "google_alerts", collect: (windowHours) => collectGoogleAlertsItems(windowHours) },
  { key: "reddit", collect: (windowHours) => collectRedditItems(windowHours) },
  { key: "openrouter", collect: (windowHours) => collectOpenRouterItems(windowHours) },
  { key: "huggingface", collect: (windowHours) => collectHuggingFaceItems(windowHours) },
  { key: "vendor_announcements", collect: (windowHours) => collectVendorAnnouncementItems(windowHours) },
  { key: "bluesky", collect: (windowHours) => collectBlueskyItems(windowHours) },
];

function resolveSourceWindowProfile(): SourceWindowProfile {
  const legacyMin = process.env.PIPELINE_SOURCE_MIN_WINDOW_HOURS;
  const legacyFallback = process.env.PIPELINE_SOURCE_FALLBACK_WINDOW_HOURS;
  const legacyMax = process.env.PIPELINE_SOURCE_MAX_WINDOW_HOURS;
  const legacyOverlap = process.env.PIPELINE_SOURCE_OVERLAP_MINUTES;

  const minHours = parsePositiveIntEnv(
    process.env.PIPELINE_REALTIME_SOURCE_MIN_WINDOW_HOURS ?? legacyMin,
    24,
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

const DEFAULT_SCORING_WEIGHTS = {
  recency: 0.28,
  frequency: 0.12,
  authority: 0.08,
  velocity: 0.30,
  engagement: 0.22,
  internal: 0,
};

async function resolveRuntimeProfile(mode: PipelineMode): Promise<PipelineRuntimeProfile> {
  const scheduleUtc = resolveScheduleUtc(mode);

  // DB에서 관리자 설정 가중치 조회, 실패 시 기본값 사용
  let weights = DEFAULT_SCORING_WEIGHTS;
  try {
    const dbWeights = await getRankingWeights();
    weights = {
      recency: dbWeights.w_recency,
      frequency: dbWeights.w_frequency,
      authority: dbWeights.w_authority,
      velocity: dbWeights.w_velocity,
      engagement: dbWeights.w_engagement ?? DEFAULT_SCORING_WEIGHTS.engagement,
      internal: dbWeights.w_internal,
    };
  } catch (err) {
    console.warn(`[snapshot] Failed to load ranking weights from DB, using defaults: ${(err as Error).message}`);
  }

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
    weights,
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
  existingEn?: string | null,
  // 스냅샷 사이클 pre-pass에서 신규 키워드들을 배치 호출해 미리 계산해 둔 결과.
  // 존재하면 개별 gpt-4o-mini 호출을 건너뛰고 재사용한다. 미존재/미스 시 기존과
  // 동일하게 단건 호출로 폴백하므로 동작·결과는 이전과 항상 동일하다.
  prebatched?: Map<string, { ko: string; en: string }>
): Promise<{ ko: string; en: string }> {
  const fallback = keyword.trim() || keyword;
  let ko = (existingKo ?? "").trim();
  let en = (existingEn ?? "").trim();
  const fallbackHasKorean = hasKoreanText(fallback);
  const pre = prebatched?.get(keyword);

  if (fallbackHasKorean) {
    if (!ko) ko = fallback;
    const needEnTranslation = !en || en === fallback;
    if (needEnTranslation) {
      en = pre?.en ?? (await batchTranslateTitles([keyword], "en"))[0] ?? fallback;
    }
  } else {
    if (!en) en = fallback;
    const needKoTranslation = !ko || ko === fallback;
    if (needKoTranslation) {
      if (pre) {
        ko = pre.ko;
      } else {
        // keep: 영문 원문 유지, natural: 자연스러운 한국어 표기, translate: 번역
        const [kwType] = await classifyKeywordType([keyword]);
        if (kwType === "translate") {
          ko = (await batchTranslateTitles([keyword], "ko"))[0] ?? fallback;
        } else if (kwType === "natural") {
          ko = (await naturalizeKeywordKo([keyword]))[0] ?? fallback;
        } else {
          ko = fallback; // keep: 영문 그대로
        }
      }
    }
  }

  return {
    ko: ko || fallback,
    en: en || fallback,
  };
}

/**
 * 스냅샷 사이클 pre-pass: "신규(로컬라이즈 캐시 없음)" 키워드 목록을 모아
 * classifyKeywordType / batchTranslateTitles / naturalizeKeywordKo를 각각
 * 최대 1회씩(타입별 그룹 배치)만 호출해 ko/en 쌍을 미리 계산한다.
 * ensureLocalizedKeyword와 동일한 분기 로직을 배치 형태로 재현하므로
 * 결과값은 기존 단건 순차 호출과 동일하다. 실패 시에도 각 배치 함수 자체가
 * 원문 폴백을 보장하므로 여기서 별도 예외 처리는 불필요하다.
 */
async function buildNewKeywordLocalizationMap(
  keywords: string[]
): Promise<Map<string, { ko: string; en: string }>> {
  const map = new Map<string, { ko: string; en: string }>();
  if (keywords.length === 0) return map;

  // 동일 키워드 재호출 방지: 중복 제거(원 순서 보존)
  const uniqueKeywords = Array.from(new Set(keywords));

  const koreanOrigin: string[] = [];
  const nonKoreanOrigin: string[] = [];
  for (const kw of uniqueKeywords) {
    if (hasKoreanText(kw.trim() || kw)) {
      koreanOrigin.push(kw);
    } else {
      nonKoreanOrigin.push(kw);
    }
  }

  const [enForKorean, kwTypes] = await Promise.all([
    koreanOrigin.length > 0
      ? batchTranslateTitles(koreanOrigin, "en")
      : Promise.resolve([] as string[]),
    nonKoreanOrigin.length > 0
      ? classifyKeywordType(nonKoreanOrigin)
      : Promise.resolve([] as KeywordLocaleAction[]),
  ]);

  koreanOrigin.forEach((kw, i) => {
    const fallback = kw.trim() || kw;
    map.set(kw, { ko: fallback, en: enForKorean[i] ?? fallback });
  });

  const translateGroup: string[] = [];
  const naturalGroup: string[] = [];
  const keepGroup: string[] = [];
  nonKoreanOrigin.forEach((kw, i) => {
    const type = kwTypes[i] ?? "keep";
    if (type === "translate") translateGroup.push(kw);
    else if (type === "natural") naturalGroup.push(kw);
    else keepGroup.push(kw);
  });

  const [translatedKo, naturalKo] = await Promise.all([
    translateGroup.length > 0
      ? batchTranslateTitles(translateGroup, "ko")
      : Promise.resolve([] as string[]),
    naturalGroup.length > 0
      ? naturalizeKeywordKo(naturalGroup)
      : Promise.resolve([] as string[]),
  ]);

  translateGroup.forEach((kw, i) => {
    const fallback = kw.trim() || kw;
    map.set(kw, { ko: translatedKo[i] ?? fallback, en: fallback });
  });
  naturalGroup.forEach((kw, i) => {
    const fallback = kw.trim() || kw;
    map.set(kw, { ko: naturalKo[i] ?? fallback, en: fallback });
  });
  keepGroup.forEach((kw) => {
    const fallback = kw.trim() || kw;
    map.set(kw, { ko: fallback, en: fallback });
  });

  return map;
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

// ─── Per-keyword processor ────────────────────────────────────────────────────

async function processKeyword(
  item: RankedKeywordWithDelta,
  snapshotId: string,
  defaultImage: string,
  allowExternalEnrichmentForNewKeywords: boolean,
  forceExternalEnrichmentForKeyword: boolean,
  allSourceItems: RssItem[] = [],
  // pre-pass에서 미리 조회해 둔 캐시 조회 결과. Step 8 진입 전에 이미 1회
  // findCachedKeyword를 호출했으므로 processKeyword 내부에서는 재조회하지 않는다.
  precomputedCached: { keyword: Keyword; sources: Source[] } | null = null,
  // pre-pass에서 배치 계산해 둔 신규 키워드 로컬라이즈 결과 (ensureLocalizedKeyword 참고)
  localizationPrebatchMap?: Map<string, { ko: string; en: string }>
): Promise<{ reused: boolean }> {
  const kw = item.keyword;
  const keywordAliases = [kw.keyword, ...kw.aliases];

  const cached = precomputedCached;

  if (cached) {
    const localizedKeyword = await ensureLocalizedKeyword(
      kw.keyword,
      cached.keyword.keyword_ko,
      cached.keyword.keyword_en,
      localizationPrebatchMap
    );
    const localizedSources = await ensureLocalizedStoredSources(cached.sources);
    const primaryType = determinePrimaryType(localizedSources);
    const topSource = pickPrimarySource(localizedSources, primaryType, kw.keyword);

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
      score_engagement: item.score.engagement,
      score_internal: item.score.internal,
      summary_short: cached.keyword.summary_short,
      summary_short_en: cached.keyword.summary_short_en,
      bullets_ko: cached.keyword.bullets_ko,
      bullets_en: cached.keyword.bullets_en,
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
          provider: src.provider,
        })
      )
    );
    return { reused: true };
  }

  const allowExternalEnrichment =
    allowExternalEnrichmentForNewKeywords || forceExternalEnrichmentForKeyword;

  if (!allowExternalEnrichment) {
    const localizedKeyword = await ensureLocalizedKeyword(
      kw.keyword,
      undefined,
      undefined,
      localizationPrebatchMap
    );
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
      score_engagement: item.score.engagement,
      score_internal: item.score.internal,
      summary_short: "",
      summary_short_en: "",
      bullets_ko: "[]",
      bullets_en: "[]",
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
  const eventContext = buildEventContext(kw, allSourceItems);
  const sourcesMap = await collectSources(kw.keyword, eventContext);
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

  // RSS 원본 기사에서 컨텍스트 추출 (이벤트 컨텍스트 재사용)
  const rssContext = eventContext.articles.map((article) => ({
    title: article.title,
    snippet: article.snippet,
    publishedAt: article.publishedAt,
    domain: article.domain,
  }));
  const latestTriggerPublishedAt = eventContext.articles.reduce<string | null>(
    (latest, article) =>
      article.publishedAt && (!latest || article.publishedAt > latest)
        ? article.publishedAt
        : latest,
    null
  );

  // Jina Reader로 상위 소스 전문(全文) 보강 (실패해도 스니펫 기반 요약으로 폴백됨)
  const fullTexts = await fetchTopSourceFullTexts(
    sourcesMap.news.length > 0 ? sourcesMap.news : allSources,
    2
  );

  const summaries = await generateSummaries(
    kw.keyword,
    sourcesMap.news.length > 0 ? sourcesMap.news : allSources.slice(0, 5),
    rssContext,
    {
      isNew: item.isNew,
      matchedArticleCount: eventContext.articles.length,
      latestTriggerPublishedAt,
    },
    fullTexts
  );
  const localizedKeyword = await ensureLocalizedKeyword(
    kw.keyword,
    undefined,
    undefined,
    localizationPrebatchMap
  );
  const primaryType = determinePrimaryType(allSources);
  const topSource = pickPrimarySource(allSources, primaryType, kw.keyword);

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
    score_engagement: item.score.engagement,
    score_internal: item.score.internal,
    summary_short: summaries.ko.summary,
    summary_short_en: summaries.en.summary,
    bullets_ko: JSON.stringify(summaries.ko.bullets),
    bullets_en: JSON.stringify(summaries.en.bullets),
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
        provider: source.provider ?? null,
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
  const profile = await resolveRuntimeProfile(mode);
  const startedAt = Date.now();
  console.log(`[snapshot] Pipeline started (mode=${mode})`);
  console.log(
    `[snapshot] Config: mode=${mode}, detailedLimit=${profile.detailedKeywordLimit}, keywordConcurrency=${KEYWORD_CONCURRENCY}, lightweightConcurrency=${LIGHTWEIGHT_CONCURRENCY}, scheduleUtc=${profile.scheduleUtc.map((slot) => `${String(slot.hour).padStart(2, "0")}:${String(slot.minute).padStart(2, "0")}`).join(",")}, recencyHalfLifeHours=${profile.scoring.recencyHalfLifeHours}, velocityWindow=${profile.scoring.velocityRecentWindowHours}h+${profile.scoring.velocityBaselineWindowHours}h, enrichmentForNew=${profile.allowExternalEnrichmentForNewKeywords}`
  );

  // 캐시 재사용 범위: 최근 4개 스냅샷 (약 24h)
  // 히스토리 범위: 최근 16개 스냅샷 (cron 4x/day × 4일) — appearances >= 8·12 패널티 도달 가능
  const CACHE_SNAPSHOTS = 4;
  const HISTORY_SNAPSHOTS = 16;
  const [recentSnapshots, historySnapshots] = await Promise.all([
    getRecentSnapshots(CACHE_SNAPSHOTS, mode),
    getRecentSnapshots(HISTORY_SNAPSHOTS, mode),
  ]);
  const prevSnapshot = recentSnapshots[0] ?? null; // delta rank 계산용
  const recentSnapshotIds = recentSnapshots.map((s) => s.snapshot_id);

  // 1) 전체 소스 병렬 수집
  console.log("[snapshot] Step 1: Collecting items from all sources...");
  const sourceStates = await getSourceIngestionStates();
  const sourceStateMap = new Map<string, SourceIngestionState>(
    sourceStates.map((state) => [state.source_key, state])
  );
  // 주의: 구조 분해 순서는 SOURCE_PLANS 배열 순서와 정확히 일치해야 한다.
  // (과거 techmeme/google_alerts 추가 시 구조 분해 누락으로 reddit 결과가
  //  유실되던 버그가 있었음 — 항목 추가 시 반드시 양쪽을 함께 수정할 것)
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
    techmemeItems,
    googleAlertsItems,
    redditItems,
    openRouterItems,
    huggingFaceItems,
    vendorAnnouncementItems,
    blueskyItems,
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
    ...vendorAnnouncementItems,
    ...githubMdItems,
    ...githubReleaseItems,
    ...changelogItems,
    ...openRouterItems,
    ...huggingFaceItems,
    ...youtubeItems,
    ...techmemeItems,
    ...googleAlertsItems,
    ...hnItems,
    ...gdeltItems,
    ...githubItems,
    ...redditItems,
    ...blueskyItems,
  ].filter((item) => {
    if (seenUrls.has(item.link)) return false;
    seenUrls.add(item.link);
    return true;
  });
  console.log(
    `[snapshot] Got ${allItems.length} items (productHuntTop=${productHuntTopItems.length}, rss=${rssItems.length}, vendorAnnounce=${vendorAnnouncementItems.length}, githubMd=${githubMdItems.length}, githubRel=${githubReleaseItems.length}, changelog=${changelogItems.length}, openrouter=${openRouterItems.length}, huggingface=${huggingFaceItems.length}, youtube=${youtubeItems.length}, techmeme=${techmemeItems.length}, googleAlerts=${googleAlertsItems.length}, hn=${hnItems.length}, gdelt=${gdeltItems.length}, github=${githubItems.length}, reddit=${redditItems.length}, bluesky=${blueskyItems.length})`
  );

  // 2~3) 키워드 추출 + 정규화 (AI 클러스터링)
  console.log("[snapshot] Step 2-3: Normalizing keywords...");
  const extractedKeywords = await normalizeKeywords(allItems, { mode });
  console.log(`[snapshot] Got ${extractedKeywords.length} normalized keywords`);

  // 2-4) canonical ID 재해석: 과거 스냅샷의 keyword_aliases와 매칭되면 그 canonical ID를
  // 재사용해, appearances 기반 evergreen 패널티(repeat_exposure_policy.ts)가 표면 텍스트
  // 변형(띄어쓰기/표기 차이)에 의해 리셋되지 않도록 한다.
  const aliasLookupKeys = collectAliasLookupKeys(extractedKeywords);
  const aliasCanonicalMap = await getCanonicalKeywordIdsByAliases(aliasLookupKeys);
  const { resolved: normalizedKeywords, remappedCount } = resolveCanonicalKeywordIds(
    extractedKeywords,
    aliasCanonicalMap
  );
  console.log(
    `[snapshot] Canonical ID resolution: ${remappedCount}/${extractedKeywords.length} keywords remapped to existing canonical IDs`
  );
  const activeManualKeywords = await getActiveManualKeywords(mode);
  const activeManualKeywordKeySet = new Set<string>(
    activeManualKeywords.map((row) => normalizeManualKeywordLookupKey(row.keyword))
  );
  const rankingLimit = Math.min(
    60,
    Math.max(RANKING_CANDIDATE_LIMIT, activeManualKeywords.length + 10)
  );
  const candidateLimit = Math.min(
    Math.max(rankingLimit * 3, 40),
    Math.max(normalizedKeywords.length, rankingLimit)
  );
  console.log(
    `[snapshot] Manual keywords: active=${activeManualKeywords.length}, rankingLimit=${rankingLimit}, candidateLimit=${candidateLimit}`
  );

  // 4~6) 스코어링 + Top N 선별
  console.log("[snapshot] Step 4-6: Scoring and ranking...");
  const ranked = rankKeywords(normalizedKeywords, {
    limit: candidateLimit,
    sourceItems: allItems,
    profile: profile.scoring,
  });
  const policyMetaByKeywordId = buildKeywordPolicyMap(normalizedKeywords, allItems);
  const policyDeltaByKeywordId = new Map<string, number>();
  const rankedWithPolicy = ranked
    .map((item) => {
      const meta = policyMetaByKeywordId.get(item.keyword.keywordId);
      const delta = meta ? calculateKeywordPolicyDelta(item, meta) : 0;
      policyDeltaByKeywordId.set(item.keyword.keywordId, delta);
      return applyInternalDelta(item, delta);
    })
    .sort((a, b) => b.score.total - a.score.total);
  const dedupedRanked = suppressVersionFamilyDuplicates(
    rankedWithPolicy,
    policyMetaByKeywordId
  ).sort((a, b) => b.score.total - a.score.total);

  // 이전 스냅샷 rank 조회
  const snapshotId = buildSnapshotId();
  const prevRankMap = prevSnapshot
    ? await getPreviousRanks(
        prevSnapshot.snapshot_id,
        dedupedRanked.map((r) => r.keyword.keywordId)
      )
    : new Map<string, number>();
  const rankedWithHistory: RankedKeywordWithDelta[] = dedupedRanked.map((item) => {
    const prevRank = prevRankMap.get(item.keyword.keywordId);
    return {
      ...item,
      deltaRank: prevRank == null ? 0 : prevRank - item.rank,
      isNew: prevRank == null,
    };
  });

  const recentTopKeywordLists = await Promise.all(
    historySnapshots.map((snapshot) => getTopKeywords(snapshot.snapshot_id, 10))
  );
  const historyByKeywordId = new Map<string, RankingHistoryStats>();
  for (const item of rankedWithHistory) {
    let appearances = 0;
    let previousRank: number | null = null;

    for (let i = 0; i < recentTopKeywordLists.length; i++) {
      const hit = recentTopKeywordLists[i].find(
        (keyword) => keyword.keyword_id === item.keyword.keywordId
      );
      if (!hit) continue;
      appearances += 1;
      if (i === 0) previousRank = hit.rank;
    }

    historyByKeywordId.set(item.keyword.keywordId, {
      appearances,
      previousRank,
    });
  }

  const stabilityDeltaByKeywordId = new Map<string, number>();
  const rankedWithStability = rankedWithHistory
    .map((item) => {
      const delta = calculateStabilityDelta(
        item,
        historyByKeywordId.get(item.keyword.keywordId)
      );
      stabilityDeltaByKeywordId.set(item.keyword.keywordId, delta);
      return applyInternalDelta(item, delta);
    })
    .sort((a, b) => b.score.total - a.score.total);

  const qualityFlags = parseRankingQualityFlags();
  const qualityDeltaByKeywordId = new Map<string, number>();
  const qualityReasonsByKeywordId = new Map<string, readonly string[]>();
  const rankedWithQuality = rankedWithStability
    .map((item) => {
      const isManual = keywordLookupKeys(item).some((key) =>
        activeManualKeywordKeySet.has(key)
      );
      const decision = evaluateRankingQualityCandidate(
        buildRankingQualityCandidate(
          item,
          allItems,
          historyByKeywordId.get(item.keyword.keywordId),
          isManual
        ),
        qualityFlags
      );
      qualityDeltaByKeywordId.set(item.keyword.keywordId, decision.appliedDelta);
      qualityReasonsByKeywordId.set(item.keyword.keywordId, decision.reasons);
      return applyInternalDelta(item, decision.appliedDelta);
    })
    .sort((a, b) => b.score.total - a.score.total);

  const manualPriority = applyManualKeywordPriority(
    mode,
    rankedWithQuality,
    activeManualKeywords,
    {
      internalBonus: MANUAL_KEYWORD_INTERNAL_BONUS,
      totalBonus: MANUAL_KEYWORD_TOTAL_BONUS,
    }
  );
  const finalRanked = manualPriority.items
    .slice(0, rankingLimit)
    .map((item, idx) => {
      const nextRank = idx + 1;
      const prevRank = prevRankMap.get(item.keyword.keywordId);
      return {
        ...item,
        rank: nextRank,
        isNew: prevRank == null,
        deltaRank: prevRank == null ? 0 : prevRank - nextRank,
      };
    });

  if (finalRanked.length === 0) {
    throw new Error(
      "[snapshot] No ranked keywords generated; aborting snapshot write to avoid empty snapshot."
    );
  }

  // 6.5) 시뮬레이터용 후보 전체 저장
  try {
    const manualKeywordKeySet = new Set<string>(
      activeManualKeywords.map((row) => normalizeManualKeywordLookupKey(row.keyword))
    );
    await insertSnapshotCandidates(
      snapshotId,
      finalRanked.map((item) => ({
        keyword: item.keyword.keyword,
        keyword_normalized: item.keyword.keywordId,
        score_recency: item.score.recency,
        score_frequency: item.score.frequency,
        score_authority: item.score.authority,
        score_velocity: item.score.velocity,
        score_engagement: item.score.engagement,
        score_internal: calculateFixedCandidateBonus(
          item.score,
          profile.scoring.weights
        ),
        total_score: item.score.total,
        source_count: item.keyword.candidates.domains.size,
        top_source_title: null,
        top_source_domain: [...item.keyword.candidates.domains][0] ?? null,
        is_manual: keywordLookupKeys(item).some((key) => manualKeywordKeySet.has(key)),
        ...buildRankingCandidateDebug({
          policyDelta: policyDeltaByKeywordId.get(item.keyword.keywordId) ?? 0,
          qualityReasons: qualityReasonsByKeywordId.get(item.keyword.keywordId) ?? [],
          stabilityDelta: stabilityDeltaByKeywordId.get(item.keyword.keywordId) ?? 0,
          manualDelta: manualPriority.manualDeltaByKeywordId.get(item.keyword.keywordId) ?? 0,
          isInsertedManual: manualPriority.insertedKeywordIds.has(item.keyword.keywordId),
          meta: policyMetaByKeywordId.get(item.keyword.keywordId) ?? null,
        }),
      }))
    );
    console.log(`[snapshot] Saved ${finalRanked.length} candidates for ranking simulator`);
  } catch (err) {
    console.warn(`[snapshot] Failed to save candidates: ${(err as Error).message}`);
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

  // 7.5) 신규 키워드 로컬라이즈 pre-pass — Step 8/9에서 매 신규 키워드마다
  // classifyKeywordType/batchTranslateTitles/naturalizeKeywordKo를 단건 호출하던 것을
  // 캐시 조회 결과를 먼저 확정한 뒤 신규분만 모아 배치 1~4회 호출로 대체한다.
  // (자세한 설계는 상단 buildNewKeywordLocalizationMap 주석 참고)
  const cachedByKeywordId = new Map<
    string,
    { keyword: Keyword; sources: Source[] } | null
  >();
  await Promise.all(
    detailedRanked.map(async (item) => {
      const cached = await findCachedKeyword(item.keyword.keywordId, recentSnapshotIds);
      cachedByKeywordId.set(item.keyword.keywordId, cached);
    })
  );
  const newDetailedKeywordTexts = detailedRanked
    .filter((item) => cachedByKeywordId.get(item.keyword.keywordId) == null)
    .map((item) => item.keyword.keyword);
  const lightweightKeywordTexts = lightweightRanked.map((item) => item.keyword.keyword);
  const localizationPrebatchMap = await buildNewKeywordLocalizationMap([
    ...newDetailedKeywordTexts,
    ...lightweightKeywordTexts,
  ]);

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
        DEFAULT_IMAGE,
        profile.allowExternalEnrichmentForNewKeywords,
        forceExternalEnrichmentForKeyword,
        allItems,
        cachedByKeywordId.get(item.keyword.keywordId) ?? null,
        localizationPrebatchMap
      );
    }
  );

  // 9) 나머지 키워드는 검색 화면 노출용으로 lightweight 저장
  console.log("[snapshot] Step 9: Saving lightweight keywords for search chips...");
  const lightweightResults = await mapWithConcurrency(
    lightweightRanked,
    LIGHTWEIGHT_CONCURRENCY,
    async (item) => {
      const localizedKeyword = await ensureLocalizedKeyword(
        item.keyword.keyword,
        undefined,
        undefined,
        localizationPrebatchMap
      );
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
        score_engagement: item.score.engagement,
        score_internal: item.score.internal,
        summary_short: "",
        summary_short_en: "",
        bullets_ko: "[]",
        bullets_en: "[]",
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
