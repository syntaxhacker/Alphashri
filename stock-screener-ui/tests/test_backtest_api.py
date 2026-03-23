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


def _make_mock_strategy(run_result=None, validation_errors=None):
    mock_instance = Mock()
    mock_instance.validate_params.return_value = validation_errors or []
    mock_instance.run.return_value = run_result or {'results': []}
    mock_class = Mock(return_value=mock_instance)
    return mock_class, mock_instance


@pytest.fixture
def mock_get_strategy():
    with patch('backtest.api.get_strategy') as m:
        yield m


@pytest.fixture
def mock_handle():
    with patch('backtest.api.handle_run_backtest') as m:
        yield m


@pytest.fixture
def mock_build():
    with patch('backtest.api.build_chart_data_for_symbol') as m:
        yield m


class TestSanitizeForJson:

    def test_sanitize_dict_with_finite_floats(self):
        data = {'a': 1.5, 'b': 2.0}
        result = _sanitize_for_json(data)
        assert result == {'a': 1.5, 'b': 2.0}

    def test_sanitize_dict_with_nan(self):
        data = {'value': float('nan')}
        result = _sanitize_for_json(data)
        assert result['value'] is None

    def test_sanitize_dict_with_infinity(self):
        data = {'pos_inf': float('inf'), 'neg_inf': float('-inf')}
        result = _sanitize_for_json(data)
        assert result['pos_inf'] is None
        assert result['neg_inf'] is None

    def test_sanitize_list_with_non_finite(self):
        data = [1.0, float('nan'), 2.0, float('inf')]
        result = _sanitize_for_json(data)
        assert result == [1.0, None, 2.0, None]

    def test_sanitize_nested_structure(self):
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
        dt = datetime(2026, 3, 4, 10, 30, 0)
        data = {'timestamp': dt}
        result = _sanitize_for_json(data)
        assert result['timestamp'] == '2026-03-04T10:30:00'

    def test_sanitize_object_with_isoformat_method(self):
        mock_obj = Mock()
        mock_obj.isoformat.return_value = '2026-03-04T10:30:00'
        data = {'time': mock_obj}
        result = _sanitize_for_json(data)
        assert result['time'] == '2026-03-04T10:30:00'

    def test_sanitize_string_unchanged(self):
        data = {'text': 'hello world'}
        result = _sanitize_for_json(data)
        assert result['text'] == 'hello world'

    def test_sanitize_int_unchanged(self):
        data = {'count': 42}
        result = _sanitize_for_json(data)
        assert result['count'] == 42

    def test_sanitize_none_unchanged(self):
        data = {'value': None}
        result = _sanitize_for_json(data)
        assert result['value'] is None

    def test_sanitize_bool_unchanged(self):
        data = {'flag': True, 'flag2': False}
        result = _sanitize_for_json(data)
        assert result['flag'] is True
        assert result['flag2'] is False

    def test_sanitize_empty_dict(self):
        result = _sanitize_for_json({})
        assert result == {}

    def test_sanitize_empty_list(self):
        result = _sanitize_for_json([])
        assert result == []

    def test_sanitize_deeply_nested(self):
        data = {'a': {'b': {'c': {'d': float('nan')}}}}
        result = _sanitize_for_json(data)
        assert result['a']['b']['c']['d'] is None


class TestHandleGetStrategies:

    @patch('backtest.api.list_strategies')
    def test_returns_strategies_list(self, mock_list):
        mock_list.return_value = [
            {'id': 'orb', 'name': 'ORB', 'description': 'Opening Range'}
        ]
        result = handle_get_strategies()
        assert 'strategies' in result
        assert len(result['strategies']) == 1
        assert result['strategies'][0]['id'] == 'orb'

    @patch('backtest.api.list_strategies')
    def test_includes_default_strategy(self, mock_list):
        mock_list.return_value = []
        result = handle_get_strategies()
        assert 'default' in result
        assert result['default'] == 'orb'

    @patch('backtest.api.list_strategies')
    def test_empty_strategies_list(self, mock_list):
        mock_list.return_value = []
        result = handle_get_strategies()
        assert result['strategies'] == []
        assert result['default'] == 'orb'

    @patch('backtest.api.list_strategies')
    def test_multiple_strategies(self, mock_list):
        mock_list.return_value = [
            {'id': 'orb', 'name': 'ORB'},
            {'id': 'sr_breakout', 'name': 'SR Breakout'},
            {'id': 'week52_chaser', 'name': '52W Chaser'},
        ]
        result = handle_get_strategies()
        assert len(result['strategies']) == 3


