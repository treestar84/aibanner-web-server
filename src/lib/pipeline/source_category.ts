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
  "tweetdeck.twitter.com",
  "mobile.twitter.com",
  "linkedin.com",
  "lnkd.in",
  "threads.net",
  "reddit.com",
  "redd.it",
  "old.reddit.com",
  "news.ycombinator.com",
  "hn.algolia.com",
  "dev.to",
  "clien.net",
  "facebook.com",
  "fb.com",
  "instagram.com",
  "instagr.am",
  "tiktok.com",
  "vm.tiktok.com",
  "news.hada.io",
  "geeksforgeeks.org",
  "geeks.kr",
  "geeks.co.kr",
  "mastodon.social",
  "velog.io",
  "hashnode.com",
  "discord.com",
  "discord.gg",
]);

const DATA_DOMAINS = new Set([
  "youtube.com",
  "youtu.be",
  "m.youtube.com",
  "vimeo.com",
  "dailymotion.com",
  "twitch.tv",
  "loom.com",
  "docs.google.com",
  "drive.google.com",
  "colab.research.google.com",
  "slideshare.net",
  "speakerdeck.com",
  "figshare.com",
  "zenodo.org",
  "kaggle.com",
  "huggingface.co",
  "osf.io",
  "dropbox.com",
  "onedrive.live.com",
  "unsplash.com",
  "images.unsplash.com",
  "pexels.com",
  "pixabay.com",
  "imgur.com",
  "flickr.com",
  "giphy.com",
  "tenor.com",
  "media.githubusercontent.com",
  "raw.githubusercontent.com",
  "arxiv.org",
  "openreview.net",
  "aclanthology.org",
  "dblp.org",
  "ieeexplore.ieee.org",
  "springer.com",
  "link.springer.com",
  "sciencedirect.com",
  "dl.acm.org",
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
  /(arxiv|openreview|aclanthology|semanticscholar|researchgate|paperswithcode|preprint|doi\.org|whitepaper|technical\s*report|benchmark|leaderboard|supplementary)/i;
const YOUTUBE_HINT_RE = /(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|loom\.com)/i;
const GOOGLE_DOCS_HINT_RE =
  /(docs\.google\.com|drive\.google\.com|colab\.research\.google\.com|slideshare\.net|speakerdeck\.com|notion\.(so|site))/i;
const IMAGE_OR_VIDEO_HINT_RE =
  /\.(png|jpe?g|gif|webp|bmp|svg|tiff|avif|mp4|mov|avi|mkv|webm|flv|m3u8)(?:$|[?#])/i;
const DATA_FILE_HINT_RE =
  /\.(pdf|csv|tsv|json|jsonl|xml|yaml|yml|parquet|xls|xlsx|doc|docx|ppt|pptx|zip|tar|gz|7z)(?:$|[?#])/i;
const FILETYPE_HINT_RE = /(filetype=pdf|format=pdf|download=1|output=1)/i;

function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/:\d+$/, "")
    .replace(/\/+$/, "");
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

  if (type === "social") return "social";
  if (type === "data") return "data";
  if (type === "video" || type === "image") return "data";
  if (hasDomain(host, SOCIAL_DOMAINS)) return "social";

  if (hasDomain(host, DATA_DOMAINS)) return "data";
  if (YOUTUBE_HINT_RE.test(url)) return "data";
  if (GOOGLE_DOCS_HINT_RE.test(url)) return "data";
  if (IMAGE_OR_VIDEO_HINT_RE.test(url)) return "data";
  if (DATA_FILE_HINT_RE.test(url)) return "data";
  if (FILETYPE_HINT_RE.test(url)) return "data";
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
    scores[category] += 1;
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
