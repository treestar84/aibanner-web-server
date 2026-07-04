// MCP 도구별 마크다운 포맷터 (docs/mcp-playmcp-compliance-design.md 작업 4)
// 원칙: API 응답 데이터를 그대로 노출하지 않고, snippet/이미지 없이 요약 + 출처 링크만 담은
// 정제된 마크다운 텍스트로 변환한다. footer(AI 생성 고지 + takedown 연락처)는 policy.ts의
// toolText()가 붙이므로 여기서는 본문만 만든다.

import type {
  getBurningKeywords,
  getDailyPodcast,
  getHotTopics,
  getKeywordDetail,
  getRealtimeTrends,
  searchTrends,
} from "@/lib/mcp/tools";
import type { McpLang } from "@/lib/mcp/policy";

export type RealtimeTrendsData = NonNullable<
  Awaited<ReturnType<typeof getRealtimeTrends>>
>;
export type BurningKeywordsData = NonNullable<
  Awaited<ReturnType<typeof getBurningKeywords>>
>;
export type KeywordDetailData = Awaited<ReturnType<typeof getKeywordDetail>>;

// getKeywordDetail의 두 반환 분기는 필드가 서로 다르지만, `found` 리터럴이 함수 내부에서
// 위닝(boolean으로 widen)되어 TS가 판별 유니온으로 좁히지 못한다(옵셔널 필드로 뭉개짐).
// found=true로 확인한 뒤 이 타입으로 단언해 실제 필드에 안전하게 접근한다.
type KeywordDetailFound = {
  found: true;
  keyword: string;
  summary: string;
  bullets: string[];
  sources: { type: string; name: string | null; url: string; domain: string }[];
};
export type SearchTrendsData = Awaited<ReturnType<typeof searchTrends>>;
export type HotTopicsData = NonNullable<Awaited<ReturnType<typeof getHotTopics>>>;
export type DailyPodcastData = NonNullable<Awaited<ReturnType<typeof getDailyPodcast>>>;

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** ISO 타임스탬프를 KST 기준 "YYYY-MM-DD HH:mm"으로 변환한다. */
function formatKstDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return parts.replace(",", "");
}

