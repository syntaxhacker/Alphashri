"""
Trade Journal Unit Tests

Tests for trading/journal.py covering:
1. TradeRecord creation and validation
2. TradeJournal initialization
3. Adding/recording trades
4. Loading/saving journals
5. Getting strategy performance
6. Filtering trades by date, symbol, strategy
7. P&L calculations
8. Export functionality
9. Module-level functions (get_journal, clear_journal)
"""

import pytest
import json
import csv
import tempfile
import shutil
from pathlib import Path
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, MagicMock, mock_open
from dataclasses import asdict

import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from trading.journal import (
    TradeRecord,
    TradeJournal,
    get_journal,
    clear_journal,
    _journals,
    _default_journal,
)


@pytest.fixture(autouse=True)
def reset_journal_module_state():
    _journals.clear()
    import trading.journal as journal_module
    journal_module._default_journal = None
    yield
    _journals.clear()
    journal_module._default_journal = None


@pytest.fixture
def temp_journal_dir():
    """Create a temporary directory for journal files."""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def sample_trade_dict():
    """Sample trade dictionary for log_trade tests."""
    return {
        'trade_id': 'TRADE-001',
        'symbol': 'RELIANCE',
        'side': 'BUY',
        'quantity': 100,
        'entry_price': 2500.0,
        'exit_price': 2600.0,
        'entry_time': '2024-01-15T10:15:00',
        'exit_time': '2024-01-15T12:30:00',
        'pnl': 10000.0,
        'pnl_pct': 4.0,
        'exit_reason': 'TP',
        'costs': 200.0,
        'net_pnl': 9800.0,
        'sl_price': 2450.0,
        'tp_price': 2650.0,
        'peak_price': 2620.0,
        'low_price': 2495.0,
    }


@pytest.fixture
def sample_trade_record():
    """Sample TradeRecord instance."""
    return TradeRecord(
        trade_id='TRADE-001',
        symbol='RELIANCE',
        side='BUY',
        quantity=100,
        entry_price=2500.0,
        exit_price=2600.0,
        entry_time='2024-01-15T10:15:00',
        exit_time='2024-01-15T12:30:00',
        pnl=10000.0,
        pnl_pct=4.0,
        exit_reason='TP',
        costs=200.0,
        net_pnl=9800.0,
        sl_price=2450.0,
        tp_price=2650.0,
        peak_price=2620.0,
        low_price=2495.0,
        notes='Test trade',
        strategy_id=1,
        strategy_name='ORB Conservative',
        bot_id=1,
        bot_name='TestBot',
        source='live',
        is_test=False,
    )


@pytest.fixture
def journal(temp_journal_dir):
    """Create a TradeJournal with a temporary directory."""
    return TradeJournal(journal_dir=temp_journal_dir)


@pytest.fixture
def journal_with_trades(journal, sample_trade_dict):
    """Journal with sample trades added."""
    trade1 = sample_trade_dict.copy()
    trade1['trade_id'] = 'TRADE-001'
    trade1['symbol'] = 'RELIANCE'
    trade1['net_pnl'] = 5000.0
    
    trade2 = sample_trade_dict.copy()
    trade2['trade_id'] = 'TRADE-002'
    trade2['symbol'] = 'TCS'
    trade2['net_pnl'] = -2000.0
    trade2['exit_time'] = '2024-01-15T14:00:00'
    
    trade3 = sample_trade_dict.copy()
    trade3['trade_id'] = 'TRADE-003'
    trade3['symbol'] = 'RELIANCE'
    trade3['net_pnl'] = 3000.0
    trade3['exit_time'] = '2024-01-16T10:00:00'
    trade3['strategy_id'] = 2
    trade3['strategy_name'] = 'ORB Aggressive'
    
    journal.log_trade(trade1)
    journal.log_trade(trade2)
    journal.log_trade(trade3)
    
    return journal


@pytest.mark.unit
class TestTradeRecord:
    """Tests for TradeRecord dataclass."""

    def test_create_trade_record_basic(self):
        """Test creating a basic TradeRecord with required fields."""
        record = TradeRecord(
            trade_id='TRD-001',
            symbol='RELIANCE',
            side='BUY',
            quantity=100,
            entry_price=2500.0,
            exit_price=2600.0,
            entry_time='2024-01-15T10:00:00',
            exit_time='2024-01-15T12:00:00',
            pnl=10000.0,
            pnl_pct=4.0,
            exit_reason='TP',
            costs=200.0,
            net_pnl=9800.0,
        )
        
        assert record.trade_id == 'TRD-001'
        assert record.symbol == 'RELIANCE'
        assert record.side == 'BUY'
        assert record.quantity == 100
        assert record.entry_price == 2500.0
        assert record.exit_price == 2600.0
        assert record.pnl == 10000.0
        assert record.net_pnl == 9800.0

    def test_trade_record_default_values(self):
        """Test that optional fields have correct defaults."""
        record = TradeRecord(
            trade_id='TRD-001',
            symbol='RELIANCE',
            side='BUY',
            quantity=100,
            entry_price=2500.0,
            exit_price=2600.0,
            entry_time='2024-01-15T10:00:00',
            exit_time='2024-01-15T12:00:00',
            pnl=10000.0,
            pnl_pct=4.0,
            exit_reason='TP',
            costs=200.0,
            net_pnl=9800.0,
        )
        
        assert record.sl_price == 0.0
        assert record.tp_price == 0.0
        assert record.peak_price == 0.0
        assert record.low_price == 0.0
        assert record.notes == ""
        assert record.strategy_id == 0
        assert record.strategy_name == ""
        assert record.bot_id == 0
        assert record.bot_name == ""
        assert record.source == "live"
        assert record.is_test is False

    def test_trade_record_with_all_fields(self, sample_trade_record):
        """Test TradeRecord with all optional fields set."""
        assert sample_trade_record.sl_price == 2450.0
        assert sample_trade_record.tp_price == 2650.0
        assert sample_trade_record.peak_price == 2620.0
        assert sample_trade_record.low_price == 2495.0
        assert sample_trade_record.notes == 'Test trade'
        assert sample_trade_record.strategy_id == 1
        assert sample_trade_record.strategy_name == 'ORB Conservative'
        assert sample_trade_record.bot_id == 1
        assert sample_trade_record.bot_name == 'TestBot'
        assert sample_trade_record.source == 'live'
        assert sample_trade_record.is_test is False

    def test_trade_record_asdict(self, sample_trade_record):
        """Test converting TradeRecord to dictionary."""
        d = asdict(sample_trade_record)
        
        assert isinstance(d, dict)
        assert d['trade_id'] == 'TRADE-001'
        assert d['symbol'] == 'RELIANCE'
        assert d['pnl'] == 10000.0


