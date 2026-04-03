import { getTopKeywords, getLatestSnapshotWithKeywords } from "../db/queries";

const BASE_TERMS = [
  "AI", "LLM", "GPT", "Claude", "Gemini",
  "OpenAI", "Anthropic", "DeepSeek",
];

/**
 * 이전 스냅샷 Top 10 키워드를 베이스 쿼리에 합쳐 동적 검색어를 생성한다.
 * 최대 15개 term. 실패 시 베이스 쿼리만 반환.
 */
export async function buildDynamicQuery(): Promise<string> {
  try {
    const latest = await getLatestSnapshotWithKeywords();
    if (!latest) return BASE_TERMS.join(" OR ");

    const topKeywords = await getTopKeywords(latest.snapshot_id, 10);
    const dynamicTerms: string[] = [];

    for (const kw of topKeywords) {
      const term = (kw.keyword_en || kw.keyword).trim();
      if (term.length < 3 || term.length > 30) continue;
      if (BASE_TERMS.some((b) => b.toLowerCase() === term.toLowerCase())) continue;
      dynamicTerms.push(term.includes(" ") ? `"${term}"` : term);
    }

    const allTerms = [...BASE_TERMS, ...dynamicTerms].slice(0, 15);
    return allTerms.join(" OR ");
  } catch (err) {
    console.warn("[dynamic_query] Failed, using base query:", (err as Error).message);
    return BASE_TERMS.join(" OR ");
  }
}
