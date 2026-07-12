// MCP 도구 공통 응답 정책 (docs/mcp-server-design.md §3)
// 모든 도구 응답은 이 모듈을 통해 meta를 붙이고 직렬화한다.
// 저작권 정책: snippet(원문 발췌)·image_url은 어떤 도구 응답에도 포함하지 않는다.

export type McpLang = "ko" | "en";

export const TAKEDOWN_CONTACT = "angelyrlove7@gmail.com";

const FOOTER_KO = `\n\n---\n_요약은 AI가 생성했으며, 각 항목의 출처 링크에서 원문을 확인할 수 있습니다. (Vibenow · 문의: ${TAKEDOWN_CONTACT})_`;
const FOOTER_EN = `\n\n---\n_Summaries are AI-generated. See linked sources for original articles. (Vibenow · contact: ${TAKEDOWN_CONTACT})_`;

export interface McpToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** 도구 성공 응답: 정제된 마크다운 텍스트에 lang별 footer(AI 생성 고지 + takedown 연락처)를 붙여 반환한다. */
export function toolText(markdown: string, lang: McpLang): McpToolResult {
  const footer = lang === "en" ? FOOTER_EN : FOOTER_KO;
  return {
    content: [{ type: "text", text: `${markdown}${footer}` }],
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
