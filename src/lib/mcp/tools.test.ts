import test from "node:test";
import assert from "node:assert/strict";

import { toolError, toolText, truncate, TAKEDOWN_CONTACT } from "@/lib/mcp/policy";
import {
  DESC_GET_BURNING_KEYWORDS,
  DESC_GET_DAILY_PODCAST,
  DESC_GET_HOT_TOPICS,
  DESC_GET_KEYWORD_DETAIL,
  DESC_GET_REALTIME_TRENDS,
  DESC_SEARCH_TRENDS,
} from "@/lib/mcp/descriptions";
import {
  formatBurningKeywords,
  formatDailyPodcast,
  formatHotTopics,
  formatKeywordDetail,
  formatRealtimeTrends,
  formatSearchTrends,
  type BurningKeywordsData,
  type DailyPodcastData,
  type HotTopicsData,
  type KeywordDetailData,
  type RealtimeTrendsData,
  type SearchTrendsData,
} from "@/lib/mcp/markdown";

test("truncate keeps short text untouched", () => {
  assert.equal(truncate("짧은 요약", 200), "짧은 요약");
  assert.equal(truncate(null, 200), "");
  assert.equal(truncate(undefined, 200), "");
});

test("truncate cuts long text and appends ellipsis", () => {
  const long = "가".repeat(250);
  const result = truncate(long, 200);
  assert.equal(result.length, 200);
  assert.ok(result.endsWith("…"));
});

test("toolError marks isError true and never leaks a stack trace", () => {
  const result = toolError("지금은 트렌드 데이터를 불러올 수 없어요. 잠시 후 다시 시도해주세요.");
  assert.equal(result.isError, true);
  assert.equal(
    result.content[0].text,
    "지금은 트렌드 데이터를 불러올 수 없어요. 잠시 후 다시 시도해주세요."
  );
  assert.ok(!result.content[0].text.includes("at "));
});

test("toolText appends the AI-generated notice and takedown contact as a footer", () => {
  const ko = toolText("## 실시간 AI 트렌드 Top 1\n\n1. **GPT-5**", "ko");
  assert.equal(ko.content.length, 1);
  assert.equal(ko.content[0].type, "text");
  assert.equal(ko.isError, undefined);
  assert.ok(ko.content[0].text.includes("AI가 생성"));
  assert.ok(ko.content[0].text.includes(TAKEDOWN_CONTACT));

  const en = toolText("## Realtime AI Trends Top 1", "en");
  assert.ok(en.content[0].text.includes("AI-generated"));
  assert.ok(en.content[0].text.includes(TAKEDOWN_CONTACT));
});

test("MCP tool descriptions include service name, stay within length limit, and never mention kakao", () => {
  const descriptions = [
    DESC_GET_REALTIME_TRENDS,
    DESC_GET_BURNING_KEYWORDS,
    DESC_GET_KEYWORD_DETAIL,
    DESC_SEARCH_TRENDS,
    DESC_GET_HOT_TOPICS,
    DESC_GET_DAILY_PODCAST,
  ];

  for (const description of descriptions) {
    assert.ok(
      description.includes("Vibenow(바이브나우)"),
      `description must include service name: ${description}`
    );
    assert.ok(
      description.length <= 1024,
      `description must be within 1024 chars: ${description}`
    );
    assert.ok(
      !/kakao/i.test(description),
      `description must not mention kakao: ${description}`
    );
  }
});

// ─── markdown formatter fixtures ───────────────────────────────────────────

const REALTIME_TRENDS_FIXTURE: RealtimeTrendsData = {
  updated_at: "2026-07-04T06:56:00.000Z",
  next_update_at: "2026-07-05T00:10:00.000Z",
  items: [
    {
      rank: 1,
      keyword: "MCP Servers",
      rank_delta: 0,
      is_new: true,
      summary: "X(구 Twitter)가 호스팅형 MCP 서버를 출시하며 화제.",
      source: { name: "TechCrunch", url: "https://example.com/mcp" },
    },
    {
      rank: 2,
      keyword: "Crew",
      rank_delta: 2,
      is_new: false,
      summary: "멀티 에이전트 프레임워크 Crew가 순위 상승.",
      source: { name: "GitHub", url: "https://example.com/crew" },
    },
    {
      rank: 3,
      keyword: "No Source Keyword",
      rank_delta: -1,
      is_new: false,
      summary: "출처 링크가 없는 케이스.",
      source: null,
    },
  ],
};

const BURNING_KEYWORDS_FIXTURE: BurningKeywordsData = {
  items: [
    { keyword: "Sora 2", view_count: 120, summary: "영상 생성 모델 화제", detail_available: true },
    { keyword: "AgentOps", view_count: 80, summary: null, detail_available: false },
  ],
};

const KEYWORD_DETAIL_FOUND_FIXTURE: KeywordDetailData = {
  found: true,
  keyword: "Claude Fable 5",
  summary: "새로운 Claude 모델이 공개되며 커뮤니티에서 큰 화제가 되고 있다.",
  bullets: ["ClaudeFable5", "AI모델"],
  sources: [
    { type: "news", name: "출처 제목", url: "https://example.com/a", domain: "example.com" },
    { type: "social", name: "커뮤니티 글", url: "https://example.com/b", domain: "example.com" },
  ],
};

