#!/usr/bin/env python3
"""
Unit tests for Upstox Authentication Module

Tests the UpstoxAuthHandler class and related authentication functionality.
"""

import unittest
import json
import tempfile
import shutil
from pathlib import Path
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, MagicMock

# Add the parent directory to the path for imports
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from config_and_utils.upstox_auth import UpstoxAuthHandler, create_upstox_auth, TOKEN_FILE


class TestUpstoxAuthHandler(unittest.TestCase):
    """Test cases for UpstoxAuthHandler class."""

    def setUp(self):
        """Set up test fixtures."""
        self.api_key = "test_api_key"
        self.api_secret = "test_api_secret"
        self.test_token = "test_access_token_12345"

        # Create a temporary directory for token files
        self.temp_dir = tempfile.mkdtemp()
        self.original_token_file = TOKEN_FILE

        # Mock the TOKEN_FILE constant directly
        self.patcher = patch('upstox_trader.config_and_utils.upstox_auth.TOKEN_FILE',
                           Path(self.temp_dir) / ".upstox_token.json")
        self.patcher.start()

    def tearDown(self):
        """Clean up test fixtures."""
        self.patcher.stop()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_initialization(self):
        """Test UpstoxAuthHandler initialization."""
        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)

        self.assertEqual(auth.api_key, self.api_key)
        self.assertEqual(auth.api_secret, self.api_secret)
        self.assertIsNone(auth.access_token)
        self.assertTrue(auth.quiet)

    def test_initialization_quiet_mode(self):
        """Test UpstoxAuthHandler initialization in quiet mode."""
        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)

        self.assertTrue(auth.quiet)

    def test_save_token_with_token(self):
        """Test that save_token works when token is available."""
        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)
        auth.access_token = self.test_token

        # Test that the method returns True when token is available
        # (The actual file operations are tested in integration tests)
        result = auth.save_token()
        self.assertTrue(result)

    def test_save_token_no_token(self):
        """Test save_token when no token is available."""
        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)

        result = auth.save_token()

        self.assertFalse(result)

    def test_load_token_success(self):
        """Test loading a valid token from file."""
        # Create a token file manually
        token_data = {
            'access_token': self.test_token,
            'timestamp': datetime.now().isoformat()
        }
        token_file = Path(self.temp_dir) / ".upstox_token.json"
        with open(token_file, 'w') as f:
            json.dump(token_data, f)

        # Test loading
        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)

        # Mock the TOKEN_FILE constant at module level
        with patch('upstox_trader.config_and_utils.upstox_auth.TOKEN_FILE', token_file):
            result = auth.load_token()

            self.assertTrue(result)
            self.assertEqual(auth.access_token, self.test_token)

    def test_load_token_expired(self):
        """Test loading an expired token."""
        # Create an expired token file
        expired_time = datetime.now() - timedelta(hours=25)
        token_data = {
            'access_token': self.test_token,
            'timestamp': expired_time.isoformat()
        }
        token_file = Path(self.temp_dir) / ".upstox_token.json"
        with open(token_file, 'w') as f:
            json.dump(token_data, f)

        # Test loading (should fail and remove file)
        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)

        # Mock the TOKEN_FILE constant at module level
        with patch('upstox_trader.config_and_utils.upstox_auth.TOKEN_FILE', token_file):
            result = auth.load_token()

            self.assertFalse(result)
            self.assertIsNone(auth.access_token)

    def test_load_token_no_file(self):
        """Test loading token when no file exists."""
        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)
        result = auth.load_token()

        self.assertFalse(result)
        self.assertIsNone(auth.access_token)

    def test_load_token_corrupted_file(self):
        """Test loading token from corrupted file."""
        token_file = Path(self.temp_dir) / ".upstox_token.json"
        with open(token_file, 'w') as f:
            f.write("invalid json content")

        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)
        result = auth.load_token()

        self.assertFalse(result)
        self.assertIsNone(auth.access_token)

    def test_get_headers_with_token(self):
        """Test get_headers method with valid token."""
        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)
        auth.access_token = self.test_token

        headers = auth.get_headers()

        self.assertIn('Accept', headers)
        self.assertIn('Api-Version', headers)
        self.assertIn('Authorization', headers)
        self.assertEqual(headers['Accept'], 'application/json')
        self.assertEqual(headers['Api-Version'], '2.0')
        self.assertEqual(headers['Authorization'], f'Bearer {self.test_token}')

    def test_get_headers_no_token(self):
        """Test get_headers method without token."""
        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)

        headers = auth.get_headers()

        self.assertIn('Authorization', headers)
        self.assertEqual(headers['Authorization'], 'Bearer None')

    @patch('upstox_trader.config_and_utils.upstox_auth.requests.post')
    def test_get_access_token_success(self, mock_post):
        """Test successful token exchange."""
        # Mock successful API response
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {'access_token': self.test_token}
        mock_post.return_value = mock_response

        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)
        result = auth._get_access_token("test_auth_code")

        self.assertEqual(result, self.test_token)
        mock_post.assert_called_once()

    @patch('upstox_trader.config_and_utils.upstox_auth.requests.post')
    def test_get_access_token_failure(self, mock_post):
        """Test failed token exchange."""
        # Mock failed API response
        mock_response = Mock()
        mock_response.raise_for_status.side_effect = Exception("API Error")
        mock_post.return_value = mock_response

        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)
        result = auth._get_access_token("test_auth_code")

        self.assertIsNone(result)

    def test_validate_token_no_token(self):
        """Test token validation when no token is available."""
        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)
        result = auth.validate_token()

        self.assertFalse(result)

    @patch('upstox_trader.config_and_utils.upstox_auth.requests.get')
    def test_validate_token_success(self, mock_get):
        """Test successful token validation."""
        # Mock successful API response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)
        auth.access_token = self.test_token
        result = auth.validate_token()

        self.assertTrue(result)
        mock_get.assert_called_once()

    @patch('upstox_trader.config_and_utils.upstox_auth.requests.get')
    def test_validate_token_expired(self, mock_get):
        """Test expired token validation."""
        # Mock 401 response (unauthorized)
        mock_response = Mock()
        mock_response.status_code = 401
        mock_get.return_value = mock_response

        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)
        auth.access_token = self.test_token
        result = auth.validate_token()

        self.assertFalse(result)

    def test_refresh_token_success(self):
        """Test successful token refresh."""
        # Create expired token file
        expired_time = datetime.now() - timedelta(hours=25)
        token_data = {
            'access_token': self.test_token,
            'timestamp': expired_time.isoformat()
        }
        token_file = Path(self.temp_dir) / ".upstox_token.json"
        with open(token_file, 'w') as f:
            json.dump(token_data, f)

        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)

        with patch.object(auth, 'authenticate', return_value=True) as mock_auth:
            result = auth.refresh_token()

            self.assertTrue(result)
            mock_auth.assert_called_once()

    def test_refresh_token_failure(self):
        """Test failed token refresh."""
        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)

        with patch.object(auth, 'authenticate', return_value=False) as mock_auth:
            result = auth.refresh_token()

            self.assertFalse(result)
            mock_auth.assert_called_once()

    def test_handle_websocket_token_refresh_success(self):
        """Test successful WebSocket token refresh."""
        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)

        with patch.object(auth, 'authenticate', return_value=True) as mock_auth:
            result = auth.handle_websocket_token_refresh()

            self.assertTrue(result)
            mock_auth.assert_called_once()

    def test_handle_websocket_token_refresh_failure(self):
        """Test failed WebSocket token refresh."""
        auth = UpstoxAuthHandler(self.api_key, self.api_secret, quiet=True)

        with patch.object(auth, 'authenticate', return_value=False) as mock_auth:
            result = auth.handle_websocket_token_refresh()

            self.assertFalse(result)
            mock_auth.assert_called_once()


