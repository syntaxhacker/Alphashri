#!/usr/bin/env python3
"""
Upstox Authentication Module

Handles OAuth2 authentication, token management, and WebSocket token refresh
for Upstox API integration.
"""

import json
import time
import requests
import webbrowser
import http.server
import socketserver
import threading
import urllib.parse
from datetime import datetime, timedelta
from typing import Optional, Dict, Callable
from pathlib import Path
import os

# Constants - Store token in project root for consistency
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
TOKEN_FILE = PROJECT_ROOT / ".upstox_token.json"
REDIRECT_URI = "http://localhost:5000/callback"
BASE_URL_V2 = "https://api.upstox.com/v2"


class UpstoxAuthHandler:
    """
    Handles Upstox OAuth2 authentication and token management.

    Features:
    - OAuth2 authentication flow with persistent tokens
    - Automatic token validation and refresh
    - WebSocket token refresh handling
    - Local auth server for callback handling
    """

    def __init__(self, api_key: str, api_secret: str, quiet: bool = False):
        """
        Initialize the Upstox authentication handler.

        Args:
            api_key (str): Your Upstox API key
            api_secret (str): Your Upstox API secret
            quiet (bool): If True, suppresses console output. Default is False.
        """
        self.api_key = api_key
        self.api_secret = api_secret
        self.access_token = None
        self.redirect_uri = REDIRECT_URI
        self._auth_code = None
        self._httpd = None
        self.quiet = quiet

        if not self.quiet:
            print("🔐 Upstox Authentication Handler Initialized")

    def _load_token_from_db(self) -> bool:
        """Try loading token from DB (broker_connections table) first."""
        try:
            from db.models import get_shared_broker_token
            token_data = get_shared_broker_token("upstox")
            if token_data and token_data.get("access_token"):
                self.access_token = token_data["access_token"]
                if not self.quiet:
                    print("✅ Access token loaded from DB (broker_connections)")
                return True
        except Exception as e:
            if not self.quiet:
                print(f"⚠️ DB token load failed: {e}")
        return False

    def load_token(self) -> bool:
        """Load access token: DB -> env var -> file (in that order)."""
        if self._load_token_from_db():
            return True

        # Fallback: UPSTOX_ACCESS_TOKEN env var (set via load_dotenv or CI)
        import os as _os
        _env_tok = _os.environ.get('UPSTOX_ACCESS_TOKEN')
        if _env_tok:
            self.access_token = _env_tok
            if not self.quiet:
                print("✅ Access token loaded from UPSTOX_ACCESS_TOKEN env var")
            return True

        if TOKEN_FILE.exists():
            try:
                with open(TOKEN_FILE, 'r') as f:
                    token_data = json.load(f)

                token_time = datetime.fromisoformat(token_data.get('timestamp', '1970-01-01'))
                if datetime.now() - token_time < timedelta(hours=23):
                    self.access_token = token_data.get('access_token')
                    if not self.quiet:
                        age_hours = (datetime.now() - token_time).total_seconds() / 3600
                        print(f"✅ Access token loaded from file (age: {age_hours:.1f}h)")
                    return True
                else:
                    if not self.quiet:
                        print("🟡 File token expired (>23h old)")
            except (json.JSONDecodeError, KeyError) as e:
                if not self.quiet:
                    print(f"⚠️ Could not read token file: {e}")
        else:
            if not self.quiet:
                print(f"🔑 No token file at {TOKEN_FILE}")

        return False

    def save_token(self) -> bool:
        """Save the access token and current timestamp to a local file."""
        if self.access_token:
            token_data = {
                'access_token': self.access_token,
                'timestamp': datetime.now().isoformat()
            }
            with open(TOKEN_FILE, 'w') as f:
                json.dump(token_data, f)
            if not self.quiet:
                print(f"✅ Access token saved to {TOKEN_FILE}")
            return True
        return False

    def _start_auth_server(self):
        """Starts a temporary local server to catch the OAuth2 callback."""
        self._auth_code = None

        class AuthHandler(http.server.SimpleHTTPRequestHandler):
            def do_GET(self_handler):
                if '/callback' in self_handler.path:
                    query = urllib.parse.urlparse(self_handler.path).query
                    params = urllib.parse.parse_qs(query)
                    if 'code' in params:
                        self._auth_code = params['code'][0]
                        self_handler.send_response(200)
                        self_handler.send_header('Content-type', 'text/html')
                        self_handler.end_headers()
                        self_handler.wfile.write(b"<html><body><h1>Authentication successful!</h1><p>You can close this window now.</p></body></html>")
                        threading.Thread(target=self._httpd.shutdown).start()
                    else:
                        self_handler.send_response(400)
                else:
                    self_handler.send_response(404)

            def log_message(self, format, *args):
                pass

        try:
            self._httpd = socketserver.TCPServer(('localhost', 5000), AuthHandler)
            if not self.quiet:
                print("🔐 Waiting for authentication... Please log in to Upstox in your browser.")
            self._httpd.serve_forever()
        except Exception as e:
            if not self.quiet:
                print(f"❌ Failed to start auth server: {e}")
        finally:
            if self._httpd:
                self._httpd.server_close()

    def _get_access_token(self, auth_code: str) -> Optional[str]:
        """Exchange the authorization code for an access token."""
        headers = {'Accept': 'application/json'}
        data = {
            'code': auth_code,
            'client_id': self.api_key,
            'client_secret': self.api_secret,
            'redirect_uri': self.redirect_uri,
            'grant_type': 'authorization_code'
        }
        try:
            response = requests.post(f"{BASE_URL_V2}/login/authorization/token", headers=headers, data=data, timeout=30)
            response.raise_for_status()
            return response.json().get('access_token')
        except requests.RequestException as e:
            if not self.quiet:
                print(f"❌ Token generation failed: {e.response.text if e.response else e}")
            return None

    def authenticate(self) -> bool:
        """Initiates the full OAuth2 authentication flow."""
        if self.access_token:
            if not self.quiet:
                print("✅ Already authenticated.")
            return True

        server_thread = threading.Thread(target=self._start_auth_server)
        server_thread.daemon = True
        server_thread.start()
        time.sleep(1)

        login_url = f"{BASE_URL_V2}/login/authorization/dialog?response_type=code&client_id={self.api_key}&redirect_uri={self.redirect_uri}"
        if not self.quiet:
            print(f"🔐 Opening browser for authentication: {login_url}")
        webbrowser.open(login_url)

        server_thread.join(timeout=120)

        if not self._auth_code:
            if not self.quiet:
                print("❌ Authentication timed out or failed.")
            return False

        if not self.quiet:
            print("✅ Authentication code received.")
        self.access_token = self._get_access_token(self._auth_code)
        if self.access_token:
            if not self.quiet:
                print("✅ Access token obtained successfully!")
            self.save_token()
            return True
        else:
            if not self.quiet:
                print("❌ Failed to obtain access token.")
            return False

    def validate_token(self) -> bool:
        """
        Validate if the current access token is still valid.
        Returns True if token is valid, False otherwise.
        Note: This makes an API call, so use sparingly.
        """
        if not self.access_token:
            return False

        try:
            # Use a lightweight endpoint to test token validity
            headers = {
                'Accept': 'application/json',
                'Api-Version': '2.0',
                'Authorization': f'Bearer {self.access_token}'
            }
            response = requests.get(f"{BASE_URL_V2}/user/profile", headers=headers, timeout=10)

            if response.status_code == 200:
                if not self.quiet:
                    print("✅ Token is valid")
                return True
            elif response.status_code == 401:
                if not self.quiet:
                    print("🟡 Token invalid (401 Unauthorized)")
                # Only delete token file when confirmed invalid
                if TOKEN_FILE.exists():
                    TOKEN_FILE.unlink()
                return False
            elif response.status_code == 400:
                # Sometimes 400 means the endpoint doesn't exist, but token is valid
                # Try a different endpoint to confirm
                if not self.quiet:
                    print("⚠️ Token validation endpoint returned 400, assuming valid")
                return True
            else:
                if not self.quiet:
                    print(f"⚠️ Token validation returned {response.status_code}, assuming invalid")
                return False

        except requests.RequestException as e:
            if not self.quiet:
                print(f"⚠️ Token validation network error: {e}")
            # On network error, assume token is still valid (don't force re-auth)
            return True
        except Exception as e:
            if not self.quiet:
                print(f"⚠️ Token validation error: {e}")
            return True

    def refresh_token(self) -> bool:
        """Refresh the access token by clearing current and re-authenticating."""
        try:
            # Clear current token and cached file
            self.access_token = None
            if TOKEN_FILE.exists():
                TOKEN_FILE.unlink()

            # Re-authenticate
            if not self.quiet:
                print("🔐 Re-authenticating with Upstox...")

            if self.authenticate():
                if not self.quiet:
                    print("✅ Re-authentication successful!")
                return True
            else:
                if not self.quiet:
                    print("❌ Re-authentication failed")
                return False

        except Exception as e:
            if not self.quiet:
                print(f"❌ Token refresh failed: {e}")
            return False

    def get_headers(self) -> Dict[str, str]:
        """Constructs the required headers for API calls."""
        return {
            'Accept': 'application/json',
            'Api-Version': '2.0',
            'Authorization': f'Bearer {self.access_token}'
        }

    def handle_websocket_token_refresh(self) -> bool:
        """Handle token refresh when WebSocket authentication fails."""
        try:
            # Clear the current token
            self.access_token = None

            # Remove the cached token file to force fresh authentication
            if TOKEN_FILE.exists():
                TOKEN_FILE.unlink()

            # Re-authenticate
            if not self.quiet:
                print("🔐 Re-authenticating with Upstox...")

            if self.authenticate():
                if not self.quiet:
                    print("✅ Re-authentication successful!")
                return True
            else:
                if not self.quiet:
                    print("❌ Re-authentication failed")
                return False

        except Exception as e:
            if not self.quiet:
                print(f"❌ Token refresh failed: {e}")
            return False


