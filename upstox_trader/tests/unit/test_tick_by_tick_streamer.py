import pytest
import pandas as pd
import numpy as np
from unittest.mock import Mock, patch, MagicMock, call
from datetime import datetime, timedelta
import sys
import os
import json
from pathlib import Path

# Add the parent directories to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from screeners.tick_by_tick_streamer import TickByTickStreamer


class TestTickByTickStreamerInitialization:
    """Test TickByTickStreamer class initialization"""

    def test_initialization_with_valid_symbols(self):
        """Test initialization with valid symbol list"""
        symbols = ['RELIANCE', 'TCS', 'INFY']
        api_key = 'test_key'
        api_secret = 'test_secret'

        streamer = TickByTickStreamer(symbols, api_key, api_secret)

        assert streamer.symbols == symbols
        assert streamer.api_key == api_key
        assert streamer.api_secret == api_secret
        assert len(streamer.current_prices) == len(symbols)
        assert len(streamer.price_history) == len(symbols)
        assert len(streamer.update_count) == len(symbols)
        assert len(streamer.last_update_time) == len(symbols)

        # Check all symbols are initialized
        for symbol in symbols:
            assert symbol in streamer.current_prices
            assert symbol in streamer.price_history
            assert symbol in streamer.update_count
            assert symbol in streamer.last_update_time
            assert streamer.current_prices[symbol] == 0.0
            assert streamer.price_history[symbol] == []
            assert streamer.update_count[symbol] == 0
            assert streamer.last_update_time[symbol] is None

    def test_initialization_with_single_symbol(self):
        """Test initialization with single symbol string"""
        symbols = ['RELIANCE']
        api_key = 'test_key'
        api_secret = 'test_secret'

        streamer = TickByTickStreamer(symbols, api_key, api_secret)

        assert streamer.symbols == symbols
        assert len(streamer.current_prices) == 1
        assert 'RELIANCE' in streamer.current_prices

    def test_initialization_empty_symbols(self):
        """Test initialization with empty symbols list"""
        symbols = []
        api_key = 'test_key'
        api_secret = 'test_secret'

        streamer = TickByTickStreamer(symbols, api_key, api_secret)

        assert streamer.symbols == []
        assert len(streamer.current_prices) == 0


class TestTickByTickStreamerAuthentication:
    """Test authentication functionality"""

    @patch('screeners.tick_by_tick_streamer.UpstoxAPI')
    def test_authentication_success(self, mock_api_class):
        """Test successful authentication"""
        # Setup mock API
        mock_api = Mock()
        mock_api_class.return_value = mock_api
        mock_api.access_token = None  # No existing token
        mock_api.authenticate.return_value = True

        symbols = ['RELIANCE']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')

        # Replace the API instance
        streamer.upstox_api = mock_api

        result = streamer.authenticate()

        assert result is True
        mock_api.authenticate.assert_called_once()

    @patch('screeners.tick_by_tick_streamer.UpstoxAPI')
    def test_authentication_with_existing_token(self, mock_api_class):
        """Test authentication when token already exists"""
        # Setup mock API with existing token
        mock_api = Mock()
        mock_api_class.return_value = mock_api
        mock_api.access_token = 'existing_token'  # Token already exists

        symbols = ['RELIANCE']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')
        streamer.upstox_api = mock_api

        result = streamer.authenticate()

        assert result is True
        mock_api.authenticate.assert_not_called()  # Should not authenticate if token exists

    @patch('screeners.tick_by_tick_streamer.UpstoxAPI')
    def test_authentication_failure(self, mock_api_class):
        """Test authentication failure"""
        # Setup mock API that fails authentication
        mock_api = Mock()
        mock_api_class.return_value = mock_api
        mock_api.access_token = None
        mock_api.authenticate.return_value = False

        symbols = ['RELIANCE']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')
        streamer.upstox_api = mock_api

        result = streamer.authenticate()

        assert result is False
        mock_api.authenticate.assert_called_once()


