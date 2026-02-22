"""
Text cleaning utilities for removing emojis and unwanted characters
"""
import re
from typing import Optional, Dict, Any


def remove_emojis(text: str) -> str:
    """
    Remove all emoji characters from text while preserving Korean, English, and common punctuation.

    This function uses Unicode ranges to identify and remove emoji characters:
    - Emoticons (U+1F600–U+1F64F)
    - Symbols & Pictographs (U+1F300–U+1F5FF)
    - Transport & Map Symbols (U+1F680–U+1F6FF)
    - Supplemental Symbols (U+1F900–U+1F9FF)
    - Miscellaneous Symbols (U+2600–U+26FF)
    - Dingbats (U+2700–U+27BF)
    - Enclosed characters (U+24C2–U+1F251)
    - Flags (U+1F1E0–U+1F1FF)
    - Keycap symbols
    - Variation selectors

    Args:
        text: Input text that may contain emojis

    Returns:
        Text with all emojis removed and extra whitespace cleaned

    Examples:
        >>> remove_emojis("🤖 GPT-5 출시 임박")
        "GPT-5 출시 임박"
        >>> remove_emojis("## 🤖 AI News")
        "## AI News"
        >>> remove_emojis("테스트 🔥🎯 완료")
        "테스트 완료"
    """
    if not text:
        return text

    # Comprehensive emoji pattern covering all major Unicode emoji ranges
    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F"  # emoticons
        "\U0001F300-\U0001F5FF"  # symbols & pictographs
        "\U0001F680-\U0001F6FF"  # transport & map symbols
        "\U0001F700-\U0001F77F"  # alchemical symbols
        "\U0001F780-\U0001F7FF"  # Geometric Shapes Extended
        "\U0001F800-\U0001F8FF"  # Supplemental Arrows-C
        "\U0001F900-\U0001F9FF"  # Supplemental Symbols and Pictographs
        "\U0001FA00-\U0001FA6F"  # Chess Symbols
        "\U0001FA70-\U0001FAFF"  # Symbols and Pictographs Extended-A
        "\U00002600-\U000026FF"  # Miscellaneous Symbols
        "\U00002700-\U000027BF"  # Dingbats
        "\U0000FE00-\U0000FE0F"  # Variation Selectors
        "\U0001F1E0-\U0001F1FF"  # flags (iOS)
        "\U00002300-\U000023FF"  # Miscellaneous Technical
        "\U00002B50-\U00002BFF"  # Stars and other symbols
        "\U0000200D"             # Zero Width Joiner (used in composite emojis)
        "\U0001F004"             # Mahjong Tile
        "\U0001F0CF"             # Playing Card
        "\U0001F18E"             # Negative Squared AB
        "\U0001F191-\U0001F19A"  # Squared symbols
        "\U0001F201-\U0001F251"  # Enclosed ideographic supplement
        "\U0000203C\U00002049"   # Double exclamation, exclamation question
        "\U000025AA-\U000025FE"  # Geometric shapes
        "\U0001F004-\U0001F0CF"  # Additional symbols
        "]+",
        flags=re.UNICODE
    )

    # Remove emojis
    cleaned_text = emoji_pattern.sub('', text)

    # Clean up extra whitespace
    # Replace multiple spaces with single space
    cleaned_text = re.sub(r' +', ' ', cleaned_text)

    # Remove space at the beginning of line after markdown headers
    cleaned_text = re.sub(r'^(#{1,6})\s+', r'\1 ', cleaned_text, flags=re.MULTILINE)

    # Trim leading/trailing whitespace
    cleaned_text = cleaned_text.strip()

    return cleaned_text


def clean_article_content(evaluate_dict: Dict[str, Any]) -> Dict[str, Any]:
    """
    Clean emoji characters from article evaluation dictionary.

    This function removes emojis from:
    - title field
    - summary field

    Tags and score fields are preserved as-is.

    Args:
        evaluate_dict: Dictionary containing article evaluation data
                      Expected keys: 'title', 'summary', 'tags', 'score'

    Returns:
        Dictionary with emojis removed from title and summary

    Example:
        >>> data = {
        ...     "title": "🤖 GPT-5 출시",
        ...     "summary": "AI 기술 발전 🚀",
        ...     "tags": ["AI"],
        ...     "score": 9
        ... }
        >>> clean_article_content(data)
        {'title': 'GPT-5 출시', 'summary': 'AI 기술 발전', 'tags': ['AI'], 'score': 9}
    """
    if not evaluate_dict:
        return evaluate_dict

    cleaned = evaluate_dict.copy()

    # Clean title
    if 'title' in cleaned and cleaned['title']:
        cleaned['title'] = remove_emojis(cleaned['title'])

    # Clean summary
    if 'summary' in cleaned and cleaned['summary']:
        cleaned['summary'] = remove_emojis(cleaned['summary'])

    return cleaned
