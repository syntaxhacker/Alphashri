"""
Backtest API Tests

Tests for /api/backtest/* endpoints.
"""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from datetime import datetime
import sys
from pathlib import Path
import pandas as pd

# Add project root to path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backtest.api import (
    BacktestRequestHandler,
    handle_get_strategies,
    handle_get_costs,
    handle_run_backtest,
    handle_get_chart_data,
)
from backtest.strategies import list_strategies, get_strategy
from backtest.costs import get_cost_breakdown, calculate_trading_costs


@pytest.fixture
def backtest_handler():
    """Create a fresh BacktestRequestHandler for each test."""
    return BacktestRequestHandler()


@pytest.fixture
def mock_strategy_result():
    """Mock successful backtest result."""
    return {
        'results': [
            {
                'symbol': 'RELIANCE',
                'trades': 5,
                'winners': 3,
                'losers': 2,
                'win_rate': 60.0,
                'total_pnl': 2500,
                'net_pnl': 2100,
                'avg_pnl': 420,
                'max_profit': 1200,
                'max_loss': -600,
            }
        ],
        'config': {
            'strategy': 'orb',
            'symbols': ['RELIANCE'],
            'days': 90,
            'params': {
                'or_minutes': 45,
                'sl_pct': 0.4,
                'tp_pct': 1.2,
            }
        },
        'candles': {
            'RELIANCE': pd.DataFrame({
                'datetime': pd.date_range('2024-01-01', periods=100, freq='15min'),
                'open': range(100, 200),
                'high': range(105, 205),
                'low': range(95, 195),
                'close': range(100, 200),
                'volume': range(1000, 2000, 10),
            })
        },
        'chart_data': {
            'RELIANCE': {
                'trades': [
                    {
                        'entry_time': '2024-01-01 09:45:00',
                        'exit_time': '2024-01-01 11:30:00',
                        'entry_price': 100,
                        'exit_price': 105,
                        'quantity': 50,
                        'pnl': 250,
                        'net_pnl': 210,
                        'type': 'LONG',
                    }
                ]
            }
        }
    }


@pytest.fixture
def mock_candles_df():
    """Mock candles DataFrame for chart data tests."""
    return pd.DataFrame({
        'datetime': pd.date_range('2024-01-01 09:15:00', periods=100, freq='15min'),
        'open': [100 + i * 0.1 for i in range(100)],
        'high': [102 + i * 0.1 for i in range(100)],
        'low': [99 + i * 0.1 for i in range(100)],
        'close': [101 + i * 0.1 for i in range(100)],
        'volume': [1000 + i * 10 for i in range(100)],
    })


class TestBacktestStrategiesEndpoint:
    """Test GET /api/backtest/strategies endpoint."""

    def test_get_strategies_returns_all_strategies(self):
        """Test that get_strategies returns all available strategies."""
        result = handle_get_strategies()

        assert 'strategies' in result
        assert 'default' in result

        strategies = result['strategies']
        assert isinstance(strategies, list)
        assert len(strategies) >= 3  # orb, sr_breakout, 52w_chaser

        # Check default strategy
        assert result['default'] == 'orb'

    def test_strategy_structure(self):
        """Test that each strategy has correct structure."""
        result = handle_get_strategies()
        strategies = result['strategies']

        for strategy in strategies:
            assert 'id' in strategy
            assert 'name' in strategy
            assert 'description' in strategy
            assert 'params' in strategy
            assert isinstance(strategy['params'], list)

            # Check params structure
            for param in strategy['params']:
                assert 'key' in param
                assert 'label' in param
                assert 'type' in param
                assert 'default' in param

    def test_expected_strategies_present(self):
        """Test that expected strategies are present."""
        result = handle_get_strategies()
        strategy_ids = [s['id'] for s in result['strategies']]

        assert 'orb' in strategy_ids
        assert 'sr_breakout' in strategy_ids
        assert '52w_chaser' in strategy_ids
        assert '52w_target' in strategy_ids

    def test_orb_strategy_params(self):
        """Test ORB strategy has expected parameters."""
        result = handle_get_strategies()
        orb_strategy = next((s for s in result['strategies'] if s['id'] == 'orb'), None)

        assert orb_strategy is not None
        param_keys = [p['key'] for p in orb_strategy['params']]

        # Expected ORB parameters
        expected_params = ['or_minutes', 'timeframe', 'stop_loss_pct', 'take_profit_pct', 'trade_size', 'cooldown_bars', 'enable_shorts']
        for param in expected_params:
            assert param in param_keys