class TestTickByTickStreamerInstrumentKeys:
    """Test instrument key retrieval functionality"""

    @patch('screeners.tick_by_tick_streamer.UpstoxAPI')
    def test_get_instrument_keys_success(self, mock_api_class):
        """Test successful instrument key retrieval"""
        # Setup mock API
        mock_api = Mock()
        mock_api_class.return_value = mock_api

        # Mock instrument keys for different symbols
        mock_api.get_instrument_key.side_effect = [
            'NSE_EQ|INE002A01018',  # RELIANCE
            'NSE_EQ|INE467B01029',  # TCS
            'NSE_EQ|INE009A01021'   # INFY
        ]

        symbols = ['RELIANCE', 'TCS', 'INFY']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')
        streamer.upstox_api = mock_api

        result = streamer.get_instrument_keys()

        expected_keys = {
            'RELIANCE': 'NSE_EQ|INE002A01018',
            'TCS': 'NSE_EQ|INE467B01029',
            'INFY': 'NSE_EQ|INE009A01021'
        }

        assert result == expected_keys
        assert mock_api.get_instrument_key.call_count == 3

        # Verify correct symbols were passed to API
        calls = mock_api.get_instrument_key.call_args_list
        called_symbols = [call[0][0] for call in calls]
        assert called_symbols == symbols

    @patch('screeners.tick_by_tick_streamer.UpstoxAPI')
    def test_get_instrument_keys_partial_failure(self, mock_api_class):
        """Test instrument key retrieval with some failures"""
        # Setup mock API with mixed success/failure
        mock_api = Mock()
        mock_api_class.return_value = mock_api

        mock_api.get_instrument_key.side_effect = [
            'NSE_EQ|INE002A01018',  # RELIANCE - success
            None,                   # TCS - failure
            'NSE_EQ|INE009A01021'   # INFY - success
        ]

        symbols = ['RELIANCE', 'TCS', 'INFY']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')
        streamer.upstox_api = mock_api

        result = streamer.get_instrument_keys()

        expected_keys = {
            'RELIANCE': 'NSE_EQ|INE002A01018',
            'INFY': 'NSE_EQ|INE009A01021'
        }

        assert result == expected_keys
        assert mock_api.get_instrument_key.call_count == 3

    @patch('screeners.tick_by_tick_streamer.UpstoxAPI')
    def test_get_instrument_keys_all_failures(self, mock_api_class):
        """Test instrument key retrieval with all failures"""
        # Setup mock API with all failures
        mock_api = Mock()
        mock_api_class.return_value = mock_api

        mock_api.get_instrument_key.return_value = None

        symbols = ['RELIANCE', 'TCS']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')
        streamer.upstox_api = mock_api

        result = streamer.get_instrument_keys()

        assert result == {}
        assert mock_api.get_instrument_key.call_count == 2


class TestTickByTickStreamerWebSocket:
    """Test WebSocket functionality"""

    @patch('screeners.tick_by_tick_streamer.upstox_client')
    @patch('screeners.tick_by_tick_streamer.UpstoxAPI')
    def test_websocket_setup_success(self, mock_api_class, mock_client):
        """Test successful WebSocket setup"""
        # Setup mocks
        mock_api = Mock()
        mock_api_class.return_value = mock_api
        mock_api.access_token = 'test_token'

        # Mock instrument keys
        mock_api.get_instrument_key.side_effect = [
            'NSE_EQ|INE002A01018',
            'NSE_EQ|INE467B01029'
        ]

        # Mock WebSocket components
        mock_config = Mock()
        mock_client.Configuration.return_value = mock_config

        mock_api_client = Mock()
        mock_client.ApiClient.return_value = mock_api_client

        mock_streamer = Mock()
        mock_client.MarketDataStreamerV3.return_value = mock_streamer

        symbols = ['RELIANCE', 'TCS']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')
        streamer.upstox_api = mock_api

        result = streamer.setup_websocket()

        assert result is True
        assert streamer.market_streamer == mock_streamer
        assert 'RELIANCE' in streamer.instrument_keys
        assert 'TCS' in streamer.instrument_keys

        # Verify WebSocket was configured correctly
        mock_client.Configuration.assert_called_once()
        mock_config.access_token = 'test_token'
        mock_client.ApiClient.assert_called_once_with(mock_config)
        mock_client.MarketDataStreamerV3.assert_called_once()

    @patch('screeners.tick_by_tick_streamer.UpstoxAPI')
    def test_websocket_setup_no_sdk(self, mock_api_class):
        """Test WebSocket setup when SDK not available"""
        # Mock SDK not available
        with patch('screeners.tick_by_tick_streamer.UPSTOX_SDK_AVAILABLE', False):
            symbols = ['RELIANCE']
            streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')

            result = streamer.setup_websocket()

            assert result is False
            assert streamer.market_streamer is None

    @patch('screeners.tick_by_tick_streamer.upstox_client')
    @patch('screeners.tick_by_tick_streamer.UpstoxAPI')
    def test_websocket_setup_no_token(self, mock_api_class, mock_client):
        """Test WebSocket setup without access token"""
        # Setup mock API without token
        mock_api = Mock()
        mock_api_class.return_value = mock_api
        mock_api.access_token = None

        symbols = ['RELIANCE']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')
        streamer.upstox_api = mock_api

        result = streamer.setup_websocket()

        assert result is False