@pytest.mark.unit
class TestTradeJournalInit:
    """Tests for TradeJournal initialization."""

    def test_init_with_journal_dir(self, temp_journal_dir):
        """Test initialization with explicit journal directory."""
        journal = TradeJournal(journal_dir=temp_journal_dir)
        
        assert journal.journal_dir == Path(temp_journal_dir)
        assert journal.trades == []
        assert journal.daily_summaries == {}
        assert journal.user_id is None

    def test_init_with_user_id(self):
        """Test initialization with user_id creates user-specific directory."""
        journal = TradeJournal(user_id=123)
        
        assert journal.user_id == 123
        assert 'journals' in str(journal.journal_dir)
        assert '123' in str(journal.journal_dir)

    def test_init_without_args(self):
        """Test initialization without args uses default directory."""
        journal = TradeJournal()
        
        assert journal.journal_dir is not None
        assert 'journals' in str(journal.journal_dir)
        assert journal.user_id is None

    def test_init_creates_directory(self, temp_journal_dir):
        """Test that initialization creates the journal directory."""
        new_dir = Path(temp_journal_dir) / 'new_journal'
        assert not new_dir.exists()
        
        TradeJournal(journal_dir=str(new_dir))
        
        assert new_dir.exists()

    def test_init_empty_trades_and_summaries(self, journal):
        """Test that new journal has empty trades and summaries."""
        assert journal.trades == []
        assert journal.daily_summaries == {}


@pytest.mark.unit
class TestLogTrade:
    """Tests for log_trade method."""

    def test_log_trade_basic(self, journal, sample_trade_dict):
        """Test logging a basic trade."""
        record = journal.log_trade(sample_trade_dict)
        
        assert len(journal.trades) == 1
        assert journal.trades[0] == record
        assert record.trade_id == 'TRADE-001'
        assert record.symbol == 'RELIANCE'

    def test_log_trade_with_notes(self, journal, sample_trade_dict):
        """Test logging a trade with notes."""
        record = journal.log_trade(sample_trade_dict, notes='Test entry')
        
        assert record.notes == 'Test entry'

    def test_log_trade_with_strategy(self, journal, sample_trade_dict):
        """Test logging a trade with strategy info."""
        record = journal.log_trade(
            sample_trade_dict,
            strategy_id=5,
            strategy_name='Momentum'
        )
        
        assert record.strategy_id == 5
        assert record.strategy_name == 'Momentum'

    def test_log_trade_with_bot_info(self, journal, sample_trade_dict):
        """Test logging a trade with bot info."""
        record = journal.log_trade(
            sample_trade_dict,
            bot_id=10,
            bot_name='AlphaBot'
        )
        
        assert record.bot_id == 10
        assert record.bot_name == 'AlphaBot'

    def test_log_trade_uses_dict_strategy_if_present(self, journal):
        """Test that strategy info from trade dict takes precedence."""
        trade = {
            'trade_id': 'TRD-001',
            'symbol': 'TEST',
            'side': 'BUY',
            'quantity': 10,
            'entry_price': 100.0,
            'exit_price': 110.0,
            'entry_time': '2024-01-15T10:00:00',
            'exit_time': '2024-01-15T11:00:00',
            'pnl': 100.0,
            'pnl_pct': 10.0,
            'exit_reason': 'TP',
            'costs': 10.0,
            'net_pnl': 90.0,
            'strategy_id': 3,
            'strategy_name': 'FromDict',
        }
        
        record = journal.log_trade(
            trade,
            strategy_id=5,
            strategy_name='FromArgs'
        )
        
        assert record.strategy_id == 3
        assert record.strategy_name == 'FromDict'

    def test_log_trade_handles_missing_optional_fields(self, journal):
        """Test logging trade without optional fields."""
        minimal_trade = {
            'symbol': 'TEST',
            'side': 'BUY',
            'quantity': 10,
            'entry_price': 100.0,
            'exit_price': 110.0,
            'entry_time': '2024-01-15T10:00:00',
            'exit_time': '2024-01-15T11:00:00',
            'pnl': 100.0,
            'pnl_pct': 10.0,
            'exit_reason': 'TP',
            'costs': 10.0,
            'net_pnl': 90.0,
        }
        
        record = journal.log_trade(minimal_trade)
        
        assert record.trade_id == ''
        assert record.sl_price == 0
        assert record.tp_price == 0

    def test_log_trade_updates_daily_summary(self, journal, sample_trade_dict):
        """Test that logging trade updates daily summary."""
        journal.log_trade(sample_trade_dict)
        
        assert '2024-01-15' in journal.daily_summaries
        summary = journal.daily_summaries['2024-01-15']
        assert summary['trades'] == 1
        assert summary['winners'] == 1
        assert summary['losers'] == 0
        assert summary['net_pnl'] == 9800.0

    def test_log_trade_counts_losers_correctly(self, journal, sample_trade_dict):
        """Test that losing trades are counted correctly."""
        losing_trade = sample_trade_dict.copy()
        losing_trade['net_pnl'] = -500.0
        
        journal.log_trade(losing_trade)
        
        summary = journal.daily_summaries['2024-01-15']
        assert summary['losers'] == 1
        assert summary['winners'] == 0

    def test_log_trade_zero_pnl_counts_as_winner(self, journal, sample_trade_dict):
        """Test that zero net P&L counts as winner (>=0)."""
        breakeven_trade = sample_trade_dict.copy()
        breakeven_trade['net_pnl'] = 0.0
        
        journal.log_trade(breakeven_trade)
        
        summary = journal.daily_summaries['2024-01-15']
        assert summary['winners'] == 1