/** ISO 타임스탬프를 KST 기준 "HH:mm"으로 변환한다. */
function formatKstTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** 날짜 전용 문자열(date/created_at 등)을 KST 기준 "YYYY-MM-DD"로 변환한다. */
function formatKstDateOnly(value: string): string {
  if (isDateOnly(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function rankBadge(item: { rank_delta: number; is_new: boolean }): string {
  if (item.is_new) return " 🆕";
  if (item.rank_delta > 0) return ` (▲${item.rank_delta})`;
  if (item.rank_delta < 0) return ` (▼${Math.abs(item.rank_delta)})`;
  return "";
}

// ─── get_realtime_trends ──────────────────────────────────────────────────

export function formatRealtimeTrends(data: RealtimeTrendsData, lang: McpLang): string {
  const sourceLabel = lang === "en" ? "Source" : "출처";
  const header =
    lang === "en"
      ? `## Realtime AI Trends Top ${data.items.length}`
      : `## 실시간 AI 트렌드 Top ${data.items.length}`;
  const subheader =
    lang === "en"
      ? `_As of: ${formatKstDateTime(data.updated_at)} KST · Next update: ${formatKstTime(data.next_update_at)} KST_`
      : `_기준: ${formatKstDateTime(data.updated_at)} KST · 다음 업데이트: ${formatKstTime(data.next_update_at)} KST_`;

  const lines = data.items.map((item) => {
    const badge = rankBadge(item);
    const summaryPart = item.summary ? ` — ${item.summary}` : "";
    const sourceLink = item.source ? ` [${sourceLabel}](${item.source.url})` : "";
    return `${item.rank}. **${item.keyword}**${badge}${summaryPart}${sourceLink}`;
  });

  return [header, subheader, "", ...lines].join("\n");
}

// ─── get_burning_keywords ─────────────────────────────────────────────────

export function formatBurningKeywords(data: BurningKeywordsData, lang: McpLang): string {
  const header = lang === "en" ? "## Burning AI Keywords" : "## 타는중 AI 키워드";
  if (data.items.length === 0) {
    const empty =
      lang === "en" ? "No burning keywords right now." : "지금은 타는중 키워드가 없어요.";
    return `${header}\n\n${empty}`;
  }

  const lines = data.items.map((item, index) => {
    const summaryPart = item.summary ? ` — ${item.summary}` : "";
    return `${index + 1}. **${item.keyword}**${summaryPart}`;
  });

  return [header, "", ...lines].join("\n");
}

// ─── get_keyword_detail ───────────────────────────────────────────────────

export function formatKeywordDetail(data: KeywordDetailData, lang: McpLang): string {
  if (!data.found) {
    return lang === "en"
      ? "Couldn't find that keyword. Try the search_trends tool to search for it."
      : "키워드를 찾지 못했어요. search_trends 도구로 검색해보세요.";
  }

  const found = data as KeywordDetailFound;
  const hashtagLabel = lang === "en" ? "Hashtags" : "해시태그";
  const sourceLabel = lang === "en" ? "Sources" : "출처";

  const parts = [`## ${found.keyword}`, found.summary];

  if (found.bullets.length > 0) {
    parts.push("", `**${hashtagLabel}**: ${found.bullets.map((b) => `#${b}`).join(" ")}`);
  }

  if (found.sources.length > 0) {
    const sourceLines = found.sources.map(
      (s) => `- [${s.name}](${s.url}) — ${s.domain} (${s.type})`
    );
    parts.push("", `**${sourceLabel}**`, ...sourceLines);
  }

  return parts.join("\n");
}

// ─── search_trends ────────────────────────────────────────────────────────

export function formatSearchTrends(data: SearchTrendsData, lang: McpLang): string {
  const header = lang === "en" ? "## Search Results" : "## 검색 결과";
  if (data.items.length === 0) {
    const empty =
      lang === "en"
        ? "No matching trends found. Try a different keyword."
        : "검색 결과가 없어요. 다른 키워드로 다시 시도해보세요.";
    return `${header}\n\n${empty}`;
  }

  const lines = data.items.map((item) => {
    const date = item.snapshot_date ? ` (${formatKstDateOnly(item.snapshot_date)})` : "";
    const summaryPart = item.summary ? ` — ${item.summary}` : "";
    return `- **${item.keyword}**${date}${summaryPart}`;
  });

  return [header, "", ...lines].join("\n");
}

// ─── get_hot_topics (한국어 콘텐츠 고정) ───────────────────────────────────

export function formatHotTopics(data: HotTopicsData): string {
  const header = `## 오늘의 AI 핫토픽 (${formatKstDateOnly(data.date)})`;

  if (data.topics.length === 0) {
    return `${header}\n\n오늘의 핫토픽이 아직 준비되지 않았어요.`;
  }

  const sections = data.topics.map((topic) => {
    const sourceLinks = topic.sources.map((s) => `[${s.name}](${s.url})`).join(", ");
    const lines = [`### ${topic.rank}. ${topic.title}`, topic.brief];
    if (sourceLinks) lines.push(`출처: ${sourceLinks}`);
    return lines.join("\n");
  });

  return [header, "", ...sections].join("\n\n");
}

// ─── get_daily_podcast (한국어 콘텐츠 고정) ────────────────────────────────

export function formatDailyPodcast(data: DailyPodcastData): string {
  const minutes = Math.floor(data.duration_seconds / 60);
  const seconds = data.duration_seconds % 60;

  const lines = [
    `## 🎙 오늘의 AI 뉴스 팟캐스트 (${formatKstDateOnly(data.date)})`,
    `**${data.title}**`,
    "",
    data.description,
    "",
    `▶ [팟캐스트 듣기 (${minutes}분 ${seconds}초)](${data.audio_url})`,
    "",
    `_${data.note}_`,
  ];

  return lines.join("\n");
}
