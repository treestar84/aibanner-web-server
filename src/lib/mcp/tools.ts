// MCP 도구 구현 6개 (docs/mcp-server-design.md §4)
// 기존 /api/v1/* 라우트가 쓰는 조회 함수를 그대로 재사용하고, queries.ts는 수정하지 않는다.
// 저작권 정책(§3): 어떤 응답에도 snippet·image_url을 포함하지 않는다.

import {
  getActiveManualKeywordIds,
  getHotKeywords,
  getLatestSnapshot,
  getLatestSnapshotWithKeywords,
  getSourcesByKeyword,
  getTopKeywords,
  searchKeywordsByText,
  type Keyword,
  type Source,
} from "@/lib/db/queries";
import { filterActiveSnapshotKeywords } from "@/lib/manual-keywords";
import {
  isTop20LightweightGuardEnabled,
  selectTopTrendDisplayKeywords,
} from "@/lib/api/top_trends_display_quality";
import { classifySourceCategory } from "@/lib/pipeline/source_category";
import { truncate, type McpLang } from "@/lib/mcp/policy";
import { getCached } from "@/lib/mcp/cache";

const SUMMARY_MAX_LENGTH = 200;
const KEYWORD_DETAIL_SOURCE_LIMIT = 10;
const CONTENT_BASE_URL =
  process.env.CONTENT_BASE_URL ?? "https://ainews-amber.vercel.app";
const CONTENT_FETCH_REVALIDATE_SECONDS = 600;

function localizedKeyword(keyword: Keyword, lang: McpLang): string {
  return lang === "en"
    ? keyword.keyword_en || keyword.keyword
    : keyword.keyword_ko || keyword.keyword;
}

function localizedSummary(keyword: Keyword, lang: McpLang): string {
  const raw =
    lang === "en"
      ? keyword.summary_short_en || keyword.summary_short
      : keyword.summary_short;
  return truncate(raw, SUMMARY_MAX_LENGTH);
}

function localizedTopSourceTitle(keyword: Keyword, lang: McpLang): string | null {
  return lang === "en"
    ? keyword.top_source_title_en || keyword.top_source_title
    : keyword.top_source_title_ko || keyword.top_source_title;
}

// ─── 4.1 get_realtime_trends ──────────────────────────────────────────────────

export interface RealtimeTrendsInput {
  lang: McpLang;
  limit: number;
}

const REALTIME_TRENDS_TTL_MS = 120_000;

export async function getRealtimeTrends(input: RealtimeTrendsInput) {
  return getCached(
    `trends:${input.lang}:${input.limit}`,
    REALTIME_TRENDS_TTL_MS,
    async () => {
      const snapshot =
        (await getLatestSnapshotWithKeywords("realtime")) ??
        (await getLatestSnapshotWithKeywords());
      if (!snapshot) return null;

      const keywords = await getTopKeywords(
        snapshot.snapshot_id,
        Math.max(input.limit * 4, 100)
      );
      const activeManualKeywordIds = await getActiveManualKeywordIds(
        snapshot.pipeline_mode
      );
      const activeKeywords = filterActiveSnapshotKeywords(
        keywords,
        activeManualKeywordIds
      );
      const visibleKeywords = selectTopTrendDisplayKeywords(
        activeKeywords,
        input.limit,
        isTop20LightweightGuardEnabled()
      );

      return {
        updated_at: snapshot.updated_at_utc,
        next_update_at: snapshot.next_update_at_utc,
        items: visibleKeywords.map((kw) => ({
          rank: kw.rank,
          keyword: localizedKeyword(kw, input.lang),
          rank_delta: kw.delta_rank,
          is_new: kw.is_new,
          summary: localizedSummary(kw, input.lang),
          source: kw.top_source_url
            ? {
                name: localizedTopSourceTitle(kw, input.lang),
                url: kw.top_source_url,
              }
            : null,
        })),
      };
    }
  );
}

// ─── 4.2 get_burning_keywords ─────────────────────────────────────────────────

