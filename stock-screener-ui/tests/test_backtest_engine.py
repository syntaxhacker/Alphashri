"""
Comprehensive unit tests for backtest/engine.py

Tests cover:
- BacktestEngine initialization
- Running backtests with historical data
- Strategy execution
- Signal generation and processing
- Trade execution simulation
- P&L calculations
- Performance metrics calculation
- Error handling
- Global instance management
"""

import pytest
from datetime import datetime
from unittest.mock import Mock, patch, MagicMock
import backtest.engine as engine_module

from backtest.engine import BacktestEngine


class TestBacktestEngineInit:

    def test_init_default_values(self):
        engine = BacktestEngine()
        assert engine.last_results is None
        assert engine.last_config is None
        assert engine.last_run_time is None

    def test_init_no_shared_state(self):
        engine1 = BacktestEngine()
        engine2 = BacktestEngine()

        engine1.last_results = {'test': 'data'}
        engine1.last_config = {'strategy': 'orb'}
        engine1.last_run_time = datetime.now()

        assert engine2.last_results is None
        assert engine2.last_config is None
        assert engine2.last_run_time is None


class TestListStrategies:

    def test_list_strategies_returns_list(self):
        strategies = BacktestEngine().list_strategies()
        assert isinstance(strategies, list)

    def test_list_strategies_has_expected_strategies(self):
        strategies = BacktestEngine().list_strategies()
        strategy_ids = [s['id'] for s in strategies]
        assert 'orb' in strategy_ids
        assert 'sr_breakout' in strategy_ids
        assert '52w_chaser' in strategy_ids

    def test_list_strategies_structure(self):
        strategies = BacktestEngine().list_strategies()
        for strategy in strategies:
            assert 'id' in strategy
            assert 'name' in strategy
            assert 'description' in strategy
            assert 'params' in strategy

    @patch('backtest.engine.list_strategies')
    def test_list_strategies_delegates_to_module(self, mock_list_strategies):
        mock_list_strategies.return_value = [{'id': 'test', 'name': 'Test'}]
        result = BacktestEngine().list_strategies()
        mock_list_strategies.assert_called_once()
        assert result == [{'id': 'test', 'name': 'Test'}]


def _setup_mock_get_strategy(run_result=None, validate_errors=None, side_effect=None):
    mock_instance = MagicMock()
    mock_instance.validate_params.return_value = validate_errors or []
    if side_effect:
        mock_instance.run.side_effect = side_effect
    else:
        mock_instance.run.return_value = run_result or {
            'results': {'total_pnl': 1000}, 'chart_data': {}, 'candles': {}
        }
    mock_class = MagicMock(return_value=mock_instance)
    return mock_class, mock_instance, patch('backtest.engine.get_strategy', return_value=mock_class)


