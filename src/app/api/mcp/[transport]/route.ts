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
import { GENERIC_ERROR_MESSAGE, toolError, toolSuccess } from "@/lib/mcp/policy";

export const runtime = "nodejs";
export const maxDuration = 60;

const langSchema = z.enum(["ko", "en"]).default("ko");

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "get_realtime_trends",
      {
        title: "실시간 AI 트렌드",
        description:
          "지금 실시간으로 뜨고 있는 AI 트렌드 키워드 순위를 반환합니다. '지금 뭐가 화제야?', '요즘 뜨는 AI 뉴스/기술 알려줘' 같은 질문에 사용. (Realtime AI trend keyword ranking)",
        inputSchema: {
          lang: langSchema,
          limit: z.number().int().min(1).max(20).default(10),
        },
      },
      async ({ lang, limit }) => {
        try {
          const data = await getRealtimeTrends({ lang, limit });
          if (!data) return toolError(GENERIC_ERROR_MESSAGE);
          return toolSuccess(data, lang);
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
        description:
          "조회수가 급상승 중인(타는중) AI 키워드를 반환합니다. '갑자기 뜨는 키워드', '급상승 트렌드' 질문에 사용.",
        inputSchema: {
          lang: langSchema,
          limit: z.number().int().min(1).max(20).default(10),
        },
      },
      async ({ lang, limit }) => {
        try {
          const data = await getBurningKeywords({ lang, limit });
          if (!data) return toolError(GENERIC_ERROR_MESSAGE);
          return toolSuccess(data, lang);
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
        description:
          "특정 AI 키워드가 왜 뜨는지 상세 설명과 뉴스·커뮤니티 출처 링크를 반환합니다. 특정 키워드에 대해 더 알고 싶을 때 사용.",
        inputSchema: {
          keyword: z.string().min(1).max(80),
          lang: langSchema,
        },
      },
      async ({ keyword, lang }) => {
        try {
          const data = await getKeywordDetail({ keyword, lang });
          return toolSuccess(data, lang);
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
        description:
          "과거~현재 수집된 AI 트렌드 키워드를 검색합니다. 키워드가 실시간 순위에 없을 때 사용.",
        inputSchema: {
          query: z.string().min(1).max(80),
          lang: langSchema,
          limit: z.number().int().min(1).max(10).default(5),
        },
      },
      async ({ query, lang, limit }) => {
        try {
          const data = await searchTrends({ query, lang, limit });
          return toolSuccess(data, lang);
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
        description:
          "오늘의 AI 핫토픽 브리핑(복수 출처 종합)을 반환합니다. '오늘 AI 뉴스 정리해줘', '핫토픽 알려줘' 질문에 사용.",
        inputSchema: {
          limit: z.number().int().min(1).max(20).default(10),
        },
      },
      async ({ limit }) => {
        try {
          const data = await getHotTopics({ limit });
          if (!data) return toolError(GENERIC_ERROR_MESSAGE);
          return toolSuccess(data, "ko");
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
        description:
          "매일 자동 생성되는 한국어 AI 뉴스 팟캐스트(2인 진행 토크쇼, 오디오)를 반환합니다. '오늘 AI 뉴스 들려줘', '팟캐스트 틀어줘' 질문에 사용. audio_url을 사용자에게 재생 가능한 링크로 제공하세요.",
        inputSchema: {},
      },
      async () => {
        try {
          const data = await getDailyPodcast();
          if (!data) {
            return toolError(
              "오늘의 팟캐스트를 아직 준비하지 못했어요. 잠시 후 다시 시도해주세요."
            );
          }
          return toolSuccess(data, "ko");
        } catch (err) {
          console.error("[mcp] get_daily_podcast", err);
          return toolError(GENERIC_ERROR_MESSAGE);
        }
      }
    );
  },
  {},
  {
    basePath: "/api/mcp",
    maxDuration: 60,
  }
);

export { handler as GET, handler as POST, handler as DELETE };