class TestDailySummary:
    """Tests for daily summary functionality."""

    def test_update_daily_summary_creates_new_date(self, journal, sample_trade_record):
        """Test that _update_daily_summary creates entry for new date."""
        journal._update_daily_summary(sample_trade_record)
        
        assert '2024-01-15' in journal.daily_summaries

    def test_update_daily_summary_aggregates_trades(self, journal, sample_trade_dict):
        """Test that multiple trades on same day are aggregated."""
        trade1 = sample_trade_dict.copy()
        trade1['net_pnl'] = 1000.0
        trade1['pnl'] = 1100.0
        trade1['costs'] = 100.0
        
        trade2 = sample_trade_dict.copy()
        trade2['net_pnl'] = 2000.0
        trade2['pnl'] = 2200.0
        trade2['costs'] = 200.0
        
        record1 = TradeRecord(**{k: v for k, v in trade1.items() if k in TradeRecord.__dataclass_fields__})
        record2 = TradeRecord(**{k: v for k, v in trade2.items() if k in TradeRecord.__dataclass_fields__})
        
        journal._update_daily_summary(record1)
        journal._update_daily_summary(record2)
        
        summary = journal.daily_summaries['2024-01-15']
        assert summary['trades'] == 2
        assert summary['total_pnl'] == 3300.0
        assert summary['net_pnl'] == 3000.0
        assert summary['total_costs'] == 300.0

    def test_update_daily_summary_tracks_symbols(self, journal, sample_trade_dict):
        """Test that daily summary tracks unique symbols."""
        trade1 = sample_trade_dict.copy()
        trade1['symbol'] = 'RELIANCE'
        
        trade2 = sample_trade_dict.copy()
        trade2['symbol'] = 'TCS'
        
        record1 = TradeRecord(**{k: v for k, v in trade1.items() if k in TradeRecord.__dataclass_fields__})
        record2 = TradeRecord(**{k: v for k, v in trade2.items() if k in TradeRecord.__dataclass_fields__})
        
        journal._update_daily_summary(record1)
        journal._update_daily_summary(record2)
        
        summary = journal.daily_summaries['2024-01-15']
        assert 'RELIANCE' in summary['symbols']
        assert 'TCS' in summary['symbols']
        assert len(summary['symbols']) == 2

    def test_get_daily_report_today(self, journal):
        """Test getting daily report for today."""
        today = datetime.now().strftime('%Y-%m-%d')
        
        report = journal.get_daily_report()
        
        assert report['date'] == today
        assert report['trades'] == 0

    def test_get_daily_report_specific_date(self, journal, sample_trade_dict):
        """Test getting daily report for specific date."""
        journal.log_trade(sample_trade_dict)
        
        report = journal.get_daily_report('2024-01-15')
        
        assert report['date'] == '2024-01-15'
        assert report['trades'] == 1
        assert report['net_pnl'] == 9800.0

    def test_get_daily_report_nonexistent_date(self, journal):
        """Test getting daily report for date with no trades."""
        report = journal.get_daily_report('2020-01-01')
        
        assert report['date'] == '2020-01-01'
        assert report['trades'] == 0
        assert report['winners'] == 0
        assert report['losers'] == 0


