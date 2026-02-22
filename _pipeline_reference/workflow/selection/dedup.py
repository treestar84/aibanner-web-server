"""
Deduplication Module
Removes duplicate articles based on URL canonicalization and metadata similarity
"""

from typing import List, Any, Set, Dict, Tuple
from urllib.parse import urlparse, parse_qs, urlunparse
from loguru import logger
import difflib


def canonicalize_url(url: str, canonical_fields: List[str] = None) -> str:
    """
    Canonicalize URL by removing tracking parameters and normalizing

    Args:
        url: Original URL
        canonical_fields: Fields to use for canonicalization (e.g., ['link', 'guid'])

    Returns:
        Canonicalized URL string
    """
    if not url:
        return ""

    try:
        parsed = urlparse(url)

        # Remove common tracking parameters
        tracking_params = {
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'ref', 'source', 'fbclid', 'gclid', 'msclkid'
        }

        # Parse query string
        query_params = parse_qs(parsed.query)

        # Filter out tracking parameters
        clean_params = {
            k: v for k, v in query_params.items()
            if k.lower() not in tracking_params
        }

        # Rebuild query string
        clean_query = '&'.join(
            f"{k}={v[0]}" for k, v in sorted(clean_params.items())
        ) if clean_params else ''

        # Rebuild URL without tracking params
        canonical = urlunparse((
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            parsed.path,
            parsed.params,
            clean_query,
            ''  # Remove fragment
        ))

        return canonical

    except Exception as e:
        logger.warning(f"Failed to canonicalize URL '{url}': {e}")
        return url


def normalize_title(title: str) -> str:
    """
    Normalize title for comparison
    - Lowercase
    - Remove extra whitespace
    - Remove common punctuation
    """
    if not title:
        return ""

    # Lowercase
    title = title.lower()

    # Remove common punctuation
    for char in '.,!?;:()[]{}""''—–-':
        title = title.replace(char, ' ')

    # Normalize whitespace
    title = ' '.join(title.split())

    return title


def title_similarity(title1: str, title2: str) -> float:
    """
    Compute similarity between two titles using SequenceMatcher

    Returns:
        Similarity score 0.0 to 1.0
    """
    if not title1 or not title2:
        return 0.0

    norm1 = normalize_title(title1)
    norm2 = normalize_title(title2)

    if norm1 == norm2:
        return 1.0

    # Use difflib SequenceMatcher for fuzzy matching
    return difflib.SequenceMatcher(None, norm1, norm2).ratio()


def get_tier_priority(tier: str) -> int:
    """
    Get priority score for tier (higher is better)

    Tier priority:
    P0_CURATED > P0_RELEASES > P1_CONTEXT > P2_RAW > COMMUNITY
    """
    tier_priority_map = {
        'P0_CURATED': 5,
        'P0_RELEASES': 4,
        'P1_CONTEXT': 3,
        'P2_RAW': 2,
        'COMMUNITY': 1
    }
    return tier_priority_map.get(tier, 0)


def choose_better_article(article1: Any, article2: Any) -> Any:
    """
    Choose the better article when duplicates are found

    Priority:
    1. Higher tier (P0 > P1 > P2 > COMMUNITY)
    2. origin_type = curated > raw
    3. Higher confidence score (for ai-news-daily)
    4. Higher focus score
    5. First occurrence (original behavior)

    Returns:
        The better article
    """
    # Tier comparison
    tier1 = getattr(article1, 'tier', '')
    tier2 = getattr(article2, 'tier', '')
    tier1_priority = get_tier_priority(tier1)
    tier2_priority = get_tier_priority(tier2)

    if tier1_priority > tier2_priority:
        return article1
    elif tier2_priority > tier1_priority:
        return article2

    # origin_type comparison (curated > raw)
    origin1 = getattr(article1, 'origin_type', 'raw')
    origin2 = getattr(article2, 'origin_type', 'raw')

    if origin1 == 'curated' and origin2 != 'curated':
        return article1
    elif origin2 == 'curated' and origin1 != 'curated':
        return article2

    # Confidence score comparison (for ai-news-daily)
    conf1 = getattr(article1, 'ainews_confidence', 0)
    conf2 = getattr(article2, 'ainews_confidence', 0)

    if conf1 > conf2:
        return article1
    elif conf2 > conf1:
        return article2

    # Focus score comparison
    score1 = getattr(article1, 'score', 0)
    score2 = getattr(article2, 'score', 0)

    if score1 > score2:
        return article1
    elif score2 > score1:
        return article2

    # Default: keep first occurrence
    return article1


