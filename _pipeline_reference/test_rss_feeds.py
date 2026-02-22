"""
RSS Feed Health Check
Tests all feeds in rss.json to verify they are working
"""

import json
import feedparser
import requests
from datetime import datetime
from loguru import logger

# Configure logger
logger.remove()
logger.add(lambda msg: print(msg, end=''), format="{message}")


def test_feed(feed_item, category_name):
    """Test a single RSS feed"""
    title = feed_item.get('title', 'Unknown')
    url = feed_item.get('url', '')
    feed_type = feed_item.get('type', 'rss')
    tier = feed_item.get('tier', 'N/A')

    result = {
        'category': category_name,
        'title': title,
        'url': url,
        'type': feed_type,
        'tier': tier,
        'status': 'UNKNOWN',
        'item_count': 0,
        'error': None,
        'latest_item': None
    }

    try:
        # Parse feed with user agent
        feed = feedparser.parse(
            url,
            agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )

        # Check for parsing errors
        if feed.bozo and feed.bozo_exception:
            result['status'] = 'ERROR'
            result['error'] = str(feed.bozo_exception)
            return result

        # Check if we got any entries
        entries = feed.entries if hasattr(feed, 'entries') else []
        result['item_count'] = len(entries)

        if len(entries) == 0:
            result['status'] = 'EMPTY'
            result['error'] = 'No entries found in feed'
        else:
            result['status'] = 'OK'
            # Get latest item info
            latest = entries[0]
            result['latest_item'] = {
                'title': latest.get('title', 'N/A'),
                'link': latest.get('link', 'N/A'),
                'published': latest.get('published', latest.get('updated', 'N/A'))
            }

    except requests.exceptions.RequestException as e:
        result['status'] = 'NETWORK_ERROR'
        result['error'] = str(e)
    except Exception as e:
        result['status'] = 'ERROR'
        result['error'] = str(e)

    return result


def main():
    # Load RSS config
    config_path = 'workflow/resources/rss.json'

    logger.info("=" * 80)
    logger.info("RSS Feed Health Check")
    logger.info("=" * 80)
    logger.info("")

    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)

    categories = config.get('categories', [])

    all_results = []
    total_feeds = 0
    working_feeds = 0
    failed_feeds = 0
    empty_feeds = 0

    # Test each category
    for category in categories:
        category_name = category.get('category', 'Unknown')
        priority = category.get('priority', 'N/A')
        items = category.get('items', [])

        logger.info(f"\n📂 {category_name} (Priority: {priority})")
        logger.info("-" * 80)

        for feed_item in items:
            total_feeds += 1
            result = test_feed(feed_item, category_name)
            all_results.append(result)

            # Status icon
            status_icon = {
                'OK': '✅',
                'EMPTY': '⚠️',
                'ERROR': '❌',
                'NETWORK_ERROR': '🔴',
                'UNKNOWN': '❓'
            }.get(result['status'], '❓')

            # Count status
            if result['status'] == 'OK':
                working_feeds += 1
            elif result['status'] == 'EMPTY':
                empty_feeds += 1
            else:
                failed_feeds += 1

            # Print result
            logger.info(f"{status_icon} [{result['tier']}] {result['title']}")
            logger.info(f"   URL: {result['url']}")
            logger.info(f"   Status: {result['status']} | Items: {result['item_count']}")

            if result['error']:
                logger.info(f"   Error: {result['error'][:100]}")

            if result['latest_item']:
                latest = result['latest_item']
                logger.info(f"   Latest: {latest['title'][:60]}...")
                logger.info(f"   Published: {latest['published']}")

            logger.info("")

    # Summary
    logger.info("\n" + "=" * 80)
    logger.info("SUMMARY")
    logger.info("=" * 80)
    logger.info(f"Total feeds tested: {total_feeds}")
    logger.info(f"✅ Working feeds: {working_feeds} ({working_feeds/total_feeds*100:.1f}%)")
    logger.info(f"⚠️  Empty feeds: {empty_feeds} ({empty_feeds/total_feeds*100:.1f}%)")
    logger.info(f"❌ Failed feeds: {failed_feeds} ({failed_feeds/total_feeds*100:.1f}%)")
    logger.info("")

    # List failed/empty feeds
    if failed_feeds > 0 or empty_feeds > 0:
        logger.info("\n⚠️  FEEDS TO REVIEW:")
        logger.info("-" * 80)
        for result in all_results:
            if result['status'] in ['ERROR', 'NETWORK_ERROR', 'EMPTY']:
                logger.info(f"• [{result['status']}] {result['title']}")
                logger.info(f"  Category: {result['category']}")
                logger.info(f"  URL: {result['url']}")
                if result['error']:
                    logger.info(f"  Error: {result['error'][:100]}")
                logger.info("")

    # Export results to JSON
    output_file = 'feed_health_check_results.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)

    logger.info(f"✅ Detailed results saved to: {output_file}")


if __name__ == '__main__':
    main()