export interface BurningKeywordsInput {
  lang: McpLang;
  limit: number;
}

const BURNING_LIFECYCLE_DAYS = 3;
const BURNING_TOP_RANK_LIMIT = 10;

const BURNING_KEYWORDS_TTL_MS = 120_000;

export async function getBurningKeywords(input: BurningKeywordsInput) {
  return getCached(
    `burning:${input.lang}:${input.limit}`,
    BURNING_KEYWORDS_TTL_MS,
    async () => {
      const snapshot =
        (await getLatestSnapshotWithKeywords("realtime")) ??
        (await getLatestSnapshot("realtime"));
      if (!snapshot) return null;

      const keywords = await getHotKeywords(
        BURNING_LIFECYCLE_DAYS,
        Math.max(input.limit * 4, 100),
        BURNING_TOP_RANK_LIMIT,
        snapshot.pipeline_mode
      );
      const activeManualKeywordIds = await getActiveManualKeywordIds(
        snapshot.pipeline_mode
      );
      const visibleKeywords = filterActiveSnapshotKeywords(
        keywords,
        activeManualKeywordIds
      ).slice(0, input.limit);

      return {
        items: visibleKeywords.map((kw) => {
          const summaryRaw =
            input.lang === "en"
              ? kw.summary_short_en || kw.summary_short
              : kw.summary_short;
          const hasSummary = Boolean(summaryRaw && summaryRaw.trim().length > 0);
          return {
            keyword: localizedKeyword(kw, input.lang),
            view_count: kw.view_count,
            summary: hasSummary ? truncate(summaryRaw, SUMMARY_MAX_LENGTH) : null,
            detail_available: hasSummary,
          };
        }),
      };
    }
  );
}

// ─── 4.3 get_keyword_detail ───────────────────────────────────────────────────

export interface KeywordDetailInput {
  keyword: string;
  lang: McpLang;
}

function sourcesToDetailList(sources: Source[], lang: McpLang) {
  return sources.slice(0, KEYWORD_DETAIL_SOURCE_LIMIT).map((s) => ({
    type: classifySourceCategory(s),
    name: (lang === "en" ? s.title_en || s.title : s.title_ko || s.title) || s.title,
    url: s.url,
    domain: s.domain,
  }));
}

