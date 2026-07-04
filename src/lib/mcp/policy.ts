// MCP 도구 공통 응답 정책 (docs/mcp-server-design.md §3)
// 모든 도구 응답은 이 모듈을 통해 meta를 붙이고 직렬화한다.
// 저작권 정책: snippet(원문 발췌)·image_url은 어떤 도구 응답에도 포함하지 않는다.

export type McpLang = "ko" | "en";

export const ATTRIBUTION_TEXT =
  "모든 요약은 출처 링크와 함께 제공됩니다. 원문은 sources의 url을 참조하세요.";
export const TAKEDOWN_CONTACT = "angelyrlove40@gmail.com";

export interface McpMeta {
  generated_at: string;
  lang: McpLang;
  summaries_are_ai_generated: true;
  attribution: string;
  takedown_contact: string;
}

export function buildMeta(lang: McpLang): McpMeta {
  return {
    generated_at: new Date().toISOString(),
    lang,
    summaries_are_ai_generated: true,
    attribution: ATTRIBUTION_TEXT,
    takedown_contact: TAKEDOWN_CONTACT,
  };
}

export interface McpToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** 도구 성공 응답: { data, meta } 컴팩트 JSON 텍스트 컨텐츠로 직렬화한다. */
export function toolSuccess(data: unknown, lang: McpLang): McpToolResult {
  const payload = { data, meta: buildMeta(lang) };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

/** 도구 오류 응답: 내부 정보를 노출하지 않는 사용자 친화 한국어 메시지만 반환한다. */
export function toolError(message: string): McpToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export const GENERIC_ERROR_MESSAGE =
  "지금은 트렌드 데이터를 불러올 수 없어요. 잠시 후 다시 시도해주세요.";

/** 문자열을 최대 길이로 자르고 말줄임표를 붙인다 (응답 크기 방어, §3-3). */
export function truncate(text: string | null | undefined, maxLength: number): string {
  const value = (text ?? "").trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
