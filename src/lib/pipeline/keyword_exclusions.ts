import config from "@/config/keyword-exclusions.json";

type KeywordExclusionsConfig = {
  exact?: unknown;
};

function normalizeKeyword(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildExactExclusionSet(): Set<string> {
  const exactRaw = (config as KeywordExclusionsConfig).exact;
  if (!Array.isArray(exactRaw)) return new Set();

  return new Set(
    exactRaw
      .filter((value): value is string => typeof value === "string")
      .map(normalizeKeyword)
      .filter((value) => value.length > 0)
  );
}

const EXACT_EXCLUSION_SET = buildExactExclusionSet();

export function isExactlyExcludedKeyword(keyword: string): boolean {
  return EXACT_EXCLUSION_SET.has(normalizeKeyword(keyword));
}
