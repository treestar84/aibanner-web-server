"""
GitHub API client with ETag caching and retry logic

Features:
- GitHub Token authentication
- ETag caching for folder contents
- Exponential backoff retry (1s → 3s → 7s)
- Rate limit handling (403/429)
- Graceful error handling
"""

import os
import time
import json
import requests
from loguru import logger
from pathlib import Path
from typing import Optional, Tuple, List, Dict

# Configuration
GITHUB_API_BASE = "https://api.github.com"
CACHE_DIR = Path(__file__).parent / ".github_cache"
MAX_RETRIES = 3
RETRY_DELAYS = [1, 3, 7]  # Exponential backoff in seconds
REQUEST_TIMEOUT = 30


class GitHubAPIError(Exception):
    """Custom exception for GitHub API errors"""
    pass


class GitHubRateLimitError(GitHubAPIError):
    """Raised when rate limit is exceeded"""
    pass


def _get_headers() -> dict:
    """Build request headers with optional authentication"""
    headers = {
        "User-Agent": "AIDailyNews-RSS-Fetcher/1.0",
        "Accept": "application/vnd.github.v3+json"
    }

    # Add GitHub token if available
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
        logger.debug("Using GitHub token for authentication")
    else:
        logger.warning("No GITHUB_TOKEN found - using unauthenticated requests (rate limit: 60/hr)")

    return headers


def _load_etag_cache(cache_key: str) -> Optional[str]:
    """Load ETag from cache file"""
    if not CACHE_DIR.exists():
        return None

    cache_file = CACHE_DIR / f"{cache_key}.json"
    if not cache_file.exists():
        return None

    try:
        with open(cache_file, 'r') as f:
            data = json.load(f)
            return data.get("etag")
    except Exception as e:
        logger.warning(f"Failed to load ETag cache: {e}")
        return None


def _save_etag_cache(cache_key: str, etag: str, data: dict):
    """Save ETag and data to cache"""
    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"{cache_key}.json"

    try:
        with open(cache_file, 'w') as f:
            json.dump({
                "etag": etag,
                "data": data,
                "updated_at": time.time()
            }, f, indent=2)
        logger.debug(f"Saved ETag cache: {cache_key}")
    except Exception as e:
        logger.error(f"Failed to save ETag cache: {e}")


def _load_cached_data(cache_key: str) -> Optional[dict]:
    """Load cached response data"""
    if not CACHE_DIR.exists():
        return None

    cache_file = CACHE_DIR / f"{cache_key}.json"
    if not cache_file.exists():
        return None

    try:
        with open(cache_file, 'r') as f:
            data = json.load(f)
            return data.get("data")
    except Exception as e:
        logger.warning(f"Failed to load cached data: {e}")
        return None


