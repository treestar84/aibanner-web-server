#!/usr/bin/env python3
"""
GENEXIS-AI GitHub Fetcher E2E Integration Test

테스트 흐름:
1. GitHub API로 GENEXIS-AI/DailyNews 폴더 조회
2. 최신 .md 파일 다운로드
3. Title 추출 검증
4. RSS 파이프라인 통합 검증
"""

import os
import sys
from dotenv import load_dotenv

# Load environment
load_dotenv()


def test_genexis_fetcher():
    """GENEXIS-AI fetcher end-to-end test"""
    print("=" * 70)
    print("GENEXIS-AI GitHub MD Folder Fetcher - E2E Test")
    print("=" * 70)

    # Import modules
    print("\n[1] Importing modules...")
    try:
        from workflow.article.rss import (
            parse_github_md_folder,
            extract_title_from_markdown,
            _parse_github_md_folder_url
        )
        print("  ✅ Modules imported successfully")
    except ImportError as e:
        print(f"  ❌ ERROR: Failed to import modules: {e}")
        return False

    # Test URL parsing
    print("\n[2] Testing URL parsing...")
    url = "github://GENEXIS-AI/DailyNews/%EB%89%B4%EC%8A%A4%EB%A0%88%ED%84%B0@main"
    try:
        owner, repo, folder, ref = _parse_github_md_folder_url(url)
        print(f"  Owner: {owner}")
        print(f"  Repo: {repo}")
        print(f"  Folder: {folder}")
        print(f"  Ref: {ref}")

        if owner != "GENEXIS-AI" or repo != "DailyNews":
            print("  ❌ ERROR: URL parsing returned incorrect values")
            return False

        print("  ✅ URL parsing successful")
    except Exception as e:
        print(f"  ❌ ERROR: URL parsing failed: {e}")
        return False

    # Test fetcher
    print("\n[3] Fetching latest newsletter from GENEXIS-AI/DailyNews...")
    try:
        content, cover = parse_github_md_folder(owner, repo, folder, ref)

        if not content:
            print("  ❌ ERROR: No content returned")
            print("  Possible reasons:")
            print("    - No .md files in folder")
            print("    - File content too short (< 100 chars)")
            print("    - GitHub API rate limit")
            print("    - Network error")
            return False

        print(f"  ✅ Successfully fetched {len(content)} characters")

        # Test title extraction
        print("\n[4] Extracting title from markdown...")
        title = extract_title_from_markdown(content)
        print(f"  Title: {title}")

        if title == "Untitled Newsletter":
            print("  ⚠️  WARNING: No # header found in markdown")
        else:
            print("  ✅ Title extracted successfully")

        # Show preview
        print("\n[5] Content preview (first 500 chars):")
        print("-" * 70)
        print(content[:500])
        if len(content) > 500:
            print("...")
        print("-" * 70)

        # Test RSS config integration
        print("\n[6] Checking RSS configuration...")
        import json
        with open("workflow/resources/rss.json", "r") as f:
            rss_config = json.load(f)

        # Find GENEXIS entry
        genexis_found = False
        openchoi_found = False

        for category in rss_config["categories"]:
            for item in category.get("items", []):
                if "GENEXIS" in item.get("title", ""):
                    genexis_found = True
                    print(f"  ✅ GENEXIS config found: {item['title']}")
                    print(f"     Type: {item['type']}")
                    print(f"     Tier: {item['tier']}")
                    print(f"     URL: {item['url']}")

                if "openchoi" in item.get("title", ""):
                    openchoi_found = True
                    print(f"  ⚠️  openchoi config still exists (should be removed)")
                    print(f"     Title: {item['title']}")

        if not genexis_found:
            print("  ❌ ERROR: GENEXIS config not found in rss.json")
            return False

        if openchoi_found:
            print("  ⚠️  WARNING: openchoi should be removed from rss.json")
            # Not a failure, just a warning

        # Check type description
        type_desc = rss_config.get("configuration", {}).get("_type_descriptions", {})
        if "github_md_folder" in type_desc:
            print(f"  ✅ github_md_folder type documented: {type_desc['github_md_folder']}")
        else:
            print("  ⚠️  WARNING: github_md_folder type not documented in _type_descriptions")

        print("\n" + "=" * 70)
        print("✅ ALL TESTS PASSED")
        print("=" * 70)
        return True

    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()

        print("\n" + "=" * 70)
        print("❌ TEST FAILED")
        print("=" * 70)
        return False


if __name__ == "__main__":
    print("GENEXIS-AI GitHub MD Folder Fetcher - E2E Integration Test")
    print()

    # Check for GITHUB_TOKEN
    if os.environ.get("GITHUB_TOKEN"):
        print("✅ GITHUB_TOKEN found (authenticated requests)")
    else:
        print("⚠️  GITHUB_TOKEN not found (unauthenticated, 60 req/hr limit)")
        print("   Set GITHUB_TOKEN in .env for higher rate limits (5000 req/hr)")

    print()

    try:
        success = test_genexis_fetcher()
        print()
        print("=" * 70)
        if success:
            print("Result: ✅ PASS")
        else:
            print("Result: ❌ FAIL")
        print("=" * 70)

        sys.exit(0 if success else 1)

    except Exception as e:
        print()
        print("=" * 70)
        print(f"❌ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        print("=" * 70)
        sys.exit(1)
