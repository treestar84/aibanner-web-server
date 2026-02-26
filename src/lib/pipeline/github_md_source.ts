import type { RssItem } from "./rss";

const REPO = "GENEXIS-AI/DailyNews";
const FOLDER = "뉴스레터";

// 소셜 미디어 스레드 링크 제외
const SKIP_DOMAINS = ["twitter.com", "x.com", "t.co", "threads.net"];

interface GithubFile {
  name: string;
  type: string;
  download_url: string | null;
}

function parseDateFromFilename(filename: string): Date | null {
  const match = filename.match(/(\d{4}[-_]\d{2}[-_]\d{2})/);
  if (!match) return null;
  return new Date(match[1].replace(/_/g, "-"));
}

function extractLinksFromMarkdown(
  content: string,
  publishedAt: Date
): RssItem[] {
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  const items: RssItem[] = [];
  const seen = new Set<string>();

  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const title = match[1].trim();
    const url = match[2].trim();

    if (!title || !url || title.length < 5 || seen.has(url)) continue;

    let domain: string;
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }

    if (SKIP_DOMAINS.some((d) => domain.endsWith(d))) continue;

    seen.add(url);
    items.push({
      title,
      link: url,
      publishedAt,
      summary: "",
      sourceDomain: domain,
      feedTitle: "GENEXIS-AI DailyNews",
      tier: "P0_CURATED" as const,
      lang: "ko",
    });
  }

  return items;
}

export async function collectGithubMdItems(
  windowHours = 72
): Promise<RssItem[]> {
  const token = process.env.GITHUB_TOKEN;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  try {
    const listUrl = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(FOLDER)}`;
    const listRes = await fetch(listUrl, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!listRes.ok) throw new Error(`HTTP ${listRes.status}`);

    const files: GithubFile[] = await listRes.json();
    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    // 날짜 기반 파일명(.md)만, 윈도우 내 최신 3개
    const mdFiles = files
      .filter(
        (f) => f.type === "file" && f.name.endsWith(".md") && f.download_url
      )
      .map((f) => ({ ...f, date: parseDateFromFilename(f.name) }))
      .filter((f) => f.date !== null && f.date >= cutoff)
      .sort((a, b) => b.date!.getTime() - a.date!.getTime())
      .slice(0, 3);

    if (mdFiles.length === 0) {
      console.log("[github_md_source] No recent files found");
      return [];
    }

    const allItems: RssItem[] = [];

    for (const file of mdFiles) {
      const contentRes = await fetch(file.download_url!, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (!contentRes.ok) continue;

      const content = await contentRes.text();
      const items = extractLinksFromMarkdown(content, file.date!);
      allItems.push(...items);
    }

    console.log(`[github_md_source] Got ${allItems.length} items`);
    return allItems;
  } catch (err) {
    console.warn("[github_md_source] Failed:", (err as Error).message);
    return [];
  }
}