def create_upstox_auth(api_key: str, api_secret: str, quiet: bool = False,
                       validate: bool = False) -> UpstoxAuthHandler:
    """
    Factory function to create and initialize Upstox authentication handler.

    Args:
        api_key (str): Your Upstox API key
        api_secret (str): Your Upstox API secret
        quiet (bool): If True, suppresses console output. Default is False.
        validate (bool): If True, validates token with API call. Default is False.

    Returns:
        UpstoxAuthHandler: Configured authentication handler with loaded token

    Usage:
        # Standard usage - just loads cached token (no API call)
        auth = create_upstox_auth(api_key, api_secret)

        # If you need to validate token is actually working
        auth = create_upstox_auth(api_key, api_secret, validate=True)
    """
    auth_handler = UpstoxAuthHandler(api_key, api_secret, quiet)

    # Try to load existing token first (no API call)
    token_loaded = auth_handler.load_token()

    # Only validate if explicitly requested
    if validate and token_loaded:
        if not auth_handler.validate_token():
            if not quiet:
                print("⚠️ Cached token invalid, re-authentication required")
            auth_handler.authenticate()
    elif not token_loaded and not quiet:
        print("⚠️ No cached token found. Call auth.authenticate() when ready.")

    return auth_handler


def get_authenticated_upstox(api_key: str, api_secret: str, quiet: bool = False) -> UpstoxAuthHandler:
    """
    Get a fully authenticated Upstox handler, ready to use.
    Will authenticate automatically if needed (may open browser).

    Args:
        api_key (str): Your Upstox API key
        api_secret (str): Your Upstox API secret
        quiet (bool): If True, suppresses console output. Default is False.

    Returns:
        UpstoxAuthHandler: Authenticated handler with valid access token

    Usage:
        auth = get_authenticated_upstox(api_key, api_secret)
        # auth.access_token is guaranteed to be set (though may still be expired)
    """
    auth = create_upstox_auth(api_key, api_secret, quiet)

    if not auth.access_token:
        if not quiet:
            print("🔐 No token available, starting authentication...")
        auth.authenticate()

    return auth