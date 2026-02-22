import os, json, datetime, glob
from collections import defaultdict

from workflow.article.rss import Article
from workflow.gpt.summary import evaluate_article_with_gpt
import workflow.article.rss as rss
import workflow.article.blog as blog
import time

from loguru import logger

# New selection modules
from workflow.selection.scorer import calculate_score, should_drop_article
from workflow.selection.diversity import enforce_diversity_quotas
from workflow.selection.dedup import deduplicate_articles

# Global metrics tracking
FEED_METRICS = {}

# GENEXIS MD Generator - DISABLED
GENEXIS_ENABLED = False


def _article_config(article):
    config = getattr(article, "config", None)
    return config if isinstance(config, dict) else {}


def _article_feed_title(article):
    config = _article_config(article)
    if config.get("title"):
        return config["title"]
    if isinstance(article.info, dict):
        return article.info.get("title", "Unknown")
    return "Unknown"


def _article_tier(article, default="P2_RAW"):
    config = _article_config(article)
    if config.get("tier"):
        return config["tier"]
    if isinstance(article.info, dict):
        tier = article.info.get("tier")
        if tier:
            return tier
    return default


def initialize_all_feed_metrics(rss_resource):
    """Initialize FEED_METRICS with all feeds from rss.json"""
    global FEED_METRICS

    # Load all RSS configurations
    rss_items = rss.load_rss_configs(rss_resource)

    # Initialize metrics for all feeds
    for item in rss_items:
        feed_title = item.get("title", "Unknown")
        if feed_title not in FEED_METRICS:
            FEED_METRICS[feed_title] = {
                "title": feed_title,
                "tier": item.get("tier", ""),
                "priority": item.get("priority", ""),
                "find_count": 0,
                "candidate_count": 0,
                "release_count": 0,
                "release_scores": [],
                "rank_list": []
            }

    logger.info(f"✅ Initialized metrics for {len(FEED_METRICS)} feeds from rss.json")


def save_metrics():
    """Save feed metrics to JSON file for Astro site"""
    global FEED_METRICS

    # Calculate average scores
    metrics_list = []
    for feed_title, metrics in FEED_METRICS.items():
        # Calculate average release score
        if metrics["release_scores"]:
            avg_score = sum(metrics["release_scores"]) / len(metrics["release_scores"])
        else:
            avg_score = 0.0

        metrics_list.append({
            "title": metrics["title"],
            "tier": metrics["tier"],
            "priority": metrics["priority"],
            "find_count": metrics["find_count"],
            "candidate_count": metrics["candidate_count"],
            "release_count": metrics["release_count"],
            "release_score": round(avg_score, 2),
            "rank_list": metrics["rank_list"]
        })

    # Sort by tier priority, then by release_count
    tier_order = {"P0_CURATED": 0, "P0_RELEASES": 1, "P1_CONTEXT": 2, "P2_RAW": 3, "COMMUNITY": 4}
    metrics_list.sort(key=lambda x: (tier_order.get(x["tier"], 999), -x["release_count"]))

    # Save to src/data/metrics.json
    metrics_path = "src/data/metrics.json"
    os.makedirs(os.path.dirname(metrics_path), exist_ok=True)

    metrics_data = {
        "generated_at": datetime.datetime.now().isoformat(),
        "feeds": metrics_list
    }

    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(metrics_data, f, indent=2, ensure_ascii=False)

    logger.info(f"✅ Metrics saved to {metrics_path}")


def execute(rss_resource="workflow/resources"):
    # Reset metrics for new execution
    global FEED_METRICS
    FEED_METRICS = {}

    # Initialize FEED_METRICS with all feeds from rss.json
    initialize_all_feed_metrics(rss_resource)

    # 缓存判断
    cache_folder, cache_file = find_valid_file()
    origin_article_list = parse_daily_rss_article(rss_resource, cache_file)
    if cache_folder:
        save_article(origin_article_list, cache_folder)
    articles = find_favorite_article(origin_article_list)

    # Generate Daily Report (existing functionality)
    md_path, blog_content = blog.make_daily_markdown_with(articles, origin_article_list)

    # Save metrics to JSON file
    save_metrics()

    # Send Kakao Talk notification (if enabled)
    if os.environ.get("KAKAO_NOTIFICATION_ENABLED") == "true" and md_path:
        try:
            from workflow.notification import send_daily_notification
            send_daily_notification(md_path, articles)
            logger.info("✅ Kakao notification sent successfully")
        except Exception as e:
            logger.error(f"❌ Kakao notification failed: {e}")
            # Don't fail entire pipeline

    # GENEXIS MD generation - DISABLED (individual article files not needed)


