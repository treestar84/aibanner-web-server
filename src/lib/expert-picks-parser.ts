const TITLE_MAX_CHARS = 100;
const URL_PATTERN = /https?:\/\/[^\s<>"'\)\]]+/;

/// 파서는 body_ko_raw 재편집을 위해 본문 원문에서 제목 줄을 지우지 않고
/// 그대로 둔다 (body는 raw.trim()과 동일). 그래서 제목을 별도 요소로
/// 이미 보여주는 화면(전문가픽 상세/목록 페이지)에서 본문을 그대로 렌더링
/// 하면 첫 줄에 제목이 다시 나타나 중복으로 보인다. 화면에 본문을 그릴
/// 때는 항상 이 함수를 거친 텍스트를 써야 한다.
export function stripLeadingTitleLine(body: string, title: string): string {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return body;
  const lines = body.split("\n");
  const idx = lines.findIndex((line) => line.trim().length > 0);
  if (idx === -1) return body;
  const firstLine = lines[idx].trim();
  // 제목이 100자 초과로 잘려 저장된 경우 본문 첫 줄은 제목보다 길므로
  // startsWith로도 비교한다.
  if (firstLine === trimmedTitle || firstLine.startsWith(trimmedTitle)) {
    return lines.slice(idx + 1).join("\n").replace(/^\s+/, "");
  }
  return body;
}

export function extractLinkDomain(url: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function parseExpertPickPaste(raw: string): {
  title: string;
  body: string;
  linkUrl: string;
  linkDomain: string;
} {
  const body = raw.trim();

  const firstNonEmptyLine =
    body
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  const title = firstNonEmptyLine.slice(0, TITLE_MAX_CHARS);

  const linkMatch = body.match(URL_PATTERN);
  const linkUrl = linkMatch ? linkMatch[0] : "";
  const linkDomain = extractLinkDomain(linkUrl);

  return { title, body, linkUrl, linkDomain };
}