const KEYWORD_DETAIL_NOT_FOUND_FIXTURE: KeywordDetailData = {
  found: false,
  suggestion: "search_trends로 검색해보세요",
};

const SEARCH_TRENDS_FIXTURE: SearchTrendsData = {
  items: [
    { keyword: "GPT-5", summary: "차세대 모델 발표", snapshot_date: "2026-07-01T00:00:00.000Z" },
  ],
};

const SEARCH_TRENDS_EMPTY_FIXTURE: SearchTrendsData = { items: [] };

const HOT_TOPICS_FIXTURE: HotTopicsData = {
  date: "2026-07-04T00:00:00.000Z",
  topics: [
    {
      rank: 1,
      title: "AI 에이전트 표준 경쟁 심화",
      brief: "여러 업체가 에이전트 프로토콜을 발표했다.",
      type: "news",
      sources: [
        { name: "Source A", url: "https://example.com/a" },
        { name: "Source B", url: "https://example.com/b" },
      ],
    },
  ],
};

const DAILY_PODCAST_FIXTURE: DailyPodcastData = {
  date: "2026-07-04",
  title: "오늘의 AI 뉴스",
  description: "오늘의 주요 AI 뉴스를 두 진행자가 정리합니다.",
  audio_url: "https://example.com/podcast/latest.mp3",
  duration_seconds: 725,
  hosts: [{ name: "host-a" }, { name: "host-b" }],
  note: "본 팟캐스트는 복수 출처 뉴스를 AI가 종합해 생성한 오디오입니다",
};

function assertNoLeakedFields(markdown: string) {
  const lower = markdown.toLowerCase();
  assert.ok(!lower.includes("snippet"));
  assert.ok(!lower.includes("image_url"));
  assert.ok(!lower.includes("imageurl"));
}

test("formatRealtimeTrends never leaks snippet/image fields, includes source links, and stays under 8KB", () => {
  const markdown = formatRealtimeTrends(REALTIME_TRENDS_FIXTURE, "ko");
  assertNoLeakedFields(markdown);
  assert.ok(markdown.includes("](http"));
  assert.ok(markdown.includes("🆕"));
  assert.ok(markdown.includes("(▲2)"));
  assert.ok(Buffer.byteLength(markdown, "utf8") < 8 * 1024);

  const en = formatRealtimeTrends(REALTIME_TRENDS_FIXTURE, "en");
  assertNoLeakedFields(en);
  assert.ok(en.includes("Realtime AI Trends"));
});

test("formatBurningKeywords never leaks snippet/image fields and lists items in order", () => {
  const markdown = formatBurningKeywords(BURNING_KEYWORDS_FIXTURE, "ko");
  assertNoLeakedFields(markdown);
  assert.ok(markdown.includes("1. **Sora 2**"));
  assert.ok(markdown.includes("2. **AgentOps**"));
});

test("formatBurningKeywords handles the empty-list case with a friendly message", () => {
  const markdown = formatBurningKeywords({ items: [] }, "ko");
  assert.ok(markdown.includes("없어요"));
});

test("formatKeywordDetail (found) never leaks snippet/image fields and includes source links", () => {
  const markdown = formatKeywordDetail(KEYWORD_DETAIL_FOUND_FIXTURE, "ko");
  assertNoLeakedFields(markdown);
  assert.ok(markdown.includes("](http"));
  assert.ok(markdown.includes("#ClaudeFable5"));
});

test("formatKeywordDetail (not found) guides the user toward search_trends", () => {
  const markdown = formatKeywordDetail(KEYWORD_DETAIL_NOT_FOUND_FIXTURE, "ko");
  assert.ok(markdown.includes("search_trends"));

  const en = formatKeywordDetail(KEYWORD_DETAIL_NOT_FOUND_FIXTURE, "en");
  assert.ok(en.includes("search_trends"));
});

test("formatSearchTrends never leaks snippet/image fields and handles the empty case", () => {
  const markdown = formatSearchTrends(SEARCH_TRENDS_FIXTURE, "ko");
  assertNoLeakedFields(markdown);
  assert.ok(markdown.includes("**GPT-5**"));

  const empty = formatSearchTrends(SEARCH_TRENDS_EMPTY_FIXTURE, "ko");
  assert.ok(empty.includes("없어요"));
});

test("formatHotTopics never leaks snippet/image fields and includes attribution links", () => {
  const markdown = formatHotTopics(HOT_TOPICS_FIXTURE);
  assertNoLeakedFields(markdown);
  assert.ok(markdown.includes("](http"));
  assert.ok(markdown.includes("AI 에이전트 표준 경쟁 심화"));
});

test("formatDailyPodcast never leaks snippet/image fields and includes a playable audio link", () => {
  const markdown = formatDailyPodcast(DAILY_PODCAST_FIXTURE);
  assertNoLeakedFields(markdown);
  assert.ok(markdown.includes("](https://example.com/podcast/latest.mp3)"));
  assert.ok(markdown.includes("12분 5초"));
});

test("toolText output for a formatted tool result stays free of snippet/image fields and carries the footer", () => {
  const markdown = formatRealtimeTrends(REALTIME_TRENDS_FIXTURE, "ko");
  const result = toolText(markdown, "ko");
  const text = result.content[0].text;
  assertNoLeakedFields(text);
  assert.ok(text.includes(TAKEDOWN_CONTACT));
  assert.ok(text.includes("AI가 생성"));
});
