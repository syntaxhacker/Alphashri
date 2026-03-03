"""
QA Tests for Multi-Strategy Trading System

This test file provides comprehensive end-to-end testing with dummy data
to verify the entire multi-strategy trading workflow.

Run with: python -m pytest tests/test_multi_strategy_qa.py -v
"""

import pytest
import sys
import json
import tempfile
from pathlib import Path
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, MagicMock

# Add project path
sys.path.insert(0, str(Path(__file__).parent.parent))

from trading.shared_portfolio import (
    SharedPortfolioManager,
    StrategyAllocation,
    SharedPosition,
    CompletedTrade,
    OrderSide,
)
from trading.global_risk_manager import (
    GlobalRiskManager,
    GlobalRiskConfig,
)
from trading.journal import TradeJournal, TradeRecord


# ============================================
# Test Fixtures - Dummy Data
# ============================================

@pytest.fixture
def dummy_strategies():
    """Dummy strategy configurations."""
    return [
        {
            'id': 1,
            'name': 'ORB Conservative',
            'strategy_type': 'ORB',
            'allocation_pct': 0.35,
            'max_positions': 3,
            'sl_pct': 0.4,
            'tp_pct': 1.2,
        },
        {
            'id': 2,
            'name': 'ORB Aggressive',
            'strategy_type': 'ORB',
            'allocation_pct': 0.35,
            'max_positions': 3,
            'sl_pct': 0.6,
            'tp_pct': 1.8,
        },
        {
            'id': 3,
            'name': '52W Chaser',
            'strategy_type': '52W_CHASER',
            'allocation_pct': 0.10,
            'max_positions': 2,
            'sl_pct': 0.5,
            'tp_pct': 2.0,
        },
    ]


@pytest.fixture
def dummy_stock_prices():
    """Dummy stock prices for testing."""
    return {
        'RELIANCE': 2500.0,
        'TCS': 3500.0,
        'INFY': 1500.0,
        'HDFC': 1600.0,
        'ICICI': 950.0,
        'TATASTEEL': 120.0,
        'SBIN': 550.0,
        'BAJFINANCE': 6500.0,
    }


@pytest.fixture
def portfolio_with_strategies(dummy_strategies):
    """Portfolio with strategies configured."""
    portfolio = SharedPortfolioManager(
        initial_capital=1_000_000,
        max_total_capital_pct=0.80,
        max_total_positions=10,
        max_symbol_exposure_pct=0.20,
    )

    for strategy in dummy_strategies:
        portfolio.set_strategy_allocation(
            strategy_id=strategy['id'],
            strategy_name=strategy['name'],
            allocation_pct=strategy['allocation_pct'],
            max_positions=strategy['max_positions'],
        )

    return portfolio


@pytest.fixture
def risk_manager():
    """Global risk manager with standard config."""
    return GlobalRiskManager(
        max_total_positions=10,
        max_total_capital_pct=0.80,
        max_symbol_exposure_pct=0.20,
    )


