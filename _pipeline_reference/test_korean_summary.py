#!/usr/bin/env python3
"""
Korean Summary Test Script for Story 1.3
Tests Korean-optimized AI summarization with sample articles.
"""
import os
import sys
import json

# Add workflow to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'workflow'))

from dotenv import load_dotenv
from article.rss import Article
from gpt.summary import evaluate_article_with_gpt, get_prompt_by_language
from gpt.prompt import multi_content_prompt_ko

def test_korean_summary():
    """Test Korean summary functionality with sample articles"""
    print("=" * 60)
    print("Korean Summary Test")
    print("=" * 60)

    # Load environment
    load_dotenv()

    # Check environment setup
    print("\n[1] Environment Check")
    api_key = os.environ.get("GPT_API_KEY", "")
    ai_provider = os.environ.get("AI_PROVIDER", "gemini")
    model = os.environ.get("GPT_MODEL_NAME", "")
    lang = os.environ.get("SUMMARY_LANGUAGE", "ko")

    print(f"  AI Provider: {ai_provider}")
    print(f"  Model: {model}")
    print(f"  Summary Language: {lang}")
    print(f"  API Key: {'Set (' + api_key[:10] + '...)' if api_key else 'NOT SET'}")

    if not api_key:
        print("\nERROR: GPT_API_KEY is not set in .env file")
        return False

    # Check prompt selection
    print("\n[2] Prompt Selection Check")
    selected_prompt = get_prompt_by_language()
    is_korean = selected_prompt == multi_content_prompt_ko
    print(f"  Korean prompt selected: {is_korean}")

    if not is_korean:
        print("  WARNING: Korean prompt not selected. Check SUMMARY_LANGUAGE env variable.")

    # Create sample articles
    print("\n[3] Creating Sample Articles")

    sample_articles = [
        Article(
            title="OpenAI Releases GPT-5 with Enhanced Reasoning",
            summary="""OpenAI has announced GPT-5, their latest large language model with significantly
            improved reasoning capabilities. The new model shows 40% better performance on complex
            mathematical problems and coding tasks. GPT-5 introduces a new architecture that allows
            for better context understanding and more accurate responses. The model is available
            through the API with new pricing tiers. Enterprise customers get priority access.""",
            link="https://example.com/gpt5-release",
            date="2025-12-12",
            info={"title": "Sample Tech Blog"},
            config={"category": "AI News", "output_count": 3}
        ),
        Article(
            title="NVIDIA Announces Next-Gen AI Chips",
            summary="""NVIDIA unveiled their new B200 Blackwell chips designed specifically for
            AI training and inference workloads. The chips offer 3x performance improvement over
            previous generation with 50% lower power consumption. Major cloud providers including
            AWS, Azure, and Google Cloud have already committed to deploying B200 clusters.
            The new chips support up to 192GB of HBM3e memory.""",
            link="https://example.com/nvidia-b200",
            date="2025-12-12",
            info={"title": "Tech News"},
            config={"category": "AI News", "output_count": 3}
        )
    ]

    print(f"  Created {len(sample_articles)} sample articles")
    for art in sample_articles:
        print(f"    - {art.title}")

    # Test AI summarization
    print("\n[4] Testing AI Summarization (Korean)")
    print("  Calling OpenAI API...")

    try:
        results = evaluate_article_with_gpt(sample_articles)

        if not results:
            print("  ERROR: No results returned from AI")
            return False

        print(f"\n  SUCCESS: Received {len(results)} summaries")

        # Validate results
        print("\n[5] Validating Results")
        all_valid = True

        for idx, result in enumerate(results):
            print(f"\n  Article {idx + 1}:")
            print(f"    Link: {result.get('link', 'N/A')}")
            print(f"    Title: {result.get('title', 'N/A')}")
            print(f"    Tags: {result.get('tags', [])}")
            print(f"    Score: {result.get('score', 'N/A')}")

            summary = result.get('summary', '')
            print(f"    Summary length: {len(summary)} chars")
            print(f"    Summary preview: {summary[:100]}...")

            # Check if summary is in Korean (contains Korean characters)
            has_korean = any('\uac00' <= char <= '\ud7a3' for char in summary)
            print(f"    Contains Korean: {has_korean}")

            if not has_korean:
                print("    WARNING: Summary may not be in Korean")
                all_valid = False

            # Check required fields
            required_fields = ['link', 'title', 'tags', 'score', 'summary']
            missing = [f for f in required_fields if f not in result or not result[f]]
            if missing:
                print(f"    WARNING: Missing fields: {missing}")
                all_valid = False

        # Summary
        print("\n" + "=" * 60)
        print("TEST SUMMARY")
        print("=" * 60)
        print(f"Articles processed: {len(sample_articles)}")
        print(f"Summaries returned: {len(results)}")
        print(f"All validations passed: {all_valid}")

        return all_valid

    except Exception as e:
        print(f"\n  ERROR during summarization: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_api_error_handling():
    """Test API error handling with invalid key"""
    print("\n" + "=" * 60)
    print("API Error Handling Test")
    print("=" * 60)

    # Temporarily set invalid API key
    original_key = os.environ.get("GPT_API_KEY", "")
    os.environ["GPT_API_KEY"] = "invalid-key-for-testing"

    sample = Article(
        title="Test Article",
        summary="Test content for error handling",
        link="https://example.com/test",
        date="2025-12-12",
        info={},
        config={}
    )

    print("  Testing with invalid API key...")
    try:
        results = evaluate_article_with_gpt([sample])
        if not results:
            print("  PASS: Error handled gracefully (empty result)")
        else:
            print("  WARNING: Unexpected result with invalid key")
    except Exception as e:
        print(f"  PASS: Exception caught: {type(e).__name__}")

    # Restore original key
    os.environ["GPT_API_KEY"] = original_key
    return True


if __name__ == "__main__":
    # Run main test
    success = test_korean_summary()

    # Run error handling test
    if success:
        test_api_error_handling()

    sys.exit(0 if success else 1)
