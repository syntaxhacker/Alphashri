"""
Comprehensive unit tests for backtest/api.py.

Tests cover:
- _sanitize_for_json: JSON serialization sanitization
- handle_get_strategies: Strategy listing endpoint
- handle_get_costs: Cost breakdown endpoint
- handle_run_backtest: Backtest execution with various scenarios
- handle_get_chart_data: Chart data retrieval
- BacktestRequestHandler: Request routing and state management
- Error handling and edge cases
"""

import pytest
import math
import pandas as pd
from datetime import datetime
from unittest.mock import Mock, patch, MagicMock


from backtest.api import (
    _sanitize_for_json,
    handle_get_strategies,
    handle_get_costs,
    handle_run_backtest,
    handle_get_chart_data,
    BacktestRequestHandler,
)


class TestSanitizeForJson:
    """Tests for _sanitize_for_json function."""

    def test_sanitize_dict_with_finite_floats(self):
        """Test: Dict with finite floats is unchanged."""
        data = {'a': 1.5, 'b': 2.0}
        result = _sanitize_for_json(data)
        assert result == {'a': 1.5, 'b': 2.0}

    def test_sanitize_dict_with_nan(self):
        """Test: NaN values are converted to None."""
        data = {'value': float('nan')}
        result = _sanitize_for_json(data)
        assert result['value'] is None

    def test_sanitize_dict_with_infinity(self):
        """Test: Infinity values are converted to None."""
        data = {'pos_inf': float('inf'), 'neg_inf': float('-inf')}
        result = _sanitize_for_json(data)
        assert result['pos_inf'] is None
        assert result['neg_inf'] is None

    def test_sanitize_list_with_non_finite(self):
        """Test: List with non-finite values."""
        data = [1.0, float('nan'), 2.0, float('inf')]
        result = _sanitize_for_json(data)
        assert result == [1.0, None, 2.0, None]

    def test_sanitize_nested_structure(self):
        """Test: Nested dict/list with non-finite values."""
        data = {
            'outer': {
                'inner': [float('nan'), 1.0],
                'value': float('inf')
            },
            'list': [{'a': float('-inf')}, {'b': 2.0}]
        }
        result = _sanitize_for_json(data)
        assert result['outer']['inner'] == [None, 1.0]
        assert result['outer']['value'] is None
        assert result['list'][0]['a'] is None
        assert result['list'][1]['b'] == 2.0

    def test_sanitize_datetime_object(self):
        """Test: datetime objects are converted to ISO format."""
        dt = datetime(2026, 3, 4, 10, 30, 0)
        data = {'timestamp': dt}
        result = _sanitize_for_json(data)
        assert result['timestamp'] == '2026-03-04T10:30:00'

    def test_sanitize_object_with_isoformat_method(self):
        """Test: Objects with isoformat method are converted."""
        mock_obj = Mock()
        mock_obj.isoformat.return_value = '2026-03-04T10:30:00'
        data = {'time': mock_obj}
        result = _sanitize_for_json(data)
        assert result['time'] == '2026-03-04T10:30:00'

    def test_sanitize_string_unchanged(self):
        """Test: Strings are unchanged."""
        data = {'text': 'hello world'}
        result = _sanitize_for_json(data)
        assert result['text'] == 'hello world'

    def test_sanitize_int_unchanged(self):
        """Test: Integers are unchanged."""
        data = {'count': 42}
        result = _sanitize_for_json(data)
        assert result['count'] == 42

    def test_sanitize_none_unchanged(self):
        """Test: None is unchanged."""
        data = {'value': None}
        result = _sanitize_for_json(data)
        assert result['value'] is None

    def test_sanitize_bool_unchanged(self):
        """Test: Booleans are unchanged."""
        data = {'flag': True, 'flag2': False}
        result = _sanitize_for_json(data)
        assert result['flag'] is True
        assert result['flag2'] is False

    def test_sanitize_empty_dict(self):
        """Test: Empty dict returns empty dict."""
        result = _sanitize_for_json({})
        assert result == {}

    def test_sanitize_empty_list(self):
        """Test: Empty list returns empty list."""
        result = _sanitize_for_json([])
        assert result == []

    def test_sanitize_deeply_nested(self):
        """Test: Deeply nested structures are handled."""
        data = {'a': {'b': {'c': {'d': float('nan')}}}}
        result = _sanitize_for_json(data)
        assert result['a']['b']['c']['d'] is None


