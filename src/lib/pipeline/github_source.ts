import type { RssItem } from "./rss";

const GITHUB_QUERY =
  "llm OR gpt OR agent OR rag OR openai OR anthropic OR gemini OR claude";

interface GithubRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  pushed_at: string;
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
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const sinceDate = since.toISOString().slice(0, 10); // YYYY-MM-DD

    const params = new URLSearchParams({
      q: `${GITHUB_QUERY} pushed:>=${sinceDate}`,
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
    }));
  } catch (err) {
    console.warn("[github_source] Failed:", (err as Error).message);
    return [];
  }
}