def parse_daily_rss_article(rss_resource, cache_file=None):
    """获取rss信息"""
    global FEED_METRICS

    if cache_file:
        return decode_article(cache_file)
    rss_items = rss.load_rss_configs(rss_resource)

    telegram_prefix = "https://t.me/"

    daily_rss = []
    for item in rss_items:
        feed_title = item.get("title", "Unknown")
        rss_list = rss.parse_rss_config(item)

        # Update find_count for this feed (already initialized in initialize_all_feed_metrics)
        if feed_title in FEED_METRICS:
            FEED_METRICS[feed_title]["find_count"] = len(rss_list)

        for rss_item in rss_list:
            daily_rss.append(rss_item)
            if rss_item.link.startswith(telegram_prefix):
                rss_item = rss.transform_telegram_article(rss_item)
            logger.info(f"date: {rss_item.date}, link: {rss_item.link}")
    return daily_rss


def stratified_sample_with_priority(rss_articles, config, max_total=100):
    """
    Sample articles using stratified sampling based on tier + priority

    Allocation strategy (tier implies priority):
    - P0_CURATED (critical): 30 articles
    - P0_RELEASES (critical): 12 articles
    - P1_CONTEXT (high): 20 articles
    - P2_RAW (medium): 20 articles
    - COMMUNITY (low): 18 articles
    Total: 100 articles

    If a tier has fewer articles than allocated, redistribute quota to other tiers.
    """
    import random
    global FEED_METRICS

    # Tier-based allocation (tier implies priority level)
    tier_allocation = {
        "P0_CURATED": 30,
        "P0_RELEASES": 12,
        "P1_CONTEXT": 20,
        "P2_RAW": 20,
        "COMMUNITY": 18,
    }

    # Group articles by tier
    tier_groups = {}
    for article in rss_articles:
        tier = _article_tier(article)
        if tier not in tier_groups:
            tier_groups[tier] = []
        tier_groups[tier].append(article)

    # Sample from each tier
    sampled = []
    remaining_quota = 0

    for tier, target_count in tier_allocation.items():
        tier_articles = tier_groups.get(tier, [])

        if len(tier_articles) >= target_count:
            # Enough articles: random sample
            selected = random.sample(tier_articles, target_count)
            sampled.extend(selected)
        else:
            # Not enough: take all and track deficit
            sampled.extend(tier_articles)
            remaining_quota += (target_count - len(tier_articles))

    # Fill remaining quota from all tiers proportionally
    if remaining_quota > 0:
        all_remaining = [a for a in rss_articles if a not in sampled]
        if len(all_remaining) > 0:
            additional = min(remaining_quota, len(all_remaining))
            sampled.extend(random.sample(all_remaining, additional))

    # Track candidate_count for each feed
    for article in sampled:
        feed_title = _article_feed_title(article)
        if feed_title in FEED_METRICS:
            FEED_METRICS[feed_title]["candidate_count"] += 1

    # Log distribution
    logger.info(f"📊 Stratified sampling: {len(rss_articles)} → {len(sampled)} articles")
    for tier in sorted(set(_article_tier(a) for a in sampled)):
        count = sum(1 for a in sampled if _article_tier(a) == tier)
        logger.info(f"  {tier}: {count} articles")

    return sampled