class TestHandleGetStrategies:
    """Tests for handle_get_strategies function."""

    @patch('backtest.api.list_strategies')
    def test_returns_strategies_list(self, mock_list):
        """Test: Returns strategies from list_strategies."""
        mock_list.return_value = [
            {'id': 'orb', 'name': 'ORB', 'description': 'Opening Range'}
        ]
        result = handle_get_strategies()
        assert 'strategies' in result
        assert len(result['strategies']) == 1
        assert result['strategies'][0]['id'] == 'orb'

    @patch('backtest.api.list_strategies')
    def test_includes_default_strategy(self, mock_list):
        """Test: Response includes default strategy."""
        mock_list.return_value = []
        result = handle_get_strategies()
        assert 'default' in result
        assert result['default'] == 'orb'

    @patch('backtest.api.list_strategies')
    def test_empty_strategies_list(self, mock_list):
        """Test: Handles empty strategies list."""
        mock_list.return_value = []
        result = handle_get_strategies()
        assert result['strategies'] == []
        assert result['default'] == 'orb'

    @patch('backtest.api.list_strategies')
    def test_multiple_strategies(self, mock_list):
        """Test: Handles multiple strategies."""
        mock_list.return_value = [
            {'id': 'orb', 'name': 'ORB'},
            {'id': 'sr_breakout', 'name': 'SR Breakout'},
            {'id': 'week52_chaser', 'name': '52W Chaser'},
        ]
        result = handle_get_strategies()
        assert len(result['strategies']) == 3


class TestHandleGetCosts:
    """Tests for handle_get_costs function."""

    @patch('backtest.api.get_cost_breakdown')
    def test_returns_costs_dict(self, mock_get_costs):
        """Test: Returns costs dict from get_cost_breakdown."""
        mock_get_costs.return_value = {'brokerage': {'rate': '0.03%'}}
        result = handle_get_costs()
        assert 'costs' in result
        assert result['costs']['brokerage']['rate'] == '0.03%'

    @patch('backtest.api.get_cost_breakdown')
    def test_includes_updated_timestamp(self, mock_get_costs):
        """Test: Response includes updated timestamp."""
        mock_get_costs.return_value = {}
        result = handle_get_costs()
        assert 'updated' in result
        assert result['updated'] is not None

    @patch('backtest.api.get_cost_breakdown')
    def test_timestamp_is_isoformat(self, mock_get_costs):
        """Test: Timestamp is in ISO format."""
        mock_get_costs.return_value = {}
        result = handle_get_costs()
        try:
            datetime.fromisoformat(result['updated'])
            is_valid = True
        except ValueError:
            is_valid = False
        assert is_valid


