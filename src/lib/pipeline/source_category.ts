export type PrimaryType = "news" | "social" | "data";

type SourceLike = {
  type?: string | null;
  domain?: string | null;
  url?: string | null;
  title?: string | null;
};

const SOCIAL_DOMAINS = new Set([
  "x.com",
  "twitter.com",
  "t.co",
  "linkedin.com",
  "lnkd.in",
  "threads.net",
  "reddit.com",
  "redd.it",
  "discord.com",
  "discord.gg",
]);

const DATA_DOMAINS = new Set([
  "youtube.com",
  "youtu.be",
  "arxiv.org",
  "openreview.net",
  "aclanthology.org",
  "semanticscholar.org",
  "researchgate.net",
  "paperswithcode.com",
  "doi.org",
  "biorxiv.org",
  "medrxiv.org",
  "jmlr.org",
  "nature.com",
  "science.org",
]);

const ACADEMIC_HINT_RE =
  /(arxiv|openreview|aclanthology|semanticscholar|researchgate|paperswithcode|preprint|doi\.org)/i;
const YOUTUBE_HINT_RE = /(youtube\.com|youtu\.be)/i;

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
}

function hostFromUrl(url?: string | null): string {
  if (!url) return "";
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return "";
  }
}

function getHost(source: SourceLike): string {
  const fromDomain = normalizeHost(source.domain ?? "");
  if (fromDomain) return fromDomain;
  return hostFromUrl(source.url);
}

function hasDomain(host: string, domainSet: Set<string>): boolean {
  if (!host) return false;
  for (const domain of domainSet) {
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}

export function classifySourceCategory(source: SourceLike): PrimaryType {
  const type = (source.type ?? "").toLowerCase();
  const host = getHost(source);
  const url = (source.url ?? "").toLowerCase();
  const title = (source.title ?? "").toLowerCase();

  if (type === "video" || type === "image") return "data";
  if (hasDomain(host, SOCIAL_DOMAINS)) return "social";

  if (hasDomain(host, DATA_DOMAINS)) return "data";
  if (YOUTUBE_HINT_RE.test(url)) return "data";
  if (ACADEMIC_HINT_RE.test(url) || ACADEMIC_HINT_RE.test(title)) return "data";

  return "news";
}

export function determinePrimaryType(sources: SourceLike[]): PrimaryType {
  if (sources.length === 0) return "news";

  const scores: Record<PrimaryType, number> = {
    news: 0,
    social: 0,
    data: 0,
  };

  for (let i = 0; i < sources.length; i++) {
    const category = classifySourceCategory(sources[i]);
    const weight = i < 3 ? 3 : i < 8 ? 2 : 1;
    scores[category] += weight;
  }

  const firstCategory = classifySourceCategory(sources[0]);
  const tieOrder: Record<PrimaryType, number> = {
    [firstCategory]: 0,
    social: firstCategory === "social" ? 0 : 1,
    data: firstCategory === "data" ? 0 : 2,
    news: firstCategory === "news" ? 0 : 3,
  };

  let best: PrimaryType = "news";
  for (const category of ["news", "social", "data"] as const) {
    if (scores[category] > scores[best]) {
      best = category;
      continue;
    }
    if (scores[category] === scores[best] && tieOrder[category] < tieOrder[best]) {
      best = category;
    }
  }
  return best;
}

export function pickPrimarySource<T extends SourceLike>(
  sources: T[],
  primaryType: PrimaryType
): T | undefined {
  return (
    sources.find((source) => classifySourceCategory(source) === primaryType) ??
    sources[0]
  );
}

export function normalizePrimaryType(
  storedType: string | null | undefined,
  sourceHint?: SourceLike
): PrimaryType {
  const normalized = (storedType ?? "").toLowerCase().trim();

  if (normalized === "social" || normalized === "data") return normalized;
  if (sourceHint) {
    return classifySourceCategory({
      ...sourceHint,
      type: normalized || sourceHint.type,
    });
  }
  if (normalized === "video" || normalized === "image") return "data";
  return "news";
}
