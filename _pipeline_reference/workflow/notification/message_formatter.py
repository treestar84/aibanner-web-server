"""
Message Formatter for Kakao Talk
Converts article data into Kakao-compatible message templates
"""

from datetime import datetime
from typing import List, Dict, Any
from loguru import logger


class MessageFormatter:
    """Formats daily news content for Kakao Talk messages"""

    def __init__(self, max_articles: int = 5, max_summary_length: int = 150):
        """
        Initialize formatter

        Args:
            max_articles: Maximum number of articles to include in message
            max_summary_length: Maximum length of each summary
        """
        self.max_articles = max_articles
        self.max_summary_length = max_summary_length
        self.category_emojis = {
            "Prompt Tutorials": "🎨",
            "Raw Prompt Streams": "⚡",
            "AI Intel": "🧠",
            "AI News": "🤖",
            "AI Community": "💬",
            "Tech News": "📰",
            "Dev Tools": "🛠️",
        }

    def truncate_content(self, text: str, max_length: int = None) -> str:
        """Truncate text to specified length, breaking at sentence boundary"""
        if max_length is None:
            max_length = self.max_summary_length

        if len(text) <= max_length:
            return text

        truncated = text[:max_length]
        for char in ['. ', '! ', '? ', '.\n', '!\n', '?\n']:
            pos = truncated.rfind(char)
            if pos > 0:
                return truncated[:pos + 1] + "..."

        return truncated.rstrip() + "..."

    def format_daily_news(self, articles: List[Any], date: str, blog_url: str = None) -> Dict[str, Any]:
        """Create Kakao text template from article list"""
        try:
            date_obj = datetime.strptime(date, "%Y-%m-%d")
            formatted_date = date_obj.strftime("%Y년 %m월 %d일")
        except ValueError:
            formatted_date = date

        selected_articles = articles[:self.max_articles]
        total_count = len(articles)

        message_lines = [
            f"📰 Daily News #{date}",
            "",
            f"🗓️ {formatted_date}",
            f"📊 총 {total_count}개 기사",
            "",
            "== 주요 기사 ==",
            ""
        ]

        current_category = None
        for article in selected_articles:
            try:
                title = article.evaluate.get("title", "제목 없음")
                summary = article.evaluate.get("summary", "요약 없음")
                link = article.link
                category = article.config.get("category", "기타")
            except AttributeError:
                logger.warning(f"Skipping malformed article: {article}")
                continue

            if category != current_category:
                emoji = self.category_emojis.get(category, "📌")
                message_lines.append(f"{emoji} [{category}]")
                current_category = category

            short_summary = self.truncate_content(summary)

            message_lines.append(f"• {title}")
            message_lines.append(f"  → {short_summary}")
            message_lines.append(f"  🔗 {link}")
            message_lines.append("")

        message_lines.append("---")
        if blog_url:
            message_lines.append(f"전체 뉴스: {blog_url}")
        else:
            message_lines.append("전체 뉴스를 확인하세요!")

        message_text = "\n".join(message_lines)

        template = self.create_text_template(
            text=message_text,
            link_url=blog_url
        )

        logger.info(f"Created message template with {len(selected_articles)} articles")
        return template

    def format_from_summaries(self, summaries: List[Dict[str, str]], date: str, blog_url: str = None) -> Dict[str, Any]:
        """
        Create Kakao text template with titles only (no summaries)

        Args:
            summaries: List of dicts with 'title', 'summary', 'priority'
            date: Date string (YYYY-MM-DD)
            blog_url: Blog URL for "전체 보기" button

        Returns:
            Kakao template dict
        """
        try:
            date_obj = datetime.strptime(date, "%Y-%m-%d")
            formatted_date = date_obj.strftime("%Y년 %m월 %d일")
        except ValueError:
            formatted_date = date

        message_lines = [
            f"📰 AI Daily News",
            "",
            f"🗓️ {formatted_date}",
            f"📌 오늘의 주요 소식 {len(summaries)}개",
            "",
        ]

        # Sort by priority
        sorted_summaries = sorted(summaries, key=lambda x: x.get('priority', 99))

        # Show titles only
        for idx, item in enumerate(sorted_summaries, 1):
            title = item.get('title', '제목 없음')
            message_lines.append(f"{idx}. {title}")

        message_lines.append("")
        message_lines.append("─" * 30)
        if blog_url:
            message_lines.append(f"📖 전체 뉴스: {blog_url}")
        else:
            message_lines.append("📖 전체 뉴스를 확인하세요!")

        message_text = "\n".join(message_lines)

        template = self.create_text_template(
            text=message_text,
            link_url=blog_url
        )

        logger.info(f"Created title-only message with {len(summaries)} articles")
        return template

    def create_text_template(self, text: str, link_url: str = None) -> Dict[str, Any]:
        """Create Kakao text template object"""
        template = {
            "object_type": "text",
            "text": text
        }

        if link_url:
            template["link"] = {
                "web_url": link_url,
                "mobile_web_url": link_url
            }
            template["button_title"] = "전체 보기"

        return template
