"""
Token Manager for unified token management across trading APIs.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Optional


class TokenManager:
    """
    Unified token management for trading APIs.

    Handles token storage, expiration tracking, and validation
    for both Upstox and INDMONEY APIs.
    """

    def __init__(self, token_file: Path, expiry_hours: float, quiet: bool = False):
        """
        Initialize token manager.

        Args:
            token_file: Path to token cache file
            expiry_hours: Token validity period in hours
            quiet: Suppress console output
        """
        self.token_file = token_file
        self.expiry_hours = expiry_hours
        self.quiet = quiet
        self.token_timestamp = datetime.now()

        self._load_token_metadata()

    def _load_token_metadata(self):
        """Load token timestamp from cache file."""
        if self.token_file.exists():
            try:
                with open(self.token_file, 'r') as f:
                    token_data = json.load(f)
                    self.token_timestamp = datetime.fromisoformat(
                        token_data.get('timestamp', datetime.now().isoformat())
                    )
            except Exception:
                pass

    def _save_token_metadata(self, partial_token: str = None):
        """
        Save token metadata to cache file.

        Args:
            partial_token: Optional partial token (first 20 chars) for reference
        """
        try:
            with open(self.token_file, 'w') as f:
                json.dump({
                    'timestamp': self.token_timestamp.isoformat(),
                    'partial_token': partial_token or 'unknown',
                    'expiry_hours': self.expiry_hours
                }, f)
        except Exception:
            pass

    def is_token_expired(self) -> bool:
        """
        Check if token has expired.

        Returns:
            bool: True if token is expired
        """
        if self.token_timestamp is None:
            return False

        token_age = datetime.now() - self.token_timestamp
        return token_age.total_seconds() > (self.expiry_hours * 3600)

    def get_token_age_hours(self) -> float:
        """
        Get token age in hours.

        Returns:
            float: Token age in hours
        """
        if self.token_timestamp is None:
            return 0.0

        token_age = datetime.now() - self.token_timestamp
        return token_age.total_seconds() / 3600

    def check_token_validity(self, provider_name: str, token_url: str):
        """
        Check token validity and raise error if expired.

        Args:
            provider_name: Name of the provider (for error messages)
            token_url: URL to get new token (for error messages)

        Raises:
            ValueError: If token is expired
        """
        if self.is_token_expired():
            age = self.get_token_age_hours()
            self._log_error(f"❌ {provider_name} token expired ({age:.1f} hours old)")
            self._log_error(f"🔑 Get new token at: {token_url}")
            raise ValueError(
                f"{provider_name} access token has expired ({self.expiry_hours:.0f}-hour validity). "
                f"Please generate a new token from {token_url} "
                f"and update your config.py"
            )

        token_age = self.get_token_age_hours()
        warning_threshold = self.expiry_hours * 0.8

        if token_age > warning_threshold and not self.quiet:
            remaining = self.expiry_hours - token_age
            self._log(f"⚠️  {provider_name} token is {token_age:.1f}h old "
                     f"(expires in {remaining:.1f}h)")

    def refresh_token_timestamp(self, partial_token: str = None):
        """
        Update token timestamp (call when token is refreshed).

        Args:
            partial_token: Optional partial token for reference
        """
        self.token_timestamp = datetime.now()
        self._save_token_metadata(partial_token)

    def _log_error(self, message: str):
        """Log error message (always shown)."""
        print(message)

    def _log(self, message: str):
        """Log message if not in quiet mode."""
        if not self.quiet:
            print(message)
