import os
import random
from datetime import datetime
from dateutil import tz
from loguru import logger

INSIGHT_FIELDS = [
    "why_it_matters",
    "key_evidence",
    "who_should_care",
    "next_action",
    "comparison",
]

INSIGHT_TEMPLATES = {
    "why_it_matters": "이 소식이 중요한 이유는 {value}",
    "key_evidence": "구체적 근거로 {value}",
    "who_should_care": "특히 {value}에게 직접적인 도움이 됩니다",
    "next_action": "이후에는 {value}",
    "comparison": "경쟁 대비 차별점은 {value}",
}


class Blog:
    metadata: str
    guide: str
    categories: list

    def __init__(self, metadata, guide, categories):
        self.metadata = metadata
        self.guide = guide
        self.categories = categories

    def make_blog(self):
        return self.metadata + self.guide + "\n".join(self.categories)


def make_daily_markdown_with(articles, rss_list):
    tags = []
    article_titles = []

    # Collect tags and titles from all articles (no category grouping)
    for article in articles:
        tags.extend(article.evaluate.get("tags", []))
        article_titles.append(article.evaluate["title"])

    # Generate single unified content without category sections
    articles_content = make_articles_content(articles)

    md_path, meta_data = make_meta_data(description="\n".join(article_titles), tags=tags)
    daily_guide = make_daily_guide(article_titles)
    if not articles_content:
        logger.error("articles content is empty!")
        return None, None
    blog = Blog(metadata=meta_data, guide=daily_guide, categories=[articles_content])
    logger.info(f"make blog success: {meta_data}")
    blog_content = blog.make_blog()
    with open(md_path, "w") as fp:
        fp.write(blog_content)
    logger.info(f"write to file: {md_path}")
    return md_path, blog_content


def make_meta_data(description, tags):

    time_zone = tz.gettz("Asia/Seoul")
    today_with_timezone = datetime.today().astimezone(time_zone)
    today_str = today_with_timezone.strftime("%Y-%m-%d")

    current_directory = os.path.dirname(os.path.abspath(__file__))
    # 获取当前项目的根目录
    project_root = os.path.dirname(current_directory)
    blog_folder = f"{project_root}/../src/content/blog"

    md_title = f"Daily News #{today_str}"
    # Expected "tag" to match "[^\/#\?]+?"
    def rectify_tag_value(value: str):
        res = value.replace('/', '_')
        return f'- "{res}"\n'

    # Handle empty tags - use empty array instead of null
    if tags and len(tags) > 0:
        tags_str = "".join([rectify_tag_value(tag) for tag in set(tags)])
        tags_field = f"tags: \n{tags_str}"
    else:
        tags_field = "tags: []"

    data = f"""---
title: "{md_title}"
date: "{today_with_timezone.strftime("%Y-%m-%d %H:%M:%S")}"
description: "{description}"
{tags_field}
---
"""

    path = f"{blog_folder}/dailyNews_{today_str}.md"
    return path, data


def make_articles_content(articles):
    """Generate unified article list without category headers"""
    if not articles:
        return ""
    content = ""
    for article in articles:
        cover = f"![]({article.cover_url})" if article.cover_url else ""

        # Determine link to display
        display_link = article.link
        exclude_threads = False
        if hasattr(article, 'config') and article.config:
            exclude_threads = article.config.get('exclude_threads_links', False)

        # Remove Threads links if configured
        if exclude_threads and display_link:
            if "threads.net" in display_link or "thread" in display_link.lower():
                display_link = ""

        # Title without link (링크 제거됨)
        title_line = f"### {article.evaluate['title']}"

        # Source line removed (출처 표시 제거됨)
        source_line = ""

        insight_lines = build_insight_lines(article)

        article_intro = f"""
{title_line}
{source_line}
발행시간: {article.date}
{cover}
{article.evaluate["summary"]}
{insight_lines}
"""
        content += article_intro
    return content


def make_daily_guide(titles):
    guide = "".join([f"> - {item}\n" for item in titles])
    return f"\n{guide}\n"


def build_insight_lines(article):
    if not hasattr(article, "evaluate") or not isinstance(article.evaluate, dict):
        return ""

    available = [
        (key, article.evaluate.get(key))
        for key in INSIGHT_FIELDS
        if article.evaluate.get(key)
    ]

    if not available:
        return ""

    sample_count = min(3, len(available))
    if sample_count == 0:
        return ""

    seed_value = f"{article.evaluate.get('title', '')}-{article.date}"
    rng = random.Random(seed_value)
    selected = rng.sample(available, sample_count)

    sentences = []
    for key, value in selected:
        template = INSIGHT_TEMPLATES.get(key, "{value}")
        sentence = template.format(value=value).strip()
        if not sentence.endswith("다.") and not sentence.endswith("다"):
            sentence = sentence.rstrip(".") + "."
        sentences.append(sentence)

    insight_text = "\n".join(sentences)
    return f"\n{insight_text}\n"