class TestPerformanceSummary:
    """Tests for get_performance_summary method."""

    def test_empty_journal_performance(self, journal):
        """Test performance summary with no trades."""
        summary = journal.get_performance_summary()
        
        assert summary['total_trades'] == 0
        assert summary['winners'] == 0
        assert summary['losers'] == 0
        assert summary['win_rate'] == 0
        assert summary['total_pnl'] == 0
        assert summary['net_pnl'] == 0
        assert summary['profit_factor'] == 0

    def test_performance_summary_with_trades(self, journal_with_trades):
        """Test performance summary calculation with trades."""
        summary = journal_with_trades.get_performance_summary()
        
        assert summary['total_trades'] == 3
        assert summary['winners'] == 2
        assert summary['losers'] == 1
        assert summary['win_rate'] == pytest.approx(66.67, rel=0.01)

    def test_performance_summary_pnl_calculation(self, journal_with_trades):
        """Test P&L calculations in summary."""
        summary = journal_with_trades.get_performance_summary()
        
        assert summary['total_pnl'] == pytest.approx(30000.0, rel=0.01)
        assert summary['net_pnl'] == pytest.approx(6000.0, rel=0.01)

    def test_performance_summary_profit_factor(self, journal, sample_trade_dict):
        """Test profit factor calculation."""
        win1 = sample_trade_dict.copy()
        win1['net_pnl'] = 1000.0
        
        win2 = sample_trade_dict.copy()
        win2['net_pnl'] = 500.0
        win2['trade_id'] = 'TRADE-002'
        
        loss1 = sample_trade_dict.copy()
        loss1['net_pnl'] = -500.0
        loss1['trade_id'] = 'TRADE-003'
        
        journal.log_trade(win1)
        journal.log_trade(win2)
        journal.log_trade(loss1)
        
        summary = journal.get_performance_summary()
        
        expected_pf = 1500.0 / 500.0
        assert summary['profit_factor'] == pytest.approx(expected_pf, rel=0.01)

    def test_performance_summary_all_winners(self, journal, sample_trade_dict):
        """Test profit factor when all trades are winners."""
        for i in range(3):
            trade = sample_trade_dict.copy()
            trade['trade_id'] = f'TRADE-{i}'
            trade['net_pnl'] = 1000.0
            journal.log_trade(trade)
        
        summary = journal.get_performance_summary()
        
        assert summary['profit_factor'] == float('inf')

    def test_performance_summary_avg_win_loss(self, journal, sample_trade_dict):
        """Test average win and loss calculations."""
        wins = [1000.0, 2000.0]
        losses = [-500.0, -300.0]
        
        for i, pnl in enumerate(wins):
            trade = sample_trade_dict.copy()
            trade['trade_id'] = f'WIN-{i}'
            trade['net_pnl'] = pnl
            journal.log_trade(trade)
        
        for i, pnl in enumerate(losses):
            trade = sample_trade_dict.copy()
            trade['trade_id'] = f'LOSS-{i}'
            trade['net_pnl'] = pnl
            journal.log_trade(trade)
        
        summary = journal.get_performance_summary()
        
        assert summary['avg_win'] == 1500.0
        assert summary['avg_loss'] == 400.0


class TestSymbolPerformance:
    """Tests for get_symbol_performance method."""

    def test_symbol_performance_empty(self, journal):
        """Test symbol performance with no trades."""
        perf = journal.get_symbol_performance()
        
        assert perf == {}

    def test_symbol_performance_single_symbol(self, journal, sample_trade_dict):
        """Test symbol performance with single symbol."""
        journal.log_trade(sample_trade_dict)
        
        perf = journal.get_symbol_performance()
        
        assert 'RELIANCE' in perf
        assert perf['RELIANCE']['trades'] == 1
        assert perf['RELIANCE']['net_pnl'] == 9800.0

    def test_symbol_performance_multiple_symbols(self, journal_with_trades):
        """Test symbol performance with multiple symbols."""
        perf = journal_with_trades.get_symbol_performance()
        
        assert 'RELIANCE' in perf
        assert 'TCS' in perf
        assert perf['RELIANCE']['trades'] == 2
        assert perf['TCS']['trades'] == 1

    def test_symbol_performance_win_rate(self, journal, sample_trade_dict):
        """Test win rate calculation per symbol."""
        win = sample_trade_dict.copy()
        win['net_pnl'] = 1000.0
        
        loss = sample_trade_dict.copy()
        loss['trade_id'] = 'TRADE-002'
        loss['net_pnl'] = -500.0
        
        journal.log_trade(win)
        journal.log_trade(loss)
        
        perf = journal.get_symbol_performance()
        
        assert perf['RELIANCE']['win_rate'] == 50.0

    def test_symbol_performance_aggregates_pnl(self, journal, sample_trade_dict):
        """Test that P&L is aggregated per symbol."""
        trade1 = sample_trade_dict.copy()
        trade1['net_pnl'] = 1000.0
        trade1['costs'] = 50.0
        
        trade2 = sample_trade_dict.copy()
        trade2['trade_id'] = 'TRADE-002'
        trade2['net_pnl'] = 2000.0
        trade2['costs'] = 100.0
        
        journal.log_trade(trade1)
        journal.log_trade(trade2)
        
        perf = journal.get_symbol_performance()
        
        assert perf['RELIANCE']['net_pnl'] == 3000.0
        assert perf['RELIANCE']['total_costs'] == 150.0


