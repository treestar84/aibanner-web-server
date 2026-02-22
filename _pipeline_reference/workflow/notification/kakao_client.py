"""
Kakao Talk API Client
Handles "나에게 보내기" (Send to Me) message API
"""

import requests
import time
from functools import wraps
from loguru import logger
from typing import Dict, Any

from .token_manager import TokenManager, TokenRefreshError


class KakaoAPIError(Exception):
    """Exception raised for Kakao API errors"""
    def __init__(self, code: int, message: str):
        self.code = code
        self.message = message
        super().__init__(f"Kakao API Error {code}: {message}")


def retry_with_backoff(max_retries=3, base_delay=2):
    """Decorator for exponential backoff retry logic"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except (requests.Timeout, requests.ConnectionError) as e:
                    if attempt == max_retries - 1:
                        raise
                    delay = base_delay * (2 ** attempt)
                    logger.warning(f"Attempt {attempt+1}/{max_retries} failed: {e}. Retrying in {delay}s...")
                    time.sleep(delay)
        return wrapper
    return decorator


class KakaoClient:
    """Client for Kakao Talk API"""

    def __init__(self, rest_api_key: str, access_token: str, refresh_token: str, client_secret: str = None):
        self.rest_api_key = rest_api_key
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.client_secret = client_secret
        self.token_manager = TokenManager()
        self.send_endpoint = "https://kapi.kakao.com/v2/api/talk/memo/default/send"

    @retry_with_backoff(max_retries=3, base_delay=2)
    def _make_api_request(self, url: str, data: Dict[str, Any]) -> Dict[str, Any]:
        headers = {
            'Authorization': f'Bearer {self.access_token}',
            'Content-Type': 'application/x-www-form-urlencoded'
        }

        response = requests.post(url, headers=headers, data=data, timeout=10)

        if response.status_code != 200:
            try:
                error_data = response.json()
                error_code = error_data.get('error_code', response.status_code)
                error_message = error_data.get('error_description', 'Unknown error')
            except ValueError:
                error_code = response.status_code
                error_message = response.text
            raise KakaoAPIError(error_code, error_message)

        return response.json()

    def send_to_me(self, template_object: Dict[str, Any]) -> Dict[str, Any]:
        import json

        data = {
            'template_object': json.dumps(template_object, ensure_ascii=False)
        }

        try:
            logger.info("Sending Kakao Talk notification...")
            result = self._make_api_request(self.send_endpoint, data)
            logger.info(f"✅ Message sent successfully: {result}")
            return result

        except KakaoAPIError as e:
            # Handle token expiration (HTTP 401 or error_code -401)
            if e.code == 401 or e.code == -401:
                logger.info("Access token expired, refreshing...")
                try:
                    new_token = self.token_manager.refresh_access_token(
                        self.rest_api_key,
                        self.refresh_token,
                        self.client_secret
                    )
                    self.access_token = new_token
                    logger.info("Retrying with refreshed token...")
                    result = self._make_api_request(self.send_endpoint, data)
                    logger.info(f"✅ Message sent successfully after token refresh: {result}")
                    return result

                except TokenRefreshError as refresh_err:
                    logger.error(f"Failed to refresh token: {refresh_err}")
                    raise

            logger.error(f"Kakao API error: {e}")
            raise

    def validate_token(self) -> bool:
        return self.token_manager.validate_token(self.access_token)