@pytest.fixture
def temp_journal_dir():
    """Temporary directory for journal files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


# ============================================
# QA Test: Complete Trading Day Simulation
# ============================================

class TestCompleteTradingDay:
    """
    Simulate a complete trading day with multiple strategies,
    multiple trades, and verify all tracking is correct.
    """

    def test_full_trading_day_simulation(
        self,
        portfolio_with_strategies,
        risk_manager,
        dummy_stock_prices,
        temp_journal_dir,
    ):
        """Simulate a full trading day with entries, updates, and exits."""
        portfolio = portfolio_with_strategies
        journal = TradeJournal(journal_dir=str(temp_journal_dir))

        # ========================================
        # PHASE 1: Market Open - Initial Positions
        # ========================================
        print("\n=== PHASE 1: Market Open - Initial Positions ===")

        # Strategy 1 (ORB Conservative) opens RELIANCE
        trade_1_result = risk_manager.validate_trade(
            strategy_id=1,
            strategy_name="ORB Conservative",
            symbol="RELIANCE",
            entry_price=2500,
            stop_loss=2490,  # 0.4% SL
            take_profit=2530,  # 1.2% TP
            side="BUY",
            total_capital=1_000_000,
            cash_available=1_000_000,
            current_total_positions=0,
            current_total_capital_used=0,
            strategy_max_positions=3,
            strategy_allocation_pct=0.35,
            current_strategy_positions=0,
            current_strategy_capital_used=0,
            current_symbol_exposure=0,
            daily_pnl=0,
            risk_per_trade_pct=0.01,
            max_capital_per_trade_pct=0.10,
            min_trade_value=5000,
            max_trade_value=100000,
        )
        assert trade_1_result['valid'] is True, f"Trade 1 rejected: {trade_1_result['reason']}"

        pos_1 = portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB Conservative",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=trade_1_result['shares'],
            entry_price=2500,
            stop_loss=2490,
            take_profit=2530,
        )
        assert pos_1 is not None
        print(f"✓ Strategy 1 opened RELIANCE: {trade_1_result['shares']} shares @ ₹2500")

        # Strategy 2 (ORB Aggressive) opens TCS
        trade_2_result = risk_manager.validate_trade(
            strategy_id=2,
            strategy_name="ORB Aggressive",
            symbol="TCS",
            entry_price=3500,
            stop_loss=3479,  # 0.6% SL
            take_profit=3563,  # 1.8% TP
            side="BUY",
            total_capital=1_000_000,
            cash_available=portfolio.cash,
            current_total_positions=1,
            current_total_capital_used=portfolio.get_total_capital_used(),
            strategy_max_positions=3,
            strategy_allocation_pct=0.35,
            current_strategy_positions=0,
            current_strategy_capital_used=0,
            current_symbol_exposure=0,
            daily_pnl=0,
            risk_per_trade_pct=0.01,
            max_capital_per_trade_pct=0.10,
        )
        assert trade_2_result['valid'] is True, f"Trade 2 rejected: {trade_2_result['reason']}"

        pos_2 = portfolio.open_position(
            strategy_id=2,
            strategy_name="ORB Aggressive",
            symbol="TCS",
            side=OrderSide.BUY,
            quantity=trade_2_result['shares'],
            entry_price=3500,
            stop_loss=3479,
            take_profit=3563,
        )
        assert pos_2 is not None
        print(f"✓ Strategy 2 opened TCS: {trade_2_result['shares']} shares @ ₹3500")

        # Verify initial state
        status = portfolio.get_portfolio_status()
        assert status['total_positions'] == 2
        print(f"✓ Portfolio has 2 positions, cash: ₹{status['cash']:,.0f}")

        # ========================================
        # PHASE 2: Both Strategies Trade Same Symbol
        # ========================================
        print("\n=== PHASE 2: Both Strategies Trade Same Symbol ===")

        # Strategy 1 opens INFY
        pos_3 = portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB Conservative",
            symbol="INFY",
            side=OrderSide.BUY,
            quantity=50,
            entry_price=1500,
            stop_loss=1494,
            take_profit=1518,
        )
        assert pos_3 is not None
        print(f"✓ Strategy 1 opened INFY: 50 shares @ ₹1500")

        # Strategy 2 ALSO opens INFY (same symbol, different strategy)
        pos_4 = portfolio.open_position(
            strategy_id=2,
            strategy_name="ORB Aggressive",
            symbol="INFY",
            side=OrderSide.BUY,
            quantity=40,
            entry_price=1505,
            stop_loss=1496,
            take_profit=1532,
        )
        assert pos_4 is not None, "Strategy 2 should be able to trade INFY!"
        print(f"✓ Strategy 2 ALSO opened INFY: 40 shares @ ₹1505")

        # Verify both positions exist with different keys
        assert "1_INFY" in portfolio.positions
        assert "2_INFY" in portfolio.positions
        print("✓ Both strategies have separate INFY positions")

        # ========================================
        # PHASE 3: Price Updates and P&L Tracking
        # ========================================
        print("\n=== PHASE 3: Price Updates ===")

        # Update prices
        price_updates = {
            'RELIANCE': 2520,  # +0.8%
            'TCS': 3480,       # -0.6% (near SL)
            'INFY': 1510,      # +0.7%
        }
        portfolio.update_prices(price_updates)

        # Check RELIANCE P&L
        reli_pos = portfolio.positions["1_RELIANCE"]
        assert reli_pos.unrealized_pnl > 0, "RELIANCE should be profitable"
        print(f"✓ RELIANCE unrealized P&L: ₹{reli_pos.unrealized_pnl:.2f}")

        # Check TCS P&L
        tcs_pos = portfolio.positions["2_TCS"]
        assert tcs_pos.unrealized_pnl < 0, "TCS should be at a loss"
        print(f"✓ TCS unrealized P&L: ₹{tcs_pos.unrealized_pnl:.2f}")

        # ========================================
        # PHASE 4: Position Exits
        # ========================================
        print("\n=== PHASE 4: Position Exits ===")

        # Close RELIANCE at profit (TP hit)
        trade_1 = portfolio.close_position(
            strategy_id=1,
            symbol="RELIANCE",
            exit_price=2530,
            exit_reason="TP",
            costs=150,
        )
        assert trade_1 is not None
        assert trade_1.pnl > 0
        print(f"✓ RELIANCE closed at TP: P&L ₹{trade_1.pnl:.2f}, Net ₹{trade_1.net_pnl:.2f}")

        # Log to journal
        journal.log_trade({
            'trade_id': trade_1.trade_id,
            'symbol': trade_1.symbol,
            'side': trade_1.side.value,
            'quantity': trade_1.quantity,
            'entry_price': trade_1.entry_price,
            'exit_price': trade_1.exit_price,
            'entry_time': trade_1.entry_time.isoformat(),
            'exit_time': trade_1.exit_time.isoformat(),
            'pnl': trade_1.pnl,
            'pnl_pct': trade_1.pnl_pct,
            'exit_reason': trade_1.exit_reason,
            'costs': trade_1.costs,
            'net_pnl': trade_1.net_pnl,
            'strategy_id': trade_1.strategy_id,
            'strategy_name': trade_1.strategy_name,
        })

        # Close TCS at loss (SL hit)
        trade_2 = portfolio.close_position(
            strategy_id=2,
            symbol="TCS",
            exit_price=3479,
            exit_reason="SL",
            costs=100,
        )
        assert trade_2 is not None
        assert trade_2.pnl < 0
        print(f"✓ TCS closed at SL: P&L ₹{trade_2.pnl:.2f}, Net ₹{trade_2.net_pnl:.2f}")

        journal.log_trade({
            'trade_id': trade_2.trade_id,
            'symbol': trade_2.symbol,
            'side': trade_2.side.value,
            'quantity': trade_2.quantity,
            'entry_price': trade_2.entry_price,
            'exit_price': trade_2.exit_price,
            'entry_time': trade_2.entry_time.isoformat(),
            'exit_time': trade_2.exit_time.isoformat(),
            'pnl': trade_2.pnl,
            'pnl_pct': trade_2.pnl_pct,
            'exit_reason': trade_2.exit_reason,
            'costs': trade_2.costs,
            'net_pnl': trade_2.net_pnl,
            'strategy_id': trade_2.strategy_id,
            'strategy_name': trade_2.strategy_name,
        })

        # Close both INFY positions
        trade_3 = portfolio.close_position(
            strategy_id=1,
            symbol="INFY",
            exit_price=1515,
            exit_reason="MANUAL",
            costs=50,
        )
        trade_4 = portfolio.close_position(
            strategy_id=2,
            symbol="INFY",
            exit_price=1515,
            exit_reason="MANUAL",
            costs=40,
        )

        for t in [trade_3, trade_4]:
            journal.log_trade({
                'trade_id': t.trade_id,
                'symbol': t.symbol,
                'side': t.side.value,
                'quantity': t.quantity,
                'entry_price': t.entry_price,
                'exit_price': t.exit_price,
                'entry_time': t.entry_time.isoformat(),
                'exit_time': t.exit_time.isoformat(),
                'pnl': t.pnl,
                'pnl_pct': t.pnl_pct,
                'exit_reason': t.exit_reason,
                'costs': t.costs,
                'net_pnl': t.net_pnl,
                'strategy_id': t.strategy_id,
                'strategy_name': t.strategy_name,
            })

        # ========================================
        # PHASE 5: Verify Final State
        # ========================================
        print("\n=== PHASE 5: Final State Verification ===")

        # All positions closed
        assert len(portfolio.positions) == 0
        print("✓ All positions closed")

        # 4 trades recorded
        assert len(portfolio.trades) == 4
        assert len(journal.trades) == 4
        print(f"✓ 4 trades recorded in journal")

        # Strategy performance
        strategy_perf = journal.get_strategy_performance()
        assert 1 in strategy_perf  # ORB Conservative
        assert 2 in strategy_perf  # ORB Aggressive
        print(f"✓ Strategy performance tracked")

        # Display results
        print("\n--- Strategy Performance ---")
        for sid, perf in strategy_perf.items():
            print(f"  {perf['strategy_name']}:")
            print(f"    Trades: {perf['trades']}, Win Rate: {perf['win_rate']}%")
            print(f"    Net P&L: ₹{perf['net_pnl']:.2f}")

        # Overall performance
        overall = journal.get_performance_summary()
        print(f"\n--- Overall Performance ---")
        print(f"  Total Trades: {overall['total_trades']}")
        print(f"  Win Rate: {overall['win_rate']:.1f}%")
        print(f"  Net P&L: ₹{overall['net_pnl']:.2f}")
        print(f"  Profit Factor: {overall['profit_factor']:.2f}")

        # Save journal
        journal.save_journal()
        print("\n✓ Journal saved")

        # Verify journal file
        journal_files = list(temp_journal_dir.glob("*.json"))
        assert len(journal_files) == 1
        print(f"✓ Journal file created: {journal_files[0].name}")


# ============================================
# QA Test: Risk Management Edge Cases
# ============================================

class TestRiskManagementEdgeCases:
    """Test edge cases in risk management."""

    def test_max_positions_per_strategy(
        self,
        portfolio_with_strategies,
        risk_manager,
    ):
        """Verify strategy position limits are enforced."""
        portfolio = portfolio_with_strategies

        # Strategy 1 has max 3 positions
        # Open 3 positions
        for symbol in ['A', 'B', 'C']:
            pos = portfolio.open_position(
                strategy_id=1,
                strategy_name="ORB Conservative",
                symbol=symbol,
                side=OrderSide.BUY,
                quantity=10,
                entry_price=100,
                stop_loss=99,
                take_profit=102,
            )
            assert pos is not None, f"Should open position {symbol}"

        # Try to open 4th - should fail
        allowed, reason = portfolio.can_open_position(
            strategy_id=1,
            symbol='D',
            trade_value=1000,
        )
        assert allowed is False
        assert "max positions" in reason.lower()
        print(f"✓ Strategy position limit enforced: {reason}")

    def test_global_position_limit(
        self,
        portfolio_with_strategies,
    ):
        """Verify global position limits across all strategies."""
        portfolio = portfolio_with_strategies
        portfolio.max_total_positions = 4  # Set lower limit for testing

        # Open positions across strategies
        portfolio.open_position(1, "S1", "A", OrderSide.BUY, 10, 100, 99, 102)
        portfolio.open_position(1, "S1", "B", OrderSide.BUY, 10, 100, 99, 102)
        portfolio.open_position(2, "S2", "C", OrderSide.BUY, 10, 100, 99, 102)
        portfolio.open_position(2, "S2", "D", OrderSide.BUY, 10, 100, 99, 102)

        assert portfolio.get_total_positions() == 4

        # Try 5th position
        allowed, reason = portfolio.can_open_position(
            strategy_id=3,
            symbol='E',
            trade_value=1000,
        )
        assert allowed is False
        assert "positions limit" in reason.lower()
        print(f"✓ Global position limit enforced: {reason}")

    def test_symbol_exposure_limit(
        self,
        portfolio_with_strategies,
    ):
        """Verify symbol exposure limits prevent over-concentration."""
        portfolio = portfolio_with_strategies
        portfolio.max_symbol_exposure_pct = 0.10  # 10% max

        # Strategy 1 opens large RELIANCE position (8% of capital)
        portfolio.open_position(
            strategy_id=1,
            strategy_name="S1",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=40,  # 40 * 2000 = 80,000 = 8%
            entry_price=2000,
            stop_loss=1990,
            take_profit=2020,
        )

        # Strategy 2 tries to open more RELIANCE
        # Would add 5% more = 13% total, exceeding 10% limit
        allowed, reason = portfolio.can_open_position(
            strategy_id=2,
            symbol="RELIANCE",
            trade_value=50_000,  # 5% of capital
        )
        assert allowed is False
        assert "exposure" in reason.lower()
        print(f"✓ Symbol exposure limit enforced: {reason}")

    def test_capital_allocation_per_strategy(
        self,
        portfolio_with_strategies,
    ):
        """Verify each strategy can only use its allocated capital."""
        portfolio = portfolio_with_strategies

        # Strategy 3 has 10% allocation = 100,000
        strategy_status = portfolio.get_strategy_status(3)
        assert strategy_status['allocated_capital'] == 100_000

        # Try to use more than allocated
        allowed, reason = portfolio.can_open_position(
            strategy_id=3,
            symbol="TEST",
            trade_value=120_000,  # More than 100k
        )
        assert allowed is False
        assert "capital limit" in reason.lower()
        print(f"✓ Strategy capital limit enforced: {reason}")

    def test_insufficient_cash(
        self,
        portfolio_with_strategies,
    ):
        """Verify trades rejected when cash is insufficient."""
        portfolio = portfolio_with_strategies

        # Use up most cash
        portfolio.cash = 10_000  # Only 10k left

        # Try large trade
        allowed, reason = portfolio.can_open_position(
            strategy_id=1,
            symbol="TEST",
            trade_value=50_000,
        )
        assert allowed is False
        assert "insufficient cash" in reason.lower()
        print(f"✓ Insufficient cash handled: {reason}")


# ============================================
# QA Test: Journal and Performance Tracking
# ============================================

class TestJournalTracking:
    """Test journal and performance tracking functionality."""

    def test_strategy_performance_tracking(self, temp_journal_dir):
        """Verify strategy-specific performance is tracked correctly."""
        journal = TradeJournal(journal_dir=str(temp_journal_dir))

        # Add trades for different strategies
        trades = [
            {'symbol': 'A', 'strategy_id': 1, 'strategy_name': 'Cons', 'net_pnl': 1000},
            {'symbol': 'B', 'strategy_id': 1, 'strategy_name': 'Cons', 'net_pnl': -500},
            {'symbol': 'C', 'strategy_id': 2, 'strategy_name': 'Aggr', 'net_pnl': 2000},
            {'symbol': 'D', 'strategy_id': 2, 'strategy_name': 'Aggr', 'net_pnl': -300},
            {'symbol': 'E', 'strategy_id': 2, 'strategy_name': 'Aggr', 'net_pnl': 1500},
        ]

        for i, t in enumerate(trades):
            journal.log_trade({
                'trade_id': f'TRADE-{i:03d}',
                'symbol': t['symbol'],
                'side': 'BUY',
                'quantity': 10,
                'entry_price': 100,
                'exit_price': 100 + t['net_pnl'] / 10,
                'entry_time': '2024-01-01T10:00:00',
                'exit_time': '2024-01-01T11:00:00',
                'pnl': t['net_pnl'] + 10,
                'pnl_pct': 1.0,
                'exit_reason': 'TP',
                'costs': 10,
                'net_pnl': t['net_pnl'],
                'strategy_id': t['strategy_id'],
                'strategy_name': t['strategy_name'],
            })

        # Get strategy performance
        perf = journal.get_strategy_performance()

        assert 1 in perf
        assert 2 in perf
        assert perf[1]['trades'] == 2
        assert perf[2]['trades'] == 3
        assert perf[1]['net_pnl'] == 500  # 1000 - 500
        assert perf[2]['net_pnl'] == 3200  # 2000 - 300 + 1500
        print(f"✓ Strategy performance tracked correctly")

    def test_daily_summary_tracking(self, temp_journal_dir):
        """Verify daily summaries are calculated correctly."""
        journal = TradeJournal(journal_dir=str(temp_journal_dir))

        today = datetime.now().strftime('%Y-%m-%d')

        # Add trades
        for i in range(5):
            journal.log_trade({
                'trade_id': f'TRADE-{i:03d}',
                'symbol': f'STOCK{i}',
                'side': 'BUY',
                'quantity': 10,
                'entry_price': 100,
                'exit_price': 105 if i < 3 else 95,
                'entry_time': f'{today}T10:00:00',
                'exit_time': f'{today}T11:00:00',
                'pnl': 50 if i < 3 else -50,
                'pnl_pct': 5.0 if i < 3 else -5.0,
                'exit_reason': 'TP' if i < 3 else 'SL',
                'costs': 5,
                'net_pnl': 45 if i < 3 else -55,
                'strategy_id': 1,
                'strategy_name': 'Test',
            })

        daily = journal.get_daily_report()
        assert daily['trades'] == 5
        assert daily['winners'] == 3
        assert daily['losers'] == 2
        assert daily['net_pnl'] == 25  # 3*45 - 2*55 = 135 - 110
        print(f"✓ Daily summary: {daily['winners']}W/{daily['losers']}L, Net ₹{daily['net_pnl']}")


# ============================================
# QA Test: Concurrent Strategy Operations
# ============================================

class TestConcurrentOperations:
    """Test concurrent operations across strategies."""

    def test_simultaneous_same_symbol_trades(self, portfolio_with_strategies):
        """Test that multiple strategies can simultaneously trade same symbol."""
        portfolio = portfolio_with_strategies

        # Both strategies trade HDFC at similar prices
        pos1 = portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB Conservative",
            symbol="HDFC",
            side=OrderSide.BUY,
            quantity=30,
            entry_price=1600,
            stop_loss=1594,
            take_profit=1619,
        )

        pos2 = portfolio.open_position(
            strategy_id=2,
            strategy_name="ORB Aggressive",
            symbol="HDFC",
            side=OrderSide.BUY,
            quantity=25,
            entry_price=1602,
            stop_loss=1592,
            take_profit=1631,
        )

        assert pos1 is not None
        assert pos2 is not None
        assert "1_HDFC" in portfolio.positions
        assert "2_HDFC" in portfolio.positions
        print("✓ Both strategies have HDFC positions")

        # Update prices
        portfolio.update_prices({'HDFC': 1610})

        # Both should show different P&L based on entry prices
        pnl1 = portfolio.positions["1_HDFC"].unrealized_pnl
        pnl2 = portfolio.positions["2_HDFC"].unrealized_pnl
        assert pnl1 != pnl2, "P&L should differ based on entry price"
        print(f"✓ Strategy 1 HDFC P&L: ₹{pnl1:.2f}")
        print(f"✓ Strategy 2 HDFC P&L: ₹{pnl2:.2f}")

    def test_independent_strategy_capital(self, portfolio_with_strategies):
        """Test that strategy capital usage is tracked independently."""
        portfolio = portfolio_with_strategies

        # Strategy 1 uses capital
        portfolio.open_position(1, "S1", "A", OrderSide.BUY, 50, 1000, 990, 1020)
        portfolio.open_position(1, "S1", "B", OrderSide.BUY, 50, 1000, 990, 1020)

        # Strategy 2 should still have full capital available
        status1 = portfolio.get_strategy_status(1)
        status2 = portfolio.get_strategy_status(2)

        assert status1['capital_used'] > 0
        assert status2['capital_used'] == 0
        assert status2['available_capital'] == status2['allocated_capital']
        print(f"✓ Strategy 1 capital used: ₹{status1['capital_used']:,.0f}")
        print(f"✓ Strategy 2 capital available: ₹{status2['available_capital']:,.0f}")


# ============================================
# QA Test: Data Export and Persistence
# ============================================

class TestDataPersistence:
    """Test data export and persistence."""

    def test_journal_export_csv(self, temp_journal_dir):
        """Test journal export to CSV."""
        journal = TradeJournal(journal_dir=str(temp_journal_dir))

        # Add some trades
        for i in range(3):
            journal.log_trade({
                'trade_id': f'TRADE-{i:03d}',
                'symbol': f'STOCK{i}',
                'side': 'BUY',
                'quantity': 10,
                'entry_price': 100,
                'exit_price': 110,
                'entry_time': '2024-01-01T10:00:00',
                'exit_time': '2024-01-01T11:00:00',
                'pnl': 100,
                'pnl_pct': 10.0,
                'exit_reason': 'TP',
                'costs': 5,
                'net_pnl': 95,
                'strategy_id': 1,
                'strategy_name': 'Test',
            })

        # Export
        csv_path = journal.export_to_csv()
        assert Path(csv_path).exists()

        # Read and verify
        with open(csv_path, 'r') as f:
            content = f.read()
            assert 'TRADE-000' in content
            assert 'STOCK0' in content
            assert 'strategy_id' in content.lower() or 'Test' in content

        print(f"✓ Journal exported to CSV: {csv_path}")

    def test_journal_save_and_load(self, temp_journal_dir):
        """Test journal save and load cycle."""
        journal1 = TradeJournal(journal_dir=str(temp_journal_dir))

        # Add trades
        for i in range(5):
            journal1.log_trade({
                'trade_id': f'TRADE-{i:03d}',
                'symbol': f'STOCK{i}',
                'side': 'BUY',
                'quantity': 10,
                'entry_price': 100 + i * 10,
                'exit_price': 110 + i * 10,
                'entry_time': f'2024-01-0{i+1}T10:00:00',
                'exit_time': f'2024-01-0{i+1}T11:00:00',
                'pnl': 100,
                'pnl_pct': 10.0,
                'exit_reason': 'TP',
                'costs': 5,
                'net_pnl': 95,
                'strategy_id': i % 2 + 1,
                'strategy_name': f'Strategy{i % 2 + 1}',
            })

        journal1.save_journal()

        # Create new journal and load
        journal2 = TradeJournal(journal_dir=str(temp_journal_dir))
        journal_files = list(temp_journal_dir.glob("*.json"))
        journal2.load_journal(str(journal_files[0]))

        assert len(journal2.trades) == 5
        assert len(journal2.daily_summaries) > 0
        print(f"✓ Journal saved and loaded: {len(journal2.trades)} trades")


# ============================================
# Run Tests
# ============================================

if __name__ == "__main__":
    # Run with verbose output
    pytest.main([__file__, "-v", "-s", "--tb=short"])
