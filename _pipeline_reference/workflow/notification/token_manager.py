"""
Kakao Talk Token Manager
Handles OAuth token refresh and lifecycle management
Supports automatic GitHub Secrets update when refresh token is renewed
"""

import os
import requests
from loguru import logger


class TokenRefreshError(Exception):
    """Exception raised when token refresh fails"""
    pass


def _try_update_github_secret(new_refresh_token: str) -> bool:
    """Attempt to update GitHub Secrets with new refresh token"""
    try:
        from .github_secrets import auto_update_refresh_token
        return auto_update_refresh_token(new_refresh_token)
    except ImportError:
        logger.debug("GitHub secrets module not available")
        return False
    except Exception as e:
        logger.warning(f"Failed to auto-update GitHub secret: {e}")
        return False


class TokenManager:
    """Manages Kakao OAuth tokens (access token & refresh token)"""

    def __init__(self):
        self.refresh_token_endpoint = "https://kauth.kakao.com/oauth/token"
        self.token_info_endpoint = "https://kapi.kakao.com/v1/user/access_token_info"

    def refresh_access_token(self, rest_api_key: str, refresh_token: str, client_secret: str = None) -> str:
        """
        Refresh access token using refresh token
        """
        logger.info("Refreshing Kakao access token...")

        data = {
            'grant_type': 'refresh_token',
            'client_id': rest_api_key,
            'refresh_token': refresh_token
        }

        if client_secret:
            data['client_secret'] = client_secret

        try:
            response = requests.post(self.refresh_token_endpoint, data=data, timeout=10)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            raise TokenRefreshError(f"Failed to refresh token: {e}")

        tokens = response.json()
        new_access_token = tokens.get('access_token')
        if not new_access_token:
            raise TokenRefreshError(f"No access token in response: {tokens}")

        new_refresh_token = tokens.get('refresh_token', refresh_token)

        os.environ['KAKAO_ACCESS_TOKEN'] = new_access_token

        if new_refresh_token != refresh_token:
            os.environ['KAKAO_REFRESH_TOKEN'] = new_refresh_token
            logger.info(f"🔄 New refresh token issued (first 20 chars): {new_refresh_token[:20]}...")

            # Try to auto-update GitHub Secrets
            if _try_update_github_secret(new_refresh_token):
                logger.info("✅ GitHub Secret 'KAKAO_REFRESH_TOKEN' auto-updated successfully")
            else:
                logger.warning("⚠️ Could not auto-update GitHub Secrets - manual update may be needed")
                logger.warning("   Set GH_PAT and GITHUB_REPOSITORY to enable auto-update")

        logger.info("✅ Access token refreshed successfully")
        return new_access_token

    def validate_token(self, access_token: str) -> bool:
        """
        Check if access token is valid
        """
        headers = {
            'Authorization': f'Bearer {access_token}'
        }

        try:
            response = requests.get(self.token_info_endpoint, headers=headers, timeout=10)
            response.raise_for_status()

            token_info = response.json()
            expires_in = token_info.get('expires_in', 0)

            logger.info(f"Token valid for {expires_in} seconds")
            return expires_in > 0

        except requests.exceptions.RequestException:
            return False

    def should_refresh_token(self, access_token: str, threshold_seconds: int = 300) -> bool:
        """
        Check if token should be refreshed proactively
        """
        headers = {
            'Authorization': f'Bearer {access_token}'
        }

        try:
            response = requests.get(self.token_info_endpoint, headers=headers, timeout=10)
            response.raise_for_status()

            token_info = response.json()
            expires_in = token_info.get('expires_in', 0)

            return expires_in < threshold_seconds

        except requests.exceptions.RequestException:
            return True
