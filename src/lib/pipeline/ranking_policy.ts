import type { NormalizedKeyword } from "./keywords";
import type { RssItem } from "./rss";

export type VersionKind = "none" | "build" | "patch" | "minor" | "major";
export type KeywordKind =
  | "named_topic"
  | "feature_event"
  | "incident"
  | "version_release"
  | "version_only";

export interface KeywordPolicyMeta {
  familyKey: string;
  familyLabel: string;
  familySource: "repo" | "stem";
  versionKind: VersionKind;
  keywordKind: KeywordKind;
}

export interface RankingHistoryStats {
  appearances: number;
  previousRank: number | null;
}

const MINOR_VARIANT_WORDS = new Set([
  "small",
  "mini",
  "micro",
  "lite",
  "base",
  "core",
  "pro",
  "plus",
  "max",
  "large",
  "turbo",
  "preview",
  "beta",
  "alpha",
]);

const FRAMEWORK_SUFFIXES = new Set([
  "react",
  "vue",
  "svelte",
  "angular",
  "solid",
  "next",
  "nuxt",
  "python",
  "javascript",
  "typescript",
  "java",
  "go",
]);

const FAMILY_TRAILING_NOISE = new Set([
  "release",
  "releases",
  "released",
  "version",
  "versions",
  "update",
  "updates",
  "updated",
  "announcement",
  "announcements",
  "launch",
  "launched",
  "support",
  "integration",
  "integrations",
  ...MINOR_VARIANT_WORDS,
]);

const INCIDENT_HINTS = [
  "outage",
  "incident",
  "degraded",
  "downtime",
  "server down",
  "down",
  "latency",
  "error",
  "errors",
  "bug",
  "bugs",
  "issue",
  "issues",
  "broken",
  "failure",
  "failed",
  "rollback",
  "revert",
  "security",
  "vulnerability",
  "cve",
  "장애",
  "오류",
  "먹통",
  "다운",
  "보안",
];

const FEATURE_HINTS = [
  "memory",
  "import",
  "teams",
  "workflow",
  "workflows",
  "mode",
  "modes",
  "plugin",
  "plugins",
  "extension",
  "extensions",
  "integration",
  "integrations",
  "voice",
  "audio",
  "search",
  "sync",
  "tool calling",
  "filesystem",
  "browser",
  "desktop",
  "mobile",
  "studio",
  "feature",
  "features",
  "support",
  "memory import",
  "기능",
  "지원",
  "연동",
  "통합",
  "음성",
  "보이스",
];