class TestBacktestCostsEndpoint:
    """Test GET /api/backtest/costs endpoint."""

    def test_get_costs_structure(self):
        """Test that get_costs returns correct structure."""
        result = handle_get_costs()

        assert 'costs' in result
        assert 'updated' in result

        costs = result['costs']
        assert isinstance(costs, dict)

    def test_expected_cost_components(self):
        """Test that all expected cost components are present."""
        result = get_cost_breakdown()

        expected_components = [
            'brokerage',
            'stt',
            'exchange_charges',
            'sebi_fee',
            'stamp_duty',
            'gst',
            'dp_charges'
        ]

        for component in expected_components:
            assert component in result

            cost_item = result[component]
            assert 'rate' in cost_item
            assert 'description' in cost_item
            assert 'applies_to' in cost_item

    def test_brokerage_cost_details(self):
        """Test brokerage cost configuration."""
        result = get_cost_breakdown()
        brokerage = result['brokerage']

        assert brokerage['rate'] == '0.03%'
        assert 'Lower of ₹20 or 0.03%' in brokerage['description']
        assert brokerage['applies_to'] == 'Both buy and sell'

    def test_stt_cost_details(self):
        """Test STT cost configuration."""
        result = get_cost_breakdown()
        stt = result['stt']

        assert stt['rate'] == '0.025%'
        assert 'Securities Transaction Tax' in stt['description']
        assert stt['applies_to'] == 'Sell side only (intraday)'

    def test_calculate_trading_costs(self):
        """Test cost calculation for a sample trade."""
        entry_price = 100
        exit_price = 105
        quantity = 100

        costs = calculate_trading_costs(entry_price, exit_price, quantity)

        assert 'buy_costs' in costs
        assert 'sell_costs' in costs
        assert 'total_costs' in costs
        assert 'breakdown' in costs

        # Costs should be positive
        assert costs['buy_costs'] > 0
        assert costs['sell_costs'] > 0
        assert costs['total_costs'] > 0

        # Total should equal sum of buy and sell
        assert costs['total_costs'] == costs['buy_costs'] + costs['sell_costs']

    def test_calculate_trading_costs_breakdown(self):
        """Test detailed breakdown of trading costs."""
        entry_price = 100
        exit_price = 105
        quantity = 100

        costs = calculate_trading_costs(entry_price, exit_price, quantity)
        breakdown = costs['breakdown']

        # Check buy-side costs
        assert 'buy_brokerage' in breakdown
        assert 'buy_stamp_duty' in breakdown
        assert 'buy_exchange' in breakdown
        assert 'buy_sebi' in breakdown
        assert 'buy_gst' in breakdown

        # Check sell-side costs
        assert 'sell_brokerage' in breakdown
        assert 'sell_stt' in breakdown
        assert 'sell_exchange' in breakdown
        assert 'sell_sebi' in breakdown
        assert 'sell_gst' in breakdown

        # All costs should be non-negative
        for key, value in breakdown.items():
            assert value >= 0

    def test_estimate_avg_cost_per_trade(self):
        """Test estimation function for average trade cost."""
        from backtest.costs import estimate_avg_cost_per_trade

        # Default trade value
        cost = estimate_avg_cost_per_trade()
        assert cost > 0
        assert cost < 100  # Should be reasonable

        # Larger trade
        cost_large = estimate_avg_cost_per_trade(100000)
        assert cost_large > cost

    def test_costs_endpoint_response(self):
        """Test the full costs endpoint response."""
        result = handle_get_costs()

        assert result['costs']
        assert 'updated' in result

        # Verify updated timestamp is recent
        updated = datetime.fromisoformat(result['updated'])
        assert (datetime.now() - updated).total_seconds() < 1


