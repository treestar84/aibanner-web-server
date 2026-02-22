import feedparser
import html2text
import os, json, re
from datetime import datetime, timedelta
from dateutil import tz
import dateparser
import requests
from bs4 import BeautifulSoup
from loguru import logger
from urllib.parse import urljoin
from markdown import markdown

# 统一时区
time_zone_value = "Asia/Seoul"
FOCUS_THRESHOLD = 0  # 테스트용: 모든 기사 선택
BASE_DIR = os.path.dirname(__file__)
FOCUS_FILE = os.path.join(BASE_DIR, "..", "myfocus.md")
NOFOCUS_FILE = os.path.join(BASE_DIR, "..", "mynofocus.md")
DEFAULT_IMAGE_ENABLE = True
IMAGE_EXCLUDE_KEYWORDS = ["sprite", "spacer", "pixel", "logo", "icon", "avatar", "transparent"]
VALID_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp")
REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}
REQUEST_TIMEOUT = 10


def _load_keywords(path):
    try:
        with open(path, "r") as fp:
            words = []
            for line in fp:
                data = line.strip().lower()
                if not data or data.startswith("#"):
                    continue
                words.append(data)
            return words
    except FileNotFoundError:
        return []


MY_FOCUS = _load_keywords(FOCUS_FILE)
MY_NO_FOCUS = _load_keywords(NOFOCUS_FILE)


class Article:
    title: str
    summary: str
    link: str
    cover_url: str  # 封面链接
    date: str
    info: dict
    # rss 配置信息
    config: dict
    evaluate: dict = None  # 来源于ai生成
    # Stage 1: Curated RSS 메타데이터
    origin_type: str = "raw"  # raw|curated
    tier: str = None  # P0_CURATED, P0_RELEASES, P1_CONTEXT, P2_RAW, COMMUNITY

    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)
        if not hasattr(self, "score"):
            self.score = 0
        if not hasattr(self, "origin_type"):
            self.origin_type = "raw"  # 기본값: raw

    @staticmethod
    def make_with_dict(obj_dict):
        rss = Article()
        for key, value in obj_dict.items():
            setattr(rss, key, value)
        return rss


def load_rss_configs(resource):
    rss_configs = {}
    rss_categories = []
    rss_items = []

    def load_config_with(path):
        with open(path, "r") as fp:
            data = json.loads(fp.read())
            rss_categories.extend(data["categories"])
            rss_configs.update(data["configuration"])

    if os.path.isdir(resource):
        for file in os.listdir(resource):
            if file.endswith("json"):
                load_config_with(os.path.join(resource, file))
    else:
        load_config_with(resource)

    for rss_category in rss_categories:
        for rss in rss_category["items"]:
            rss["category"] = rss_category.get("category", "Daily News")
            # Propagate priority from category to item
            if "priority" not in rss and "priority" in rss_category:
                rss["priority"] = rss_category["priority"]
            if "rsshub_path" in rss:
                rss["url"] = rss_configs["rsshub_domain"] + rss["rsshub_path"]
            rss_items.append(rss)

    return rss_items


def is_article_recent(article_date: datetime, hours_limit: float = 36.0) -> bool:
    """
    Check if article is within the recent hours limit (36 hours by default)

    Args:
        article_date: Article publication datetime (timezone-aware)
        hours_limit: Maximum age in hours (default: 36)

    Returns:
        True if article is within hours_limit, False otherwise
    """
    if not article_date:
        # If no date, assume it's recent
        return True

    time_zone = tz.gettz(time_zone_value)
    now = datetime.now(time_zone)

    # Ensure article_date is timezone-aware
    if article_date.tzinfo is None:
        article_date = article_date.replace(tzinfo=time_zone)

    hours_old = (now - article_date).total_seconds() / 3600.0

    is_recent = hours_old <= hours_limit
    if not is_recent:
        logger.debug(f"Article filtered: {hours_old:.1f} hours old (limit: {hours_limit}h)")

    return is_recent


def compute_focus_score(article):
    text_parts = [
        article.title or "",
        article.summary or "",
        article.config.get("category", "") if article.config else "",
    ]
    if article.info and isinstance(article.info, dict):
        text_parts.append(article.info.get("title", ""))
    text = " ".join(text_parts).lower()
    score = 0
    for kw in MY_FOCUS:
        if kw in text:
            score += 2
    for kw in MY_NO_FOCUS:
        if kw in text:
            score -= 2
    return score


