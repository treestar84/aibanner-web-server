import { readLimitedResponsePrefixText } from "../youtube-fetch";
import type { RssItem } from "./rss";
import { extractDomain } from "./rss";

interface ProviderChangelogConfig {
  readonly provider: string;
  readonly url: string;
  readonly domain: string;
}

interface ProviderChangelogEntry {
  readonly title: string;
  readonly publishedAt: Date;
  readonly text: string;
  readonly url: string;
}

export const PROVIDER_CHANGELOGS: readonly ProviderChangelogConfig[] = [
  {
    provider: "OpenAI",
    url: "https://developers.openai.com/api/docs/changelog",
    domain: "developers.openai.com",
  },
  {
    provider: "Anthropic",
    url: "https://platform.claude.com/docs/en/release-notes/overview",
    domain: "platform.claude.com",
  },
  {
    provider: "Gemini",
    url: "https://ai.google.dev/gemini-api/docs/changelog",
    domain: "ai.google.dev",
  },
  {
    provider: "Mistral",
    url: "https://docs.mistral.ai/resources/changelogs",
    domain: "docs.mistral.ai",
  },
];

const RELEASE_RE =
  /\b(model|models|api|apis|sdk|agent|agents|coding|code|tool|tools|mcp|responses|reasoning|embedding|embeddings|fine[- ]?tuning|batch|structured outputs?|function calling|computer use|code execution|released|available|launched|preview|generally available)\b/i;

const LOW_VALUE_RE =
  /\b(billing|invoice|invoices|typo|documentation typo|docs typo|dashboard filter|dashboard filters|minor bug fixes?|performance improvements and bug fixes|deprecat(?:e|ed|ion)|retire(?:d|ment)?)\b/i;

const DATE_RE =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s+\d{4})?\b/i;
const EXACT_DATE_RE =
  /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s+\d{4})?$/i;

const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const MAX_CHANGELOG_HTML_BYTES = 768 * 1024;
const ACTION_PREFIX_RE =
  /^(?:Update|Feature|New)?\s*(?:[a-z0-9_/-]+\s*){0,8}\b(Released|Added|Launched|Introduced)\b/i;

function parseProviderDate(raw: string, now: Date): Date | null {
  const match = raw.match(DATE_RE);
  if (!match) return null;

  const dateText = /\d{4}/.test(match[0])
    ? match[0]
    : `${match[0]}, ${now.getUTCFullYear()}`;
  const parsed = new Date(`${dateText} UTC`);
  if (Number.isNaN(parsed.getTime())) return null;

  const futureToleranceMs = 7 * 24 * 60 * 60 * 1000;
  if (parsed.getTime() - now.getTime() > futureToleranceMs) {
    return new Date(
      Date.UTC(parsed.getUTCFullYear() - 1, parsed.getUTCMonth(), parsed.getUTCDate())
    );
  }

  return parsed;
}

function firstRelevantSentence(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const sentences = normalized.split(/(?<=[.!?])\s+/);
  return sentences.find((sentence) => RELEASE_RE.test(sentence)) ?? normalized;
}

