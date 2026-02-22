"""
Diversity Quota Module
Enforces minimum and maximum quotas per topic category
"""

from typing import List, Dict, Any
from collections import defaultdict
from loguru import logger


def enforce_diversity_quotas(
    articles: List[Any],
    config: Dict[str, Any],
    target_count: int = 12
) -> List[Any]:
    """
    Enforce diversity quotas while selecting top articles

    Strategy:
    1. First pass: Ensure minimum quotas for each topic
    2. Second pass: Fill remaining slots with top-scored articles
    3. Third pass: Enforce maximum quotas

    Args:
        articles: List of articles with evaluate metadata (sorted by score DESC)
        config: Configuration dict from rss.json
        target_count: Target number of articles (default: 12)

    Returns:
        List of selected articles respecting diversity quotas
    """
    diversity_config = config.get("configuration", {}).get("selection", {}).get("diversity_quotas", {})
    min_quotas = diversity_config.get("min", {})
    max_quotas = diversity_config.get("max", {})

    # Group articles by topic
    articles_by_topic = defaultdict(list)
    for article in articles:
        topic = article.evaluate.get("topic", "Other")
        articles_by_topic[topic].append(article)

    selected = []
    topic_counts = defaultdict(int)

    # Phase 1: Ensure minimum quotas
    logger.info("Phase 1: Enforcing minimum quotas")
    for topic, min_count in min_quotas.items():
        available = articles_by_topic.get(topic, [])

        # Sort by score within topic
        available_sorted = sorted(available, key=lambda x: x.evaluate.get("score", 0), reverse=True)

        # Take top N to meet minimum quota
        to_select = min(min_count, len(available_sorted))
        for i in range(to_select):
            if available_sorted[i] not in selected:
                selected.append(available_sorted[i])
                topic_counts[topic] += 1

        logger.info(f"  {topic}: selected {to_select}/{min_count} (min quota)")

    # Phase 2: Fill remaining slots with highest-scored articles
    logger.info(f"Phase 2: Filling remaining slots (current: {len(selected)}/{target_count})")
    remaining_slots = target_count - len(selected)

    # Get all unselected articles, sorted by score
    unselected = [a for a in articles if a not in selected]

    for article in unselected:
        if remaining_slots <= 0:
            break

        topic = article.evaluate.get("topic", "Other")

        # Check if topic has reached maximum quota
        max_quota = max_quotas.get(topic, float('inf'))
        if topic_counts[topic] >= max_quota:
            logger.debug(f"  Skipping {topic} article (max quota {max_quota} reached)")
            continue

        selected.append(article)
        topic_counts[topic] += 1
        remaining_slots -= 1

    # Phase 3: Verify and log final distribution
    logger.info(f"Final selection: {len(selected)} articles")
    logger.info("Topic distribution:")
    for topic, count in sorted(topic_counts.items(), key=lambda x: -x[1]):
        min_q = min_quotas.get(topic, 0)
        max_q = max_quotas.get(topic, "∞")
        logger.info(f"  {topic}: {count} (min: {min_q}, max: {max_q})")

    return selected