def select_top_articles(candidates, limit):
    if not candidates:
        return []
    sorted_candidates = sorted(
        candidates,
        key=lambda art: (art.score, art.date or "", art.title or ""),
        reverse=True,
    )
    selected = [sorted_candidates[0]]
    if limit <= 1:
        return selected
    for article in sorted_candidates[1:]:
        if len(selected) >= limit:
            break
        if article.score >= FOCUS_THRESHOLD:
            selected.append(article)
    return selected


def parse_github_md_folder_rss(rss_config):
    """
    Parse github_md_folder type RSS config

    GENEXIS-AI처럼 한 MD 파일에 여러 뉴스가 있는 경우,
    각 뉴스를 개별 Article로 생성하여 반환

    Args:
        rss_config: RSS configuration dict with type="github_md_folder"

    Returns:
        List of Article objects (one per news section)
    """
    # Parse URL
    url = rss_config["url"]
    try:
        owner, repo, folder_path, ref = _parse_github_md_folder_url(url)
    except Exception as e:
        logger.error(f"Failed to parse github_md_folder URL {url}: {e}")
        return []

    # Fetch MD file content
    md_content, _ = parse_github_md_folder(owner, repo, folder_path, ref)
    if not md_content:
        logger.warning(f"No content fetched from {url}")
        return []

    # Parse into sections
    sections = parse_genexis_md_sections(md_content)
    if not sections:
        logger.warning(f"No sections parsed from {url}")
        return []

    # Convert each section to Article object
    articles = []
    time_zone = tz.gettz(time_zone_value)
    now = datetime.now(time_zone)
    current_date = now.strftime("%Y-%m-%d %H:%M:%S")

    for section in sections:
        # Create Article from section (keep original link for GPT processing)
        article = Article(
            title=section['title'],
            summary=section['full_summary'],
            link=section['link'],  # Keep original link
            cover_url=section.get('image_url', ""),
            date=current_date,
            info={"title": rss_config.get("title", "GENEXIS-AI DailyNews")},
            config=rss_config,
            origin_type="curated",  # github_md_folder는 curated로 분류
            tier=rss_config.get("tier")
        )

        # Store importance score for later use
        article.genexis_importance = section['importance']

        # Compute focus score
        article.score = compute_focus_score(article)

        articles.append(article)

    logger.info(f"Created {len(articles)} articles from GENEXIS MD file")

    # Apply selection
    max_output = rss_config.get("output_count", len(articles))
    selected = select_top_articles(articles, max_output)

    logger.info(f"Selected {len(selected)} / {len(articles)} articles from {rss_config.get('title', 'GENEXIS')}")
    return selected


def parse_ainews_daily_json_rss(rss_config):
    """
    Parse github_json type RSS config (ai-news-daily)

    ai-news-daily는 날짜별 JSON 파일로 AI 뉴스 제공:
    - 3000+ articles per day
    - Already AI-curated and categorized
    - Confidence scores included

    Args:
        rss_config: RSS configuration dict with type="github_json"

    Returns:
        List of Article objects from JSON data
    """
    # Parse URL
    url = rss_config["url"]
    try:
        owner, repo, date_str = _parse_github_json_url(url)
    except Exception as e:
        logger.error(f"Failed to parse github_json URL {url}: {e}")
        return []

    # Fetch JSON articles
    json_articles = parse_ainews_daily_json(owner, repo, date_str)
    if not json_articles:
        logger.warning(f"No articles fetched from {url}")
        return []

    # Convert JSON articles to Article objects
    articles = []
    time_zone = tz.gettz(time_zone_value)
    now = datetime.now(time_zone)
    current_date = now.strftime("%Y-%m-%d %H:%M:%S")

    # Respect input_count limit
    max_input = rss_config.get("input_count", len(json_articles))
    limited_articles = json_articles[:max_input]

    for json_article in limited_articles:
        # Extract fields from JSON
        title = json_article.get("title", "")
        url_link = json_article.get("url", "")
        summary = json_article.get("summary", "")
        category = json_article.get("category", "")
        confidence = json_article.get("confidence", 0)
        source = json_article.get("source", "")

        # Skip if missing required fields
        if not title or not url_link:
            continue

        # Build enhanced summary with metadata
        enhanced_summary = summary
        if category:
            enhanced_summary += f"\n\nCategory: {category}"
        if source:
            enhanced_summary += f"\nSource: {source}"
        if confidence:
            enhanced_summary += f"\nConfidence: {confidence:.2f}"

        # Create Article object
        article = Article(
            title=title,
            summary=enhanced_summary,
            link=url_link,
            cover_url="",
            date=current_date,
            info={"title": rss_config.get("title", "ai-news-daily")},
            config=rss_config,
            origin_type="curated",  # github_json은 curated로 분류
            tier=rss_config.get("tier")
        )

        # Store ai-news-daily metadata
        article.ainews_category = category
        article.ainews_confidence = confidence
        article.ainews_source = source

        # Compute focus score
        article.score = compute_focus_score(article)

        articles.append(article)

    logger.info(f"Created {len(articles)} articles from ai-news-daily JSON")

    # Apply selection
    max_output = rss_config.get("output_count", len(articles))
    selected = select_top_articles(articles, max_output)

    logger.info(f"Selected {len(selected)} / {len(articles)} articles from {rss_config.get('title', 'ai-news-daily')}")
    return selected