class TestTickByTickStreamerTickProcessing:
    """Test tick data processing functionality"""

    def test_display_tick_update_format(self, capsys):
        """Test tick update display formatting"""
        symbols = ['RELIANCE']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')

        # Test price increase
        streamer.display_tick_update('RELIANCE', 1368.10, 1368.00)

        captured = capsys.readouterr()
        assert 'RELIANCE' in captured.out
        assert '1368.10' in captured.out
        assert '+0.10' in captured.out

    def test_display_tick_update_no_change(self, capsys):
        """Test tick update display with no price change"""
        symbols = ['RELIANCE']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')

        # Test no price change
        streamer.display_tick_update('RELIANCE', 1368.00, 1368.00)

        captured = capsys.readouterr()
        assert 'RELIANCE' in captured.out
        assert '+0.00' in captured.out

    def test_tick_update_processing(self):
        """Test processing of incoming tick data"""
        symbols = ['RELIANCE']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')

        # Mock message data
        message = {
            'feeds': {
                'NSE_EQ|INE002A01018': {
                    'ltpc': {
                        'ltp': '1368.10'
                    }
                }
            }
        }

        # Set up instrument keys
        streamer.instrument_keys = {'RELIANCE': 'NSE_EQ|INE002A01018'}

        # Process the message
        streamer.on_tick_update(message)

        # Verify price was updated
        assert streamer.current_prices['RELIANCE'] == 1368.10
        assert streamer.update_count['RELIANCE'] == 1
        assert streamer.last_update_time['RELIANCE'] is not None

        # Verify price history was updated
        assert len(streamer.price_history['RELIANCE']) == 1
        assert streamer.price_history['RELIANCE'][0]['price'] == 1368.10
        assert streamer.price_history['RELIANCE'][0]['change'] == 1368.10

    def test_tick_update_processing_no_change(self):
        """Test processing when price doesn't change significantly"""
        symbols = ['RELIANCE']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')

        # Set initial price
        streamer.current_prices['RELIANCE'] = 1368.00

        # Mock message with same price
        message = {
            'feeds': {
                'NSE_EQ|INE002A01018': {
                    'ltpc': {
                        'ltp': '1368.00'  # Same price
                    }
                }
            }
        }

        streamer.instrument_keys = {'RELIANCE': 'NSE_EQ|INE002A01018'}

        # Process the message
        streamer.on_tick_update(message)

        # Price should not update for insignificant changes
        assert streamer.current_prices['RELIANCE'] == 1368.00
        assert streamer.update_count['RELIANCE'] == 0

    def test_tick_update_processing_unknown_instrument(self):
        """Test processing of unknown instrument keys"""
        symbols = ['RELIANCE']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')

        # Mock message with unknown instrument key
        message = {
            'feeds': {
                'UNKNOWN_KEY': {
                    'ltpc': {
                        'ltp': '1368.10'
                    }
                }
            }
        }

        # Process the message (should not crash)
        streamer.on_tick_update(message)

        # No updates should occur for unknown instruments
        assert streamer.update_count['RELIANCE'] == 0


