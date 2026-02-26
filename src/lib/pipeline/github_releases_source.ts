import type { RssItem } from "./rss";

// ─── Tracked Repos ───────────────────────────────────────────────────────────

const TRACKED_REPOS: string[] = [
  "ollama/ollama",
  "langchain-ai/langchain",
  "crewAIInc/crewAI",
  "microsoft/autogen",
  "run-llama/llama_index",
  "vllm-project/vllm",
  "huggingface/transformers",
  "ggml-org/llama.cpp",
  "LadybirdBrowser/ladybird",
  "anthropics/claude-code",
  "vercel/ai",
  "openai/openai-python",
  "google/generative-ai-python",
  "All-Hands-AI/OpenHands",
  "continuedev/continue",
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface GithubRelease {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string;
  prerelease: boolean;
  body: string | null;
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function fetchReleases(
  repo: string,
  token: string,
  cutoff: Date
): Promise<RssItem[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases?per_page=5`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(6000),
      }
    );

    if (!res.ok) {
      if (res.status === 404) return []; // repo not found or private
      throw new Error(`HTTP ${res.status}`);
    }

    const releases: GithubRelease[] = await res.json();

    return releases
      .filter((r) => {
        const pubDate = new Date(r.published_at);
        return pubDate > cutoff;
      })
      .map((r) => ({
        title: `${repo} ${r.tag_name}${r.prerelease ? " (pre-release)" : ""}: ${r.name ?? r.tag_name}`,
        link: r.html_url,
        publishedAt: new Date(r.published_at),
        summary: (r.body ?? "").slice(0, 500),
        sourceDomain: "github.com",
        feedTitle: `GitHub Release: ${repo}`,
        tier: "P1_CONTEXT" as const,
        lang: "en",
      }));
  } catch (err) {
    console.warn(
      `[github_releases] Failed ${repo}: ${(err as Error).message}`
    );
    return [];
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function collectGithubReleaseItems(
  windowHours = 72
): Promise<RssItem[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log("[github_releases] No GITHUB_TOKEN, skipping");
    return [];
  }

  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const results = await Promise.allSettled(
    TRACKED_REPOS.map((repo) => fetchReleases(repo, token, cutoff))
  );

  const all: RssItem[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled" && r.value.length > 0) {
      console.log(
        `[github_releases] ${TRACKED_REPOS[i]}: ${r.value.length} releases`
      );
      all.push(...r.value);
    }
  }

  console.log(`[github_releases] Total: ${all.length} releases`);
  return all;
}