def deduplicate_articles(
    articles: List[Any],
    config: Dict[str, Any] = None
) -> List[Any]:
    """
    Remove duplicate articles based on URL canonicalization and title similarity

    Strategy:
    1. URL canonicalization (remove tracking params)
    2. Title similarity matching (for curated sources, threshold: 0.85)
    3. When duplicates found, keep the better article (tier, origin_type, confidence, score)
    4. Log duplicate removals with reasons

    Args:
        articles: List of articles (should be sorted by score DESC)
        config: Configuration dict from rss.json

    Returns:
        Deduplicated list of articles
    """
    if config:
        dedup_config = config.get("configuration", {}).get("deduplication", {})
        enabled = dedup_config.get("enabled", True)
        canonical_fields = dedup_config.get("canonical_url_fields", ["link", "guid"])
        title_similarity_threshold = 0.85  # High threshold for title matching
    else:
        enabled = True
        canonical_fields = ["link", "guid"]
        title_similarity_threshold = 0.85

    if not enabled:
        logger.info("Deduplication disabled in config")
        return articles

    # Track seen URLs and titles with their corresponding articles
    seen_urls: Dict[str, Any] = {}  # canonical_url -> article
    seen_titles: Dict[str, Any] = {}  # normalized_title -> article (for curated only)
    unique_articles = []
    duplicates_removed = 0
    url_duplicates = 0
    title_duplicates = 0

    for article in articles:
        # Get URL
        url = None
        if hasattr(article, 'link'):
            url = article.link
        elif hasattr(article, 'evaluate') and isinstance(article.evaluate, dict):
            url = article.evaluate.get('link')

        if not url:
            logger.warning(f"Article missing URL, skipping: {getattr(article, 'title', 'N/A')}")
            continue

        # Get title
        title = getattr(article, 'title', '')
        if not title and hasattr(article, 'evaluate') and isinstance(article.evaluate, dict):
            title = article.evaluate.get('title', '')

        # Canonicalize URL
        canonical = canonicalize_url(url, canonical_fields)

        # Check for URL duplicate
        if canonical in seen_urls:
            existing_article = seen_urls[canonical]
            better_article = choose_better_article(existing_article, article)

            if better_article == article:
                # Replace existing article with better one
                seen_urls[canonical] = article
                # Update in unique_articles list
                for i, a in enumerate(unique_articles):
                    if a == existing_article:
                        unique_articles[i] = article
                        break
                logger.debug(
                    f"URL duplicate (replaced): {title} "
                    f"(tier: {getattr(article, 'tier', 'N/A')}, "
                    f"origin: {getattr(article, 'origin_type', 'N/A')})"
                )
            else:
                logger.debug(
                    f"URL duplicate (kept existing): {title} "
                    f"(existing tier: {getattr(existing_article, 'tier', 'N/A')})"
                )

            duplicates_removed += 1
            url_duplicates += 1
            continue

        # For curated sources, also check title similarity
        is_curated = getattr(article, 'origin_type', 'raw') == 'curated'
        if is_curated and title:
            normalized_title = normalize_title(title)

            # Check against all existing curated articles
            title_duplicate_found = False
            for existing_title, existing_article in list(seen_titles.items()):
                similarity = title_similarity(title, existing_article.title)

                if similarity >= title_similarity_threshold:
                    # Title duplicate found
                    better_article = choose_better_article(existing_article, article)

                    if better_article == article:
                        # Replace existing article
                        del seen_titles[existing_title]
                        seen_titles[normalized_title] = article
                        # Update URL mapping
                        existing_canonical = canonicalize_url(existing_article.link)
                        del seen_urls[existing_canonical]
                        seen_urls[canonical] = article
                        # Update in unique_articles list
                        for i, a in enumerate(unique_articles):
                            if a == existing_article:
                                unique_articles[i] = article
                                break
                        logger.debug(
                            f"Title duplicate (replaced, sim={similarity:.2f}): {title} "
                            f"(tier: {getattr(article, 'tier', 'N/A')})"
                        )
                    else:
                        logger.debug(
                            f"Title duplicate (kept existing, sim={similarity:.2f}): {title} "
                            f"(existing tier: {getattr(existing_article, 'tier', 'N/A')})"
                        )

                    duplicates_removed += 1
                    title_duplicates += 1
                    title_duplicate_found = True
                    break

            if title_duplicate_found:
                continue

            # Add to seen titles for curated sources
            seen_titles[normalized_title] = article

        # Add to seen URLs and unique list
        seen_urls[canonical] = article
        unique_articles.append(article)

    logger.info(
        f"Deduplication: {len(articles)} -> {len(unique_articles)} articles "
        f"({duplicates_removed} duplicates: {url_duplicates} URL, {title_duplicates} title)"
    )

    return unique_articles