def find_favorite_article(rss_articles):
    """
    Global article selection with new scoring, diversity quotas, and deduplication

    New approach (with stratified sampling):
    1. Load configuration from rss.json
    2. Stratified sampling to ensure tier representation (100 articles)
    3. Evaluate ALL sampled articles globally (not per-category)
    4. Apply new scoring formula: 0.35*impact + 0.25*novelty + 0.25*proof + 0.15*recency
    5. Filter articles with drop_reason
    6. Deduplicate by URL
    7. Sort by score globally
    8. Apply diversity quotas (min/max per topic)
    9. Select top 12
    """
    # Load configuration
    config_path = "workflow/resources/rss.json"
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)

    # Get target count from config or env
    target_article_nums = config.get("configuration", {}).get("daily_target", 12)
    if os.environ.get("MAX_ARTICLE_NUMS"):
        target_article_nums = int(os.environ.get("MAX_ARTICLE_NUMS"))

    # Apply stratified sampling to ensure tier representation
    max_analyze_nums = 100
    rss_articles = stratified_sample_with_priority(rss_articles, config, max_analyze_nums)

    # Group articles by RSS source (for batch evaluation)
    rss_resource = {}
    for article in rss_articles:
        if not article.summary:
            continue
        rss_category = _article_feed_title(article)
        if rss_category in rss_resource.keys():
            rss_resource[rss_category].append(article)
        else:
            rss_resource[rss_category] = [article]

    # Evaluate ALL articles globally
    all_evaluated_articles = []
    for key, articles in rss_resource.items():
        # Prevent API rate limiting
        time.sleep(2)

        # Get GPT evaluation with new schema
        evaluate_results = evaluate_article_with_gpt(articles)

        # Attach evaluation to articles
        for evaluate in evaluate_results:
            for article in articles:
                if article.link == evaluate.get("link"):
                    article.evaluate = evaluate

                    # Calculate new score with formula
                    if hasattr(article, 'date') and article.date:
                        # Convert string date to datetime if needed
                        from datetime import datetime
                        from dateutil import tz
                        if isinstance(article.date, str):
                            try:
                                article_dt = datetime.strptime(article.date, "%Y-%m-%d %H:%M:%S")
                                article_dt = article_dt.replace(tzinfo=tz.gettz("Asia/Seoul"))
                            except:
                                article_dt = datetime.now(tz.gettz("Asia/Seoul"))
                        else:
                            article_dt = article.date

                        score = calculate_score(evaluate, article_dt, config)
                        article.evaluate["score"] = score

        # Filter articles with valid evaluations
        valid_articles = [item for item in articles if item.evaluate]
        all_evaluated_articles.extend(valid_articles)

    # Stage 1: origin_type 집계
    raw_count = sum(1 for a in all_evaluated_articles if a.origin_type == "raw")
    curated_count = sum(1 for a in all_evaluated_articles if a.origin_type == "curated")
    logger.info(f"Total evaluated articles: {len(all_evaluated_articles)} (raw: {raw_count}, curated: {curated_count})")

    # Filter: Drop articles based on drop_if rules
    filtered_articles = [
        article for article in all_evaluated_articles
        if not should_drop_article(article.evaluate, config)
    ]
    logger.info(f"After filtering (drop_if rules): {len(filtered_articles)} articles")

    # Deduplicate by URL
    unique_articles = deduplicate_articles(filtered_articles, config)

    # Sort by score globally (DESC)
    unique_articles.sort(key=lambda x: x.evaluate.get("score", 0), reverse=True)

    # Apply diversity quotas and select top N
    selected_articles = enforce_diversity_quotas(unique_articles, config, target_article_nums)

    # Track final selection metrics
    global FEED_METRICS
    for idx, article in enumerate(selected_articles, 1):
        feed_title = _article_feed_title(article)
        if feed_title in FEED_METRICS:
            FEED_METRICS[feed_title]["release_count"] += 1
            score = article.evaluate.get("score", 0) if article.evaluate else 0
            FEED_METRICS[feed_title]["release_scores"].append(score)
            FEED_METRICS[feed_title]["rank_list"].append(idx)

    # Stage 1: 최종 선택 origin 분포
    final_raw = sum(1 for a in selected_articles if a.origin_type == "raw")
    final_curated = sum(1 for a in selected_articles if a.origin_type == "curated")
    logger.info(f"Final selection: {len(selected_articles)} articles (raw: {final_raw}, curated: {final_curated})")
    return selected_articles


def find_valid_file():
    """是否为有效rss缓存"""
    if os.environ.get("RSS_CACHE_ENABLE") != "true":
        return None, None

    current_directory = os.path.dirname(os.path.abspath(__file__))

    cache_folder = f"{current_directory}/draft"
    today_str = datetime.date.today().strftime('%Y-%m-%d')
    cache_files = glob.glob(f"{cache_folder}/*{today_str}.json")
    cache_file = cache_files[-1] if cache_files else None
    return cache_folder, cache_file


def save_article(articles, draft_folder):
    """存储解析的文章"""
    data = []
    path = f"{draft_folder}/article_cache_{datetime.date.today().strftime('%Y-%m-%d')}.json"
    for article in articles:
        data.append(article.__dict__)

    with open(path, "w") as fp:
        fp.write(json.dumps(data, indent=4))


def decode_article(path):
    """根据文件解析"""
    rss_list = []
    with open(path, "r") as fp:
        object_list = json.loads(fp.read())
        for item in object_list:
            rss_item = rss.Article()
            for key, value in item.items():
                setattr(rss_item, key, value)
            rss_list.append(rss_item)
    return rss_list