def _make_request_with_retry(url: str, headers: dict) -> Tuple[requests.Response, bool]:
    """
    Make HTTP request with exponential backoff retry

    Returns:
        (response, used_cache): Response object and whether cache was used
    """
    last_error = None

    for attempt in range(MAX_RETRIES):
        try:
            logger.debug(f"Request attempt {attempt + 1}/{MAX_RETRIES}: {url}")
            response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)

            # Handle 304 Not Modified (cache hit)
            if response.status_code == 304:
                logger.info("Content not modified (304) - using cached data")
                return response, True

            # Handle rate limit errors (403/429)
            if response.status_code in [403, 429]:
                rate_limit_reset = response.headers.get("X-RateLimit-Reset")
                if rate_limit_reset:
                    reset_time = int(rate_limit_reset)
                    wait_seconds = reset_time - int(time.time())
                    if wait_seconds > 0 and wait_seconds < 300:  # Wait max 5 minutes
                        logger.warning(f"Rate limit exceeded. Waiting {wait_seconds}s until reset...")
                        time.sleep(wait_seconds + 1)
                        continue

                raise GitHubRateLimitError(f"Rate limit exceeded: {response.status_code}")

            # Handle server errors (5xx) with retry
            if 500 <= response.status_code < 600:
                if attempt < MAX_RETRIES - 1:
                    delay = RETRY_DELAYS[attempt]
                    logger.warning(f"Server error {response.status_code}, retrying in {delay}s...")
                    time.sleep(delay)
                    continue
                else:
                    response.raise_for_status()

            # Success or client error (4xx except 403/429)
            response.raise_for_status()
            return response, False

        except requests.exceptions.Timeout as e:
            last_error = e
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_DELAYS[attempt]
                logger.warning(f"Request timeout, retrying in {delay}s...")
                time.sleep(delay)
            else:
                raise GitHubAPIError(f"Request timeout after {MAX_RETRIES} attempts") from e

        except requests.exceptions.RequestException as e:
            last_error = e
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_DELAYS[attempt]
                logger.warning(f"Request failed: {e}, retrying in {delay}s...")
                time.sleep(delay)
            else:
                raise GitHubAPIError(f"Request failed after {MAX_RETRIES} attempts") from e

    # Should not reach here, but just in case
    raise GitHubAPIError(f"Request failed after {MAX_RETRIES} attempts") from last_error


def list_folder_contents(owner: str, repo: str, folder_path: str, ref: str = "main") -> List[Dict]:
    """
    List contents of a GitHub repository folder

    Args:
        owner: Repository owner
        repo: Repository name
        folder_path: Path to folder (URL-encoded if needed)
        ref: Branch/tag/commit ref (default: main)

    Returns:
        List of file/folder metadata dicts

    Raises:
        GitHubAPIError: On API errors
        GitHubRateLimitError: On rate limit errors
    """
    url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/contents/{folder_path}"
    if ref:
        url += f"?ref={ref}"

    # Build cache key
    cache_key = f"{owner}_{repo}_{folder_path.replace('/', '_')}_{ref}"

    # Build headers with ETag
    headers = _get_headers()
    cached_etag = _load_etag_cache(cache_key)
    if cached_etag:
        headers["If-None-Match"] = cached_etag
        logger.debug(f"Using ETag cache: {cached_etag[:20]}...")

    # Make request with retry
    try:
        response, used_cache = _make_request_with_retry(url, headers)

        # Handle 304 (use cached data)
        if used_cache:
            cached_data = _load_cached_data(cache_key)
            if cached_data:
                return cached_data
            else:
                logger.warning("304 response but no cached data - re-fetching without ETag")
                headers.pop("If-None-Match", None)
                response, _ = _make_request_with_retry(url, headers)

        # Parse response
        data = response.json()

        # Validate response is a list (folder contents)
        if not isinstance(data, list):
            raise GitHubAPIError(f"Expected folder contents (list), got: {type(data)}")

        # Save ETag cache
        etag = response.headers.get("ETag")
        if etag:
            _save_etag_cache(cache_key, etag, data)

        logger.info(f"Fetched {len(data)} items from {owner}/{repo}/{folder_path}")
        return data

    except GitHubRateLimitError:
        logger.error("GitHub rate limit exceeded - cannot fetch folder contents")
        raise
    except GitHubAPIError:
        raise
    except Exception as e:
        raise GitHubAPIError(f"Failed to list folder contents: {e}") from e


def download_file_content(download_url: str) -> str:
    """
    Download file content from GitHub raw URL

    Args:
        download_url: Raw content URL (e.g., https://raw.githubusercontent.com/...)

    Returns:
        File content as string

    Raises:
        GitHubAPIError: On download errors
    """
    headers = {"User-Agent": "AIDailyNews-RSS-Fetcher/1.0"}

    try:
        response, _ = _make_request_with_retry(download_url, headers)
        content = response.text
        logger.info(f"Downloaded {len(content)} bytes from {download_url[:60]}...")
        return content

    except Exception as e:
        raise GitHubAPIError(f"Failed to download file: {e}") from e
