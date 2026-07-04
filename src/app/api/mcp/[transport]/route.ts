// Vibenow MCP 서버 (docs/mcp-server-design.md) — 도구 등록만 하는 얇은 라우트.
// 실제 구현은 src/lib/mcp/tools.ts, 응답 정책은 src/lib/mcp/policy.ts.

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  getBurningKeywords,
  getDailyPodcast,
  getHotTopics,
  getKeywordDetail,
  getRealtimeTrends,
  searchTrends,
} from "@/lib/mcp/tools";
import { GENERIC_ERROR_MESSAGE, toolError, toolText } from "@/lib/mcp/policy";
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
} from "@/lib/mcp/markdown";

export const runtime = "nodejs";
export const maxDuration = 60;

const langSchema = z.enum(["ko", "en"]).default("ko");

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "get_realtime_trends",
      {
        title: "실시간 AI 트렌드",
        description: DESC_GET_REALTIME_TRENDS,
        inputSchema: {
          lang: langSchema,
          limit: z.number().int().min(1).max(20).default(10),
        },
        annotations: {
          title: "실시간 AI 트렌드",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ lang, limit }) => {
        try {
          const data = await getRealtimeTrends({ lang, limit });
          if (!data) return toolError(GENERIC_ERROR_MESSAGE);
          return toolText(formatRealtimeTrends(data, lang), lang);
        } catch (err) {
          console.error("[mcp] get_realtime_trends", err);
          return toolError(GENERIC_ERROR_MESSAGE);
        }
      }
    );

    server.registerTool(
      "get_burning_keywords",
      {
        title: "타는중 키워드",
        description: DESC_GET_BURNING_KEYWORDS,
        inputSchema: {
          lang: langSchema,
          limit: z.number().int().min(1).max(20).default(10),
        },
        annotations: {
          title: "타는중 키워드",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ lang, limit }) => {
        try {
          const data = await getBurningKeywords({ lang, limit });
          if (!data) return toolError(GENERIC_ERROR_MESSAGE);
          return toolText(formatBurningKeywords(data, lang), lang);
        } catch (err) {
          console.error("[mcp] get_burning_keywords", err);
          return toolError(GENERIC_ERROR_MESSAGE);
        }
      }
    );

    server.registerTool(
      "get_keyword_detail",
      {
        title: "키워드 상세",
        description: DESC_GET_KEYWORD_DETAIL,
        inputSchema: {
          keyword: z.string().min(1).max(80),
          lang: langSchema,
        },
        annotations: {
          title: "키워드 상세",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ keyword, lang }) => {
        try {
          const data = await getKeywordDetail({ keyword, lang });
          return toolText(formatKeywordDetail(data, lang), lang);
        } catch (err) {
          console.error("[mcp] get_keyword_detail", err);
          return toolError(GENERIC_ERROR_MESSAGE);
        }
      }
    );

    server.registerTool(
      "search_trends",
      {
        title: "트렌드 검색",
        description: DESC_SEARCH_TRENDS,
        inputSchema: {
          query: z.string().min(1).max(80),
          lang: langSchema,
          limit: z.number().int().min(1).max(10).default(5),
        },
        annotations: {
          title: "트렌드 검색",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ query, lang, limit }) => {
        try {
          const data = await searchTrends({ query, lang, limit });
          return toolText(formatSearchTrends(data, lang), lang);
        } catch (err) {
          console.error("[mcp] search_trends", err);
          return toolError(GENERIC_ERROR_MESSAGE);
        }
      }
    );

    server.registerTool(
      "get_hot_topics",
      {
        title: "오늘의 AI 핫토픽",
        description: DESC_GET_HOT_TOPICS,
        inputSchema: {
          limit: z.number().int().min(1).max(20).default(10),
        },
        annotations: {
          title: "오늘의 AI 핫토픽",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ limit }) => {
        try {
          const data = await getHotTopics({ limit });
          if (!data) return toolError(GENERIC_ERROR_MESSAGE);
          return toolText(formatHotTopics(data), "ko");
        } catch (err) {
          console.error("[mcp] get_hot_topics", err);
          return toolError(GENERIC_ERROR_MESSAGE);
        }
      }
    );

    server.registerTool(
      "get_daily_podcast",
      {
        title: "오늘의 AI 뉴스 팟캐스트",
        description: DESC_GET_DAILY_PODCAST,
        inputSchema: {},
        annotations: {
          title: "오늘의 AI 뉴스 팟캐스트",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => {
        try {
          const data = await getDailyPodcast();
          if (!data) {
            return toolError(
              "오늘의 팟캐스트를 아직 준비하지 못했어요. 잠시 후 다시 시도해주세요."
            );
          }
          return toolText(formatDailyPodcast(data), "ko");
        } catch (err) {
          console.error("[mcp] get_daily_podcast", err);
          return toolError(GENERIC_ERROR_MESSAGE);
        }
      }
    );
  },
  {
    serverInfo: {
      name: "vibenow-trends",
      version: "1.0.0",
    },
    capabilities: { tools: {} },
  },
  {
    basePath: "/api/mcp",
    maxDuration: 60,
  }
);

export { handler as GET, handler as POST, handler as DELETE };
