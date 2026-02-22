"""
Article Scoring Module
Implements scoring formula: 0.35*impact + 0.25*novelty + 0.25*proof + 0.15*recency
"""

import math
from datetime import datetime, timezone
from typing import Dict, Any, List
from loguru import logger


def calculate_recency_score(article_date: datetime, half_life_hours: float = 36.0) -> float:
    """
    Calculate recency score with exponential decay + mandatory 24-hour penalty

    Args:
        article_date: Publication date of article
        half_life_hours: Hours until score drops to 50% (default: 36)

    Returns:
        Score from 0-5, where 5 is most recent
        Articles older than 24 hours receive mandatory -0.5 penalty
    """
    now = datetime.now(timezone.utc)

    # Ensure article_date is timezone-aware
    if article_date.tzinfo is None:
        article_date = article_date.replace(tzinfo=timezone.utc)

    hours_old = (now - article_date).total_seconds() / 3600.0

    # Exponential decay: score = 5 * (0.5 ^ (hours_old / half_life_hours))
    recency = 5.0 * math.pow(0.5, hours_old / half_life_hours)

    # Mandatory penalty for articles older than 24 hours
    if hours_old > 24.0:
        recency -= 0.5
        logger.debug(f"Applied 24+ hour penalty: {hours_old:.1f}h old, penalty=-0.5")

    return max(0.0, min(5.0, recency))


def apply_penalties(
    base_score: float,
    article_title: str,
    article_summary: str,
    penalties: List[Dict[str, Any]]
) -> float:
    """
    Apply penalty rules to base score

    Args:
        base_score: Initial calculated score
        article_title: Article title
        article_summary: Article summary
        penalties: List of penalty rules from config

    Returns:
        Adjusted score after penalties
    """
    adjusted_score = base_score
    combined_text = f"{article_title} {article_summary}".lower()

    for penalty_rule in penalties:
        keywords = penalty_rule.get("if_title_or_content_contains_any", [])
        subtract = penalty_rule.get("subtract", 0.0)

        for keyword in keywords:
            if keyword.lower() in combined_text:
                adjusted_score -= subtract
                logger.debug(f"Penalty applied: -{subtract} for keyword '{keyword}'")
                break  # Only apply penalty once per rule

    return max(0.0, adjusted_score)  # Don't go below 0


def calculate_score(
    evaluate: Dict[str, Any],
    article_date: datetime,
    config: Dict[str, Any]
) -> float:
    """
    Calculate final article score using weighted formula

    Formula: 0.35*impact + 0.25*novelty + 0.25*proof + 0.15*recency

    Args:
        evaluate: Article evaluation from GPT (contains impact, novelty, proof)
        article_date: Publication date for recency calculation
        config: Configuration dict from rss.json

    Returns:
        Final score (0-5 scale)
    """
    # Extract scores from evaluation
    impact = float(evaluate.get("impact", 0))
    novelty = float(evaluate.get("novelty", 0))
    proof = float(evaluate.get("proof", 0))

    # Get scoring config
    scoring_config = config.get("configuration", {}).get("selection", {}).get("scoring", {})
    recency_config = scoring_config.get("recency", {})
    half_life_hours = recency_config.get("half_life_hours", 36.0)

    # Calculate recency score
    recency = calculate_recency_score(article_date, half_life_hours)

    # Apply weighted formula (from rss.json)
    # Formula: 0.35*impact + 0.25*novelty + 0.25*proof + 0.15*recency
    base_score = (
        0.35 * impact +
        0.25 * novelty +
        0.25 * proof +
        0.15 * recency
    )

    # Apply penalties
    penalties = scoring_config.get("penalties", [])
    title = evaluate.get("title", "")
    summary = evaluate.get("summary", "")
    final_score = apply_penalties(base_score, title, summary, penalties)

    logger.debug(
        f"Score calculation: impact={impact}, novelty={novelty}, "
        f"proof={proof}, recency={recency:.2f} -> "
        f"base={base_score:.2f}, final={final_score:.2f}"
    )

    return final_score


def should_drop_article(evaluate: Dict[str, Any], config: Dict[str, Any]) -> bool:
    """
    Check if article should be dropped based on drop_if rules

    Args:
        evaluate: Article evaluation from GPT
        config: Configuration dict from rss.json

    Returns:
        True if article should be dropped, False otherwise
    """
    drop_config = config.get("configuration", {}).get("selection", {}).get("llm_tagging", {}).get("drop_if", {})

    # Check topic
    topic_blacklist = drop_config.get("topic_in", [])
    article_topic = evaluate.get("topic", "")
    if article_topic in topic_blacklist:
        logger.info(f"Dropping article (topic={article_topic} in blacklist): {evaluate.get('title', 'N/A')}")
        return True

    # Check impact threshold
    impact_threshold = drop_config.get("impact_lte", 0)
    article_impact = evaluate.get("impact", 0)
    if article_impact <= impact_threshold:
        logger.info(f"Dropping article (impact={article_impact} <= {impact_threshold}): {evaluate.get('title', 'N/A')}")
        return True

    # Check proof threshold
    proof_threshold = drop_config.get("proof_lte", 0)
    article_proof = evaluate.get("proof", 0)
    if article_proof <= proof_threshold:
        logger.info(f"Dropping article (proof={article_proof} <= {proof_threshold}): {evaluate.get('title', 'N/A')}")
        return True

    # Content quality check
    quality_reason = _fails_content_quality(evaluate, config)
    if quality_reason:
        logger.info(f"Dropping article ({quality_reason}): {evaluate.get('title', 'N/A')}")
        return True

    return False


def _fails_content_quality(evaluate: Dict[str, Any], config: Dict[str, Any]) -> str | None:
    """콘텐츠 품질 미달 시 drop 사유 반환, 통과 시 None"""
    quality_cfg = (
        config.get("configuration", {})
        .get("selection", {})
        .get("llm_tagging", {})
        .get("drop_if", {})
        .get("content_quality", {})
    )
    if not quality_cfg:
        return None

    # summary 길이 체크
    summary = evaluate.get("summary", "")
    min_chars = quality_cfg.get("summary_min_chars", 200)
    if len(summary) < min_chars:
        return f"summary too short ({len(summary)}<{min_chars} chars)"

    # insight 필드 충족 체크
    insight_fields = ["why_it_matters", "key_evidence", "who_should_care", "next_action", "comparison"]
    min_filled = quality_cfg.get("insight_min_filled", 2)
    min_each = quality_cfg.get("insight_min_chars_each", 15)
    filled = sum(1 for f in insight_fields if len((evaluate.get(f) or "").strip()) >= min_each)
    if filled < min_filled:
        return f"insufficient insights ({filled}<{min_filled})"

    return None
