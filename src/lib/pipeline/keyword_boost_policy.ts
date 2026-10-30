import type { RssItem } from "./rss";

export type KeywordBoostSource = "fiv" | "promppy" | "koraia";

const BOOST_DOMAINS = ["fiv.co.kr", "promppy.com", "report.koraia.org"];

export function isKeywordBoostDomain(domain: string): boolean {
  const host = domain.trim().toLowerCase().replace(/\.$/, "");
  return BOOST_DOMAINS.some((base) => host === base || host.endsWith(`.${base}`));
}

export function isKeywordBoostUrl(url: string): boolean {
  try {
    return isKeywordBoostDomain(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Also guards search results and old items that have no explicit usage flag. */
export function isKeywordBoostOnly(
  item: Pick<RssItem, "link" | "sourceDomain" | "keywordBoostSource">
): boolean {
  return !!item.keywordBoostSource || isKeywordBoostUrl(item.link) || isKeywordBoostDomain(item.sourceDomain);
}

export function isAllowedEvidence(source: { url: string; domain: string }): boolean {
  return !isKeywordBoostUrl(source.url) && !isKeywordBoostDomain(source.domain);
}
