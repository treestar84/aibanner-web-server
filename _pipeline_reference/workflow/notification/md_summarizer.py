"""
MD Summarizer for Kakao Talk
Reads markdown file and uses GPT to create short summaries for messaging
"""

from loguru import logger
from typing import List, Dict
from workflow.gpt.request import AIProvider


KAKAO_SUMMARY_PROMPT = """당신은 AI 뉴스 요약 전문가입니다.

## 역할:
매일 발행되는 AI Daily News 블로그 글을 카카오톡 메시지용으로 짧게 요약합니다.

## 입력:
- Daily News 블로그 글 전문 (Markdown 형식)
- 15개 내외의 AI 뉴스 기사 포함

## 작업:
1. 전체 기사 중 **가장 중요하고 흥미로운 10개** 선택
2. 각 기사를 **한 줄 (30-50자)**로 압축 요약
3. 카카오톡 메시지에 적합한 간결한 형식

## 출력 형식 (JSON):
```json
[
  {
    "title": "기사 제목 (그대로)",
    "summary": "한 줄 핵심 요약 (30-50자)",
    "priority": 1
  },
  ...
]
```

## 제약조건:
- **정확히 10개 기사** 선택
- 요약은 **30-50자 (공백 포함)**, 한 줄로 제한
- 원문 제목은 변경하지 말 것
- 핵심만 전달 (배경 설명 최소화)
- 이모티콘 사용 금지
- priority는 1-10 (1이 가장 중요)

## 선택 기준:
1. Impact가 높은 기사 우선
2. 최신 릴리스/발표 우선
3. 한국 독자에게 유용한 내용 우선
4. 다양한 토픽 커버 (Model, Agent, DevTool 등)
"""


class MDSummarizer:
    """Summarizes markdown blog posts for Kakao Talk messages using GPT"""

    def __init__(self):
        self.ai_provider = AIProvider.build_from_envs()

    def summarize_md_file(self, md_path: str, articles: List = None) -> List[Dict[str, str]]:
        """
        Read markdown file and summarize for Kakao Talk

        Args:
            md_path: Path to markdown file (dailyNews_YYYY-MM-DD.md)
            articles: Optional list of article objects to extract links

        Returns:
            List of dicts with 'title', 'summary', 'link', 'priority'
            Returns empty list on error
        """
        try:
            # Read markdown file
            with open(md_path, 'r', encoding='utf-8') as f:
                md_content = f.read()

            logger.info(f"Read {len(md_content)} chars from {md_path}")

            # Truncate if too long (keep first 20000 chars to avoid token limits)
            if len(md_content) > 20000:
                logger.warning(f"MD file too long ({len(md_content)} chars), truncating to 20000")
                md_content = md_content[:20000] + "\n\n... (truncated)"

            # Call GPT to summarize
            logger.info("Requesting GPT summary for Kakao message...")
            response = self.ai_provider.request(
                prompt=KAKAO_SUMMARY_PROMPT,
                content=md_content
            )

            # Parse JSON response
            import json
            try:
                # Try to extract JSON from response
                if '```json' in response:
                    json_start = response.find('```json') + 7
                    json_end = response.find('```', json_start)
                    json_str = response[json_start:json_end].strip()
                elif '[' in response and ']' in response:
                    json_start = response.find('[')
                    json_end = response.rfind(']') + 1
                    json_str = response[json_start:json_end]
                else:
                    json_str = response

                summaries = json.loads(json_str)

                if not isinstance(summaries, list):
                    logger.error(f"GPT response is not a list: {type(summaries)}")
                    return []

                # Add links from articles if available
                if articles:
                    # Create title -> link mapping
                    title_to_link = {}
                    for article in articles:
                        try:
                            title = article.evaluate.get("title", "")
                            link = article.link
                            if title and link:
                                title_to_link[title] = link
                        except AttributeError:
                            continue

                    # Match summaries with links
                    for summary in summaries:
                        title = summary.get('title', '')
                        if title in title_to_link:
                            summary['link'] = title_to_link[title]
                        else:
                            # Try fuzzy match (remove punctuation differences)
                            normalized_title = title.strip().lower()
                            for orig_title, link in title_to_link.items():
                                if orig_title.strip().lower() == normalized_title:
                                    summary['link'] = link
                                    break

                logger.info(f"✅ GPT returned {len(summaries)} article summaries")
                return summaries

            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse GPT JSON response: {e}")
                logger.error(f"Response: {response[:500]}...")
                return []

        except FileNotFoundError:
            logger.error(f"MD file not found: {md_path}")
            return []

        except Exception as e:
            logger.error(f"Error summarizing MD file: {e}")
            logger.exception(e)
            return []