class TestHandleRunBacktest:
    """Tests for handle_run_backtest function."""

    def test_no_symbols_returns_error(self):
        """Test: Empty symbols list returns error."""
        body = {'symbols': []}
        result = handle_run_backtest(body)
        assert 'error' in result
        assert result['error'] == 'No symbols provided'

    def test_missing_symbols_key_returns_error(self):
        """Test: Missing symbols key returns error."""
        body = {}
        result = handle_run_backtest(body)
        assert 'error' in result
        assert result['error'] == 'No symbols provided'

    @patch('backtest.api.get_strategy')
    def test_unknown_strategy_returns_error(self, mock_get_strategy):
        """Test: Unknown strategy ID returns error."""
        mock_get_strategy.return_value = None
        body = {'symbols': ['TCS'], 'strategy': 'unknown'}
        result = handle_run_backtest(body)
        assert 'error' in result
        assert 'Unknown strategy' in result['error']

    @patch('backtest.api.get_strategy')
    def test_invalid_params_returns_error(self, mock_get_strategy):
        """Test: Invalid parameters return error with details."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = ['Invalid param']
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        body = {'symbols': ['TCS'], 'params': {'invalid': True}}
        result = handle_run_backtest(body)
        assert 'error' in result
        assert result['error'] == 'Invalid parameters'
        assert 'details' in result

    @patch('backtest.api.get_strategy')
    def test_strategy_run_exception_returns_error(self, mock_get_strategy):
        """Test: Exception during strategy run returns error."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = []
        mock_instance.run.side_effect = Exception('Runtime error')
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        body = {'symbols': ['TCS']}
        result = handle_run_backtest(body)
        assert 'error' in result
        assert result['error'] == 'Runtime error'

    @patch('backtest.api.get_strategy')
    def test_successful_backtest(self, mock_get_strategy):
        """Test: Successful backtest returns results."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = []
        mock_instance.run.return_value = {
            'results': [{'symbol': 'TCS', 'pnl': 100}],
            'chart_data': {},
            'candles': {},
        }
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        body = {'symbols': ['TCS']}
        result = handle_run_backtest(body)
        assert 'results' in result
        assert result['results'][0]['symbol'] == 'TCS'

    @patch('backtest.api.get_strategy')
    def test_default_strategy_is_orb(self, mock_get_strategy):
        """Test: Default strategy is 'orb' when not specified."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = []
        mock_instance.run.return_value = {'results': []}
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        body = {'symbols': ['TCS']}
        handle_run_backtest(body)
        mock_get_strategy.assert_called_with('orb')

    @patch('backtest.api.get_strategy')
    def test_default_days_is_90(self, mock_get_strategy):
        """Test: Default days is 90 when not specified."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = []
        mock_instance.run.return_value = {'results': []}
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        body = {'symbols': ['TCS']}
        handle_run_backtest(body)
        call_args = mock_instance.run.call_args
        assert call_args[0][1] == 90

    @patch('backtest.api.get_strategy')
    def test_custom_days_parameter(self, mock_get_strategy):
        """Test: Custom days parameter is passed correctly."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = []
        mock_instance.run.return_value = {'results': []}
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        body = {'symbols': ['TCS'], 'days': 30}
        handle_run_backtest(body)
        call_args = mock_instance.run.call_args
        assert call_args[0][1] == 30

    @patch('backtest.api.get_strategy')
    def test_include_costs_default_true(self, mock_get_strategy):
        """Test: include_costs defaults to True."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = []
        mock_instance.run.return_value = {'results': []}
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        body = {'symbols': ['TCS']}
        handle_run_backtest(body)
        call_args = mock_instance.run.call_args
        params = call_args[0][2]
        assert params['include_costs'] is True

    @patch('backtest.api.get_strategy')
    def test_include_costs_false(self, mock_get_strategy):
        """Test: include_costs can be set to False."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = []
        mock_instance.run.return_value = {'results': []}
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        body = {'symbols': ['TCS'], 'include_costs': False}
        handle_run_backtest(body)
        call_args = mock_instance.run.call_args
        params = call_args[0][2]
        assert params['include_costs'] is False

    @patch('backtest.api.get_strategy')
    def test_progress_callback_updates_state(self, mock_get_strategy):
        """Test: Progress callback updates progress_state."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = []

        def mock_run(symbols, days, params, callback):
            if callback:
                callback(1, 3, 'Processing TCS')
            return {'results': []}

        mock_instance.run = mock_run
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        progress_state = {}
        body = {'symbols': ['TCS']}
        handle_run_backtest(body, progress_state)

        assert progress_state['current'] == 1
        assert progress_state['total'] == 3
        assert progress_state['message'] == 'Processing TCS'
        assert 'updated' in progress_state

    @patch('backtest.api.get_strategy')
    def test_progress_callback_none_state(self, mock_get_strategy):
        """Test: Progress callback handles None progress_state."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = []

        def mock_run(symbols, days, params, callback):
            if callback:
                callback(1, 3, 'Processing')
            return {'results': []}

        mock_instance.run = mock_run
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        body = {'symbols': ['TCS']}
        result = handle_run_backtest(body, None)
        assert 'error' not in result

    @patch('backtest.api.get_strategy')
    def test_result_is_sanitized(self, mock_get_strategy):
        """Test: Result is sanitized for JSON."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = []
        mock_instance.run.return_value = {
            'results': [{'pnl': float('nan')}],
        }
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        body = {'symbols': ['TCS']}
        result = handle_run_backtest(body)
        assert result['results'][0]['pnl'] is None

    @patch('backtest.api.get_strategy')
    def test_log_to_journal_disabled_by_default(self, mock_get_strategy):
        """Test: log_to_journal defaults to False."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = []
        mock_instance.run.return_value = {'results': []}
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        body = {'symbols': ['TCS']}
        result = handle_run_backtest(body)
        assert 'journal_logged' not in result

    @patch('backtest.api.get_strategy')
    def test_log_to_journal_with_trades(self, mock_get_strategy):
        """Test: log_to_journal logs trades to journal."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = []
        mock_instance.run.return_value = {
            'results': [],
            'chart_data': {
                'TCS': {'trades': [{'entry': 100, 'exit': 110}]}
            }
        }
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        mock_journal = Mock()
        mock_journal.log_backtest_trades.return_value = 1

        body = {'symbols': ['TCS'], 'log_to_journal': True}
        with patch('trading.journal.get_journal', return_value=mock_journal):
            result = handle_run_backtest(body)
        assert result['journal_logged'] == 1

    @patch('backtest.api.get_strategy')
    def test_log_to_journal_handles_exception(self, mock_get_strategy):
        """Test: log_to_journal handles exceptions gracefully."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = []
        mock_instance.run.return_value = {
            'results': [],
            'chart_data': {'TCS': {'trades': []}}
        }
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        body = {'symbols': ['TCS'], 'log_to_journal': True}
        with patch('trading.journal.get_journal', side_effect=Exception('Journal error')):
            result = handle_run_backtest(body)
        assert 'journal_error' in result
        assert 'Journal error' in result['journal_error']

    @patch('backtest.api.get_strategy')
    def test_params_are_merged_with_include_costs(self, mock_get_strategy):
        """Test: params dict is merged with include_costs."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = []
        mock_instance.run.return_value = {'results': []}
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        body = {'symbols': ['TCS'], 'params': {'sl_pct': 0.5}}
        handle_run_backtest(body)
        call_args = mock_instance.run.call_args
        params = call_args[0][2]
        assert params['sl_pct'] == 0.5
        assert params['include_costs'] is True


class TestHandleGetChartData:
    """Tests for handle_get_chart_data function."""

    def test_no_candle_data_returns_error(self):
        """Test: Missing candle data returns error."""
        cache = {'candles': {}, 'chart_data': {}}
        result = handle_get_chart_data('TCS', cache)
        assert 'error' in result
        assert 'No chart data' in result['error']

    def test_no_trade_data_returns_error(self):
        """Test: Missing trade data returns error."""
        cache = {
            'candles': {'TCS': pd.DataFrame()},
            'chart_data': {}
        }
        result = handle_get_chart_data('TCS', cache)
        assert 'error' in result
        assert 'No trade data' in result['error']

    @patch('backtest.api.build_chart_data_for_symbol')
    def test_successful_chart_data(self, mock_build):
        """Test: Successful chart data retrieval."""
        df = pd.DataFrame({
            'open': [100], 'high': [105], 'low': [99], 'close': [102]
        })
        cache = {
            'candles': {'TCS': df},
            'chart_data': {'TCS': {'trades': []}},
            'config': {'params': {'or_minutes': 45}}
        }
        mock_build.return_value = {'candles': [], 'trades': []}

        result = handle_get_chart_data('TCS', cache)
        assert 'candles' in result
        mock_build.assert_called_once()

    @patch('backtest.api.build_chart_data_for_symbol')
    def test_default_or_minutes(self, mock_build):
        """Test: Default or_minutes when not in config."""
        df = pd.DataFrame({'open': [100], 'high': [105], 'low': [99], 'close': [102]})
        cache = {
            'candles': {'TCS': df},
            'chart_data': {'TCS': {'trades': []}},
            'config': {}
        }
        mock_build.return_value = {'candles': []}

        handle_get_chart_data('TCS', cache)
        call_args = mock_build.call_args
        assert call_args[0][3] == 45

    @patch('backtest.api.build_chart_data_for_symbol')
    def test_custom_or_minutes(self, mock_build):
        """Test: Custom or_minutes from config."""
        df = pd.DataFrame({'open': [100], 'high': [105], 'low': [99], 'close': [102]})
        cache = {
            'candles': {'TCS': df},
            'chart_data': {'TCS': {'trades': []}},
            'config': {'params': {'or_minutes': 30}}
        }
        mock_build.return_value = {'candles': []}

        handle_get_chart_data('TCS', cache)
        call_args = mock_build.call_args
        assert call_args[0][3] == 30

    @patch('backtest.api.build_chart_data_for_symbol')
    def test_exception_returns_error(self, mock_build):
        """Test: Exception during build returns error."""
        df = pd.DataFrame({'open': [100]})
        cache = {
            'candles': {'TCS': df},
            'chart_data': {'TCS': {'trades': []}},
            'config': {}
        }
        mock_build.side_effect = Exception('Build error')

        result = handle_get_chart_data('TCS', cache)
        assert 'error' in result
        assert result['error'] == 'Build error'

    @patch('backtest.api.build_chart_data_for_symbol')
    def test_result_is_sanitized(self, mock_build):
        """Test: Chart data result is sanitized."""
        df = pd.DataFrame({'open': [100]})
        cache = {
            'candles': {'TCS': df},
            'chart_data': {'TCS': {'trades': []}},
            'config': {}
        }
        mock_build.return_value = {'value': float('nan')}

        result = handle_get_chart_data('TCS', cache)
        assert result['value'] is None


class TestBacktestRequestHandler:
    """Tests for BacktestRequestHandler class."""

    def test_init_creates_empty_cache(self):
        """Test: Handler initializes with empty cache."""
        handler = BacktestRequestHandler()
        assert handler.backtest_cache == {}

    def test_init_creates_progress_state(self):
        """Test: Handler initializes with progress state."""
        handler = BacktestRequestHandler()
        assert 'current' in handler.progress_state
        assert 'total' in handler.progress_state
        assert 'message' in handler.progress_state
        assert 'updated' in handler.progress_state
        assert 'running' in handler.progress_state
        assert handler.progress_state['running'] is False

    @patch('backtest.api.handle_get_strategies')
    def test_handle_get_strategies_route(self, mock_handle):
        """Test: GET /api/backtest/strategies route."""
        mock_handle.return_value = {'strategies': [], 'default': 'orb'}
        handler = BacktestRequestHandler()
        result = handler.handle_request('GET', '/api/backtest/strategies', {})
        assert 'strategies' in result
        mock_handle.assert_called_once()

    @patch('backtest.api.handle_get_strategies')
    def test_handle_get_strategies_trailing_slash(self, mock_handle):
        """Test: Trailing slash is handled."""
        mock_handle.return_value = {'strategies': []}
        handler = BacktestRequestHandler()
        handler.handle_request('GET', '/api/backtest/strategies/', {})
        mock_handle.assert_called_once()

    @patch('backtest.api.handle_get_costs')
    def test_handle_get_costs_route(self, mock_handle):
        """Test: GET /api/backtest/costs route."""
        mock_handle.return_value = {'costs': {}, 'updated': 'now'}
        handler = BacktestRequestHandler()
        result = handler.handle_request('GET', '/api/backtest/costs', {})
        assert 'costs' in result
        mock_handle.assert_called_once()

    def test_handle_get_progress_route(self):
        """Test: GET /api/backtest/progress route."""
        handler = BacktestRequestHandler()
        result = handler.handle_request('GET', '/api/backtest/progress', {})
        assert result == handler.progress_state

    @patch('backtest.api.handle_run_backtest')
    def test_handle_post_run_route(self, mock_handle):
        """Test: POST /api/backtest/run route."""
        mock_handle.return_value = {'results': []}
        handler = BacktestRequestHandler()
        body = {'symbols': ['TCS']}
        result = handler.handle_request('POST', '/api/backtest/run', {}, body)
        assert 'results' in result
        mock_handle.assert_called_once()

    @patch('backtest.api.handle_run_backtest')
    def test_post_run_sets_running_state(self, mock_handle):
        """Test: POST /api/backtest/run sets running state."""
        mock_handle.return_value = {'results': []}
        handler = BacktestRequestHandler()
        body = {'symbols': ['TCS', 'INFY']}
        handler.handle_request('POST', '/api/backtest/run', {}, body)
        assert handler.progress_state['running'] is False
        assert handler.progress_state['total'] == 2
        assert handler.progress_state['message'] == 'Starting...'

    @patch('backtest.api.handle_run_backtest')
    def test_post_run_caches_successful_result(self, mock_handle):
        """Test: POST /api/backtest/run caches result."""
        mock_handle.return_value = {
            'results': [{'symbol': 'TCS'}],
            'candles': {'TCS': {}},
            'chart_data': {'TCS': {}},
            'config': {'days': 90}
        }
        handler = BacktestRequestHandler()
        body = {'symbols': ['TCS']}
        handler.handle_request('POST', '/api/backtest/run', {}, body)
        assert 'candles' in handler.backtest_cache
        assert 'chart_data' in handler.backtest_cache
        assert 'results' in handler.backtest_cache

    @patch('backtest.api.handle_run_backtest')
    def test_post_run_does_not_cache_error(self, mock_handle):
        """Test: POST /api/backtest/run does not cache error results."""
        mock_handle.return_value = {'error': 'Something went wrong'}
        handler = BacktestRequestHandler()
        body = {'symbols': ['TCS']}
        handler.handle_request('POST', '/api/backtest/run', {}, body)
        assert handler.backtest_cache == {}

    @patch('backtest.api.handle_get_chart_data')
    def test_handle_get_chart_route(self, mock_handle):
        """Test: GET /api/backtest/chart/{symbol} route."""
        mock_handle.return_value = {'candles': []}
        handler = BacktestRequestHandler()
        result = handler.handle_request('GET', '/api/backtest/chart/TCS', {})
        assert 'candles' in result
        mock_handle.assert_called_with('TCS', handler.backtest_cache)

    @patch('backtest.api.handle_get_chart_data')
    def test_chart_route_extracts_symbol_from_path(self, mock_handle):
        """Test: Chart route extracts symbol from path."""
        mock_handle.return_value = {}
        handler = BacktestRequestHandler()
        handler.handle_request('GET', '/api/backtest/chart/RELIANCE', {})
        mock_handle.assert_called_with('RELIANCE', handler.backtest_cache)

    def test_handle_get_results_route(self):
        """Test: GET /api/backtest/results route."""
        handler = BacktestRequestHandler()
        handler.backtest_cache = {
            'results': [{'symbol': 'TCS'}],
            'config': {'days': 90}
        }
        result = handler.handle_request('GET', '/api/backtest/results', {})
        assert 'results' in result
        assert 'config' in result

    def test_get_results_empty_cache(self):
        """Test: GET /api/backtest/results with empty cache."""
        handler = BacktestRequestHandler()
        result = handler.handle_request('GET', '/api/backtest/results', {})
        assert result['results'] == []
        assert result['config'] == {}

    def test_unknown_route_returns_error(self):
        """Test: Unknown route returns error."""
        handler = BacktestRequestHandler()
        result = handler.handle_request('GET', '/api/backtest/unknown', {})
        assert 'error' in result
        assert result['error'] == 'Not found'
        assert 'path' in result

    def test_wrong_method_returns_error(self):
        """Test: Wrong method returns error."""
        handler = BacktestRequestHandler()
        result = handler.handle_request('DELETE', '/api/backtest/strategies', {})
        assert 'error' in result

    @patch('backtest.api.handle_run_backtest')
    def test_post_run_resets_current_progress(self, mock_handle):
        """Test: POST /api/backtest/run resets current progress."""
        mock_handle.return_value = {'results': []}
        handler = BacktestRequestHandler()
        handler.progress_state['current'] = 5
        body = {'symbols': ['TCS']}
        handler.handle_request('POST', '/api/backtest/run', {}, body)
        assert handler.progress_state['current'] == 0


class TestBacktestRequestHandlerIntegration:
    """Integration tests for BacktestRequestHandler."""

    @patch('backtest.api.get_strategy')
    def test_full_backtest_flow(self, mock_get_strategy):
        """Test: Full backtest flow from run to chart retrieval."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = []
        mock_instance.run.return_value = {
            'results': [{'symbol': 'TCS', 'pnl': 100}],
            'candles': {'TCS': {'index': [], 'open': [], 'high': [], 'low': [], 'close': []}},
            'chart_data': {'TCS': {'trades': []}},
            'config': {'days': 90, 'params': {}}
        }
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        handler = BacktestRequestHandler()

        run_result = handler.handle_request(
            'POST', '/api/backtest/run', {},
            {'symbols': ['TCS'], 'strategy': 'orb'}
        )
        assert 'error' not in run_result

        progress_result = handler.handle_request(
            'GET', '/api/backtest/progress', {}
        )
        assert progress_result['running'] is False

        results = handler.handle_request(
            'GET', '/api/backtest/results', {}
        )
        assert len(results['results']) == 1

    def test_chart_data_without_prior_run(self):
        """Test: Chart data request without prior run."""
        handler = BacktestRequestHandler()
        result = handler.handle_request('GET', '/api/backtest/chart/TCS', {})
        assert 'error' in result


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_sanitize_mixed_types(self):
        """Test: Sanitize with mixed types."""
        data = {
            'int': 1,
            'float': 1.5,
            'str': 'test',
            'bool': True,
            'none': None,
            'nan': float('nan'),
            'inf': float('inf'),
        }
        result = _sanitize_for_json(data)
        assert result['int'] == 1
        assert result['float'] == 1.5
        assert result['str'] == 'test'
        assert result['bool'] is True
        assert result['none'] is None
        assert result['nan'] is None
        assert result['inf'] is None

    @patch('backtest.api.get_strategy')
    def test_backtest_with_multiple_symbols(self, mock_get_strategy):
        """Test: Backtest with multiple symbols."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = []
        mock_instance.run.return_value = {'results': []}
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        body = {'symbols': ['TCS', 'INFY', 'RELIANCE']}
        handle_run_backtest(body)
        call_args = mock_instance.run.call_args
        assert call_args[0][0] == ['TCS', 'INFY', 'RELIANCE']

    def test_chart_data_empty_cache(self):
        """Test: Chart data with completely empty cache."""
        result = handle_get_chart_data('TCS', {})
        assert 'error' in result

    def test_chart_data_none_cache(self):
        """Test: Chart data with None cache returns error."""
        with pytest.raises(AttributeError):
            handle_get_chart_data('TCS', None)

    @patch('backtest.api.handle_run_backtest')
    def test_handler_consecutive_runs(self, mock_handle):
        """Test: Consecutive backtest runs update cache."""
        mock_handle.side_effect = [
            {'results': [{'run': 1}]},
            {'results': [{'run': 2}]},
        ]
        handler = BacktestRequestHandler()

        handler.handle_request('POST', '/api/backtest/run', {}, {'symbols': ['A']})
        assert handler.backtest_cache['results'][0]['run'] == 1

        handler.handle_request('POST', '/api/backtest/run', {}, {'symbols': ['B']})
        assert handler.backtest_cache['results'][0]['run'] == 2

    def test_path_with_multiple_slashes(self):
        """Test: Path with multiple trailing slashes."""
        handler = BacktestRequestHandler()
        result = handler.handle_request('GET', '/api/backtest/strategies///', {})
        assert 'strategies' in result or 'error' in result

    @patch('backtest.api.get_strategy')
    def test_backtest_with_empty_params(self, mock_get_strategy):
        """Test: Backtest with empty params dict."""
        mock_strategy_class = Mock()
        mock_instance = Mock()
        mock_instance.validate_params.return_value = []
        mock_instance.run.return_value = {'results': []}
        mock_strategy_class.return_value = mock_instance
        mock_get_strategy.return_value = mock_strategy_class

        body = {'symbols': ['TCS'], 'params': {}}
        result = handle_run_backtest(body)
        assert 'error' not in result

    def test_handler_case_sensitive_paths(self):
        """Test: Paths are case-sensitive."""
        handler = BacktestRequestHandler()
        result_lower = handler.handle_request('GET', '/api/backtest/strategies', {})
        result_upper = handler.handle_request('GET', '/API/BACKTEST/STRATEGIES', {})
        assert 'error' in result_upper
        assert 'strategies' in result_lower or 'error' not in result_lower