def _parse_github_json_url(url: str) -> tuple:
    """
    Parse github_json URL format

    Format: github-json://owner/repo@date
    Example: github-json://ai-news-daily/ai-news-daily.github.io@2025-12-25
            github-json://ai-news-daily/ai-news-daily.github.io (use today)

    Returns:
        (owner, repo, date_str) - date_str is None if not specified
    """
    if not url.startswith("github-json://"):
        raise ValueError(f"Invalid github_json URL: {url}")

    url = url[len("github-json://"):]  # Remove protocol

    # Split @date if present
    if "@" in url:
        path_part, date_str = url.rsplit("@", 1)
    else:
        path_part = url
        date_str = None  # Use today's date

    # Split owner/repo
    parts = path_part.split("/", 1)
    if len(parts) < 2:
        raise ValueError(f"Invalid URL format (expected owner/repo): {url}")

    owner, repo = parts
    return owner, repo, date_str


def parse_rss_config(rss_config):
    """仅获取当天的rss信息"""

    # Special handling for github_md_folder type
    if rss_config.get("type") == "github_md_folder":
        return parse_github_md_folder_rss(rss_config)

    # Special handling for github_json type (ai-news-daily)
    if rss_config.get("type") == "github_json":
        return parse_ainews_daily_json_rss(rss_config)

    res = feedparser.parse(rss_config["url"],
                           agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
    keymap = res.keymap
    candidates = []
    max_input = rss_config.get("input_count", 6)

    for article in res[keymap["items"]]:
        time_zone = tz.gettz(time_zone_value)
        now = datetime.now(time_zone)

        article_date = unify_timezone(article.get(keymap["issued"],
                                                  article.get(keymap["date"],
                                                              res.get(keymap["date"]))))
        if not article_date:
            # 날짜가 없으면 현재 시간으로 설정
            article_date = now

        # Apply 36-hour date filter
        if not is_article_recent(article_date, hours_limit=36.0):
            continue  # Skip articles older than 36 hours

        rss = gen_article_from(rss_item=article, rss_type=rss_config.get("type"),
                               image_enable=rss_config.get("image_enable", DEFAULT_IMAGE_ENABLE),
                               rss_date=article_date.strftime("%Y-%m-%d %H:%M:%S"),
                               channel=res[keymap["channel"]],
                               config=rss_config)
        if rss is None:
            continue
        rss.score = compute_focus_score(rss)
        candidates.append(rss)
        if len(candidates) >= max_input:
            break
    today_rss = select_top_articles(candidates, rss_config.get("output_count", 3))

    # Stage 1: curated 소스인 경우 로깅에 표시
    rss_type = rss_config.get("type")
    origin_label = "curated" if rss_type == "curated_rss" else "raw"

    if len(today_rss) == 0:
        logger.info(f'{rss_config["url"]} content of today is empty')
    else:
        logger.info(f'{rss_config["url"]} [{origin_label}] content count of today is {len(today_rss)} / candidates {len(candidates)}')
    return today_rss


def _normalize_image_url(url, base_url=None):
    if not url:
        return ""
    url = url.strip()
    if not url:
        return ""
    if base_url:
        return urljoin(base_url, url)
    return url


def _looks_like_valid_image(url):
    if not url:
        return False
    lower = url.lower()
    if any(keyword in lower for keyword in IMAGE_EXCLUDE_KEYWORDS):
        return False
    if any(lower.endswith(ext) for ext in VALID_IMAGE_EXTENSIONS):
        return True
    if "format=" in lower or "image" in lower:
        return True
    return False


def _extract_from_media_entries(media_entries, base_url=None):
    if not media_entries:
        return ""
    if isinstance(media_entries, dict):
        media_entries = [media_entries]

    for media in media_entries:
        if not isinstance(media, dict):
            continue
        url = media.get("url") or media.get("href") or media.get("src")
        if not url and media.get("srcset"):
            url = media["srcset"].split(",")[0].split()[0]
        mime = media.get("type") or media.get("medium")
        if mime and not mime.startswith("image/"):
            continue
        normalized = _normalize_image_url(url, base_url)
        if _looks_like_valid_image(normalized):
            return normalized
    return ""


def _extract_image_from_html_snippet(html_content, base_url=None):
    if not html_content:
        return ""
    soup = BeautifulSoup(html_content, "html.parser")
    for img in soup.find_all("img"):
        candidate = None
        for attr in ("data-src", "data-original", "data-lazy-src", "data-large-src", "srcset", "src"):
            value = img.get(attr)
            if not value:
                continue
            if attr == "srcset":
                value = value.split(",")[0].split()[0]
            candidate = value
            break
        if not candidate:
            continue
        normalized = _normalize_image_url(candidate, base_url)
        if _looks_like_valid_image(normalized):
            return normalized
    return ""


def _extract_image_from_feed_entry(rss_item, base_url=None):
    if not rss_item:
        return ""

    media_keys = ("media_content", "media_thumbnail", "enclosures")
    for key in media_keys:
        media_candidate = _extract_from_media_entries(rss_item.get(key), base_url)
        if media_candidate:
            return media_candidate

    for key in ("image", "thumbnail"):
        candidate = rss_item.get(key)
        if isinstance(candidate, dict):
            candidate = candidate.get("href") or candidate.get("url")
        normalized = _normalize_image_url(candidate, base_url)
        if _looks_like_valid_image(normalized):
            return normalized

    content_list = rss_item.get("content")
    if isinstance(content_list, (list, tuple)):
        for content_entry in content_list:
            html_value = content_entry.get("value") if isinstance(content_entry, dict) else None
            html_candidate = _extract_image_from_html_snippet(html_value, base_url)
            if html_candidate:
                return html_candidate

    return ""


def _fetch_image_from_article(link):
    if not link:
        return ""
    try:
        response = requests.get(link, headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
    except requests.RequestException as exc:
        logger.debug(f"Failed to fetch article for image extraction ({link}): {exc}")
        return ""
    soup = BeautifulSoup(response.text, "html.parser")
    return extract_primary_media(soup, base_url=link)


def _extract_link_from_item(rss_item):
    """
    Feed entries occasionally omit the top-level ``link`` field.
    Try alternative locations/feed formats, falling back to None when no link exists.
    """
    if not rss_item:
        return None

    link = rss_item.get("link")
    if link:
        return link

    # Some feeds only populate id/guid
    for key in ("id", "guid"):
        candidate = rss_item.get(key)
        if candidate:
            return candidate

    # Atom feeds may expose a links array
    links = rss_item.get("links")
    if isinstance(links, (list, tuple)):
        for entry in links:
            if isinstance(entry, dict):
                href = entry.get("href") or entry.get("url")
                if href:
                    return href
            elif isinstance(entry, str) and entry:
                return entry

    return None


def gen_article_from(rss_item, rss_type, image_enable=False, rss_date=None, channel=None, config=None):
    # github_md_folder의 경우 summary에서 title 추출
    if rss_type == "github_md_folder":
        title = extract_title_from_markdown(rss_item.get("summary", ""))
    else:
        title = rss_item["title"]

    link = _extract_link_from_item(rss_item)
    if not link:
        source_name = None
        if channel and isinstance(channel, dict):
            source_name = channel.get("title")
        if not source_name and config:
            source_name = config.get("title") or config.get("url")
        if not source_name:
            source_name = "unknown source"
        logger.warning(f"Skipping article without link from {source_name}: {title}")
        return None

    summary_raw = rss_item.get("summary", "")
    image_url = ""

    if image_enable:
        entry_image = _extract_image_from_feed_entry(rss_item, base_url=link)
        if entry_image:
            image_url = entry_image
        else:
            snippet_image = _extract_image_from_html_snippet(summary_raw, base_url=link)
            if snippet_image:
                image_url = snippet_image

    # RSS/Atom 피드의 경우 summary를 직접 사용 (curated_rss 포함)
    if rss_type in ["rss", "atom", "rsshub", "curated_rss"]:
        summary, summary_image = transform_html2txt(summary_raw, image_enable=image_enable)
        if image_enable and not image_url and summary_image:
            image_url = summary_image
    elif rss_type and len(rss_type) != 0:
        summary, fetched_image = fetch_summary_from(url=link, rss_type=rss_type)
        if image_enable and not image_url and fetched_image:
            image_url = fetched_image
    else:
        summary, summary_image = transform_html2txt(summary_raw, image_enable=image_enable)
        if image_enable and not image_url and summary_image:
            image_url = summary_image

    if image_enable and not image_url:
        image_url = _fetch_image_from_article(link)

    if not summary or len(summary) < 10:
        return None

    # Stage 1: origin_type 결정 (github_md_folder도 curated로 분류)
    origin_type = "curated" if rss_type in ["curated_rss", "github_md_folder"] else "raw"

    article = Article(title=title,
                  summary=summary,
                  link=link,
                  date=rss_date,
                  info=channel,
                  config=config,
                  cover_url=image_url,
                  origin_type=origin_type,
                  tier=config.get("tier") if config else None)
    return article

def _parse_github_md_folder_url(url: str):
    """
    github:// URL 파싱

    Format: github://owner/repo/folder_path@ref
    Example: github://GENEXIS-AI/DailyNews/%EB%89%B4%EC%8A%A4%EB%A0%88%ED%84%B0@main

    Returns: (owner, repo, folder_path, ref)
    """
    if not url.startswith("github://"):
        raise ValueError(f"Invalid github_md_folder URL: {url}")

    url = url[len("github://"):]  # Remove protocol

    # Split @ref if present
    if "@" in url:
        path_part, ref = url.rsplit("@", 1)
    else:
        path_part = url
        ref = "main"

    # Split owner/repo/folder
    parts = path_part.split("/", 2)
    if len(parts) < 3:
        raise ValueError(f"Invalid URL format (expected owner/repo/folder): {url}")

    owner, repo, folder_path = parts
    return owner, repo, folder_path, ref


def fetch_summary_from(url: str, rss_type: str):
    summary = None
    cover = ""
    if rss_type == "link":
        summary, cover = parse_web_page(url=url)
    elif rss_type == "code":
        summary = parse_github_readme(url)
    elif rss_type == "github_md_folder":
        # URL 형식: github://owner/repo/folder_path@ref
        owner, repo, folder_path, ref = _parse_github_md_folder_url(url)
        summary, cover = parse_github_md_folder(owner, repo, folder_path, ref)
    return summary, cover


def transform_telegram_article(article: Article):
    """
    example:
    link: https://t.me/CocoaDevBlogs/22734, summary: Late Night Silent Completions: Jiiiii — Part 446 https://t.co/iXZYsZO0A7
    """
    lines = article.summary.split('\n')
    tco_links = []
    for line in lines:
        if not line.startswith('>'):
            # 使用正则表达式查找以https://t.co开头的链接
            links = re.findall(r'https://t.co\S+', line)
            tco_links.extend(links)
    if len(tco_links) > 0:
        link = get_real_url(tco_links[0])
        article.link = link
        summary, cover = fetch_summary_from(url=link, rss_type="code" if link.startswith("https://github.com") else "link")
        article.summary = summary
        if cover and not article.cover_url:
            article.cover_url = cover
    return article


def transform_html2txt(content, image_enable=False):
    html_transform = html2text.HTML2Text(bodywidth=0)
    html_transform.ignore_links = True
    html_transform.ignore_images = not image_enable
    html_transform.ignore_tables = True
    html_transform.ignore_emphasis = True
    text = html_transform.handle(content)
    image_url = ""
    if image_enable:
        name, image_url = extract_image_links(text)
    return text, image_url


def unify_timezone(date_string):
    str_date = dateparser.parse(date_string,
                                settings={"TIMEZONE": time_zone_value,
                                          "RETURN_AS_TIMEZONE_AWARE": True})
    return str_date


def parse_web_page(url):
    try:
        response = requests.get(url, headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT)
        if response.status_code == 200:
            # 指定编码方式
            response.encoding = response.apparent_encoding
            # 使用BeautifulSoup解析HTML
            soup = BeautifulSoup(response.text, 'html.parser')
            # 提取限定标签，简化取网页内容流程
            tags = soup.find_all(["h1", "h2", "p", "code"])
            # 不处理标签嵌套内容
            tags_text = [tag.get_text() for tag in tags if not tag.next.name]
            extracted_text = '\n'.join(tags_text)
            cover = extract_primary_media(soup, base_url=url)
            return extracted_text.strip(), cover
        else:
            logger.error(f"fetch {url} failed. Status code: {response.status_code}")
            return None, ""
    except requests.exceptions.RequestException as e:
        logger.exception(f"fetch {url} get error: {e}")
        return None, ""


def extract_image_links(text):
    # 定义匹配Markdown格式图片链接的正则表达式，输出为元组格式
    image_link_regex = r"!\[(.*?)\]\((.*?)\)"
    image_links = re.findall(image_link_regex, text)
    if image_links:
        return image_links[0]
    return "", ""


def extract_primary_media(soup, base_url):
    if soup is None:
        return ""

    def normalize(url):
        return _normalize_image_url(url, base_url)

    meta_selectors = [
        {"property": "og:image"},
        {"name": "og:image"},
        {"property": "og:image:secure_url"},
        {"name": "twitter:image"},
        {"property": "twitter:image"},
        {"name": "twitter:image:src"},
        {"name": "image"},
    ]
    for attrs in meta_selectors:
        meta = soup.find("meta", attrs=attrs)
        if meta and meta.get("content"):
            candidate = normalize(meta.get("content"))
            if _looks_like_valid_image(candidate):
                return candidate

    def _rel_matches(value):
        if isinstance(value, list):
            value = " ".join(value)
        if isinstance(value, str):
            return "image_src" in value.lower()
        return False

    link_image = soup.find("link", rel=_rel_matches)
    if link_image and link_image.get("href"):
        candidate = normalize(link_image["href"])
        if _looks_like_valid_image(candidate):
            return candidate

    preferred_selectors = [
        "article img[src]",
        "main img[src]",
        ".post img[src]",
        ".entry-content img[src]",
        ".content img[src]",
    ]
    for selector in preferred_selectors:
        img = soup.select_one(selector)
        if img and img.get("src"):
            candidate = normalize(img.get("src"))
            if _looks_like_valid_image(candidate):
                return candidate

    img = soup.find("img", src=True)
    if img:
        candidate = normalize(img["src"])
        if _looks_like_valid_image(candidate):
            return candidate

    video = soup.find("video")
    if video:
        poster = video.get("poster")
        if poster:
            return urljoin(base_url, poster)
        if video.get("src"):
            return urljoin(base_url, video.get("src"))
        source = video.find("source", src=True)
        if source:
            return urljoin(base_url, source["src"])
    return ""


def extract_title_from_markdown(md_content: str) -> str:
    """
    Markdown 내용에서 첫 번째 # 헤더를 추출

    Args:
        md_content: Markdown 파일 내용

    Returns:
        첫 # 헤더 텍스트 (# 제거)
        찾지 못하면 "Untitled Newsletter"

    Example:
        "# AI Daily News 2025-12-24\n\n..." -> "AI Daily News 2025-12-24"
    """
    lines = md_content.split('\n')
    for line in lines:
        line = line.strip()
        if line.startswith('# '):
            # # 제거하고 나머지 텍스트 반환
            title = line[2:].strip()
            if title:
                return title

    # 헤더를 찾지 못한 경우 기본값
    return "Untitled Newsletter"


def parse_genexis_md_sections(md_content: str) -> list:
    """
    GENEXIS-AI MD 파일을 개별 뉴스 섹션으로 파싱

    구조:
    ## 제목: ...
    **요약**: ...
    **쉬운설명**: ...
    **관련분야**: ...
    **중요도**: N
    **전체링크** : URL

    ---
    (다음 섹션)

    Args:
        md_content: GENEXIS-AI MD 파일 전체 내용

    Returns:
        List of dicts: [{"title": ..., "summary": ..., "link": ..., "importance": ...}, ...]
    """
    import re

    sections = []

    # Split by --- delimiter
    raw_sections = md_content.split('\n---\n')

    for raw_section in raw_sections:
        raw_section = raw_section.strip()
        if not raw_section or len(raw_section) < 50:
            continue

        try:
            # Extract metadata using regex
            section_data = {}

            # Image: ![Image](URL) - extract first image if exists
            image_match = re.search(r'!\[Image\]\((https?://[^\s\)]+)\)', raw_section)
            if image_match:
                section_data['image_url'] = image_match.group(1).strip()
            else:
                section_data['image_url'] = ""

            # Title: ## 제목: TITLE or just after ## 제목:
            title_match = re.search(r'##\s*제목:\s*(.+?)(?:\n|$)', raw_section, re.DOTALL)
            if title_match:
                section_data['title'] = title_match.group(1).strip()
            else:
                # Fallback: first line after ## if exists
                first_line_match = re.search(r'##\s*(.+?)(?:\n|$)', raw_section)
                if first_line_match:
                    section_data['title'] = first_line_match.group(1).strip()
                else:
                    continue  # Skip section without title

            # Summary: **요약**: CONTENT (until next ** field)
            summary_match = re.search(r'\*\*요약\*\*:\s*(.+?)(?=\*\*|$)', raw_section, re.DOTALL)
            if summary_match:
                section_data['summary'] = summary_match.group(1).strip()
            else:
                section_data['summary'] = ""

            # Easy Explanation: **쉬운설명**: CONTENT
            easy_match = re.search(r'\*\*쉬운설명\*\*:\s*(.+?)(?=\*\*|$)', raw_section, re.DOTALL)
            if easy_match:
                section_data['easy_explanation'] = easy_match.group(1).strip()

            # Related Field: **관련분야**: CONTENT
            field_match = re.search(r'\*\*관련분야\*\*:\s*(.+?)(?=\*\*|$)', raw_section, re.DOTALL)
            if field_match:
                section_data['related_field'] = field_match.group(1).strip()

            # Importance: **중요도**: N
            importance_match = re.search(r'\*\*중요도\*\*:\s*(\d+)', raw_section)
            if importance_match:
                section_data['importance'] = int(importance_match.group(1))
            else:
                section_data['importance'] = 5  # Default

            # Link: **전체링크** : URL or **전체링크**: URL
            link_match = re.search(r'\*\*전체링크\*\*\s*:?\s*(https?://[^\s\n]+)', raw_section)
            if link_match:
                section_data['link'] = link_match.group(1).strip()
            else:
                logger.warning(f"No link found in section: {section_data.get('title', 'Untitled')[:50]}")
                continue  # Skip section without link

            # Combine summary and easy explanation for full summary
            full_summary = section_data['summary']
            if section_data.get('easy_explanation'):
                full_summary += f"\n\n쉬운설명: {section_data['easy_explanation']}"
            if section_data.get('related_field'):
                full_summary += f"\n\n관련분야: {section_data['related_field']}"

            section_data['full_summary'] = full_summary

            sections.append(section_data)

        except Exception as e:
            logger.warning(f"Failed to parse section: {e}")
            continue

    logger.info(f"Parsed {len(sections)} sections from GENEXIS MD file")
    return sections


def parse_ainews_daily_json(owner: str, repo: str, date_str: str = None) -> list:
    """
    Fetch and parse ai-news-daily processed JSON file

    URL 패턴:
    https://raw.githubusercontent.com/{owner}/{repo}/main/data/{date}-processed.json

    Args:
        owner: "ai-news-daily"
        repo: "ai-news-daily.github.io"
        date_str: YYYY-MM-DD format, defaults to today

    Returns:
        List of dicts with article data:
        [{"title": ..., "url": ..., "summary": ..., "category": ..., "confidence": ...}, ...]
        Empty list on error
    """
    import json
    from datetime import datetime

    try:
        # Default to today's date
        if not date_str:
            date_str = datetime.now().strftime("%Y-%m-%d")

        # Build raw.githubusercontent.com URL
        url = f"https://raw.githubusercontent.com/{owner}/{repo}/main/data/{date_str}-processed.json"

        logger.info(f"Fetching ai-news-daily JSON: {url}")

        # Fetch JSON file
        response = requests.get(url, timeout=30)

        # Handle 404 gracefully (no data for this date)
        if response.status_code == 404:
            logger.warning(f"No ai-news-daily data found for {date_str} (404)")
            return []

        response.raise_for_status()

        # Parse JSON
        data = response.json()

        # Extract articles array
        articles = data.get("articles", [])
        if not articles:
            logger.warning(f"No articles found in ai-news-daily JSON for {date_str}")
            return []

        logger.info(f"Fetched {len(articles)} articles from ai-news-daily ({date_str})")

        # Filter by confidence threshold (0.5 = 50%)
        # ai-news-daily uses ML confidence scores
        confidence_threshold = 0.5
        filtered_articles = [
            article for article in articles
            if article.get("confidence", 0) >= confidence_threshold
        ]

        logger.info(f"Filtered to {len(filtered_articles)} articles (confidence >= {confidence_threshold})")

        return filtered_articles

    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to fetch ai-news-daily JSON for {date_str}: {e}")
        return []

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse ai-news-daily JSON for {date_str}: {e}")
        return []

    except Exception as e:
        logger.exception(f"Unexpected error parsing ai-news-daily JSON for {date_str}: {e}")
        return []


def parse_github_readme(repo_url):
    try:
        repo_url = get_real_url(repo_url)
        # 提取用户名和仓库名
        username, repo_name = repo_url.split("/")[-2:]
        api_url = f"https://api.github.com/repos/{username}/{repo_name}/readme"
        response = requests.get(api_url)
        response.raise_for_status()
        # 解析响应，提取 README 内容
        readme_content = response.json()["content"]
        # 将 Base64 编码的内容解码为字符串
        import base64
        readme_content = base64.b64decode(readme_content).decode("utf-8")

        # md > html > text
        html = markdown(readme_content)
        # remove code snippets
        html = re.sub(r'<pre>(.*?)</pre>', '', html, flags=re.DOTALL)
        html = re.sub(r'<code>(.*?)</code>', '', html, flags=re.DOTALL)
        html = re.sub(r'```(.*?)```', '', html, flags=re.DOTALL)
        soup = BeautifulSoup(html, "html.parser")
        text = ''.join(soup.findAll(string=True))
        return text.strip()

    except Exception as e:
        logger.error(f"fetch {repo_url} get error: {e}")
        return None


def parse_github_md_folder(owner: str, repo: str, folder_path: str, ref: str = "main"):
    """
    GitHub 폴더에서 최신 .md 파일을 가져와 파싱

    Workflow:
    1. 폴더 내용 조회
    2. .md 파일 필터링
    3. 파일명 내림차순 정렬 (최신 파일 = 첫번째)
    4. 파일 다운로드
    5. 내용 길이 검증 (< 100자면 None)
    6. (content, "") 반환

    Args:
        owner: 레포 소유자 (예: "GENEXIS-AI")
        repo: 레포 이름 (예: "DailyNews")
        folder_path: 폴더 경로, URL-encoded (예: "%EB%89%B4%EC%8A%A4%EB%A0%88%ED%84%B0")
        ref: 브랜치/태그/커밋 (기본값: "main")

    Returns:
        (markdown_content, cover_url): MD 내용과 빈 문자열
        에러 시: (None, "")

    Error Handling:
    - 0개 .md 파일: 에러 로그, (None, "") 반환
    - 내용 < 100자: 경고 로그, (None, "") 반환
    - Network/API 에러: 에러 로그, (None, "") 반환
    - Rate limit: 에러 로그, (None, "") 반환
    """
    from workflow.article.github_client import (
        list_folder_contents,
        download_file_content,
        GitHubAPIError,
        GitHubRateLimitError
    )

    try:
        # 1. 폴더 내용 조회
        logger.info(f"Fetching folder: {owner}/{repo}/{folder_path}")
        items = list_folder_contents(owner, repo, folder_path, ref)

        # 2. .md 파일 필터링
        md_files = [
            item for item in items
            if item.get("type") == "file"
            and item.get("name", "").endswith(".md")
            and item.get("download_url")
        ]

        if not md_files:
            logger.error(f"No .md files found in {owner}/{repo}/{folder_path}")
            return None, ""

        # 3. 파일명 내림차순 정렬 (최신 파일 첫번째)
        md_files.sort(key=lambda x: x["name"], reverse=True)
        latest_file = md_files[0]

        logger.info(f"Latest file: {latest_file['name']} (total {len(md_files)} .md files)")

        # 4. 파일 다운로드
        download_url = latest_file["download_url"]
        content = download_file_content(download_url)

        # 5. 내용 길이 검증
        if not content or len(content) < 100:
            logger.warning(f"File content too short ({len(content)} chars): {latest_file['name']}")
            return None, ""

        logger.info(f"Successfully fetched {len(content)} chars from {latest_file['name']}")
        return content, ""

    except GitHubRateLimitError as e:
        logger.error(f"GitHub rate limit exceeded for {owner}/{repo}/{folder_path}: {e}")
        return None, ""

    except GitHubAPIError as e:
        logger.error(f"GitHub API error for {owner}/{repo}/{folder_path}: {e}")
        return None, ""

    except Exception as e:
        logger.exception(f"Unexpected error fetching {owner}/{repo}/{folder_path}: {e}")
        return None, ""


def get_real_url(short_url):
    # get real url from short url
    response = requests.head(short_url, allow_redirects=True)
    return response.url

def rss_env():
    os.environ[""] = ""