function extractLaunchSubject(sentence: string): string | null {
  const patterns: readonly RegExp[] = [
    /\b(?:we(?:'ve| have)?|we)\s+(?:launched|released|introduced)\s+([^,;()]+)(?:\s*\([^)]*\))?/i,
    /^(?:released|launched|introduced)\s+([^,;()]+)(?:\s*\([^)]*\))?/i,
    /\b(.+?)\s+(?:is|are)\s+now\s+available\b/i,
    /\b(.+?)\s+(?:is|are)\s+available\b/i,
  ];

  for (const pattern of patterns) {
    const match = sentence.match(pattern);
    const subject = match?.[1]?.replace(/\s+/g, " ").replace(/\.$/, "").trim();
    if (subject && RELEASE_RE.test(sentence)) return subject;
  }

  return null;
}

function buildItemTitle(provider: string, text: string): string {
  const relevantSentence = firstRelevantSentence(text);
  const headline = extractLaunchSubject(relevantSentence) ?? relevantSentence;
  const sentence = headline
    .replace(/\s+(is|are)\s+now\s+available\b.*$/i, "")
    .replace(/\s+(is|are)\s+available\b.*$/i, "")
    .replace(/\s+launched\b.*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/\.$/, "")
    .trim();
  const shortTitle = sentence.length > 96 ? `${sentence.slice(0, 93).trim()}...` : sentence;
  return shortTitle.toLowerCase().includes(provider.toLowerCase())
    ? shortTitle
    : `${provider}: ${shortTitle}`;
}

function isUsefulProviderChange(text: string): boolean {
  if (!RELEASE_RE.test(text)) return false;
  return !LOW_VALUE_RE.test(text);
}

export function mapProviderChangelogEntries(
  entries: readonly ProviderChangelogEntry[],
  config: ProviderChangelogConfig,
  cutoff: Date
): RssItem[] {
  const seen = new Set<string>();
  const items: RssItem[] = [];

  for (const entry of entries) {
    const text = entry.text.replace(/\s+/g, " ").trim();
    if (!(entry.publishedAt > cutoff) || !text || !isUsefulProviderChange(text)) {
      continue;
    }

    const title = buildItemTitle(config.provider, text);
    const key = `${config.provider}:${title.toLowerCase().replace(/\s+/g, " ")}`;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({
      title,
      link: entry.url,
      publishedAt: entry.publishedAt,
      summary: text.slice(0, 500),
      sourceDomain: config.domain,
      feedTitle: `${config.provider} Provider Changelog`,
      tier: "P1_CONTEXT",
      lang: "en",
    });
  }

  return items;
}

export function parseProviderChangelogHtml(
  html: string,
  config: ProviderChangelogConfig,
  now = new Date()
): ProviderChangelogEntry[] {
  const entries: ProviderChangelogEntry[] = [];
  const seen = new Set<string>();
  const lines = htmlToTextLines(html);

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index] ?? "";
    if (!EXACT_DATE_RE.test(heading)) continue;
    const publishedAt = parseProviderDate(heading, now);
    if (!publishedAt) continue;

    const parts: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? "";
      if (EXACT_DATE_RE.test(line)) break;
      if (line.length > 0) parts.push(line);
      if (parts.join(" ").length > 1200) break;
    }

    const body = cleanEntryBody(parts.join(" ").trim(), heading);
    if (!body) continue;

    const key = `${publishedAt.toISOString()}:${body.slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      title: heading,
      publishedAt,
      text: body,
      url: config.url,
    });
  }

  return entries;
}

function cleanEntryBody(text: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const normalized = text
    .replace(new RegExp(`^(?:${escapedHeading}\\s*)+`, "i"), "")
    .replace(DATE_RE, " ")
    .replace(/(?<=[a-z])(?=(Released|Added|Launched|Introduced)\b)/g, " ")
    .replace(/\b(Update|Feature|MODEL RELEASED|API UPDATED|New)\b/g, " $1 ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  const withoutBadges = normalized.replace(
    /^(?:Update|Feature|New)\s+(?:v\d+\/[a-z0-9_/-]+\s*)+/i,
    ""
  );
  if (withoutBadges !== normalized) return withoutBadges.trim();

  const actionMatch = normalized.match(ACTION_PREFIX_RE);
  if (actionMatch?.index === 0 && actionMatch[1]) {
    return normalized.slice(actionMatch[0].indexOf(actionMatch[1])).trim();
  }

  return normalized;
}

function htmlToTextLines(html: string): string[] {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(?:h[1-6]|p|li|div|article|section)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10))
    )
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchProviderChangelog(
  config: ProviderChangelogConfig,
  cutoff: Date
): Promise<RssItem[]> {
  try {
    const res = await fetch(config.url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await readLimitedResponsePrefixText(res, MAX_CHANGELOG_HTML_BYTES);
    const entries = parseProviderChangelogHtml(html, config);
    return mapProviderChangelogEntries(entries, config, cutoff).filter(
      (item) => extractDomain(item.link) === config.domain
    );
  } catch (err) {
    console.warn(
      `[provider_changelogs] ${config.provider} failed:`,
      (err as Error).message
    );
    return [];
  }
}

export async function collectProviderChangelogItems(
  windowHours = 72
): Promise<RssItem[]> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const items: RssItem[] = [];
  for (const config of PROVIDER_CHANGELOGS) {
    items.push(...(await fetchProviderChangelog(config, cutoff)));
  }
  console.log(`[provider_changelogs] ${items.length} provider update(s)`);
  return items;
}