class TestStrategyPerformance:
    """Tests for get_strategy_performance method."""

    def test_strategy_performance_empty(self, journal):
        """Test strategy performance with no trades."""
        perf = journal.get_strategy_performance()
        
        assert perf == {}

    def test_strategy_performance_single_strategy(self, journal, sample_trade_dict):
        """Test strategy performance with single strategy."""
        sample_trade_dict['strategy_id'] = 1
        sample_trade_dict['strategy_name'] = 'ORB'
        journal.log_trade(sample_trade_dict)
        
        perf = journal.get_strategy_performance()
        
        assert 1 in perf
        assert perf[1]['strategy_name'] == 'ORB'
        assert perf[1]['trades'] == 1

    def test_strategy_performance_multiple_strategies(self, journal_with_trades):
        """Test strategy performance with multiple strategies."""
        perf = journal_with_trades.get_strategy_performance()
        
        assert 0 in perf
        assert 2 in perf

    def test_strategy_performance_excludes_test_trades(self, journal, sample_trade_dict):
        """Test that test trades can be excluded."""
        sample_trade_dict['is_test'] = True
        sample_trade_dict['strategy_id'] = 1
        journal.log_trade(sample_trade_dict)
        
        perf_with = journal.get_strategy_performance(include_test=True)
        perf_without = journal.get_strategy_performance(include_test=False)
        
        assert perf_with[1]['trades'] == 1
        assert perf_without == {}

    def test_strategy_performance_tracks_test_trades(self, journal, sample_trade_dict):
        """Test that test trades are tracked separately."""
        sample_trade_dict['is_test'] = True
        sample_trade_dict['strategy_id'] = 1
        journal.log_trade(sample_trade_dict)
        
        perf = journal.get_strategy_performance()
        
        assert perf[1]['test_trades'] == 1
        assert perf[1]['has_test_data'] is True

    def test_strategy_performance_tracks_symbols(self, journal, sample_trade_dict):
        """Test that strategy tracks symbols traded."""
        sample_trade_dict['strategy_id'] = 1
        journal.log_trade(sample_trade_dict)
        
        perf = journal.get_strategy_performance()
        
        assert 'RELIANCE' in perf[1]['symbols']
        assert perf[1]['symbol_count'] == 1

    def test_strategy_performance_zero_strategy_id(self, journal, sample_trade_dict):
        """Test handling of trades with strategy_id=0."""
        sample_trade_dict['strategy_id'] = 0
        journal.log_trade(sample_trade_dict)
        
        perf = journal.get_strategy_performance()
        
        assert 0 in perf
        assert perf[0]['strategy_name'] == 'Unknown'


class TestSaveLoadJournal:
    """Tests for save_journal and load_journal methods."""

    def test_save_journal_creates_file(self, journal, sample_trade_dict, temp_journal_dir):
        """Test that save_journal creates a JSON file."""
        journal.log_trade(sample_trade_dict)
        journal.save_journal()
        
        today = datetime.now().strftime('%Y%m%d')
        expected_file = Path(temp_journal_dir) / f"journal_{today}.json"
        
        assert expected_file.exists()

    def test_save_journal_content(self, journal, sample_trade_dict, temp_journal_dir):
        """Test that save_journal writes correct content."""
        journal.log_trade(sample_trade_dict)
        journal.save_journal()
        
        today = datetime.now().strftime('%Y%m%d')
        filepath = Path(temp_journal_dir) / f"journal_{today}.json"
        
        with open(filepath, 'r') as f:
            data = json.load(f)
        
        assert 'trades' in data
        assert 'daily_summaries' in data
        assert 'last_updated' in data
        assert len(data['trades']) == 1
        assert data['trades'][0]['symbol'] == 'RELIANCE'

    def test_save_journal_converts_sets_to_lists(self, journal, sample_trade_dict, temp_journal_dir):
        """Test that sets in daily_summaries are converted to lists."""
        journal.log_trade(sample_trade_dict)
        journal.save_journal()
        
        today = datetime.now().strftime('%Y%m%d')
        filepath = Path(temp_journal_dir) / f"journal_{today}.json"
        
        with open(filepath, 'r') as f:
            data = json.load(f)
        
        for summary in data['daily_summaries'].values():
            assert isinstance(summary['symbols'], list)

    def test_load_journal_restores_trades(self, journal, temp_journal_dir, sample_trade_dict):
        """Test that load_journal restores trades correctly."""
        journal.log_trade(sample_trade_dict)
        journal.save_journal()
        
        today = datetime.now().strftime('%Y%m%d')
        filepath = Path(temp_journal_dir) / f"journal_{today}.json"
        
        new_journal = TradeJournal(journal_dir=temp_journal_dir)
        new_journal.load_journal(str(filepath))
        
        assert len(new_journal.trades) == 1
        assert new_journal.trades[0].symbol == 'RELIANCE'

    def test_load_journal_restores_daily_summaries(self, journal, temp_journal_dir, sample_trade_dict):
        """Test that load_journal restores daily summaries."""
        journal.log_trade(sample_trade_dict)
        journal.save_journal()
        
        today = datetime.now().strftime('%Y%m%d')
        filepath = Path(temp_journal_dir) / f"journal_{today}.json"
        
        new_journal = TradeJournal(journal_dir=temp_journal_dir)
        new_journal.load_journal(str(filepath))
        
        assert '2024-01-15' in new_journal.daily_summaries

    def test_load_journal_converts_lists_to_sets(self, journal, temp_journal_dir, sample_trade_dict):
        """Test that symbol lists are converted back to sets."""
        journal.log_trade(sample_trade_dict)
        journal.save_journal()
        
        today = datetime.now().strftime('%Y%m%d')
        filepath = Path(temp_journal_dir) / f"journal_{today}.json"
        
        new_journal = TradeJournal(journal_dir=temp_journal_dir)
        new_journal.load_journal(str(filepath))
        
        assert isinstance(new_journal.daily_summaries['2024-01-15']['symbols'], set)

    def test_load_journal_empty_file(self, journal, temp_journal_dir):
        """Test loading an empty journal file."""
        filepath = Path(temp_journal_dir) / "journal_empty.json"
        with open(filepath, 'w') as f:
            json.dump({'trades': [], 'daily_summaries': {}}, f)
        
        journal.load_journal(str(filepath))
        
        assert journal.trades == []
        assert journal.daily_summaries == {}


