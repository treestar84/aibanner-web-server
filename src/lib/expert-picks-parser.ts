const TITLE_MAX_CHARS = 100;
const URL_PATTERN = /https?:\/\/[^\s<>"'\)\]]+/;

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