class TestCreateUpstoxAuth(unittest.TestCase):
    """Test cases for create_upstox_auth factory function."""

    def setUp(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp()

        # Mock the TOKEN_FILE constant directly in the module
        with patch('upstox_trader.config_and_utils.upstox_auth.TOKEN_FILE',
                  Path(self.temp_dir) / ".upstox_token.json"):
            # Import after patching
            import importlib
            auth_module = importlib.import_module('upstox_trader.config_and_utils.upstox_auth')
            self.mocked_token_file = Path(self.temp_dir) / ".upstox_token.json"

    def tearDown(self):
        """Clean up test fixtures."""
        self.patcher.stop()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_create_upstox_auth_basic(self):
        """Test basic factory function usage."""
        auth = create_upstox_auth("test_key", "test_secret", quiet=True)

        self.assertIsInstance(auth, UpstoxAuthHandler)
        self.assertEqual(auth.api_key, "test_key")
        self.assertEqual(auth.api_secret, "test_secret")
        self.assertTrue(auth.quiet)

    def test_create_upstox_auth_loads_existing_token(self):
        """Test factory function loads existing token."""
        # Create a valid token file
        token_data = {
            'access_token': "existing_token",
            'timestamp': datetime.now().isoformat()
        }
        token_file = Path(self.temp_dir) / ".upstox_token.json"
        with open(token_file, 'w') as f:
            json.dump(token_data, f)

        auth = create_upstox_auth("test_key", "test_secret", quiet=True)

        self.assertEqual(auth.access_token, "existing_token")


class TestTokenFileConsistency(unittest.TestCase):
    """Test that token file path is consistent across different usage scenarios."""

    def setUp(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp()

        # Mock the TOKEN_FILE constant directly
        self.patcher = patch('upstox_trader.config_and_utils.upstox_auth.TOKEN_FILE',
                           Path(self.temp_dir) / ".upstox_token.json")
        self.patcher.start()

    def tearDown(self):
        """Clean up test fixtures."""
        self.patcher.stop()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_token_file_path_consistency(self):
        """Test that token file path is always the same regardless of import method."""
        # Import using different methods
        from upstox_trader.config_and_utils.upstox_auth import TOKEN_FILE as token_file_1

        # The token file should be mocked to our temp directory
        expected_path = Path(self.temp_dir) / ".upstox_token.json"
        self.assertEqual(token_file_1, expected_path)
        self.assertTrue(token_file_1.is_absolute())


if __name__ == '__main__':
    unittest.main(verbosity=2)