class TestTickByTickStreamerDisplay:
    """Test display and statistics functionality"""

    def test_display_summary_stats_empty(self, capsys):
        """Test summary stats display with no data"""
        symbols = ['RELIANCE', 'TCS']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')

        streamer.display_summary_stats()

        captured = capsys.readouterr()
        assert 'STREAMING SUMMARY' in captured.out
        assert 'RELIANCE' in captured.out
        assert 'TCS' in captured.out
        assert 'NO DATA' in captured.out

    def test_display_summary_stats_with_data(self, capsys):
        """Test summary stats display with data"""
        symbols = ['RELIANCE']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')

        # Add some mock data
        streamer.current_prices['RELIANCE'] = 1368.10
        streamer.update_count['RELIANCE'] = 5
        streamer.last_update_time['RELIANCE'] = datetime.now()
        streamer.connected = True

        streamer.display_summary_stats()

        captured = capsys.readouterr()
        assert 'STREAMING SUMMARY' in captured.out
        assert 'RELIANCE' in captured.out
        assert '1368.10' in captured.out
        assert '5' in captured.out  # Update count
        assert 'ACTIVE' in captured.out

    def test_price_history_management(self):
        """Test price history storage and management"""
        symbols = ['RELIANCE']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')

        # Set up instrument keys first
        streamer.instrument_keys = {'RELIANCE': 'NSE_EQ|INE002A01018'}

        # Simulate many tick updates with larger price changes to ensure processing
        for i in range(1500):  # More than the 1000 limit
            price = 1368.00 + (i * 0.02)  # Larger increment to ensure processing
            message = {
                'feeds': {
                    'NSE_EQ|INE002A01018': {
                        'ltpc': {
                            'ltp': str(price)
                        }
                    }
                }
            }
            streamer.on_tick_update(message)

        # Verify history is capped at 1000
        assert len(streamer.price_history['RELIANCE']) == 1000


class TestTickByTickStreamerIntegration:
    """Integration tests for the complete streamer"""

    @patch('screeners.tick_by_tick_streamer.upstox_client')
    @patch('screeners.tick_by_tick_streamer.UpstoxAPI')
    def test_full_streamer_workflow(self, mock_api_class, mock_client):
        """Test complete streamer workflow"""
        # Setup comprehensive mocks
        mock_api = Mock()
        mock_api_class.return_value = mock_api
        mock_api.access_token = 'test_token'
        mock_api.authenticate.return_value = True

        # Mock instrument keys
        mock_api.get_instrument_key.side_effect = [
            'NSE_EQ|INE002A01018',
            'NSE_EQ|INE467B01029'
        ]

        # Mock WebSocket components
        mock_config = Mock()
        mock_client.Configuration.return_value = mock_config

        mock_api_client = Mock()
        mock_client.ApiClient.return_value = mock_api_client

        mock_streamer = Mock()
        mock_client.MarketDataStreamerV3.return_value = mock_streamer

        symbols = ['RELIANCE', 'TCS']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')
        streamer.upstox_api = mock_api

        # Test complete workflow
        assert streamer.authenticate() is True
        assert streamer.setup_websocket() is True

        # Verify all components are properly initialized
        assert streamer.market_streamer is not None
        assert len(streamer.instrument_keys) == 2
        assert 'RELIANCE' in streamer.instrument_keys
        assert 'TCS' in streamer.instrument_keys

    @patch('screeners.tick_by_tick_streamer.UPSTOX_AVAILABLE', False)
    def test_streamer_without_dependencies(self):
        """Test streamer behavior when dependencies are missing"""
        symbols = ['RELIANCE']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')

        # Should fail gracefully when dependencies are missing
        result = streamer.run(duration_seconds=1)
        # The run method should handle missing dependencies gracefully


