"""
GitHub Secrets Auto-Updater
Automatically updates GitHub repository secrets when Kakao refresh token is renewed
"""

import os
import base64
import requests
from loguru import logger

try:
    from nacl import public, encoding
    NACL_AVAILABLE = True
except ImportError:
    NACL_AVAILABLE = False


class GitHubSecretsUpdater:
    """Updates GitHub repository secrets via API"""

    def __init__(self, token: str = None, repo: str = None):
        """
        Initialize GitHub Secrets Updater

        Args:
            token: GitHub Personal Access Token (needs 'repo' scope)
            repo: Repository in format 'owner/repo'
        """
        self.token = token or os.environ.get("GH_PAT") or os.environ.get("GITHUB_PAT")
        self.repo = repo or os.environ.get("GITHUB_REPOSITORY")
        self.api_base = "https://api.github.com"

    def _get_headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }

    def _get_public_key(self) -> tuple:
        """Get repository public key for encrypting secrets"""
        url = f"{self.api_base}/repos/{self.repo}/actions/secrets/public-key"
        response = requests.get(url, headers=self._get_headers(), timeout=10)
        response.raise_for_status()
        data = response.json()
        return data["key_id"], data["key"]

    def _encrypt_secret(self, public_key: str, secret_value: str) -> str:
        """Encrypt secret value using repository's public key"""
        if not NACL_AVAILABLE:
            raise ImportError("PyNaCl is required for secret encryption. Install with: pip install pynacl")

        public_key_bytes = public.PublicKey(public_key.encode("utf-8"), encoding.Base64Encoder())
        sealed_box = public.SealedBox(public_key_bytes)
        encrypted = sealed_box.encrypt(secret_value.encode("utf-8"))
        return base64.b64encode(encrypted).decode("utf-8")

    def update_secret(self, secret_name: str, secret_value: str) -> bool:
        """
        Update a GitHub repository secret

        Args:
            secret_name: Name of the secret (e.g., 'KAKAO_REFRESH_TOKEN')
            secret_value: New value for the secret

        Returns:
            True if successful, False otherwise
        """
        if not self.token:
            logger.warning("GitHub PAT not configured - cannot auto-update secrets")
            return False

        if not self.repo:
            logger.warning("GitHub repository not configured - cannot auto-update secrets")
            return False

        try:
            # Get public key for encryption
            key_id, public_key = self._get_public_key()

            # Encrypt the secret value
            encrypted_value = self._encrypt_secret(public_key, secret_value)

            # Update the secret
            url = f"{self.api_base}/repos/{self.repo}/actions/secrets/{secret_name}"
            data = {
                "encrypted_value": encrypted_value,
                "key_id": key_id
            }

            response = requests.put(url, headers=self._get_headers(), json=data, timeout=10)

            if response.status_code in [201, 204]:
                logger.info(f"✅ GitHub Secret '{secret_name}' updated successfully")
                return True
            else:
                logger.error(f"❌ Failed to update secret: {response.status_code} - {response.text}")
                return False

        except ImportError as e:
            logger.error(f"❌ Missing dependency: {e}")
            return False
        except requests.exceptions.RequestException as e:
            logger.error(f"❌ GitHub API error: {e}")
            return False
        except Exception as e:
            logger.error(f"❌ Unexpected error updating GitHub secret: {e}")
            return False

    def is_configured(self) -> bool:
        """Check if GitHub secrets auto-update is properly configured"""
        return bool(self.token and self.repo)


def auto_update_refresh_token(new_refresh_token: str) -> bool:
    """
    Convenience function to update KAKAO_REFRESH_TOKEN in GitHub Secrets

    Args:
        new_refresh_token: The new refresh token value

    Returns:
        True if updated successfully, False otherwise
    """
    updater = GitHubSecretsUpdater()

    if not updater.is_configured():
        logger.info("GitHub Secrets auto-update not configured (GH_PAT or GITHUB_REPOSITORY missing)")
        return False

    return updater.update_secret("KAKAO_REFRESH_TOKEN", new_refresh_token)