class TestHandleGetCosts:

    @patch('backtest.api.get_cost_breakdown')
    def test_returns_costs_dict(self, mock_get_costs):
        mock_get_costs.return_value = {'brokerage': {'rate': '0.03%'}}
        result = handle_get_costs()
        assert 'costs' in result
        assert result['costs']['brokerage']['rate'] == '0.03%'

    @patch('backtest.api.get_cost_breakdown')
    def test_includes_updated_timestamp(self, mock_get_costs):
        mock_get_costs.return_value = {}
        result = handle_get_costs()
        assert 'updated' in result
        assert result['updated'] is not None

    @patch('backtest.api.get_cost_breakdown')
    def test_timestamp_is_isoformat(self, mock_get_costs):
        mock_get_costs.return_value = {}
        result = handle_get_costs()
        try:
            datetime.fromisoformat(result['updated'])
            is_valid = True
        except ValueError:
            is_valid = False
        assert is_valid


class TestHandleRunBacktest:

    def test_no_symbols_returns_error(self):
        body = {'symbols': []}
        result = handle_run_backtest(body)
        assert 'error' in result
        assert result['error'] == 'No symbols provided'

    def test_missing_symbols_key_returns_error(self):
        body = {}
        result = handle_run_backtest(body)
        assert 'error' in result
        assert result['error'] == 'No symbols provided'

    def test_unknown_strategy_returns_error(self, mock_get_strategy):
        mock_get_strategy.return_value = None
        body = {'symbols': ['TCS'], 'strategy': 'unknown'}
        result = handle_run_backtest(body)
        assert 'error' in result
        assert 'Unknown strategy' in result['error']

    def test_invalid_params_returns_error(self, mock_get_strategy):
        mock_class, mock_instance = _make_mock_strategy(validation_errors=['Invalid param'])
        mock_get_strategy.return_value = mock_class

        body = {'symbols': ['TCS'], 'params': {'invalid': True}}
        result = handle_run_backtest(body)
        assert 'error' in result
        assert result['error'] == 'Invalid parameters'
        assert 'details' in result

    def test_strategy_run_exception_returns_error(self, mock_get_strategy):
        mock_class, mock_instance = _make_mock_strategy()
        mock_instance.run.side_effect = Exception('Runtime error')
        mock_get_strategy.return_value = mock_class

        body = {'symbols': ['TCS']}
        result = handle_run_backtest(body)
        assert 'error' in result
        assert result['error'] == 'Runtime error'

    def test_successful_backtest(self, mock_get_strategy):
        mock_class, mock_instance = _make_mock_strategy(
            run_result={'results': [{'symbol': 'TCS', 'pnl': 100}], 'chart_data': {}, 'candles': {}}
        )
        mock_get_strategy.return_value = mock_class

        body = {'symbols': ['TCS']}
        result = handle_run_backtest(body)
        assert 'results' in result
        assert result['results'][0]['symbol'] == 'TCS'

    def test_default_strategy_is_orb(self, mock_get_strategy):
        mock_class, _ = _make_mock_strategy()
        mock_get_strategy.return_value = mock_class

        body = {'symbols': ['TCS']}
        handle_run_backtest(body)
        mock_get_strategy.assert_called_with('orb')

    def test_default_days_is_90(self, mock_get_strategy):
        mock_class, mock_instance = _make_mock_strategy()
        mock_get_strategy.return_value = mock_class

        body = {'symbols': ['TCS']}
        handle_run_backtest(body)
        assert mock_instance.run.call_args[0][1] == 90

    def test_custom_days_parameter(self, mock_get_strategy):
        mock_class, mock_instance = _make_mock_strategy()
        mock_get_strategy.return_value = mock_class

        body = {'symbols': ['TCS'], 'days': 30}
        handle_run_backtest(body)
        assert mock_instance.run.call_args[0][1] == 30

    def test_include_costs_default_true(self, mock_get_strategy):
        mock_class, mock_instance = _make_mock_strategy()
        mock_get_strategy.return_value = mock_class

        body = {'symbols': ['TCS']}
        handle_run_backtest(body)
        assert mock_instance.run.call_args[0][2]['include_costs'] is True

    def test_include_costs_false(self, mock_get_strategy):
        mock_class, mock_instance = _make_mock_strategy()
        mock_get_strategy.return_value = mock_class

        body = {'symbols': ['TCS'], 'include_costs': False}
        handle_run_backtest(body)
        assert mock_instance.run.call_args[0][2]['include_costs'] is False

    def test_progress_callback_updates_state(self, mock_get_strategy):
        mock_class, mock_instance = _make_mock_strategy()

        def mock_run(symbols, days, params, callback):
            if callback:
                callback(1, 3, 'Processing TCS')
            return {'results': []}

        mock_instance.run = mock_run
        mock_get_strategy.return_value = mock_class

        progress_state = {}
        body = {'symbols': ['TCS']}
        handle_run_backtest(body, progress_state)

        assert progress_state['current'] == 1
        assert progress_state['total'] == 3
        assert progress_state['message'] == 'Processing TCS'
        assert 'updated' in progress_state

    def test_progress_callback_none_state(self, mock_get_strategy):
        mock_class, mock_instance = _make_mock_strategy()

        def mock_run(symbols, days, params, callback):
            if callback:
                callback(1, 3, 'Processing')
            return {'results': []}

        mock_instance.run = mock_run
        mock_get_strategy.return_value = mock_class

        body = {'symbols': ['TCS']}
        result = handle_run_backtest(body, None)
        assert 'error' not in result

    def test_result_is_sanitized(self, mock_get_strategy):
        mock_class, _ = _make_mock_strategy(
            run_result={'results': [{'pnl': float('nan')}]}
        )
        mock_get_strategy.return_value = mock_class

        body = {'symbols': ['TCS']}
        result = handle_run_backtest(body)
        assert result['results'][0]['pnl'] is None

    def test_log_to_journal_disabled_by_default(self, mock_get_strategy):
        mock_class, _ = _make_mock_strategy()
        mock_get_strategy.return_value = mock_class

        body = {'symbols': ['TCS']}
        result = handle_run_backtest(body)
        assert 'journal_logged' not in result

    def test_log_to_journal_with_trades(self, mock_get_strategy):
        mock_class, _ = _make_mock_strategy(
            run_result={
                'results': [],
                'chart_data': {
                    'TCS': {'trades': [{'entry': 100, 'exit': 110}]}
                }
            }
        )
        mock_get_strategy.return_value = mock_class

        mock_journal = Mock()
        mock_journal.log_backtest_trades.return_value = 1

        body = {'symbols': ['TCS'], 'log_to_journal': True}
        with patch('trading.journal.get_journal', return_value=mock_journal):
            result = handle_run_backtest(body)
        assert result['journal_logged'] == 1

    def test_log_to_journal_handles_exception(self, mock_get_strategy):
        mock_class, _ = _make_mock_strategy(
            run_result={
                'results': [],
                'chart_data': {'TCS': {'trades': []}}
            }
        )
        mock_get_strategy.return_value = mock_class

        body = {'symbols': ['TCS'], 'log_to_journal': True}
        with patch('trading.journal.get_journal', side_effect=Exception('Journal error')):
            result = handle_run_backtest(body)
        assert 'journal_error' in result
        assert 'Journal error' in result['journal_error']

    def test_params_are_merged_with_include_costs(self, mock_get_strategy):
        mock_class, mock_instance = _make_mock_strategy()
        mock_get_strategy.return_value = mock_class

        body = {'symbols': ['TCS'], 'params': {'sl_pct': 0.5}}
        handle_run_backtest(body)
        params = mock_instance.run.call_args[0][2]
        assert params['sl_pct'] == 0.5
        assert params['include_costs'] is True