function parseBullets(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const KEYWORD_DETAIL_TTL_MS = 300_000;

export async function getKeywordDetail(input: KeywordDetailInput) {
  const query = input.keyword.trim();
  return getCached(
    `detail:${input.lang}:${query.toLowerCase()}`,
    KEYWORD_DETAIL_TTL_MS,
    async () => {
      const snapshot = await getLatestSnapshotWithKeywords();
      if (!snapshot) {
        return { found: false, suggestion: "search_trends로 검색해보세요" };
      }

      const activeManualKeywordIds = await getActiveManualKeywordIds(
        snapshot.pipeline_mode
      );
      const candidates = filterActiveSnapshotKeywords(
        await searchKeywordsByText(query, snapshot.snapshot_id, 20),
        activeManualKeywordIds
      );

      const normalized = query.toLowerCase();
      const exactMatch = candidates.find(
        (kw) =>
          kw.keyword.toLowerCase() === normalized ||
          kw.keyword_ko?.toLowerCase() === normalized ||
          kw.keyword_en?.toLowerCase() === normalized
      );
      const matched = exactMatch ?? candidates[0];

      if (!matched) {
        return { found: false, suggestion: "search_trends로 검색해보세요" };
      }

      const sources = await getSourcesByKeyword(matched.snapshot_id, matched.keyword_id);
      const bullets =
        input.lang === "en"
          ? parseBullets(matched.bullets_en || matched.bullets_ko)
          : parseBullets(matched.bullets_ko);

      return {
        found: true,
        keyword: localizedKeyword(matched, input.lang),
        summary: localizedSummary(matched, input.lang),
        bullets,
        sources: sourcesToDetailList(sources, input.lang),
      };
    }
  );
}

// ─── 4.4 search_trends ────────────────────────────────────────────────────────

export interface SearchTrendsInput {
  query: string;
  lang: McpLang;
  limit: number;
}

const SEARCH_TRENDS_TTL_MS = 300_000;

export async function searchTrends(input: SearchTrendsInput) {
  const query = input.query.trim();
  return getCached(
    `search:${input.lang}:${input.limit}:${query.toLowerCase()}`,
    SEARCH_TRENDS_TTL_MS,
    async () => {
      const snapshot = await getLatestSnapshotWithKeywords();
      if (!snapshot) return { items: [] };

      const activeManualKeywordIds = await getActiveManualKeywordIds(
        snapshot.pipeline_mode
      );
      const keywords = filterActiveSnapshotKeywords(
        await searchKeywordsByText(query, snapshot.snapshot_id, input.limit),
        activeManualKeywordIds
      );

      return {
        items: keywords.map((kw) => ({
          keyword: localizedKeyword(kw, input.lang),
          summary: localizedSummary(kw, input.lang),
          snapshot_date: kw.created_at,
        })),
      };
    }
  );
}

// ─── 4.5 get_hot_topics ───────────────────────────────────────────────────────

interface HotTopicsSource {
  name: string;
  url: string;
}

interface HotTopicsTopic {
  rank: number;
  title: string;
  brief: string;
  type: string;
  sources: HotTopicsSource[];
}

interface HotTopicsPayload {
  generated_at: string;
  topics: HotTopicsTopic[];
}

export interface HotTopicsInput {
  limit: number;
}

const HOT_TOPICS_TTL_MS = 600_000;

export async function getHotTopics(input: HotTopicsInput) {
  return getCached(`hot:${input.limit}`, HOT_TOPICS_TTL_MS, async () => {
    const res = await fetch(`${CONTENT_BASE_URL}/api/hot-topics.json`, {
      next: { revalidate: CONTENT_FETCH_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;

    const payload = (await res.json()) as HotTopicsPayload;
    if (!payload || !Array.isArray(payload.topics)) return null;

    return {
      date: payload.generated_at,
      topics: payload.topics.slice(0, input.limit).map((topic) => ({
        rank: topic.rank,
        title: topic.title,
        brief: topic.brief,
        type: topic.type,
        sources: Array.isArray(topic.sources)
          ? topic.sources.map((s) => ({ name: s.name, url: s.url }))
          : [],
      })),
    };
  });
}

// ─── 4.6 get_daily_podcast ────────────────────────────────────────────────────

interface PodcastHost {
  id: string;
}

interface PodcastPayload {
  status: string;
  date: string;
  title: string;
  description: string;
  audio_url: string;
  duration_seconds: number;
  source_count: number;
  hosts?: PodcastHost[];
}

const PODCAST_NOTE =
  "본 팟캐스트는 복수 출처 뉴스를 AI가 종합해 생성한 오디오입니다";

const DAILY_PODCAST_TTL_MS = 600_000;

export async function getDailyPodcast() {
  return getCached("podcast", DAILY_PODCAST_TTL_MS, async () => {
    const res = await fetch(`${CONTENT_BASE_URL}/podcasts/latest.json`, {
      next: { revalidate: CONTENT_FETCH_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;

    const payload = (await res.json()) as PodcastPayload;
    const isValid =
      payload &&
      payload.status === "ready" &&
      typeof payload.source_count === "number" &&
      payload.source_count >= 7 &&
      payload.source_count <= 20 &&
      typeof payload.audio_url === "string" &&
      payload.audio_url.startsWith("https://");
    if (!isValid) return null;

    return {
      date: payload.date,
      title: payload.title,
      description: payload.description,
      audio_url: payload.audio_url,
      duration_seconds: payload.duration_seconds,
      hosts: Array.isArray(payload.hosts)
        ? payload.hosts.map((h) => ({ name: h.id }))
        : [],
      note: PODCAST_NOTE,
    };
  });
}
