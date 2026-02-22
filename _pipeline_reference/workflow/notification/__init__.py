"""
Kakao Talk Notification Module
Provides simple entry point for sending daily news notifications
"""

import os
from loguru import logger
from typing import List, Any

from .kakao_client import KakaoClient, KakaoAPIError
from .message_formatter import MessageFormatter
from .token_manager import TokenRefreshError
from .md_summarizer import MDSummarizer


def send_daily_notification(md_path: str, articles: List[Any]) -> bool:
    """
    Send daily news notification to Kakao Talk

    Args:
        md_path: Path to generated markdown file
        articles: List of article objects

    Returns:
        True if notification sent successfully, False otherwise
    """
    # Check if notification is enabled
    enabled = os.environ.get("KAKAO_NOTIFICATION_ENABLED", "false").lower()
    if enabled != "true":
        logger.info("Kakao notification disabled (KAKAO_NOTIFICATION_ENABLED != true)")
        return False

    # Get credentials from environment
    rest_api_key = os.environ.get("KAKAO_REST_API_KEY")
    refresh_token = os.environ.get("KAKAO_REFRESH_TOKEN")
    client_secret = os.environ.get("KAKAO_CLIENT_SECRET")  # Optional

    # Validate credentials (ACCESS_TOKEN is not required - will be refreshed)
    if not all([rest_api_key, refresh_token]):
        logger.error("Missing Kakao credentials in environment variables")
        logger.error(f"REST_API_KEY: {'✓' if rest_api_key else '✗'}")
        logger.error(f"REFRESH_TOKEN: {'✓' if refresh_token else '✗'}")
        return False

    try:
        # Extract date from markdown path (e.g., dailyNews_2025-12-14.md)
        date_str = md_path.split("dailyNews_")[1].split(".md")[0]

        # Get blog URL from environment or construct default
        site_url = os.environ.get("SITE_URL", "https://daily.sown.news")
        blog_url = f"{site_url}/blog/dailyNews_{date_str}"

        # Initialize formatter and summarizer
        formatter = MessageFormatter(max_articles=5, max_summary_length=150)
        summarizer = MDSummarizer()

        # Always refresh access token before sending (24-hour schedule, 6-hour token validity)
        logger.info("Refreshing access token for 24-hour scheduled notification...")
        try:
            from .token_manager import TokenManager
            tm = TokenManager()
            access_token = tm.refresh_access_token(rest_api_key, refresh_token, client_secret)
            logger.info("✅ Access token refreshed successfully")
        except TokenRefreshError as e:
            logger.error(f"❌ Failed to refresh access token: {e}")
            return False

        # Initialize client with fresh access token
        client = KakaoClient(rest_api_key, access_token, refresh_token, client_secret)

        # Summarize MD file with GPT for Kakao message
        logger.info(f"Summarizing {md_path} with GPT for Kakao message...")
        gpt_summaries = summarizer.summarize_md_file(md_path, articles)

        # Create message template
        if gpt_summaries and len(gpt_summaries) > 0:
            # Use GPT-generated summaries (preferred)
            logger.info(f"Using GPT summaries ({len(gpt_summaries)} articles)")
            template = formatter.format_from_summaries(
                summaries=gpt_summaries,
                date=date_str,
                blog_url=blog_url
            )
        else:
            # Fallback to original method if GPT fails
            logger.warning("GPT summarization failed, falling back to truncated summaries")
            template = formatter.format_daily_news(
                articles=articles,
                date=date_str,
                blog_url=blog_url
            )

        # Send notification
        logger.info(f"Sending notification for {len(articles)} articles")
        result = client.send_to_me(template)

        logger.info(f"✅ Kakao notification sent successfully: {result}")
        return True

    except (KakaoAPIError, TokenRefreshError) as e:
        logger.error(f"❌ Kakao notification failed: {e}")
        return False

    except Exception as e:
        logger.error(f"❌ Unexpected error sending notification: {e}")
        logger.exception(e)
        return False


# Export main function
__all__ = ['send_daily_notification']