class TestHandleGetChartData:

    def test_no_candle_data_returns_error(self):
        cache = {'candles': {}, 'chart_data': {}}
        result = handle_get_chart_data('TCS', cache)
        assert 'error' in result
        assert 'No chart data' in result['error']

    def test_no_trade_data_returns_error(self):
        cache = {
            'candles': {'TCS': pd.DataFrame()},
            'chart_data': {}
        }
        result = handle_get_chart_data('TCS', cache)
        assert 'error' in result
        assert 'No trade data' in result['error']

    def test_successful_chart_data(self, mock_build):
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

    def test_default_or_minutes(self, mock_build):
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

    def test_custom_or_minutes(self, mock_build):
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

    def test_exception_returns_error(self, mock_build):
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

    def test_result_is_sanitized(self, mock_build):
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

    def test_init_creates_empty_cache(self):
        handler = BacktestRequestHandler()
        assert handler.backtest_cache == {}

    def test_init_creates_progress_state(self):
        handler = BacktestRequestHandler()
        assert 'current' in handler.progress_state
        assert 'total' in handler.progress_state
        assert 'message' in handler.progress_state
        assert 'updated' in handler.progress_state
        assert 'running' in handler.progress_state
        assert handler.progress_state['running'] is False

    @patch('backtest.api.handle_get_strategies')
    def test_handle_get_strategies_route(self, mock_handle):
        mock_handle.return_value = {'strategies': [], 'default': 'orb'}
        handler = BacktestRequestHandler()
        result = handler.handle_request('GET', '/api/backtest/strategies', {})
        assert 'strategies' in result
        mock_handle.assert_called_once()

    @patch('backtest.api.handle_get_strategies')
    def test_handle_get_strategies_trailing_slash(self, mock_handle):
        mock_handle.return_value = {'strategies': []}
        handler = BacktestRequestHandler()
        handler.handle_request('GET', '/api/backtest/strategies/', {})
        mock_handle.assert_called_once()

    @patch('backtest.api.handle_get_costs')
    def test_handle_get_costs_route(self, mock_handle):
        mock_handle.return_value = {'costs': {}, 'updated': 'now'}
        handler = BacktestRequestHandler()
        result = handler.handle_request('GET', '/api/backtest/costs', {})
        assert 'costs' in result
        mock_handle.assert_called_once()

    def test_handle_get_progress_route(self):
        handler = BacktestRequestHandler()
        result = handler.handle_request('GET', '/api/backtest/progress', {})
        assert result == handler.progress_state

    def test_handle_post_run_route(self, mock_handle):
        mock_handle.return_value = {'results': []}
        handler = BacktestRequestHandler()
        body = {'symbols': ['TCS']}
        result = handler.handle_request('POST', '/api/backtest/run', {}, body)
        assert 'results' in result
        mock_handle.assert_called_once()

    def test_post_run_sets_running_state(self, mock_handle):
        mock_handle.return_value = {'results': []}
        handler = BacktestRequestHandler()
        body = {'symbols': ['TCS', 'INFY']}
        handler.handle_request('POST', '/api/backtest/run', {}, body)
        assert handler.progress_state['running'] is False
        assert handler.progress_state['total'] == 2
        assert handler.progress_state['message'] == 'Starting...'

    def test_post_run_caches_successful_result(self, mock_handle):
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

    def test_post_run_does_not_cache_error(self, mock_handle):
        mock_handle.return_value = {'error': 'Something went wrong'}
        handler = BacktestRequestHandler()
        body = {'symbols': ['TCS']}
        handler.handle_request('POST', '/api/backtest/run', {}, body)
        assert handler.backtest_cache == {}

    @patch('backtest.api.handle_get_chart_data')
    def test_handle_get_chart_route(self, mock_handle):
        mock_handle.return_value = {'candles': []}
        handler = BacktestRequestHandler()
        result = handler.handle_request('GET', '/api/backtest/chart/TCS', {})
        assert 'candles' in result
        mock_handle.assert_called_with('TCS', handler.backtest_cache)

    @patch('backtest.api.handle_get_chart_data')
    def test_chart_route_extracts_symbol_from_path(self, mock_handle):
        mock_handle.return_value = {}
        handler = BacktestRequestHandler()
        handler.handle_request('GET', '/api/backtest/chart/RELIANCE', {})
        mock_handle.assert_called_with('RELIANCE', handler.backtest_cache)

    def test_handle_get_results_route(self):
        handler = BacktestRequestHandler()
        handler.backtest_cache = {
            'results': [{'symbol': 'TCS'}],
            'config': {'days': 90}
        }
        result = handler.handle_request('GET', '/api/backtest/results', {})
        assert 'results' in result
        assert 'config' in result

    def test_get_results_empty_cache(self):
        handler = BacktestRequestHandler()
        result = handler.handle_request('GET', '/api/backtest/results', {})
        assert result['results'] == []
        assert result['config'] == {}

    def test_unknown_route_returns_error(self):
        handler = BacktestRequestHandler()
        result = handler.handle_request('GET', '/api/backtest/unknown', {})
        assert 'error' in result
        assert result['error'] == 'Not found'
        assert 'path' in result

    def test_wrong_method_returns_error(self):
        handler = BacktestRequestHandler()
        result = handler.handle_request('DELETE', '/api/backtest/strategies', {})
        assert 'error' in result

    def test_post_run_resets_current_progress(self, mock_handle):
        mock_handle.return_value = {'results': []}
        handler = BacktestRequestHandler()
        handler.progress_state['current'] = 5
        body = {'symbols': ['TCS']}
        handler.handle_request('POST', '/api/backtest/run', {}, body)
        assert handler.progress_state['current'] == 0


