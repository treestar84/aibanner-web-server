import json

from dotenv import load_dotenv
from loguru import logger

from workflow.gpt.prompt import multi_content_prompt_ko
from workflow.gpt.request import AIProvider
from workflow.gpt.text_cleaner import clean_article_content


def evaluate_article_with_gpt(articles):
    """
    Evaluate articles with GPT using multi_content_prompt_ko

    All articles (curated and raw) are processed with the same prompt.
    """
    load_dotenv()

    if not articles:
        return []

    article_links = [article.link for article in articles]
    logger.info(f"start summary: {article_links}")

    ai_provider: AIProvider = AIProvider.build_from_envs()

    # Process all articles with unified prompt
    logger.info(f"Processing {len(articles)} articles...")
    gpt_input = ""
    for item in articles:
        gpt_input += f"```link: {item.link}, content:{item.summary}```.\n"

    response = ai_provider.request(prompt=multi_content_prompt_ko, content=gpt_input)
    all_results = transform2json(response)

    if not all_results:
        all_results = []
    elif not isinstance(all_results, list):
        all_results = [all_results]

    logger.info(f"Articles processed: {len(all_results)} results")

    # Filter valid items
    evaluate_list = [item for item in all_results if item.get("title") and item.get("link")]

    # Clean emojis from all items
    cleaned_list = [clean_article_content(item) for item in evaluate_list]

    logger.info(f"Total evaluated: {len(cleaned_list)} articles")

    return cleaned_list


def transform2json(result):
    if not result:
        return None
    format_json = None
    # 去掉首尾两行就是完整json内容
    text = result.removeprefix("```json")
    text = text.removesuffix("```")
    # 有时输出格式可能不完全符合json
    try:
        json_obj = json.loads(text)
        # 关键信息校验
        format_json = json_obj
    except Exception as e:
        logger.exception(f"{e}")
    finally:
        return format_json
