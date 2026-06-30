import { load } from "cheerio";
import { buildYoutubeChannelUrl } from "@/lib/youtube-recommend-channels";
import { readLimitedResponseText } from "@/lib/youtube-fetch";

const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE_PATTERN = /^@[^/\s?#]+$/u;
const CHANNEL_HTML_MAX_BYTES = 1024 * 1024;

export interface ResolvedYoutubeChannel {
  channelId: string;
  channelName: string;
  channelHandle: string;
  channelUrl: string;
}

function normalizeHost(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
}

function isAllowedChannelPath(pathname: string): boolean {
  const segments = pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) return false;
  if (segments.length > 2) return false;
  if (segments[0]?.startsWith("@")) return HANDLE_PATTERN.test(segments[0]);
  return (
    segments[0] === "channel" && CHANNEL_ID_PATTERN.test(segments[1] ?? "")
  );
}

function normalizeInputAsUrl(input: string): string {
  const trimmed = input.normalize("NFKC").trim();
  if (!trimmed) {
    throw new Error("YouTube 채널 링크를 입력해 주세요.");
  }

  if (CHANNEL_ID_PATTERN.test(trimmed)) {
    return buildYoutubeChannelUrl(trimmed);
  }

  if (HANDLE_PATTERN.test(trimmed)) {
    return buildYoutubeChannelUrl("", trimmed);
  }

  try {
    const url = new URL(trimmed);
    const host = normalizeHost(url.hostname);
    if (url.protocol !== "https:") {
      throw new Error("유효한 YouTube 채널 링크를 입력해 주세요.");
    }

    if (host !== "youtube.com" && host !== "m.youtube.com") {
      throw new Error("유효한 YouTube 채널 링크를 입력해 주세요.");
    }

    if (!isAllowedChannelPath(url.pathname)) {
      throw new Error("유효한 YouTube 채널 링크를 입력해 주세요.");
    }

    return `https://www.youtube.com${url.pathname}`;
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("유효한 YouTube 채널 링크를 입력해 주세요.");
  }
}

function extractHandleFromPath(pathname: string): string {
  const trimmed = decodeURIComponent(pathname.trim());
  const match = trimmed.match(/\/(@[^/?#]+)/u);
  return match?.[1] ?? "";
}

function extractChannelIdFromPath(pathname: string): string {
  const match = pathname.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/);
  return match?.[1] ?? "";
}

function cleanChannelName(raw: string): string {
  return raw
    .replace(/\s*-\s*YouTube\s*$/i, "")
    .replace(/\s*\|\s*YouTube\s*$/i, "")
    .trim();
}

async function fetchChannelHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AI-Trend-Widget/1.0)",
    },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(6000),
  });

  if (!res.ok) {
    throw new Error("채널 정보를 가져오지 못했습니다.");
  }

  const html = await readLimitedResponseText(res, CHANNEL_HTML_MAX_BYTES);
  if (!html) {
    throw new Error("채널 응답이 너무 큽니다.");
  }

  return html;
}

function extractFromHtml(html: string): {
  channelId: string;
  channelName: string;
  channelHandle: string;
  canonicalUrl: string;
} {
  const $ = load(html);
  const title =
    $('meta[property="og:title"]').attr("content") ||
    $('meta[itemprop="name"]').attr("content") ||
    $("title").text() ||
    "";
  const canonicalUrl =
    $('link[rel="canonical"]').attr("href") ||
    $('meta[property="og:url"]').attr("content") ||
    "";

  const channelIdMatch =
    html.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/) ||
    html.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/);
  const handleMatch =
    html.match(/"canonicalBaseUrl":"(\/@[^"]+)"/u) ||
    decodeURIComponent(canonicalUrl).match(/(\/@[^/?#]+)/u);

  return {
    channelId: channelIdMatch?.[1] ?? "",
    channelName: cleanChannelName(title),
    channelHandle: handleMatch?.[1]
      ? decodeURIComponent(handleMatch[1].replace(/^\//, ""))
      : "",
    canonicalUrl,
  };
}

export async function resolveYoutubeChannel(
  rawInput: string,
): Promise<ResolvedYoutubeChannel> {
  const inputUrl = normalizeInputAsUrl(rawInput);
  const parsed = new URL(inputUrl);

  const channelIdFromPath = extractChannelIdFromPath(parsed.pathname);
  const handleFromPath = extractHandleFromPath(parsed.pathname);
  const html = await fetchChannelHtml(inputUrl);
  const extracted = extractFromHtml(html);

  const channelId = extracted.channelId || channelIdFromPath;
  const channelHandle = extracted.channelHandle || handleFromPath;
  const channelUrl =
    extracted.canonicalUrl || buildYoutubeChannelUrl(channelId, channelHandle);
  const channelName = extracted.channelName;

  if (!channelId || !CHANNEL_ID_PATTERN.test(channelId)) {
    throw new Error("채널 ID를 확인할 수 없는 링크입니다.");
  }

  if (!channelName) {
    throw new Error("채널 이름을 확인할 수 없는 링크입니다.");
  }

  return {
    channelId,
    channelName,
    channelHandle,
    channelUrl,
  };
}
