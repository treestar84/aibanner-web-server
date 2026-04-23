import config from "@/config/keyword-exclusions.json";

// Phase 2-A §4.2.1 (PRD 2026-04-23 · audit-B#L156-189):
// 키워드 제외 규칙을 exact 전용에서 exact + prefix + regex 3단으로 확장한다.
// - exact: 정확히 같은 문자열만 차단 (기존 동작 유지)
// - prefix: 정규화된 키워드가 주어진 접두사로 시작하면 차단. 공백으로 끝난 접두사는 단어 경계 역할.
// - regex: 정규화된 키워드에 매치되면 차단. 설정 오류(잘못된 정규식)는 로그만 남기고 무시.

type KeywordExclusionsConfig = {
  exact?: unknown;
  prefix?: unknown;
  regex?: unknown;
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

function buildPrefixExclusionList(): string[] {
  const prefixRaw = (config as KeywordExclusionsConfig).prefix;
  if (!Array.isArray(prefixRaw)) return [];

  return prefixRaw
    .filter((value): value is string => typeof value === "string")
    .map(normalizeKeyword)
    .filter((value) => value.length > 0);
}

function buildRegexExclusionList(): RegExp[] {
  const regexRaw = (config as KeywordExclusionsConfig).regex;
  if (!Array.isArray(regexRaw)) return [];

  const compiled: RegExp[] = [];
  for (const pattern of regexRaw) {
    if (typeof pattern !== "string" || pattern.length === 0) continue;
    try {
      compiled.push(new RegExp(pattern, "i"));
    } catch (err) {
      console.warn(
        `[keyword_exclusions] invalid regex pattern skipped: ${pattern} (${(err as Error).message})`
      );
    }
  }
  return compiled;
}

const EXACT_EXCLUSION_SET = buildExactExclusionSet();
const PREFIX_EXCLUSION_LIST = buildPrefixExclusionList();
const REGEX_EXCLUSION_LIST = buildRegexExclusionList();

export function isExcludedKeyword(keyword: string): boolean {
  const normalized = normalizeKeyword(keyword);
  if (normalized.length === 0) return false;

  if (EXACT_EXCLUSION_SET.has(normalized)) return true;

  for (const prefix of PREFIX_EXCLUSION_LIST) {
    if (normalized.startsWith(prefix)) return true;
  }

  for (const re of REGEX_EXCLUSION_LIST) {
    if (re.test(normalized)) return true;
  }

  return false;
}

// 구 API 호환 (기존 호출자를 위한 얇은 alias; Phase 3 후 제거 예정)
export const isExactlyExcludedKeyword = isExcludedKeyword;