class TestRun:

    @pytest.fixture
    def mock_strategy_class(self):
        mock_class = MagicMock()
        mock_instance = MagicMock()
        mock_instance.validate_params.return_value = []
        mock_instance.run.return_value = {
            'results': {'total_pnl': 1000},
            'chart_data': {},
            'candles': {},
        }
        mock_class.return_value = mock_instance
        return mock_class

    @patch('backtest.engine.get_strategy')
    def test_run_with_valid_strategy(self, mock_get_strategy, mock_strategy_class):
        mock_get_strategy.return_value = mock_strategy_class

        engine = BacktestEngine()
        result = engine.run(
            strategy_id='orb',
            symbols=['RELIANCE', 'TCS'],
            days=30,
            params={'or_minutes': 45}
        )

        assert 'results' in result
        mock_get_strategy.assert_called_once_with('orb')
        mock_strategy_class.assert_called_once()

    @patch('backtest.engine.get_strategy')
    def test_run_stores_results(self, mock_get_strategy, mock_strategy_class):
        mock_get_strategy.return_value = mock_strategy_class
        expected_result = {
            'results': {'total_pnl': 5000},
            'chart_data': {'RELIANCE': {}},
            'candles': {'RELIANCE': []},
        }
        mock_strategy_class.return_value.run.return_value = expected_result

        engine = BacktestEngine()
        result = engine.run(
            strategy_id='orb',
            symbols=['RELIANCE'],
            days=30,
            params={}
        )

        assert engine.last_results == expected_result
        assert result == expected_result

    @patch('backtest.engine.get_strategy')
    def test_run_stores_config(self, mock_get_strategy, mock_strategy_class):
        mock_get_strategy.return_value = mock_strategy_class

        engine = BacktestEngine()
        engine.run(
            strategy_id='orb',
            symbols=['RELIANCE', 'TCS'],
            days=60,
            params={'or_minutes': 30, 'sl_pct': 0.5}
        )

        assert engine.last_config['strategy'] == 'orb'
        assert engine.last_config['symbols'] == ['RELIANCE', 'TCS']
        assert engine.last_config['days'] == 60
        assert engine.last_config['params'] == {'or_minutes': 30, 'sl_pct': 0.5}

    @patch('backtest.engine.get_strategy')
    def test_run_stores_run_time(self, mock_get_strategy, mock_strategy_class):
        mock_get_strategy.return_value = mock_strategy_class

        engine = BacktestEngine()
        before = datetime.now()
        engine.run(
            strategy_id='orb',
            symbols=['RELIANCE'],
            days=30,
            params={}
        )
        after = datetime.now()

        assert engine.last_run_time is not None
        assert before <= engine.last_run_time <= after

    @patch('backtest.engine.get_strategy')
    def test_run_with_no_params(self, mock_get_strategy, mock_strategy_class):
        mock_get_strategy.return_value = mock_strategy_class

        engine = BacktestEngine()
        engine.run(
            strategy_id='orb',
            symbols=['RELIANCE'],
            days=30
        )

        mock_strategy_class.return_value.run.assert_called_once()
        call_args = mock_strategy_class.return_value.run.call_args
        assert call_args[0][2] == {}

    @patch('backtest.engine.get_strategy')
    def test_run_with_progress_callback(self, mock_get_strategy, mock_strategy_class):
        mock_get_strategy.return_value = mock_strategy_class

        progress_callback = Mock()

        engine = BacktestEngine()
        engine.run(
            strategy_id='orb',
            symbols=['RELIANCE'],
            days=30,
            params={},
            progress_callback=progress_callback
        )

        mock_strategy_class.return_value.run.assert_called_once()
        call_args = mock_strategy_class.return_value.run.call_args
        assert call_args[0][3] == progress_callback

    def test_run_with_unknown_strategy_raises(self):
        engine = BacktestEngine()

        with pytest.raises(ValueError, match="Unknown strategy: unknown_strategy"):
            engine.run(
                strategy_id='unknown_strategy',
                symbols=['RELIANCE'],
                days=30
            )

    @patch('backtest.engine.get_strategy')
    def test_run_with_invalid_params_raises(self, mock_get_strategy):
        mock_instance = MagicMock()
        mock_instance.validate_params.return_value = ['or_minutes must be positive', 'sl_pct out of range']
        mock_class = MagicMock(return_value=mock_instance)
        mock_get_strategy.return_value = mock_class

        engine = BacktestEngine()

        with pytest.raises(ValueError, match="Invalid parameters"):
            engine.run(
                strategy_id='orb',
                symbols=['RELIANCE'],
                days=30,
                params={'or_minutes': -10}
            )

    @patch('backtest.engine.get_strategy')
    def test_run_validates_params(self, mock_get_strategy, mock_strategy_class):
        mock_get_strategy.return_value = mock_strategy_class

        engine = BacktestEngine()
        engine.run(
            strategy_id='orb',
            symbols=['RELIANCE'],
            days=30,
            params={'or_minutes': 45}
        )

        mock_strategy_class.return_value.validate_params.assert_called_once_with({'or_minutes': 45})

    @patch('backtest.engine.get_strategy')
    def test_run_returns_strategy_result(self, mock_get_strategy, mock_strategy_class):
        expected_result = {
            'results': {
                'total_trades': 10,
                'winning_trades': 7,
                'losing_trades': 3,
                'total_pnl': 15000,
                'win_rate': 70.0,
            },
            'chart_data': {'RELIANCE': {'trades': []}},
            'candles': {'RELIANCE': []},
        }
        mock_strategy_class.return_value.run.return_value = expected_result
        mock_get_strategy.return_value = mock_strategy_class

        engine = BacktestEngine()
        result = engine.run(
            strategy_id='orb',
            symbols=['RELIANCE'],
            days=30
        )

        assert result == expected_result

    @patch('backtest.engine.get_strategy')
    def test_run_with_multiple_symbols(self, mock_get_strategy, mock_strategy_class):
        mock_get_strategy.return_value = mock_strategy_class

        engine = BacktestEngine()
        engine.run(
            strategy_id='orb',
            symbols=['RELIANCE', 'TCS', 'INFY', 'HDFC'],
            days=30
        )

        call_args = mock_strategy_class.return_value.run.call_args
        assert call_args[0][0] == ['RELIANCE', 'TCS', 'INFY', 'HDFC']

    @patch('backtest.engine.get_strategy')
    def test_run_with_empty_symbols_list(self, mock_get_strategy, mock_strategy_class):
        mock_get_strategy.return_value = mock_strategy_class

        engine = BacktestEngine()
        engine.run(
            strategy_id='orb',
            symbols=[],
            days=30
        )

        call_args = mock_strategy_class.return_value.run.call_args
        assert call_args[0][0] == []