class TestBacktestProgressEndpoint:
    """Test GET /api/backtest/progress endpoint."""

    def test_initial_progress_state(self, backtest_handler):
        """Test initial progress state."""
        progress = backtest_handler.progress_state

        assert progress['current'] == 0
        assert progress['total'] == 0
        assert progress['message'] == ''
        assert progress['updated'] is None
        assert progress['running'] is False

    def test_progress_update(self, backtest_handler):
        """Test progress state updates."""
        backtest_handler.progress_state['current'] = 5
        backtest_handler.progress_state['total'] = 10
        backtest_handler.progress_state['message'] = 'Processing...'
        backtest_handler.progress_state['running'] = True

        assert backtest_handler.progress_state['current'] == 5
        assert backtest_handler.progress_state['total'] == 10
        assert backtest_handler.progress_state['message'] == 'Processing...'
        assert backtest_handler.progress_state['running'] is True


class TestBacktestRunEndpoint:
    """Test POST /api/backtest/run endpoint."""

    def test_run_backtest_missing_symbols(self):
        """Test running backtest without symbols returns error."""
        body = {
            'strategy': 'orb',
            'symbols': [],
            'params': {},
            'days': 90
        }

        result = handle_run_backtest(body)

        assert 'error' in result
        assert 'No symbols provided' in result['error']

    @patch('backtest.api.get_strategy')
    def test_run_backtest_invalid_strategy(self, mock_get_strategy):
        """Test running backtest with invalid strategy returns error."""
        mock_get_strategy.return_value = None

        body = {
            'strategy': 'invalid_strategy',
            'symbols': ['RELIANCE'],
            'params': {},
            'days': 90
        }

        result = handle_run_backtest(body)

        assert 'error' in result
        assert 'Unknown strategy' in result['error']

    @patch('backtest.api.get_strategy')
    def test_run_backtest_invalid_params(self, mock_get_strategy):
        """Test running backtest with invalid parameters returns error."""
        mock_strategy = MagicMock()
        mock_strategy.return_value.validate_params.return_value = ['Invalid ORB minutes']
        mock_get_strategy.return_value = mock_strategy

        body = {
            'strategy': 'orb',
            'symbols': ['RELIANCE'],
            'params': {'or_minutes': -1},  # Invalid
            'days': 90
        }

        result = handle_run_backtest(body)

        assert 'error' in result
        assert 'Invalid parameters' in result['error']

    @patch('backtest.api.get_strategy')
    def test_run_backtest_success(self, mock_get_strategy, mock_strategy_result):
        """Test running backtest successfully."""
        mock_strategy = MagicMock()
        mock_strategy_instance = mock_strategy.return_value
        mock_strategy_instance.validate_params.return_value = []
        mock_strategy_instance.run.return_value = mock_strategy_result
        mock_get_strategy.return_value = mock_strategy

        body = {
            'strategy': 'orb',
            'symbols': ['RELIANCE'],
            'params': {'or_minutes': 45, 'sl_pct': 0.4, 'tp_pct': 1.2},
            'days': 90,
            'include_costs': True
        }

        progress_state = {
            'current': 0,
            'total': 0,
            'message': '',
            'updated': None,
            'running': False,
        }

        result = handle_run_backtest(body, progress_state)

        # Should not have error
        assert 'error' not in result

        # Check strategy was called
        mock_strategy_instance.run.assert_called_once()

    @patch('backtest.api.get_strategy')
    def test_run_backtest_progress_tracking(self, mock_get_strategy):
        """Test that progress is tracked during backtest."""
        mock_strategy = MagicMock()
        mock_strategy_instance = mock_strategy.return_value
        mock_strategy_instance.validate_params.return_value = []

        def run_with_progress(symbols, days, params, callback):
            # Simulate progress updates
            if callback:
                callback(0, 1, 'Starting...')
                callback(1, 1, 'Complete')
            return {'results': []}

        mock_strategy_instance.run = run_with_progress
        mock_get_strategy.return_value = mock_strategy

        body = {
            'strategy': 'orb',
            'symbols': ['RELIANCE'],
            'params': {},
            'days': 90
        }

        progress_state = {
            'current': 0,
            'total': 0,
            'message': '',
            'updated': None,
            'running': False,
        }

        handle_run_backtest(body, progress_state)

        # Progress should have been updated
        assert progress_state['current'] == 1
        assert progress_state['total'] == 1
        assert progress_state['message'] == 'Complete'

    @patch('backtest.api.get_strategy')
    def test_run_backtest_with_costs(self, mock_get_strategy):
        """Test running backtest with costs included."""
        mock_strategy = MagicMock()
        mock_strategy_instance = mock_strategy.return_value
        mock_strategy_instance.validate_params.return_value = []
        mock_strategy_instance.run.return_value = {
            'results': [],
            'config': {}
        }
        mock_get_strategy.return_value = mock_strategy

        body = {
            'strategy': 'orb',
            'symbols': ['RELIANCE'],
            'params': {},
            'days': 90,
            'include_costs': True
        }

        result = handle_run_backtest(body)

        # Check that include_costs was passed to strategy
        # The run should be called with params containing include_costs
        mock_strategy_instance.run.assert_called_once()
        call_args = mock_strategy_instance.run.call_args
        params = call_args[0][2]  # Third argument is params
        assert params.get('include_costs') is True

    @patch('backtest.api.get_strategy')
    def test_run_backtest_exception_handling(self, mock_get_strategy):
        """Test that exceptions during backtest are handled gracefully."""
        mock_strategy = MagicMock()
        mock_strategy_instance = mock_strategy.return_value
        mock_strategy_instance.validate_params.return_value = []
        mock_strategy_instance.run.side_effect = Exception("Database error")
        mock_get_strategy.return_value = mock_strategy

        body = {
            'strategy': 'orb',
            'symbols': ['RELIANCE'],
            'params': {},
            'days': 90
        }

        result = handle_run_backtest(body)

        assert 'error' in result
        assert 'Database error' in result['error']