class TestBacktestRequestHandlerIntegration:

    def test_full_backtest_flow(self, mock_get_strategy):
        mock_class, mock_instance = _make_mock_strategy(
            run_result={
                'results': [{'symbol': 'TCS', 'pnl': 100}],
                'candles': {'TCS': {'index': [], 'open': [], 'high': [], 'low': [], 'close': []}},
                'chart_data': {'TCS': {'trades': []}},
                'config': {'days': 90, 'params': {}}
            }
        )
        mock_get_strategy.return_value = mock_class

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
        handler = BacktestRequestHandler()
        result = handler.handle_request('GET', '/api/backtest/chart/TCS', {})
        assert 'error' in result


class TestEdgeCases:

    def test_sanitize_mixed_types(self):
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

    def test_backtest_with_multiple_symbols(self, mock_get_strategy):
        mock_class, mock_instance = _make_mock_strategy()
        mock_get_strategy.return_value = mock_class

        body = {'symbols': ['TCS', 'INFY', 'RELIANCE']}
        handle_run_backtest(body)
        call_args = mock_instance.run.call_args
        assert call_args[0][0] == ['TCS', 'INFY', 'RELIANCE']

    def test_chart_data_empty_cache(self):
        result = handle_get_chart_data('TCS', {})
        assert 'error' in result

    def test_chart_data_none_cache(self):
        with pytest.raises(AttributeError):
            handle_get_chart_data('TCS', None)

    def test_handler_consecutive_runs(self, mock_handle):
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
        handler = BacktestRequestHandler()
        result = handler.handle_request('GET', '/api/backtest/strategies///', {})
        assert 'strategies' in result or 'error' in result

    def test_backtest_with_empty_params(self, mock_get_strategy):
        mock_class, _ = _make_mock_strategy()
        mock_get_strategy.return_value = mock_class

        body = {'symbols': ['TCS'], 'params': {}}
        result = handle_run_backtest(body)
        assert 'error' not in result

    def test_handler_case_sensitive_paths(self):
        handler = BacktestRequestHandler()
        result_lower = handler.handle_request('GET', '/api/backtest/strategies', {})
        result_upper = handler.handle_request('GET', '/API/BACKTEST/STRATEGIES', {})
        assert 'error' in result_upper
        assert 'strategies' in result_lower or 'error' not in result_lower