class TestLoadAllJournals:
    """Tests for load_all_journals method."""

    def test_load_all_journals_no_files(self, journal):
        """Test load_all_journals when no journal files exist."""
        loaded = journal.load_all_journals(days=7)
        
        assert loaded == 0

    def test_load_all_journals_with_files(self, journal, temp_journal_dir):
        """Test loading multiple journal files."""
        for i in range(3):
            date = (datetime.now() - timedelta(days=i)).strftime('%Y%m%d')
            filepath = Path(temp_journal_dir) / f"journal_{date}.json"
            
            data = {
                'trades': [{
                    'trade_id': f'TRADE-{i}',
                    'symbol': f'STOCK{i}',
                    'side': 'BUY',
                    'quantity': 10,
                    'entry_price': 100.0,
                    'exit_price': 110.0,
                    'entry_time': '2024-01-15T10:00:00',
                    'exit_time': '2024-01-15T11:00:00',
                    'pnl': 100.0,
                    'pnl_pct': 10.0,
                    'exit_reason': 'TP',
                    'costs': 10.0,
                    'net_pnl': 90.0,
                }],
                'daily_summaries': {}
            }
            
            with open(filepath, 'w') as f:
                json.dump(data, f)
        
        loaded = journal.load_all_journals(days=3)
        
        assert loaded == 3

    def test_load_all_journals_avoids_duplicates(self, journal, temp_journal_dir):
        """Test that duplicate trades are not loaded."""
        date = datetime.now().strftime('%Y%m%d')
        filepath = Path(temp_journal_dir) / f"journal_{date}.json"
        
        trade_data = {
            'trade_id': 'TRADE-001',
            'symbol': 'TEST',
            'side': 'BUY',
            'quantity': 10,
            'entry_price': 100.0,
            'exit_price': 110.0,
            'entry_time': '2024-01-15T10:00:00',
            'exit_time': '2024-01-15T11:00:00',
            'pnl': 100.0,
            'pnl_pct': 10.0,
            'exit_reason': 'TP',
            'costs': 10.0,
            'net_pnl': 90.0,
        }
        
        data = {'trades': [trade_data], 'daily_summaries': {}}
        with open(filepath, 'w') as f:
            json.dump(data, f)
        
        journal.load_all_journals(days=1)
        assert len(journal.trades) == 1
        
        journal.load_all_journals(days=1)
        assert len(journal.trades) == 1

    def test_load_all_journals_handles_missing_fields(self, journal, temp_journal_dir):
        """Test loading trades with missing optional fields."""
        date = datetime.now().strftime('%Y%m%d')
        filepath = Path(temp_journal_dir) / f"journal_{date}.json"
        
        data = {
            'trades': [{
                'trade_id': 'TRADE-001',
                'symbol': 'TEST',
                'side': 'BUY',
                'quantity': 10,
                'entry_price': 100.0,
                'exit_price': 110.0,
                'entry_time': '2024-01-15T10:00:00',
                'exit_time': '2024-01-15T11:00:00',
                'pnl': 100.0,
                'pnl_pct': 10.0,
                'exit_reason': 'TP',
            }],
            'daily_summaries': {}
        }
        
        with open(filepath, 'w') as f:
            json.dump(data, f)
        
        loaded = journal.load_all_journals(days=1)
        
        assert loaded == 1
        assert journal.trades[0].costs == 0
        assert journal.trades[0].net_pnl == 100.0


class TestExportCSV:
    """Tests for export_to_csv method."""

    def test_export_csv_empty_journal(self, journal, temp_journal_dir):
        """Test CSV export with no trades."""
        filepath = journal.export_to_csv()
        
        with open(filepath, 'r', newline='') as f:
            reader = csv.DictReader(f)
            rows = list(reader)
        
        assert len(rows) == 0
    
    def test_export_csv_includes_all_fields(self, journal_with_trades, temp_journal_dir):
        """Test that CSV export includes all TradeRecord fields.
        
        Verifies that the export_to_csv method includes newer fields:
        source, bot_id, bot_name, is_test.
        """
        filepath = journal_with_trades.export_to_csv()
        
        with open(filepath, 'r', newline='') as f:
            reader = csv.DictReader(f)
            rows = list(reader)
        
        assert len(rows) == 3
        
        # Verify all expected fields are present
        expected_fields = [
            'trade_id', 'symbol', 'side', 'quantity',
            'entry_price', 'exit_price', 'entry_time', 'exit_time',
            'pnl', 'pnl_pct', 'exit_reason', 'costs', 'net_pnl',
            'sl_price', 'tp_price', 'peak_price', 'low_price', 'notes',
            'strategy_id', 'strategy_name', 'bot_id', 'bot_name', 'source', 'is_test'
        ]
        assert set(rows[0].keys()) == set(expected_fields)