class TestBacktestChartEndpoint:
    """Test GET /api/backtest/chart/{symbol} endpoint."""

    def test_get_chart_no_backtest_cache(self, backtest_handler):
        """Test getting chart data when no backtest has been run."""
        backtest_handler.backtest_cache = {}

        result = handle_get_chart_data('RELIANCE', backtest_handler.backtest_cache)

        assert 'error' in result
        assert 'No chart data' in result['error']

    def test_get_chart_no_candles(self, backtest_handler, mock_candles_df):
        """Test getting chart data when candles missing for symbol."""
        backtest_handler.backtest_cache = {
            'candles': {},  # Empty
            'chart_data': {}
        }

        result = handle_get_chart_data('RELIANCE', backtest_handler.backtest_cache)

        assert 'error' in result
        assert 'No chart data' in result['error']

    def test_get_chart_no_trades(self, backtest_handler, mock_candles_df):
        """Test getting chart data when trades missing for symbol."""
        backtest_handler.backtest_cache = {
            'candles': {'RELIANCE': mock_candles_df},
            'chart_data': {}  # No trades
        }

        result = handle_get_chart_data('RELIANCE', backtest_handler.backtest_cache)

        assert 'error' in result
        assert 'No trade data' in result['error']

    @patch('backtest.api.build_chart_data_for_symbol')
    def test_get_chart_success(self, mock_build, backtest_handler, mock_candles_df):
        """Test successfully getting chart data."""
        mock_build.return_value = {
            'candles': [
                {'time': '2024-01-01 09:15:00', 'open': 100, 'high': 105, 'low': 99, 'close': 103},
            ],
            'trades': [
                {'entry_time': '2024-01-01 09:45:00', 'exit_time': '2024-01-01 11:00:00', 'pnl': 250},
            ],
            'or_lines': {'high': 102, 'low': 98}
        }

        backtest_handler.backtest_cache = {
            'candles': {'RELIANCE': mock_candles_df},
            'chart_data': {
                'RELIANCE': {
                    'trades': [
                        {'entry_price': 100, 'exit_price': 105}
                    ]
                }
            },
            'config': {
                'params': {'or_minutes': 45}
            }
        }

        result = handle_get_chart_data('RELIANCE', backtest_handler.backtest_cache)

        assert 'error' not in result
        assert 'candles' in result
        assert 'trades' in result

    @patch('backtest.api.build_chart_data_for_symbol')
    def test_get_chart_exception_handling(self, mock_build, backtest_handler, mock_candles_df):
        """Test that exceptions during chart building are handled."""
        mock_build.side_effect = Exception("Chart building error")

        backtest_handler.backtest_cache = {
            'candles': {'RELIANCE': mock_candles_df},
            'chart_data': {
                'RELIANCE': {
                    'trades': [{'entry_price': 100}]
                }
            },
            'config': {'params': {'or_minutes': 45}}
        }

        result = handle_get_chart_data('RELIANCE', backtest_handler.backtest_cache)

        assert 'error' in result
        assert 'Chart building error' in result['error']


