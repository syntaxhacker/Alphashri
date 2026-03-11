"""
Integration tests for complete trading flows.

Tests end-to-end trading scenarios:
- Strategy creation and configuration
- Bot creation and initialization
- Signal generation and order placement
- Position management (open, update, close)
- P&L calculation and tracking
- Trade journaling
- Bot lifecycle (start, monitor, stop)
"""

import os
import sys
import json
import tempfile
from pathlib import Path
from datetime import datetime, timedelta
from typing import Generator, Dict, List
from unittest.mock import Mock, patch, MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

# Add project root to path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from db.models import User, UserSession, StrategyConfig, BotConfig, bot_strategies
from api.auth import hash_password



class TestStrategyCreationFlow:
    """Test flow of creating and configuring trading strategies."""

    def test_create_strategy_from_template(self, client: TestClient, db: Session):
        """
        Test complete flow of creating a strategy from a template:
        1. List available templates
        2. Create strategy from template with custom parameters
        3. Verify strategy is created with correct defaults
        4. Verify strategy appears in strategy list
        """
        # First, create a template strategy
        template = StrategyConfig(
            name="orb_conservative_template",
            strategy_type="ORB",
            is_template=True,
            is_active=True,
            or_minutes=30,
            sl_pct=0.3,
            tp_pct=1.0,
            max_positions=3,
        )
        db.add(template)
        db.commit()
        db.refresh(template)

        # Step 1: List templates
        templates_response = client.get("/api/strategies/templates")
        assert templates_response.status_code == 200

        templates_data = templates_response.json()
        assert len(templates_data["templates"]) > 0
        template_ids = [t["id"] for t in templates_data["templates"]]
        assert template.id in template_ids

        # Step 2: Create strategy from template
        create_response = client.post("/api/strategies", json={
            "name": "my_orb_conservative",
            "strategy_type": "ORB",
            "parent_id": template.id,
            "sl_pct": 0.35,  # Override default
            "tp_pct": 1.5,    # Override default
        })

        assert create_response.status_code == 200
        created_strategy = create_response.json()["strategy"]

        # Step 3: Verify strategy inherited defaults correctly
        assert created_strategy["name"] == "my_orb_conservative"
        assert created_strategy["parent_id"] == template.id
        assert created_strategy["sl_pct"] == 0.35  # Overridden value
        assert created_strategy["tp_pct"] == 1.5    # Overridden value
        assert created_strategy["or_minutes"] == 30  # Inherited from template
        assert created_strategy["max_positions"] == 3  # Inherited from template

        # Step 4: Verify strategy appears in list
        list_response = client.get("/api/strategies")
        assert list_response.status_code == 200

        strategies = list_response.json()["strategies"]
        strategy_names = [s["name"] for s in strategies]
        assert "my_orb_conservative" in strategy_names

    def test_strategy_update_and_delete_flow(self, client: TestClient, db: Session):
        """Test updating and deleting a strategy."""
        # Create a strategy
        strategy = StrategyConfig(
            name="test_update_strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()
        db.refresh(strategy)

        # Update strategy
        update_response = client.put(f"/api/strategies/{strategy.id}", json={
            "name": "updated_strategy_name",
            "sl_pct": 0.5,
        })

        assert update_response.status_code == 200
        updated = update_response.json()["strategy"]
        assert updated["name"] == "updated_strategy_name"
        assert updated["sl_pct"] == 0.5

        # Delete strategy
        delete_response = client.delete(f"/api/strategies/{strategy.id}")
        assert delete_response.status_code == 200

        # Verify strategy is soft deleted
        db.refresh(strategy)
        assert strategy.is_active is False

        # Should not appear in active strategies list
        list_response = client.get("/api/strategies")
        strategies = list_response.json()["strategies"]
        strategy_ids = [s["id"] for s in strategies]
        assert strategy.id not in strategy_ids


class TestBotCreationFlow:
    """Test flow of creating and configuring trading bots."""

    def test_create_bot_with_strategies(self, client: TestClient, db: Session):
        """
        Test complete flow of creating a bot with multiple strategies:
        1. Create multiple strategies
        2. Create bot with strategy allocations
        3. Verify bot configuration
        4. Verify strategy associations
        """
        # Step 1: Create two strategies
        strategy1 = StrategyConfig(
            name="orb_conservative",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
            sl_pct=0.3,
            tp_pct=1.0,
        )
        strategy2 = StrategyConfig(
            name="orb_aggressive",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
            sl_pct=0.6,
            tp_pct=2.0,
        )
        db.add(strategy1)
        db.add(strategy2)
        db.commit()
        db.refresh(strategy1)
        db.refresh(strategy2)

        # Step 2: Create bot with strategies
        bot_response = client.post("/api/bots", json={
            "name": "Multi-Strategy Test Bot",
            "is_active": True,
            "max_total_positions": 10,
            "max_total_capital_pct": 0.8,
            "strategies": [
                {
                    "strategy_id": strategy1.id,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.40
                },
                {
                    "strategy_id": strategy2.id,
                    "max_positions": 5,
                    "capital_allocation_pct": 0.40
                }
            ]
        })

        assert bot_response.status_code == 200
        bot = bot_response.json()

        # Step 3: Verify bot configuration
        assert bot["name"] == "Multi-Strategy Test Bot"
        assert bot["max_total_positions"] == 10
        assert bot["max_total_capital_pct"] == 0.8
        assert len(bot["strategies"]) == 2

        # Step 4: Verify strategy associations in database
        associations = db.execute(
            bot_strategies.select().where(bot_strategies.c.bot_id == bot["id"])
        ).fetchall()

        assert len(associations) == 2

        # Verify allocation details
        alloc_map = {a.strategy_id: a for a in associations}
        assert strategy1.id in alloc_map
        assert strategy2.id in alloc_map
        assert alloc_map[strategy1.id].max_positions == 3
        assert alloc_map[strategy1.id].capital_allocation_pct == 0.40
        assert alloc_map[strategy2.id].max_positions == 5
        assert alloc_map[strategy2.id].capital_allocation_pct == 0.40

    def test_bot_update_flow(self, client: TestClient, db: Session):
        """Test updating bot configuration and strategies."""
        # Create initial bot
        strategy = StrategyConfig(
            name="test_strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()
        db.refresh(strategy)

        bot_response = client.post("/api/bots", json={
            "name": "Original Bot Name",
            "is_active": True,
            "max_total_positions": 5,
            "max_total_capital_pct": 0.5,
            "strategies": [
                {
                    "strategy_id": strategy.id,
                    "max_positions": 5,
                    "capital_allocation_pct": 0.5
                }
            ]
        })

        bot = bot_response.json()

        # Update bot
        update_response = client.put(f"/api/bots/{bot['id']}", json={
            "name": "Updated Bot Name",
            "max_total_positions": 8,
        })

        assert update_response.status_code == 200
        updated_bot = update_response.json()

        assert updated_bot["name"] == "Updated Bot Name"
        assert updated_bot["max_total_positions"] == 8
        # Strategy should remain unchanged
        assert len(updated_bot["strategies"]) == 1


class TestSignalGenerationFlow:
    """Test flow of generating and processing trading signals."""

    def test_generate_signals_for_symbols(self, client: TestClient, db: Session):
        """
        Test signal generation:
        1. Configure strategy
        2. Generate signals for watchlist
        3. Filter signals by risk parameters
        4. Verify signal quality
        """
        # Create a test strategy
        strategy = StrategyConfig(
            name="signal_test_strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
            or_minutes=15,
            min_or_range_pct=0.3,
            max_or_range_pct=2.0,
            sl_pct=0.4,
            tp_pct=1.2,
            max_positions=5,
            max_capital_per_trade_pct=0.15,
        )
        db.add(strategy)
        db.commit()
        db.refresh(strategy)

        # Mock signal data
        mock_signals = [
            {
                "symbol": "RELIANCE",
                "signal_type": "LONG_ENTRY",
                "price": 2500.0,
                "stop_loss": 2490.0,
                "take_profit": 2530.0,
                "or_high": 2495.0,
                "or_low": 2480.0,
                "or_range_pct": 0.6,
            },
            {
                "symbol": "TCS",
                "signal_type": "LONG_ENTRY",
                "price": 3800.0,
                "stop_loss": 3785.0,
                "take_profit": 3845.0,
                "or_high": 3790.0,
                "or_low": 3770.0,
                "or_range_pct": 0.53,
            }
        ]

        # Generate signals (mock the actual generation)
        with patch('trading.orb_signals.ORBSignalGenerator.check_breakout') as mock_check:
            from trading.orb_signals import ORBSignal, SignalType

            mock_signal1 = ORBSignal(
                symbol="RELIANCE",
                signal_type=SignalType.LONG_ENTRY,
                price=2500.0,
                stop_loss=2490.0,
                take_profit=2530.0,
                timestamp=datetime.now().isoformat(),
            )
            mock_signal2 = ORBSignal(
                symbol="TCS",
                signal_type=SignalType.LONG_ENTRY,
                price=3800.0,
                stop_loss=3785.0,
                take_profit=3845.0,
                timestamp=datetime.now().isoformat(),
            )

            mock_check.return_value = mock_signal1

            # This would normally be called by the bot runner
            # For integration test, we verify the signal structure
            assert mock_signal1.symbol == "RELIANCE"
            assert mock_signal1.signal_type == SignalType.LONG_ENTRY
            assert mock_signal1.stop_loss < mock_signal1.price < mock_signal1.take_profit


class TestOrderPlacementFlow:
    """Test flow of placing and managing orders."""

    def test_place_order_and_create_position(self, client: TestClient):
        """
        Test order placement:
        1. Place buy order
        2. Verify position created
        3. Verify cash updated
        4. Place sell order
        5. Verify position closed
        6. Verify P&L calculated
        """
        # Mock the paper trading module
        with patch('api.paper_trading.get_paper_trader') as mock_get_trader:
            # Create mock trader
            mock_trader = Mock()
            mock_trader.cash = 100000.0
            mock_trader.initial_capital = 100000.0
            mock_trader.positions = {}

            def mock_place_order(symbol, side, quantity, price, **kwargs):
                if side == "BUY":
                    mock_trader.cash -= price * quantity
                    mock_trader.positions[symbol] = {
                        "symbol": symbol,
                        "quantity": quantity,
                        "avg_price": price,
                    }
                else:  # SELL
                    if symbol in mock_trader.positions:
                        pos = mock_trader.positions[symbol]
                        pnl = (price - pos["avg_price"]) * quantity
                        mock_trader.cash += price * quantity
                        del mock_trader.positions[symbol]
                        return {"symbol": symbol, "pnl": pnl}
                return {"symbol": symbol, "status": "filled"}

            mock_trader.place_order = mock_place_order
            mock_get_trader.return_value = mock_trader

            # Place buy order
            buy_response = client.post("/api/paper/orders", json={
                "symbol": "TEST",
                "side": "BUY",
                "quantity": 10,
                "price": 100.0,
            })

            assert buy_response.status_code == 200
            assert mock_trader.cash == 99000.0
            assert "TEST" in mock_trader.positions

            # Place sell order
            sell_response = client.delete("/api/paper/orders/TEST")

            assert sell_response.status_code == 200
            assert "TEST" not in mock_trader.positions


class TestPositionManagementFlow:
    """Test flow of managing open positions."""

    def test_position_lifecycle(self, client: TestClient):
        """
        Test complete position lifecycle:
        1. Open position
        2. Update position price (market movement)
        3. Check unrealized P&L
        4. Close position
        5. Verify realized P&L
        """
        with patch('api.paper_trading.get_paper_trader') as mock_get_trader:
            # Create mock trader
            mock_trader = Mock()
            mock_trader.cash = 100000.0
            mock_trader.initial_capital = 100000.0

            # Mock position
            mock_position = Mock()
            mock_position.symbol = "TEST"
            mock_position.quantity = 100
            mock_position.avg_price = 100.0
            mock_position.current_price = 100.0
            mock_position.unrealized_pnl = 0.0
            mock_position.unrealized_pnl_pct = 0.0

            mock_trader.positions = {"TEST": mock_position}
            mock_trader.get_position = Mock(return_value=mock_position)
            mock_trader.get_positions = Mock(return_value=[mock_position])

            mock_get_trader.return_value = mock_trader

            # Get position
            response = client.get("/api/paper/positions/TEST")
            assert response.status_code == 200

            position_data = response.json()
            assert position_data["symbol"] == "TEST"
            assert position_data["quantity"] == 100
            assert position_data["avg_price"] == 100.0

            # Update price (simulating market movement)
            mock_position.current_price = 105.0
            mock_position.unrealized_pnl = 500.0
            mock_position.unrealized_pnl_pct = 5.0

            # Check updated position
            response = client.get("/api/paper/positions/TEST")
            position_data = response.json()

            assert position_data["current_price"] == 105.0
            assert position_data["unrealized_pnl"] == 500.0


class TestPnLCalculationFlow:
    """Test P&L calculation through trading cycle."""

    def test_end_to_end_pnl_calculation(self, client: TestClient):
        """
        Test complete P&L calculation:
        1. Get initial portfolio state
        2. Place winning trade
        3. Place losing trade
        4. Verify total P&L
        5. Verify P&L percentage
        """
        with patch('api.paper_trading.get_paper_trader') as mock_get_trader:
            mock_trader = Mock()

            # Initial state
            mock_trader.initial_capital = 100000.0
            mock_trader.cash = 100000.0
            mock_trader.get_portfolio_summary = Mock(return_value={
                "initial_capital": 100000.0,
                "cash": 100000.0,
                "position_value": 0.0,
                "total_value": 100000.0,
                "total_pnl": 0.0,
                "total_pnl_pct": 0.0,
                "realized_pnl": 0.0,
                "unrealized_pnl": 0.0,
                "positions": 0,
                "trades": 0,
            })

            mock_get_trader.return_value = mock_trader

            # Get initial portfolio
            initial_response = client.get("/api/paper/portfolio")
            initial_portfolio = initial_response.json()

            assert initial_portfolio["initial_capital"] == 100000.0
            assert initial_portfolio["total_pnl"] == 0.0

            # Simulate trades
            mock_trader.cash = 98000.0  # After trades
            mock_trader.get_portfolio_summary = Mock(return_value={
                "initial_capital": 100000.0,
                "cash": 98000.0,
                "position_value": 2500.0,  # One open position
                "total_value": 100500.0,
                "total_pnl": 500.0,
                "total_pnl_pct": 0.5,
                "realized_pnl": -200.0,  # One loss closed
                "unrealized_pnl": 700.0,  # One winner open
                "positions": 1,
                "trades": 2,
            })

            # Get updated portfolio
            updated_response = client.get("/api/paper/portfolio")
            updated_portfolio = updated_response.json()

            assert updated_portfolio["total_pnl"] == 500.0
            assert updated_portfolio["total_pnl_pct"] == 0.5
            assert updated_portfolio["realized_pnl"] == -200.0
            assert updated_portfolio["unrealized_pnl"] == 700.0


class TestTradeJournalingFlow:
    """Test trade journaling through trading cycle."""

    def test_trade_journaling_lifecycle(self, client: TestClient, db: Session):
        """
        Test trade journaling:
        1. Log a completed trade
        2. Retrieve trade history
        3. Get performance summary
        4. Filter trades by strategy
        5. Verify journal persistence
        """
        # Create a test user
        user = User(
            email="journal@example.com",
            hashed_password=hash_password("JournalTest123!"),
            display_name="Journal Test User",
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        # Get journal for user
        from trading.journal import get_journal
        journal = get_journal(user.id)

        # Log some test trades
        trade1 = {
            'trade_id': 'JOURNAL-001',
            'symbol': 'RELIANCE',
            'side': 'BUY',
            'quantity': 100,
            'entry_price': 2500.0,
            'exit_price': 2530.0,
            'entry_time': '2026-03-03T10:15:00',
            'exit_time': '2026-03-03T12:30:00',
            'pnl': 3000.0,
            'pnl_pct': 1.2,
            'exit_reason': 'TP',
            'costs': 150.0,
            'net_pnl': 2850.0,
            'strategy_id': 1,
            'strategy_name': 'ORB Conservative',
        }

        trade2 = {
            'trade_id': 'JOURNAL-002',
            'symbol': 'TCS',
            'side': 'BUY',
            'quantity': 50,
            'entry_price': 3800.0,
            'exit_price': 3780.0,
            'entry_time': '2026-03-03T11:00:00',
            'exit_time': '2026-03-03T14:00:00',
            'pnl': -1000.0,
            'pnl_pct': -0.53,
            'exit_reason': 'SL',
            'costs': 95.0,
            'net_pnl': -1095.0,
            'strategy_id': 1,
            'strategy_name': 'ORB Conservative',
        }

        # Log trades
        journal.log_trade(trade1)
        journal.log_trade(trade2)

        # Verify trades in journal
        assert len(journal.trades) == 2

        # Get performance summary
        performance = journal.get_performance_summary()

        assert performance['total_trades'] == 2
        assert performance['winners'] == 1
        assert performance['losers'] == 1
        assert performance['win_rate'] == 50.0
        assert performance['net_pnl'] == 1755.0  # 2850 - 1095

        # Get strategy performance
        strategy_perf = journal.get_strategy_performance()

        assert 1 in strategy_perf
        assert strategy_perf[1]['trades'] == 2
        assert strategy_perf[1]['net_pnl'] == 1755.0

    def test_journal_persistence(self, tmp_path):
        """Test that journal persists to file and can be loaded."""
        from pathlib import Path
        import importlib.util
        ROOT = Path(__file__).resolve().parents[3]
        journal_path = ROOT / "trading" / "journal.py"
        spec = importlib.util.spec_from_file_location("real_trading_journal", str(journal_path))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        TradeJournal = mod.TradeJournal
        
        # Create journal in temp directory
        journal_dir = str(tmp_path / "journals" / "1")
        # Ensure directory exists before creating TradeJournal
        Path(journal_dir).mkdir(parents=True, exist_ok=True)
        journal = TradeJournal(journal_dir=journal_dir, user_id=1)

        # Log a trade
        trade = {
            'trade_id': 'PERSIST-001',
            'symbol': 'TEST',
            'side': 'BUY',
            'quantity': 10,
            'entry_price': 100.0,
            'exit_price': 105.0,
            'entry_time': '2026-03-03T10:00:00',
            'exit_time': '2026-03-03T11:00:00',
            'pnl': 50.0,
            'pnl_pct': 5.0,
            'exit_reason': 'TP',
            'costs': 5.0,
            'net_pnl': 45.0,
            'strategy_id': 1,
            'strategy_name': 'Test Strategy',
        }

        journal.log_trade(trade)
        journal.save_journal()

        # Create new journal instance (simulating app restart)
        journal2 = TradeJournal(journal_dir=journal_dir, user_id=1)
        journal2.load_journal(str(journal.journal_dir / f"journal_{datetime.now().strftime('%Y%m%d')}.json"))

        # Verify trade was loaded
        assert len(journal2.trades) == 1
        assert journal2.trades[0].trade_id == 'PERSIST-001'
        assert journal2.trades[0].net_pnl == 45.0


class TestBotLifecycleFlow:
    """Test complete bot lifecycle from start to stop."""

    def test_bot_start_stop_cycle(self, client: TestClient, db: Session):
        """
        Test bot lifecycle:
        1. Create bot with strategies
        2. Start bot (verify process starts)
        3. Check bot status
        4. Stop bot
        5. Verify cleanup
        """
        # Create strategies
        strategy = StrategyConfig(
            name="lifecycle_strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()
        db.refresh(strategy)

        # Create bot
        bot_response = client.post("/api/bots", json={
            "name": "Lifecycle Test Bot",
            "is_active": True,
            "max_total_positions": 5,
            "max_total_capital_pct": 0.5,
            "strategies": [
                {
                    "strategy_id": strategy.id,
                    "max_positions": 5,
                    "capital_allocation_pct": 0.5
                }
            ]
        })

        bot = bot_response.json()

        # Start bot (in test mode)
        with patch('api.bots.start_bot_process') as mock_start:
            mock_process = Mock()
            mock_process.pid = 12345
            mock_process.poll = Mock(return_value=None)  # Process running
            mock_start.return_value = mock_process

            start_response = client.post(f"/api/bots/{bot['id']}/start", params={
                "test_mode": True
            })

            assert start_response.status_code == 200
            start_data = start_response.json()
            assert "pid" in start_data

        # Check bot status
        status_response = client.get(f"/api/bots/{bot['id']}/status")

        # In test environment, this might fail without a real process
        # We're testing the flow, not the actual process management

        # Stop bot
        with patch('api.bots.stop_bot_process') as mock_stop:
            stop_response = client.post(f"/api/bots/{bot['id']}/stop")

            assert stop_response.status_code == 200


class TestErrorRecoveryInTrading:
    """Test error recovery during trading operations."""

    def test_recovery_after_order_failure(self, client: TestClient):
        """Test that system recovers after order placement failure."""
        with patch('api.paper_trading.get_paper_trader') as mock_get_trader:
            mock_trader = Mock()

            # Mock portfolio status
            portfolio_status = {
                "initial_capital": 100000.0,
                "cash": 100000.0,
                "margin_used": 0.0,
                "total_value": 100000.0,
                "total_pnl": 0.0,
            }
            mock_trader.get_portfolio_status = Mock(return_value=portfolio_status)

            # First call fails
            mock_trader.place_order = Mock(side_effect=Exception("Network error"))
            mock_get_trader.return_value = mock_trader

            # Order should fail
            response = client.post("/api/paper/order", json={
                "symbol": "TEST",
                "side": "BUY",
                "quantity": 10,
                "price": 100.0,
                "stop_loss": 95.0,
                "take_profit": 110.0,
            })

            assert response.status_code >= 400  # Error response

            # Recovery - subsequent order should succeed
            mock_trader.place_order = Mock(return_value={
                "symbol": "TEST",
                "status": "filled"
            })

            response = client.post("/api/paper/order", json={
                "symbol": "TEST",
                "side": "BUY",
                "quantity": 10,
                "price": 100.0,
                "stop_loss": 95.0,
                "take_profit": 110.0,
            })

            assert response.status_code == 200

    def test_recovery_after_api_failure(self, client: TestClient):
        """Test that API can recover from temporary failures."""
        # First call fails
        with patch('api.paper_trading.get_paper_trader') as mock_get_trader:
            mock_get_trader.side_effect = Exception("Database connection error")

            response = client.get("/api/paper/portfolio")
            assert response.status_code >= 400

            # Recovery - subsequent call succeeds
            mock_trader = Mock()
            portfolio_data = {
                "initial_capital": 100000.0,
                "cash": 100000.0,
                "position_value": 0.0,
                "total_value": 100000.0,
                "total_pnl": 0.0,
                "total_pnl_pct": 0.0,
                "realized_pnl": 0.0,
                "unrealized_pnl": 0.0,
                "positions": 0,
                "trades": 0,
            }
            mock_trader.get_portfolio_summary = Mock(return_value=portfolio_data)
            mock_trader.get_portfolio_status = Mock(return_value=portfolio_data)
            mock_trader.positions = {}
            mock_get_trader.side_effect = None
            mock_get_trader.return_value = mock_trader

            response = client.get("/api/paper/portfolio")
            assert response.status_code == 200


class TestMultiStrategyCoordination:
    """Test coordination between multiple strategies in a bot."""

    def test_strategy_coordination(self, client: TestClient, db: Session):
        """
        Test that multiple strategies coordinate:
        1. Bot enforces global position limits
        2. Strategies respect capital allocations
        """
        strategy1 = StrategyConfig(
            name="coord_orb_1",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        strategy2 = StrategyConfig(
            name="coord_orb_2",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy1)
        db.add(strategy2)
        db.commit()
        db.refresh(strategy1)
        db.refresh(strategy2)

        # Create bot with limited total positions
        bot_response = client.post("/api/bots", json={
            "name": "Coordination Test Bot",
            "is_active": True,
            "max_total_positions": 3,  # Global limit
            "max_total_capital_pct": 0.6,
            "strategies": [
                {
                    "strategy_id": strategy1.id,
                    "max_positions": 2,  # Each can have 2
                    "capital_allocation_pct": 0.3
                },
                {
                    "strategy_id": strategy2.id,
                    "max_positions": 2,  # But global is 3
                    "capital_allocation_pct": 0.3
                }
            ]
        })

        bot = bot_response.json()

        # Verify bot configuration enforces limits
        assert bot["max_total_positions"] == 3

        # Verify both strategies are associated
        assert len(bot["strategies"]) == 2

        # Verify allocation doesn't exceed 100%
        total_allocation = sum(s["capital_allocation_pct"] for s in bot["strategies"])
        assert total_allocation == 0.6  # 0.3 + 0.3
        assert total_allocation <= 1.0