function normalizeSurface(text: string): string {
  return text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/([a-z])(\d+(?:\.\d+)?)(?=\b)/gi, "$1 $2")
    .replace(/[_\-·/]+/g, " ")
    .replace(/[“”"'`~!@#$%^&*()+=[\]{}|\\:;<>?,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalizeSurface(text).split(/\s+/).filter(Boolean);
}

function isBuildToken(token: string): boolean {
  return /^b\d{3,}$/i.test(token) || /^build\d{3,}$/i.test(token);
}

function isVersionToken(token: string): boolean {
  return isBuildToken(token) || /^\d+(?:\.\d+){0,2}$/.test(token);
}

function extractGithubRepoFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("github.com")) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`.toLowerCase();
  } catch {
    return null;
  }
}

function extractGithubRepoHint(item: RssItem): string | null {
  if (item.feedTitle.startsWith("GitHub Release: ")) {
    return item.feedTitle.slice("GitHub Release: ".length).trim().toLowerCase();
  }

  if (item.sourceDomain === "github.com") {
    const repo = extractGithubRepoFromUrl(item.link);
    if (repo) return repo;
  }

  return null;
}

function inferRepoFamily(
  keyword: NormalizedKeyword,
  sourceItems: RssItem[]
): { familyKey: string; familyLabel: string; familySource: "repo" } | null {
  const repoCounts = new Map<string, number>();
  for (const idx of keyword.candidates.matchedItems) {
    const item = sourceItems[idx];
    if (!item) continue;
    const repo = extractGithubRepoHint(item);
    if (!repo) continue;
    repoCounts.set(repo, (repoCounts.get(repo) ?? 0) + 1);
  }

  let bestRepo: string | null = null;
  let bestCount = 0;
  for (const [repo, count] of repoCounts) {
    if (count > bestCount) {
      bestRepo = repo;
      bestCount = count;
    }
  }

  if (!bestRepo) return null;
  return {
    familyKey: `repo:${bestRepo}`,
    familyLabel: bestRepo,
    familySource: "repo",
  };
}

function inferStemFamily(
  keyword: NormalizedKeyword
): { familyKey: string; familyLabel: string; familySource: "stem" } {
  let tokens = tokenize(keyword.keyword);

  if (tokens.length >= 4 && tokens[1] === "org") {
    tokens = tokens.slice(2);
  }

  while (
    tokens.length > 2 &&
    (isVersionToken(tokens[tokens.length - 1]) ||
      FAMILY_TRAILING_NOISE.has(tokens[tokens.length - 1]))
  ) {
    tokens.pop();
  }

  if (tokens.length >= 4 && FRAMEWORK_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  const familyWidth =
    tokens.includes("sdk") || tokens.includes("api") || tokens.includes("code")
      ? Math.min(3, tokens.length)
      : Math.min(2, tokens.length);

  const familyTokens = tokens.slice(0, Math.max(1, familyWidth));
  const familyLabel = familyTokens.join(" ").trim() || normalizeSurface(keyword.keyword);

  return {
    familyKey: `stem:${familyLabel}`,
    familyLabel,
    familySource: "stem",
  };
}

export function classifyVersionKind(text: string): VersionKind {
  const raw = text.normalize("NFKC").trim().toLowerCase();
  const normalized = normalizeSurface(text);
  if (!normalized) return "none";

  if (/\bb\d{3,}\b/i.test(raw) || /\bbuild[\s-]*\d{3,}\b/i.test(raw)) {
    return "build";
  }

  const match = normalized.match(/\b\d+(?:\.\d+){0,2}\b/);
  if (!match) return "none";

  const value = match[0];
  const segments = value.split(".");
  if (segments.length >= 3) return "patch";
  if (segments.length === 2) {
    return segments[1] === "0" ? "major" : "minor";
  }
  return "major";
}

function classifyKeywordKind(text: string, versionKind: VersionKind): KeywordKind {
  const normalized = normalizeSurface(text);
  if (!normalized) return "named_topic";

  if (INCIDENT_HINTS.some((hint) => normalized.includes(hint))) {
    return "incident";
  }

  if (FEATURE_HINTS.some((hint) => normalized.includes(hint))) {
    return "feature_event";
  }

  if (versionKind === "none") return "named_topic";

  const tokens = tokenize(text).filter(
    (token) =>
      !isVersionToken(token) &&
      !MINOR_VARIANT_WORDS.has(token) &&
      !FRAMEWORK_SUFFIXES.has(token)
  );

  if (tokens.length <= 3) return "version_only";
  return "version_release";
}

export function inferKeywordPolicyMeta(
  keyword: NormalizedKeyword,
  sourceItems: RssItem[]
): KeywordPolicyMeta {
  const repoFamily = inferRepoFamily(keyword, sourceItems);
  const stemFamily = inferStemFamily(keyword);
  const versionKind = classifyVersionKind(keyword.keyword);
  const keywordKind = classifyKeywordKind(keyword.keyword, versionKind);

  return {
    ...(repoFamily ?? stemFamily),
    versionKind,
    keywordKind,
  };
}

export function buildKeywordPolicyMap(
  keywords: NormalizedKeyword[],
  sourceItems: RssItem[]
): Map<string, KeywordPolicyMeta> {
  const map = new Map<string, KeywordPolicyMeta>();
  for (const keyword of keywords) {
    map.set(keyword.keywordId, inferKeywordPolicyMeta(keyword, sourceItems));
  }
  return map;
}

export function calculateKeywordPolicyDelta(
  item: {
    keyword: NormalizedKeyword;
    score: {
      authority: number;
      engagement: number;
    };
  },
  meta: KeywordPolicyMeta
): number {
  let delta = 0;

  // Phase 2-A §4.2.2 (PRD 2026-04-23 · audit-B#L194-205): 정책 delta 계수 축소.
  // 사유: 현행 +0.08/+0.06 등이 자연 score(~1.0) 대비 과도해 노이즈 키워드가 과대 부스팅되는 문제.
  if (meta.keywordKind === "incident") delta += 0.02;
  if (meta.keywordKind === "feature_event") delta += 0.02;
  if (meta.keywordKind === "version_release") delta += 0.005;

  if (meta.versionKind === "major") delta += 0.01;
  if (meta.versionKind === "patch") delta -= 0.02;
  if (meta.versionKind === "build") delta -= 0.04;

  const isWeakVersionOnly =
    meta.keywordKind === "version_only" &&
    item.keyword.candidates.domains.size < 2 &&
    item.keyword.candidates.count < 3 &&
    item.score.authority < 0.84 &&
    item.score.engagement < 0.45;

  if (isWeakVersionOnly) delta -= 0.04;

  const isLowSignalSingleSource =
    item.keyword.candidates.domains.size === 1 &&
    item.score.engagement === 0 &&
    item.score.authority <= 0.3;

  if (isLowSignalSingleSource) delta -= 0.08;

  return parseFloat(delta.toFixed(4));
}

export function suppressVersionFamilyDuplicates<T extends {
  keyword: NormalizedKeyword;
  score: { total: number };
}>(
  items: T[],
  metaByKeywordId: Map<string, KeywordPolicyMeta>
): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const meta = metaByKeywordId.get(item.keyword.keywordId);
    const familyKey = meta?.familyKey ?? item.keyword.keywordId;
    const current = groups.get(familyKey);
    if (current) {
      current.push(item);
    } else {
      groups.set(familyKey, [item]);
    }
  }

  const keep = new Set<string>();

  for (const group of groups.values()) {
    const strongNonVersion = group.filter((item) => {
      const meta = metaByKeywordId.get(item.keyword.keywordId);
      return meta?.keywordKind === "feature_event" || meta?.keywordKind === "incident";
    });
    const versioned = group
      .filter((item) => {
        const meta = metaByKeywordId.get(item.keyword.keywordId);
        return meta && meta.versionKind !== "none";
      })
      .sort((a, b) => b.score.total - a.score.total);

    if (strongNonVersion.length > 0 && versioned.length > 0) {
      for (const item of group) {
        const meta = metaByKeywordId.get(item.keyword.keywordId);
        if (meta?.versionKind === "none") {
          keep.add(item.keyword.keywordId);
        }
      }
      continue;
    }

    if (versioned.length < 2) {
      for (const item of group) keep.add(item.keyword.keywordId);
      continue;
    }

    for (const item of group) {
      const meta = metaByKeywordId.get(item.keyword.keywordId);
      if (!meta || meta.versionKind === "none") {
        keep.add(item.keyword.keywordId);
      }
    }

    const bestVersioned = versioned[0];
    if (bestVersioned) keep.add(bestVersioned.keyword.keywordId);
  }

  return items.filter((item) => keep.has(item.keyword.keywordId));
}

export function calculateStabilityDelta(
  item: {
    keyword: NormalizedKeyword;
    score: {
      recency: number;
      velocity: number;
      engagement: number;
      authority: number;
    };
    isNew: boolean;
  },
  history?: RankingHistoryStats
): number {
  let delta = 0;

  const strongBreakout =
    item.score.engagement >= 0.45 ||
    item.score.authority >= 0.84 ||
    item.score.velocity >= 0.45 ||
    item.keyword.candidates.domains.size >= 3;

  // Phase 2-A §4.2.3 (PRD 2026-04-23 · audit-B#L460-463): stability delta 계수 축소.
  // 사유: 기득권 편향(echo chamber) 완화 + 신규 진입 장벽 약화.
  if (item.isNew) {
    delta += strongBreakout ? 0.03 : -0.03;
  } else if ((history?.previousRank ?? 999) <= 10) {
    delta += 0.01;
  }

  const appearances = history?.appearances ?? 0;
  if (appearances >= 2) {
    delta += Math.min(0.01, (appearances - 1) * 0.01);
  }

  const isStale =
    !item.isNew &&
    item.score.recency < 0.25 &&
    item.score.velocity < 0.08 &&
    item.score.engagement < 0.2;

  if (isStale) delta -= 0.02;

  return parseFloat(delta.toFixed(4));
}
