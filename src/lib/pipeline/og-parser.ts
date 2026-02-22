import { load } from "cheerio";

const DEFAULT_IMAGE = "/images/default-thumbnail.png";
const FETCH_TIMEOUT_MS = 5000;

export async function extractOgImage(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AI-Trend-Widget/1.0; +https://aitrendwidget.vercel.app)",
      },
    });
    clearTimeout(timer);

    if (!res.ok) return DEFAULT_IMAGE;

    const html = await res.text();
    const $ = load(html);

    // 1차: og:image
    const ogImage = $('meta[property="og:image"]').attr("content");
    if (ogImage && isValidImageUrl(ogImage)) return ogImage;

    // 2차: twitter:image
    const twitterImage = $('meta[name="twitter:image"]').attr("content");
    if (twitterImage && isValidImageUrl(twitterImage)) return twitterImage;

    // 3차: favicon
    const faviconLink =
      $('link[rel="icon"]').attr("href") ||
      $('link[rel="shortcut icon"]').attr("href");
    if (faviconLink) {
      const absolute = toAbsoluteUrl(faviconLink, url);
      if (absolute && isValidImageUrl(absolute)) return absolute;
    }

    return DEFAULT_IMAGE;
  } catch {
    return DEFAULT_IMAGE;
  }
}

function isValidImageUrl(url: string): boolean {
  try {
    new URL(url);
    return url.startsWith("http");
  } catch {
    return false;
  }
}

function toAbsoluteUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return "";
  }
}

// 여러 URL을 병렬로 처리 (concurrency 제한)
export async function batchExtractOgImages(
  urls: string[],
  concurrency = 5
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const chunks: string[][] = [];

  for (let i = 0; i < urls.length; i += concurrency) {
    chunks.push(urls.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    const images = await Promise.all(chunk.map((url) => extractOgImage(url)));
    chunk.forEach((url, i) => result.set(url, images[i]));
  }

  return result;
}