class TestTickByTickStreamerErrorHandling:
    """Test error handling scenarios"""

    @patch('screeners.tick_by_tick_streamer.UpstoxAPI')
    def test_authentication_exception_handling(self, mock_api_class):
        """Test handling of authentication exceptions"""
        # Setup mock API that raises exception
        mock_api = Mock()
        mock_api_class.return_value = mock_api
        mock_api.access_token = None
        mock_api.authenticate.side_effect = Exception("Auth failed")

        symbols = ['RELIANCE']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')
        streamer.upstox_api = mock_api

        result = streamer.authenticate()

        assert result is False

    @patch('screeners.tick_by_tick_streamer.UpstoxAPI')
    def test_instrument_key_exception_handling(self, mock_api_class):
        """Test handling of instrument key exceptions"""
        # Setup mock API that raises exception
        mock_api = Mock()
        mock_api_class.return_value = mock_api
        mock_api.get_instrument_key.side_effect = Exception("API Error")

        symbols = ['RELIANCE']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')
        streamer.upstox_api = mock_api

        # Should handle exception gracefully
        result = streamer.get_instrument_keys()

        assert result == {}

    def test_tick_update_invalid_data(self):
        """Test handling of invalid tick data"""
        symbols = ['RELIANCE']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')

        # Set up instrument keys
        streamer.instrument_keys = {'RELIANCE': 'NSE_EQ|INE002A01018'}

        # Test with invalid message formats
        invalid_messages = [
            None,
            {},
            {'feeds': None},
            {'feeds': {'NSE_EQ|INE002A01018': None}},
            {'feeds': {'NSE_EQ|INE002A01018': {'ltpc': None}}},
            {'feeds': {'NSE_EQ|INE002A01018': {'ltpc': {'ltp': 'invalid_number'}}}}
        ]

        for message in invalid_messages:
            # Should not crash
            streamer.on_tick_update(message)

        # No updates should have occurred
        assert streamer.update_count['RELIANCE'] == 0


class TestTickByTickStreamerPerformance:
    """Test performance characteristics"""

    def test_multiple_symbol_handling(self):
        """Test handling of multiple symbols efficiently"""
        symbols = [f'REL{i}' for i in range(10)]  # 10 unique symbols for testing
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')

        # Should handle multiple symbols without issues
        assert len(streamer.current_prices) == 10
        assert len(streamer.price_history) == 10

        # All symbols should be properly initialized
        for i in range(10):
            symbol = f'REL{i}'
            assert symbol in streamer.current_prices

    def test_price_history_efficiency(self):
        """Test price history storage efficiency"""
        symbols = ['RELIANCE']
        streamer = TickByTickStreamer(symbols, 'test_key', 'test_secret')

        # Set up instrument keys first
        streamer.instrument_keys = {'RELIANCE': 'NSE_EQ|INE002A01018'}

        # Add many updates by calling the actual processing method
        for i in range(2000):
            price = 1368.00 + i
            message = {
                'feeds': {
                    'NSE_EQ|INE002A01018': {
                        'ltpc': {
                            'ltp': str(price)
                        }
                    }
                }
            }
            streamer.on_tick_update(message)

        # Should be capped at 1000
        assert len(streamer.price_history['RELIANCE']) == 1000

        # Should keep the most recent 1000
        assert streamer.price_history['RELIANCE'][0]['price'] == 1368.00 + 1000
        assert streamer.price_history['RELIANCE'][-1]['price'] == 1368.00 + 1999


# Pytest fixtures for common test data
@pytest.fixture
def sample_tick_message():
    """Sample tick message for testing"""
    return {
        'feeds': {
            'NSE_EQ|INE002A01018': {
                'ltpc': {
                    'ltp': '1368.10'
                }
            }
        }
    }


@pytest.fixture
def sample_multi_symbol_message():
    """Sample tick message with multiple symbols"""
    return {
        'feeds': {
            'NSE_EQ|INE002A01018': {
                'ltpc': {
                    'ltp': '1368.10'
                }
            },
            'NSE_EQ|INE467B01029': {
                'ltpc': {
                    'ltp': '3024.30'
                }
            }
        }
    }


# Run the tests
if __name__ == "__main__":
    pytest.main([__file__, "-v"])