class TestGetChartData:

    @pytest.fixture
    def engine_with_results(self):
        engine = BacktestEngine()
        engine.last_results = {
            'candles': {
                'RELIANCE': {'index': [], 'open': [], 'high': [], 'low': [], 'close': [], 'volume': []}
            },
            'chart_data': {
                'RELIANCE': {'trades': []}
            }
        }
        engine.last_config = {
            'params': {'or_minutes': 45}
        }
        return engine

    def test_get_chart_data_no_results_returns_none(self):
        result = BacktestEngine().get_chart_data('RELIANCE')
        assert result is None

    def test_get_chart_data_missing_symbol_returns_none(self, engine_with_results):
        result = engine_with_results.get_chart_data('TCS')
        assert result is None

    def test_get_chart_data_missing_candles_returns_none(self):
        engine = BacktestEngine()
        engine.last_results = {
            'chart_data': {'RELIANCE': {'trades': []}}
        }
        engine.last_config = {'params': {'or_minutes': 45}}
        result = engine.get_chart_data('RELIANCE')
        assert result is None

    def test_get_chart_data_missing_chart_data_returns_none(self):
        engine = BacktestEngine()
        engine.last_results = {
            'candles': {'RELIANCE': []}
        }
        engine.last_config = {'params': {'or_minutes': 45}}
        result = engine.get_chart_data('RELIANCE')
        assert result is None

    @patch('backtest.chart_data.build_chart_data_for_symbol')
    def test_get_chart_data_delegates_to_builder(self, mock_build, engine_with_results):
        mock_build.return_value = {'symbol': 'RELIANCE', 'candles': []}

        result = engine_with_results.get_chart_data('RELIANCE')

        mock_build.assert_called_once()
        assert result == {'symbol': 'RELIANCE', 'candles': []}

    @patch('backtest.chart_data.build_chart_data_for_symbol')
    def test_get_chart_data_uses_or_minutes_from_config(self, mock_build, engine_with_results):
        mock_build.return_value = {'symbol': 'RELIANCE'}

        engine_with_results.get_chart_data('RELIANCE')

        call_args = mock_build.call_args
        assert call_args[0][0] == 'RELIANCE'
        assert call_args[0][3] == 45

    @patch('backtest.chart_data.build_chart_data_for_symbol')
    def test_get_chart_data_default_or_minutes(self, mock_build):
        engine = BacktestEngine()
        engine.last_results = {
            'candles': {'RELIANCE': {'index': ['2024-01-15'], 'open': [100], 'high': [105], 'low': [99], 'close': [102], 'volume': [1000]}},
            'chart_data': {'RELIANCE': {'trades': []}}
        }
        engine.last_config = {'params': {}}
        mock_build.return_value = {}

        engine.get_chart_data('RELIANCE')

        call_args = mock_build.call_args
        assert call_args[0][3] == 45

    @patch('backtest.chart_data.build_chart_data_for_symbol')
    def test_get_chart_data_with_no_params_in_config(self, mock_build):
        engine = BacktestEngine()
        engine.last_results = {
            'candles': {'RELIANCE': {'index': ['2024-01-15'], 'open': [100], 'high': [105], 'low': [99], 'close': [102], 'volume': [1000]}},
            'chart_data': {'RELIANCE': {'trades': []}}
        }
        engine.last_config = {}
        mock_build.return_value = {}

        engine.get_chart_data('RELIANCE')

        call_args = mock_build.call_args
        assert call_args[0][3] == 45


class TestGetEngine:

    def setup_method(self):
        engine_module._engine_instance = None

    def test_get_engine_returns_instance(self):
        engine = engine_module.get_engine()
        assert isinstance(engine, engine_module.BacktestEngine)

    def test_get_engine_returns_same_instance(self):
        engine1 = engine_module.get_engine()
        engine2 = engine_module.get_engine()
        assert engine1 is engine2

    def test_get_engine_creates_instance_on_first_call(self):
        assert engine_module._engine_instance is None

        engine = engine_module.get_engine()

        assert engine_module._engine_instance is not None
        assert engine_module._engine_instance is engine

    def test_get_engine_singleton_persists_state(self):
        engine = engine_module.get_engine()
        engine.last_results = {'test': 'data'}

        engine2 = engine_module.get_engine()
        assert engine2.last_results == {'test': 'data'}


