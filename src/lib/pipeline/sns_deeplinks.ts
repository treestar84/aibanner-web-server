// Phase 3 §5.2.6 (PRD 2026-04-23 · audit-C#L131-186):
// 키워드 1건당 X(Twitter) / Threads / YouTube / GitHub의 검색 deeplink 4종을 만든다.
// 비용·ToS 안전성 면에서 1순위 통합 전략 (공식 API 도입 전 최소 구현).
// schemaVersion=2 / golden 5슬롯 / preview 등 큰 contract 변경은 본 helper와 무관하게 별도 PR.

export interface SnsDeeplinks {
  x_search: string | null;
  threads_search: string | null;
  youtube_search: string | null;
  github_search: string | null;
}

const EMPTY: SnsDeeplinks = {
  x_search: null,
  threads_search: null,
  youtube_search: null,
  github_search: null,
};

export function buildSnsDeeplinks(keyword: string | null | undefined): SnsDeeplinks {
  const trimmed = (keyword ?? "").trim();
  if (trimmed.length === 0) return EMPTY;

  const q = encodeURIComponent(trimmed);

  return {
    x_search: `https://x.com/search?q=${q}&f=live`,
    threads_search: `https://www.threads.net/search?q=${q}`,
    youtube_search: `https://www.youtube.com/results?search_query=${q}`,
    github_search: `https://github.com/search?q=${q}&type=repositories`,
  };
}
