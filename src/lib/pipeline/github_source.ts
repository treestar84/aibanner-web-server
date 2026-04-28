import type { RssItem } from "./rss";

interface GithubRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  pushed_at: string;
  stargazers_count: number;
  forks_count: number;
}

interface GithubSearchResponse {
  items: GithubRepo[];
}

// GitHub Search API limits q to at most 5 AND/OR/NOT operators.
// Queries built from buildDynamicQuery() carry 13~20 OR terms and trigger HTTP 422.
// We run a small set of focused queries instead and merge unique results.
const GITHUB_QUERY_GROUPS: string[][] = [
  ["AI", "LLM", "agent", "Claude", "Gemini"],
  ["GPT", "OpenAI", "Anthropic", "DeepSeek"],
  ["RAG", "MCP", "vibecoding"],
];

export async function collectGithubItems(
  windowHours = 72
): Promise<RssItem[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log("[github_source] No GITHUB_TOKEN, skipping");
    return [];
  }

  const sinceDate = new Date(Date.now() - windowHours * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const seen = new Set<string>();
  const items: RssItem[] = [];

  for (const group of GITHUB_QUERY_GROUPS) {
    try {
      const q = `${group.join(" OR ")} pushed:>=${sinceDate}`;
      const params = new URLSearchParams({
        q,
        sort: "updated",
        order: "desc",
        per_page: "30",
      });

      const res = await fetch(
        `https://api.github.com/search/repositories?${params}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: AbortSignal.timeout(10000),
        }
      );
      if (!res.ok) {
        console.warn(`[github_source] group "${group.join("|")}" HTTP ${res.status}`);
        continue;
      }

      const data: GithubSearchResponse = await res.json();
      for (const repo of data.items) {
        if (seen.has(repo.html_url)) continue;
        seen.add(repo.html_url);
        items.push({
          title: repo.description
            ? `${repo.full_name} — ${repo.description}`
            : repo.full_name,
          link: repo.html_url,
          publishedAt: new Date(repo.pushed_at),
          summary: "",
          sourceDomain: "github.com",
          feedTitle: "GitHub",
          tier: "COMMUNITY" as const,
          lang: "en",
          engagement: {
            score: repo.stargazers_count,
            comments: repo.forks_count,
          },
        });
      }
    } catch (err) {
      console.warn(
        `[github_source] group "${group.join("|")}" failed:`,
        (err as Error).message
      );
    }
  }

  console.log(`[github_source] Got ${items.length} items across ${GITHUB_QUERY_GROUPS.length} groups`);
  return items;
}