class TestBacktestResultsEndpoint:
    """Test GET /api/backtest/results endpoint."""

    def test_get_results_no_backtest_run(self, backtest_handler):
        """Test getting results when no backtest has been run."""
        backtest_handler.backtest_cache = {}

        # Simulate endpoint call
        result = {
            'results': backtest_handler.backtest_cache.get('results', []),
            'config': backtest_handler.backtest_cache.get('config', {})
        }

        assert result['results'] == []
        assert result['config'] == {}

    def test_get_results_after_backtest(self, backtest_handler):
        """Test getting results after a successful backtest."""
        backtest_handler.backtest_cache = {
            'results': [
                {'symbol': 'RELIANCE', 'trades': 5, 'win_rate': 60, 'net_pnl': 2500}
            ],
            'config': {
                'strategy': 'orb',
                'symbols': ['RELIANCE'],
                'days': 90
            }
        }

        result = {
            'results': backtest_handler.backtest_cache.get('results', []),
            'config': backtest_handler.backtest_cache.get('config', {})
        }

        assert len(result['results']) == 1
        assert result['results'][0]['symbol'] == 'RELIANCE'
        assert result['config']['strategy'] == 'orb'


class TestBacktestRequestHandler:
    """Test BacktestRequestHandler class."""

    def test_handler_initialization(self):
        """Test handler is initialized correctly."""
        handler = BacktestRequestHandler()

        assert handler.backtest_cache == {}
        assert handler.progress_state['current'] == 0
        assert handler.progress_state['total'] == 0
        assert handler.progress_state['running'] is False

    @patch('backtest.api.handle_run_backtest')
    def test_handle_request_post_backtest_run(self, mock_run, backtest_handler):
        """Test handle_request for POST /api/backtest/run."""
        mock_run.return_value = {'results': []}

        body = {
            'strategy': 'orb',
            'symbols': ['RELIANCE'],
            'params': {},
            'days': 90
        }

        result = backtest_handler.handle_request('POST', '/api/backtest/run', {}, body)

        assert 'results' in result
        assert backtest_handler.progress_state['running'] is False

    def test_handle_request_get_strategies(self, backtest_handler):
        """Test handle_request for GET /api/backtest/strategies."""
        result = backtest_handler.handle_request('GET', '/api/backtest/strategies', {})

        assert 'strategies' in result
        assert 'default' in result

    def test_handle_request_get_costs(self, backtest_handler):
        """Test handle_request for GET /api/backtest/costs."""
        result = backtest_handler.handle_request('GET', '/api/backtest/costs', {})

        assert 'costs' in result
        assert 'updated' in result

    def test_handle_request_get_progress(self, backtest_handler):
        """Test handle_request for GET /api/backtest/progress."""
        result = backtest_handler.handle_request('GET', '/api/backtest/progress', {})

        assert 'current' in result
        assert 'total' in result
        assert 'running' in result

    def test_handle_request_not_found(self, backtest_handler):
        """Test handle_request for unknown endpoint."""
        result = backtest_handler.handle_request('GET', '/api/backtest/unknown', {})

        assert 'error' in result
        assert result['path'] == '/api/backtest/unknown'


class TestBacktestIntegration:
    """Integration tests for backtest workflows."""

    @patch('backtest.api.get_strategy')
    def test_full_backtest_workflow(self, mock_get_strategy, backtest_handler):
        """Test complete backtest workflow: run -> progress -> chart -> results."""
        # Setup mock strategy
        mock_strategy = MagicMock()
        mock_strategy_instance = mock_strategy.return_value
        mock_strategy_instance.validate_params.return_value = []

        mock_result = {
            'results': [{'symbol': 'RELIANCE', 'trades': 3, 'net_pnl': 1500}],
            'config': {'strategy': 'orb', 'params': {'or_minutes': 45}},
            'candles': {
                'RELIANCE': pd.DataFrame({
                    'datetime': pd.date_range('2024-01-01', periods=10, freq='15min'),
                    'open': [100] * 10,
                    'high': [105] * 10,
                    'low': [98] * 10,
                    'close': [103] * 10,
                    'volume': [1000] * 10,
                })
            },
            'chart_data': {
                'RELIANCE': {
                    'trades': [
                        {'entry_time': '09:45', 'exit_time': '11:00', 'pnl': 500}
                    ]
                }
            }
        }
        mock_strategy_instance.run.return_value = mock_result
        mock_get_strategy.return_value = mock_strategy

        # Step 1: Run backtest
        body = {
            'strategy': 'orb',
            'symbols': ['RELIANCE'],
            'params': {},
            'days': 90
        }

        run_result = backtest_handler.handle_request('POST', '/api/backtest/run', {}, body)
        assert 'error' not in run_result
        assert backtest_handler.backtest_cache

        # Step 2: Check progress
        progress_result = backtest_handler.handle_request('GET', '/api/backtest/progress', {})
        assert progress_result['running'] is False  # Should be complete

        # Step 3: Get results
        results_result = backtest_handler.handle_request('GET', '/api/backtest/results', {})
        assert len(results_result['results']) > 0

        # Step 4: Get chart data
        with patch('backtest.api.build_chart_data_for_symbol') as mock_build:
            mock_build.return_value = {'candles': [], 'trades': []}
            chart_result = backtest_handler.handle_request('GET', '/api/backtest/chart/RELIANCE', {})
            assert 'error' not in chart_result