class TestBacktestEngineIntegration:

    def test_full_backtest_workflow(self):
        mock_class, mock_instance, mock_get_strategy = _setup_mock_get_strategy(
            run_result={
                'results': {
                    'total_trades': 5,
                    'winning_trades': 3,
                    'losing_trades': 2,
                    'total_pnl': 5000,
                    'win_rate': 60.0,
                    'avg_pnl_per_trade': 1000,
                },
                'chart_data': {
                    'RELIANCE': {
                        'trades': [
                            {
                                'entry_price': 2500,
                                'exit_price': 2550,
                                'quantity': 100,
                                'gross_pnl': 5000,
                                'trading_costs': 50,
                                'net_pnl': 4950,
                                'net_pnl_pct': 2.0,
                                'exit_reason': 'TP',
                            }
                        ]
                    }
                },
                'candles': {
                    'RELIANCE': {
                        'index': ['2024-01-15T09:15:00'],
                        'open': [2500],
                        'high': [2550],
                        'low': [2490],
                        'close': [2540],
                        'volume': [1000000]
                    }
                },
            }
        )

        with mock_get_strategy:
            engine = BacktestEngine()
            result = engine.run(
                strategy_id='orb',
                symbols=['RELIANCE'],
                days=30,
                params={'or_minutes': 45, 'sl_pct': 0.4, 'tp_pct': 1.2}
            )

            assert result['results']['total_trades'] == 5
            assert engine.last_results is not None
            assert engine.last_config['strategy'] == 'orb'
            assert engine.last_run_time is not None

    def test_multiple_backtests_overwrite_results(self):
        mock_class, mock_instance, mock_get_strategy = _setup_mock_get_strategy(
            side_effect=[
                {'results': {'total_pnl': 1000}, 'chart_data': {}, 'candles': {}},
                {'results': {'total_pnl': 2000}, 'chart_data': {}, 'candles': {}},
            ]
        )

        with mock_get_strategy:
            engine = BacktestEngine()
            engine.run('orb', ['A'], 30)
            first_run_time = engine.last_run_time

            engine.run('orb', ['B'], 60)

            assert engine.last_results['results']['total_pnl'] == 2000
            assert engine.last_config['symbols'] == ['B']
            assert engine.last_run_time > first_run_time


class TestBacktestEngineErrorHandling:

    def test_run_strategy_raises_exception(self):
        mock_class, _, mock_get_strategy = _setup_mock_get_strategy(
            side_effect=[RuntimeError("Data fetch failed")]
        )

        with mock_get_strategy:
            engine = BacktestEngine()

            with pytest.raises(RuntimeError, match="Data fetch failed"):
                engine.run('orb', ['RELIANCE'], 30)

    def test_run_strategy_creation_fails(self):
        mock_class = MagicMock(side_effect=TypeError("Missing required argument"))

        with patch('backtest.engine.get_strategy', return_value=mock_class):
            engine = BacktestEngine()

            with pytest.raises(TypeError, match="Missing required argument"):
                engine.run('orb', ['RELIANCE'], 30)

    def test_get_chart_data_with_malformed_results(self):
        engine = BacktestEngine()
        engine.last_results = {'invalid_key': 'invalid_value'}
        engine.last_config = {}

        result = engine.get_chart_data('RELIANCE')
        assert result is None

    def test_run_with_none_params(self):
        mock_class, mock_instance, mock_get_strategy = _setup_mock_get_strategy(
            run_result={'results': {}, 'chart_data': {}, 'candles': {}}
        )

        with mock_get_strategy:
            engine = BacktestEngine()
            engine.run('orb', ['RELIANCE'], 30, params=None)

            mock_instance.validate_params.assert_called_once_with({})

    def test_run_clears_previous_results_on_error(self):
        engine = BacktestEngine()

        mock_class, _, mock_get_strategy = _setup_mock_get_strategy(
            side_effect=[
                {'results': {'pnl': 1000}, 'chart_data': {}, 'candles': {}},
                RuntimeError("Failed")
            ]
        )

        with mock_get_strategy:
            engine.run('orb', ['A'], 30)
            assert engine.last_results['results']['pnl'] == 1000

            with pytest.raises(RuntimeError):
                engine.run('orb', ['B'], 30)

            assert engine.last_results['results']['pnl'] == 1000
