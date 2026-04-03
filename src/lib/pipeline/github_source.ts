import type { RssItem } from "./rss";
import { buildDynamicQuery } from "./dynamic_query";

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

export async function collectGithubItems(
  windowHours = 72
): Promise<RssItem[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log("[github_source] No GITHUB_TOKEN, skipping");
    return [];
  }

  try {
    const dynamicQuery = await buildDynamicQuery();
    const githubQuery = dynamicQuery
      .split(" OR ")
      .map((t) => t.replace(/^"|"$/g, "").trim().toLowerCase())
      .join(" OR ");

    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const sinceDate = since.toISOString().slice(0, 10);

    const params = new URLSearchParams({
      q: `${githubQuery} pushed:>=${sinceDate}`,
      sort: "updated",
      order: "desc",
      per_page: "50",
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data: GithubSearchResponse = await res.json();

    return data.items.map((repo) => ({
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
    }));
  } catch (err) {
    console.warn("[github_source] Failed:", (err as Error).message);
    return [];
  }
}