class TestBacktestErrorScenarios:
    """Test various error scenarios for backtest endpoints."""

    def test_backtest_with_empty_symbols_list(self, backtest_handler):
        """Test backtest with empty symbols list."""
        body = {
            'strategy': 'orb',
            'symbols': [],
            'params': {},
            'days': 90
        }

        result = backtest_handler.handle_request('POST', '/api/backtest/run', {}, body)
        assert 'error' in result

    def test_backtest_with_invalid_days(self):
        """Test backtest with invalid days parameter."""
        body = {
            'strategy': 'orb',
            'symbols': ['RELIANCE'],
            'params': {},
            'days': -1  # Invalid
        }

        result = handle_run_backtest(body)
        # Should handle gracefully (depends on validation implementation)

    def test_backtest_with_large_symbol_list(self):
        """Test backtest with a large number of symbols."""
        symbols = [f'STOCK{i}' for i in range(100)]
        body = {
            'strategy': 'orb',
            'symbols': symbols,
            'params': {},
            'days': 90
        }

        # This should not crash, but may take time
        # We're just ensuring it doesn't raise an exception
        result = handle_run_backtest(body)
        # Either returns error or processes (depending on mocking)
        assert isinstance(result, dict)


class TestBacktestDataFormatting:
    """Test data formatting in backtest responses."""

    def test_sanitize_for_json_with_floats(self):
        """Test that NaN and Inf floats are sanitized."""
        from backtest.api import _sanitize_for_json

        data = {
            'valid': 1.5,
            'nan': float('nan'),
            'inf': float('inf'),
            'neg_inf': float('-inf'),
        }

        result = _sanitize_for_json(data)

        assert result['valid'] == 1.5
        assert result['nan'] is None
        assert result['inf'] is None
        assert result['neg_inf'] is None

    def test_sanitize_for_json_with_nested_structures(self):
        """Test sanitization with nested dicts and lists."""
        from backtest.api import _sanitize_for_json

        data = {
            'nested': {
                'value': 1.0,
                'invalid': float('nan')
            },
            'list': [1.0, float('inf'), 2.0]
        }

        result = _sanitize_for_json(data)

        assert result['nested']['value'] == 1.0
        assert result['nested']['invalid'] is None
        assert result['list'][1] is None

    def test_sanitize_for_json_with_datetime(self):
        """Test that datetime objects are converted to ISO format."""
        from backtest.api import _sanitize_for_json

        dt = datetime(2024, 1, 1, 12, 0, 0)
        data = {'timestamp': dt}

        result = _sanitize_for_json(data)

        assert result['timestamp'] == '2024-01-01T12:00:00'


