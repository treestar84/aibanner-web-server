const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^www\./, "");
}

function extractPathVideoId(pathname: string): string | null {
  const segments = pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) return null;
  if (segments[0] === "shorts" || segments[0] === "embed" || segments[0] === "live") {
    return YOUTUBE_ID_PATTERN.test(segments[1] ?? "") ? segments[1] : null;
  }

  const last = segments[segments.length - 1];
  return YOUTUBE_ID_PATTERN.test(last) ? last : null;
}

export function extractYoutubeVideoId(input: string): string | null {
  const trimmed = input.normalize("NFKC").trim();
  if (!trimmed) return null;

  if (YOUTUBE_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const host = normalizeHost(url.hostname);

    if (host === "youtu.be") {
      return extractPathVideoId(url.pathname);
    }

    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      const watchId = url.searchParams.get("v");
      if (YOUTUBE_ID_PATTERN.test(watchId ?? "")) {
        return watchId;
      }
      return extractPathVideoId(url.pathname);
    }
  } catch {
    // Fall through to regex extraction.
  }

  return null;
}

export function normalizeYoutubeVideoUrl(input: string): { videoId?: string; url?: string; error?: string } {
  const videoId = extractYoutubeVideoId(input);
  if (!videoId) {
    return { error: "유효한 YouTube 링크 또는 영상 ID를 입력해 주세요." };
  }
  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

export function buildYoutubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function normalizeManualYoutubeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}
