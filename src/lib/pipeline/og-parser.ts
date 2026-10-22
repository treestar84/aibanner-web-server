import { safeFetchBytes, publicHttpUrl } from "../safe-fetch";
import { load } from "cheerio";
import { recordDiagnostic, diagnosticFailure, type DiagnosticOutcome } from "./diagnostics";

const DEFAULT_IMAGE = "/images/default-thumbnail.png";
const FETCH_TIMEOUT_MS = 5000;

export async function extractOgImage(url: string, fetchBytes = safeFetchBytes): Promise<string> {
  const diagnosticStarted = Date.now();
  const observed = (image: string, outcome: DiagnosticOutcome, maxHttpStatus?: number): string => {
    recordDiagnostic("image", outcome, { requestCount: 1, durationMs: Date.now() - diagnosticStarted, ...(maxHttpStatus ? { maxHttpStatus } : {}) });
    return image;
  };
  try {
    const result = await fetchBytes(url, {
      timeoutMs: FETCH_TIMEOUT_MS, maxBytes: 2 * 1024 * 1024,
      contentTypes: ["text/html", "application/xhtml+xml"],
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AI-Trend-Widget/1.0; +https://aitrendwidget.vercel.app)",
      },
    });
    const html = result.bytes.toString("utf8");
    url = result.url;
    const $ = load(html);

    // 1차: og:image
    const ogImage = $('meta[property="og:image"]').attr("content");
    if (ogImage && isValidImageUrl(ogImage)) return observed(ogImage, "og");

    // 2차: twitter:image
    const twitterImage = $('meta[name="twitter:image"]').attr("content");
    if (twitterImage && isValidImageUrl(twitterImage)) return observed(twitterImage, "twitter");
    if (ogImage?.startsWith("/") || twitterImage?.startsWith("/")) {
      recordDiagnostic("image_candidates", "skipped", { relativeImageCandidates: 1 });
    }

    // 3차: favicon
    const faviconLink =
      $('link[rel="icon"]').attr("href") ||
      $('link[rel="shortcut icon"]').attr("href");
    if (faviconLink) {
      const absolute = toAbsoluteUrl(faviconLink, url);
      if (absolute && isValidImageUrl(absolute)) return observed(absolute, "favicon");
    }

    return observed(DEFAULT_IMAGE, "default");
  } catch (error) {
    return observed(DEFAULT_IMAGE, diagnosticFailure(error));
  }
}

function isValidImageUrl(url: string): boolean {
  try {
    publicHttpUrl(url);
    return true;
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