class TestBacktestRunCredentialCheck:
    """Test credential validation in POST /api/backtest/run."""

    def test_run_returns_503_when_no_api_key_and_no_token(self, client, auth_headers):
        """Test 503 when UPSTOX_API_KEY missing and no broker token."""
        import config
        from unittest.mock import patch as upatch
        with upatch.object(config, 'UPSTOX_API_KEY', None), \
             upatch.object(config, 'UPSTOX_API_SECRET', None), \
             upatch('db.models.get_shared_broker_token', return_value=None):
            response = client.post(
                "/api/backtest/run",
                json={
                    'strategy': 'orb',
                    'symbols': ['RELIANCE'],
                    'params': {},
                    'days': 90,
                },
                headers=auth_headers,
            )

        assert response.status_code == 503
        assert 'Upstox API credentials not configured' in response.json()['detail']

    def test_run_rejects_when_api_key_missing(self, client, auth_headers):
        """Test request fails when no API key is set (broker token no longer bypasses this)."""
        import config
        from unittest.mock import patch as upatch
        with upatch.object(config, 'UPSTOX_API_KEY', None), \
             upatch.object(config, 'UPSTOX_API_SECRET', None):
            response = client.post(
                "/api/backtest/run",
                json={
                    'strategy': 'orb',
                    'symbols': ['RELIANCE'],
                    'params': {},
                    'days': 90,
                },
                headers=auth_headers,
            )

        assert response.status_code == 503

    def test_run_allows_when_api_key_present(self, client, auth_headers):
        """Test request proceeds when UPSTOX_API_KEY is set."""
        import config
        from unittest.mock import patch as upatch
        with upatch.object(config, 'UPSTOX_API_KEY', 'test-key'), \
             upatch.object(config, 'UPSTOX_API_SECRET', 'test-secret'):
            response = client.post(
                "/api/backtest/run",
                json={
                    'strategy': 'orb',
                    'symbols': ['RELIANCE'],
                    'params': {},
                    'days': 90,
                },
                headers=auth_headers,
            )

        assert response.status_code != 503


class TestBacktestRunCaching:
    """Test that empty backtest results are not cached."""

    def test_zero_trade_results_not_cached(self, client, auth_headers):
        """Test that results with 0 trades are not cached to Redis."""
        import config
        import cache.redis_client as rc
        from unittest.mock import patch as upatch, MagicMock
        original_set = rc.cache_set
        original_get = rc.cache_get
        original_avail = rc.is_cache_available
        try:
            rc.cache_set = MagicMock()
            rc.cache_get = MagicMock(return_value=None)
            rc.is_cache_available = MagicMock(return_value=True)
            config.UPSTOX_API_KEY = 'test-key'
            config.UPSTOX_API_SECRET = 'test-secret'
            with upatch('api.backtest_routes.handle_run_backtest', return_value={
                'strategy': 'orb',
                'results': [],
                'totals': {'trades': 0, 'net_pnl': 0, 'gross_pnl': 0, 'total_costs': 0, 'win_rate': 0},
                'chart_data': {},
                'candles': {},
                'config': {},
            }):
                response = client.post(
                    "/api/backtest/run",
                    json={
                        'strategy': 'orb',
                        'symbols': ['RELIANCE'],
                        'params': {},
                        'days': 90,
                    },
                    headers=auth_headers,
                )

            assert response.status_code == 200
            rc.cache_set.assert_not_called()
        finally:
            rc.cache_set = original_set
            rc.cache_get = original_get
            rc.is_cache_available = original_avail

    def test_results_with_trades_are_cached(self, client, auth_headers):
        """Test that results with trades > 0 are cached to Redis."""
        import config
        import cache.redis_client as rc
        from unittest.mock import patch as upatch, MagicMock
        original_set = rc.cache_set
        original_get = rc.cache_get
        original_avail = rc.is_cache_available
        try:
            rc.cache_set = MagicMock()
            rc.cache_get = MagicMock(return_value=None)
            rc.is_cache_available = MagicMock(return_value=True)
            config.UPSTOX_API_KEY = 'test-key'
            config.UPSTOX_API_SECRET = 'test-secret'
            with upatch('api.backtest_routes.handle_run_backtest', return_value={
                'strategy': 'orb',
                'results': [{'symbol': 'RELIANCE', 'trades': 5, 'net_pnl': 2500}],
                'totals': {'trades': 5, 'net_pnl': 2500, 'gross_pnl': 3000, 'total_costs': 500, 'win_rate': 60.0},
                'chart_data': {},
                'candles': {},
                'config': {},
            }):
                response = client.post(
                    "/api/backtest/run",
                    json={
                        'strategy': 'orb',
                        'symbols': ['RELIANCE'],
                        'params': {},
                        'days': 90,
                    },
                    headers=auth_headers,
                )

            assert response.status_code == 200
            rc.cache_set.assert_called_once()
        finally:
            rc.cache_set = original_set
            rc.cache_get = original_get
            rc.is_cache_available = original_avail