class TestLogBacktestTrades:
    """Tests for log_backtest_trades method."""

    def test_log_backtest_trades_basic(self, journal):
        """Test logging backtest trades."""
        backtest_trades = [
            {
                'side': 'LONG',
                'quantity': 100,
                'entry_price': 2500.0,
                'exit_price': 2600.0,
                'entry_time': '2024-01-15T10:00:00',
                'exit_time': '2024-01-15T11:00:00',
                'gross_pnl': 10000.0,
                'gross_pnl_pct': 4.0,
                'net_pnl': 9800.0,
                'trading_costs': 200.0,
                'exit_reason': 'TP',
                'peak_price': 2620.0,
                'low_price': 2490.0,
            }
        ]
        
        count = journal.log_backtest_trades('RELIANCE', backtest_trades, 'ORB')
        
        assert count == 1
        assert len(journal.trades) == 1
        assert journal.trades[0].trade_id == 'BT-RELIANCE-ORB-0001'

    def test_log_backtest_trades_multiple(self, journal):
        """Test logging multiple backtest trades."""
        backtest_trades = [
            {'side': 'LONG', 'quantity': 100, 'entry_price': 100.0, 'exit_price': 110.0,
             'entry_time': '2024-01-15T10:00:00', 'exit_time': '2024-01-15T11:00:00',
             'gross_pnl': 1000.0, 'gross_pnl_pct': 10.0, 'net_pnl': 900.0, 
             'trading_costs': 100.0, 'exit_reason': 'TP'},
            {'side': 'LONG', 'quantity': 50, 'entry_price': 200.0, 'exit_price': 190.0,
             'entry_time': '2024-01-15T12:00:00', 'exit_time': '2024-01-15T13:00:00',
             'gross_pnl': -500.0, 'gross_pnl_pct': -5.0, 'net_pnl': -600.0,
             'trading_costs': 100.0, 'exit_reason': 'SL'},
        ]
        
        count = journal.log_backtest_trades('TCS', backtest_trades)
        
        assert count == 2
        assert journal.trades[0].trade_id == 'BT-TCS-backtest-0001'
        assert journal.trades[1].trade_id == 'BT-TCS-backtest-0002'

    def test_log_backtest_trades_empty_list(self, journal):
        """Test logging empty backtest trade list."""
        count = journal.log_backtest_trades('TEST', [])
        
        assert count == 0
        assert len(journal.trades) == 0


class TestModuleFunctions:
    """Tests for module-level functions."""

    def test_get_journal_default(self):
        """Test get_journal returns default journal."""
        import trading.journal as journal_module
        journal_module._default_journal = None
        
        journal = get_journal()
        
        assert journal is not None
        assert isinstance(journal, TradeJournal)

    def test_get_journal_with_user_id(self):
        """Test get_journal returns user-specific journal."""
        import trading.journal as journal_module
        journal_module._journals.clear()
        
        journal = get_journal(user_id=123)
        
        assert journal.user_id == 123
        assert '123' in str(journal.journal_dir)

    def test_get_journal_same_user_returns_same_instance(self):
        """Test that get_journal returns same instance for same user."""
        import trading.journal as journal_module
        journal_module._journals.clear()
        
        journal1 = get_journal(user_id=456)
        journal2 = get_journal(user_id=456)
        
        assert journal1 is journal2

    def test_get_journal_different_users_different_instances(self):
        """Test that different users get different journal instances."""
        import trading.journal as journal_module
        journal_module._journals.clear()
        
        journal1 = get_journal(user_id=1)
        journal2 = get_journal(user_id=2)
        
        assert journal1 is not journal2

    def test_clear_journal(self):
        """Test clear_journal removes user's journal instance."""
        import trading.journal as journal_module
        journal_module._journals.clear()
        
        get_journal(user_id=999)
        assert 999 in journal_module._journals
        
        clear_journal(999)
        assert 999 not in journal_module._journals


class TestDisplayMethods:
    """Tests for display methods (console output)."""

    def test_display_summary_no_trades(self, journal):
        """Test display_summary with no trades doesn't error."""
        with patch('trading.journal.console') as mock_console:
            journal.display_summary()
            mock_console.print.assert_called()
            from rich.table import Table
            assert isinstance(mock_console.print.call_args[0][0], Table)

    def test_display_summary_with_trades(self, journal_with_trades):
        """Test display_summary with trades."""
        with patch('trading.journal.console') as mock_console:
            journal_with_trades.display_summary()
            mock_console.print.assert_called()
            from rich.table import Table
            printed_arg = mock_console.print.call_args[0][0]
            assert isinstance(printed_arg, Table)
            assert len(printed_arg.rows) > 0

    def test_display_symbol_performance_no_trades(self, journal):
        """Test display_symbol_performance with no trades."""
        with patch('trading.journal.console') as mock_console:
            journal.display_symbol_performance()
            mock_console.print.assert_called()
            assert mock_console.print.call_count >= 1

    def test_display_symbol_performance_with_trades(self, journal_with_trades):
        """Test display_symbol_performance with trades."""
        with patch('trading.journal.console') as mock_console:
            journal_with_trades.display_symbol_performance(top_n=5)
            mock_console.print.assert_called()
            from rich.table import Table
            printed_arg = mock_console.print.call_args[0][0]
            assert isinstance(printed_arg, Table)

    def test_display_strategy_performance_no_trades(self, journal):
        """Test display_strategy_performance with no trades."""
        with patch('trading.journal.console') as mock_console:
            journal.display_strategy_performance()
            mock_console.print.assert_called()
            call_args_str = str(mock_console.print.call_args)
            assert 'No strategy data' in call_args_str

    def test_display_strategy_performance_with_trades(self, journal_with_trades):
        """Test display_strategy_performance with trades."""
        with patch('trading.journal.console') as mock_console:
            journal_with_trades.display_strategy_performance()
            mock_console.print.assert_called()
            from rich.table import Table
            printed_arg = mock_console.print.call_args[0][0]
            assert isinstance(printed_arg, Table)
            assert len(printed_arg.rows) > 0


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_log_trade_with_negative_pnl(self, journal, sample_trade_dict):
        """Test logging trade with negative P&L."""
        sample_trade_dict['net_pnl'] = -5000.0
        sample_trade_dict['pnl'] = -4800.0
        
        record = journal.log_trade(sample_trade_dict)
        
        assert record.net_pnl == -5000.0

    def test_log_trade_with_zero_quantity(self, journal, sample_trade_dict):
        """Test logging trade with zero quantity."""
        sample_trade_dict['quantity'] = 0
        
        record = journal.log_trade(sample_trade_dict)
        
        assert record.quantity == 0

    def test_get_performance_summary_all_losers(self, journal, sample_trade_dict):
        """Test performance summary when all trades are losers."""
        for i in range(3):
            trade = sample_trade_dict.copy()
            trade['trade_id'] = f'TRADE-{i}'
            trade['net_pnl'] = -1000.0
            journal.log_trade(trade)
        
        summary = journal.get_performance_summary()
        
        assert summary['winners'] == 0
        assert summary['losers'] == 3
        assert summary['win_rate'] == 0.0

    def test_load_all_journals_handles_corrupt_file(self, journal, temp_journal_dir):
        """Test load_all_journals handles corrupt JSON files."""
        date = datetime.now().strftime('%Y%m%d')
        filepath = Path(temp_journal_dir) / f"journal_{date}.json"
        
        with open(filepath, 'w') as f:
            f.write("not valid json {{{")
        
        loaded = journal.load_all_journals(days=1)
        
        assert loaded == 0

    def test_multiple_trades_same_trade_id(self, journal, sample_trade_dict):
        """Test logging trades with same trade_id (should allow - no deduplication in log_trade)."""
        journal.log_trade(sample_trade_dict)
        journal.log_trade(sample_trade_dict)
        
        assert len(journal.trades) == 2

    def test_strategy_performance_with_unknown_strategy(self, journal, sample_trade_dict):
        """Test strategy performance when strategy_name is empty."""
        sample_trade_dict['strategy_id'] = 0
        sample_trade_dict['strategy_name'] = ''
        journal.log_trade(sample_trade_dict)
        
        perf = journal.get_strategy_performance()
        
        assert perf[0]['strategy_name'] == 'Unknown'


@pytest.mark.unit
class TestPerformanceSummaryCalculations:
    """Tests for complex performance metrics in get_performance_summary."""

    def test_performance_summary_with_consistent_wins(self, journal):
        """Test metrics with consistent wins (low drawdown, high Sharpe)."""
        # 10 wins of 1% each (10,000 P&L on 1,000,000 capital)
        for i in range(10):
            journal.log_trade({
                'symbol': 'TEST', 'side': 'BUY', 'quantity': 100,
                'entry_price': 100, 'exit_price': 101,
                'entry_time': f'2024-01-{i+1:02d}', 'exit_time': f'2024-01-{i+1:02d}',
                'pnl': 10000, 'pnl_pct': 1.0, 'costs': 0, 'net_pnl': 10000,
                'exit_reason': 'TP'
            })
        
        summary = journal.get_performance_summary()
        assert summary['net_pnl'] == 100000
        assert summary['win_rate'] == 100.0
        assert summary['max_drawdown'] == 0
        # Sharpe should be 0 because stdev of and constant [1.0, 1.0...] is 0
        assert summary['sharpe_ratio'] == 0 

    def test_performance_summary_with_drawdown(self, journal):
        """Test max drawdown calculation."""
        # Win 50k, then lose 30k, then win 20k
        trades = [
            {'pnl': 50000, 'pnl_pct': 5.0},
            {'pnl': -30000, 'pnl_pct': -3.0}, # Drawdown: 30k
            {'pnl': 20000, 'pnl_pct': 2.0},
        ]
        for i, t in enumerate(trades):
            journal.log_trade({
                'symbol': 'TEST', 'side': 'BUY', 'quantity': 1,
                'entry_price': 100, 'exit_price': 105 if t['pnl'] > 0 else 95,
                'entry_time': f'2024-01-{i+1:02d}', 'exit_time': f'2024-01-{i+1:02d}',
                'pnl': t['pnl'], 'pnl_pct': t['pnl_pct'], 'costs': 0, 'net_pnl': t['pnl'],
                'exit_reason': 'MANUAL'
            })
        
        summary = journal.get_performance_summary()
        assert summary['max_drawdown'] == 30000
        # Peak equity was 1,050,000. Current after 2nd trade was 1,020,000. 
        # Drawdown % = (30,000 / 1,050,000) * 100 = 2.857...
        assert 2.85 <= summary['max_drawdown_pct'] <= 2.86

    def test_performance_summary_with_volatility(self, journal):
        """Test Sharpe Ratio with volatile returns."""
        # 5% win, 1% loss, 4% win, 2% loss
        trades = [5.0, -1.0, 4.0, -2.0]
        for i, pnl_pct in enumerate(trades):
            journal.log_trade({
                'symbol': 'TEST', 'side': 'BUY', 'quantity': 1,
                'entry_price': 100, 'exit_price': 110,
                'entry_time': f'2024-02-{i+1:02d}', 'exit_time': f'2024-02-{i+1:02d}',
                'pnl': 1000, 'pnl_pct': pnl_pct, 'costs': 0, 'net_pnl': 1000,
                'exit_reason': 'MANUAL'
            })
        
        summary = journal.get_performance_summary()
        assert summary['sharpe_ratio'] != 0
        # Mean = 1.5, Stdev = 3.415, Sharpe = (1.5 / 3.415) * sqrt(252) approx 6.97
        assert summary['sharpe_ratio'] > 0

