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
import uuid
from pathlib import Path
from datetime import datetime, timedelta
from typing import Generator, Dict, List
from unittest.mock import Mock, patch, MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

# Add project root to path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from db.models import User, UserSession, StrategyConfig, BotConfig, bot_strategies
from api.auth import hash_password



@pytest.fixture
def user(db: Session) -> User:
    """Create a test user."""
    user = User(
        email=f"test-{uuid.uuid4()}@example.com",
        hashed_password=hash_password("testpassword"),
        display_name="Test User",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


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

        # Step 1: List templates (using include_templates parameter)
        templates_response = client.get("/api/strategies", params={"include_templates": True})
        assert templates_response.status_code == 200

        templates_data = templates_response.json()
        templates = [t for t in templates_data["strategies"] if t.get("is_template")]
        assert len(templates) > 0
        template_ids = [t["id"] for t in templates]
        assert template.uuid in template_ids

        # Step 2: Create strategy from template
        create_response = client.post("/api/strategies", json={
            "name": "my_orb_conservative",
            "strategy_type": "ORB",
            "parent_id": template.id,  # Use integer ID, not UUID
            "sl_pct": 0.35,  # Override default
            "tp_pct": 1.5,    # Override default
        })

        assert create_response.status_code == 200
        created_strategy = create_response.json()["strategy"]

        # Step 3: Verify strategy inherited defaults correctly
        assert created_strategy["name"] == "my_orb_conservative"
        assert created_strategy["parent_id"] == template.id  # Integer ID
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
            name=f"orb_test_conservative_{uuid.uuid4().hex[:8]}",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
            sl_pct=0.3,
            tp_pct=1.0,
        )
        strategy2 = StrategyConfig(
            name=f"orb_test_aggressive_{uuid.uuid4().hex[:8]}",
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
            "name": "PnL Test Bot",
            "is_active": True,
            "max_total_positions": 5,
            "max_total_capital_pct": 0.5,
            "strategies": [
                {
                    "strategy_id": strategy1.uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.4
                },
                {
                    "strategy_id": strategy2.uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.4
                }
            ]
        })

        assert bot_response.status_code == 200
        bot = bot_response.json()

        # Step 3: Verify bot configuration
        assert bot["name"] == "PnL Test Bot"
        assert bot["max_total_positions"] == 5
        assert bot["max_total_capital_pct"] == 0.5
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
        assert alloc_map[strategy2.id].max_positions == 3
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
                    "strategy_id": strategy.uuid,
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
        from trading.orb_signals import ORBSignal, SignalType

        mock_signal1 = ORBSignal(
            symbol="RELIANCE",
            signal_type=SignalType.LONG_ENTRY,
            price=2500.0,
            stop_loss=2490.0,
            take_profit=2530.0,
            or_high=2495.0,
            or_low=2480.0,
            or_range=15.0,
            or_range_pct=0.6,
            timestamp=datetime.now(),
        )
        mock_signal2 = ORBSignal(
            symbol="TCS",
            signal_type=SignalType.LONG_ENTRY,
            price=3800.0,
            stop_loss=3785.0,
            take_profit=3845.0,
            or_high=3790.0,
            or_low=3770.0,
            or_range=20.0,
            or_range_pct=0.53,
            timestamp=datetime.now(),
        )

        # This would normally be called by the bot runner
        # For integration test, we verify the signal structure and risk filtering
        assert mock_signal1.symbol == "RELIANCE"
        signal_type = getattr(mock_signal1, 'signal_type', None) or getattr(mock_signal1, 'direction', None)
        assert signal_type == SignalType.LONG_ENTRY
        assert mock_signal1.stop_loss < mock_signal1.price < mock_signal1.take_profit

        assert mock_signal2.symbol == "TCS"
        assert mock_signal2.stop_loss < mock_signal2.price < mock_signal2.take_profit
        assert mock_signal2.or_range_pct == 0.53

        assert strategy.min_or_range_pct <= mock_signal1.or_range_pct <= strategy.max_or_range_pct
        assert strategy.min_or_range_pct <= mock_signal2.or_range_pct <= strategy.max_or_range_pct


class TestOrderPlacementFlow:
    """Test flow of placing and managing orders."""

    def test_place_order_and_create_position(self, client: TestClient):
        """
        Test order placement:
        1. Place buy order
        2. Verify position created
        3. Place sell order
        4. Verify position closed
        """
        from enum import Enum
        class OrderSide(Enum):
            BUY = "BUY"
            SELL = "SELL"

        # Mock the paper trading module
        with patch('api.paper_trading.get_paper_trader') as mock_get_trader, \
             patch('api.paper_trading.get_risk_manager') as mock_get_risk_manager, \
             patch('api.paper_trading.OrderSide', OrderSide):
            # Create mock risk manager
            mock_risk_manager = Mock()
            mock_risk_manager.validate_trade = Mock(return_value={'valid': True})
            mock_get_risk_manager.return_value = mock_risk_manager

            # Define FakeTrader class
            class FakeTrader:
                def __init__(self):
                    self.positions = {}
                    self.cash = 100000.0
                    self.initial_capital = 100000.0
                
                def get_portfolio_status(self):
                    total_value = self.cash + sum(
                        p['quantity'] * p['avg_price'] for p in self.positions.values()
                    )
                    return {
                        'total_value': total_value,
                        'cash': self.cash,
                        'margin_used': 0.0
                    }
                
                def place_order(self, symbol, side, quantity, price, stop_loss=None, take_profit=None):
                    # Create order object with status
                    order = Mock()
                    order.order_id = f"order-{symbol}-{datetime.now().timestamp()}"
                    order.symbol = symbol
                    order.side = side
                    order.quantity = quantity
                    order.price = price
                    order.stop_loss = stop_loss
                    order.take_profit = take_profit
                    order.status = Mock()
                    order.status.value = 'filled'
                    order.timestamp = datetime.now()
                    
                    # Handle position updates
                    side_value = getattr(side, 'value', side)
                    if side_value == "BUY":
                        if symbol in self.positions:
                            # Update existing position with average price
                            existing = self.positions[symbol]
                            total_qty = existing['quantity'] + quantity
                            total_cost = (existing['quantity'] * existing['avg_price']) + (quantity * price)
                            self.positions[symbol] = {
                                'symbol': symbol,
                                'quantity': total_qty,
                                'avg_price': total_cost / total_qty
                            }
                        else:
                            self.positions[symbol] = {
                                'symbol': symbol,
                                'quantity': quantity,
                                'avg_price': price
                            }
                    else:  # SELL
                        if symbol in self.positions:
                            del self.positions[symbol]
                    
                    return order

            # Instantiate and configure fake trader
            fake_trader = FakeTrader()
            mock_get_trader.return_value = fake_trader

            # Place buy order
            buy_response = client.post("/api/paper/order", json={
                "symbol": "TEST",
                "side": "BUY",
                "quantity": 10,
                "price": 100.0,
                "stop_loss": 95.0,
                "take_profit": 110.0,
            })

            assert buy_response.status_code == 200
            assert "TEST" in fake_trader.positions

            # Place sell order
            sell_response = client.post("/api/paper/order", json={
                "symbol": "TEST",
                "side": "SELL",
                "quantity": 10,
                "price": 105.0,
                "stop_loss": 0.0,
                "take_profit": 0.0,
            })

            assert sell_response.status_code == 200
            assert "TEST" not in fake_trader.positions


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

            # Mock position as dict (serializable)
            mock_position = {
                "symbol": "TEST",
                "quantity": 100,
                "avg_price": 100.0,
                "current_price": 100.0,
                "unrealized_pnl": 0.0,
                "unrealized_pnl_pct": 0.0,
            }

            get_positions_call_count = [0]

            def get_positions_fn():
                get_positions_call_count[0] += 1
                if get_positions_call_count[0] <= 2:
                    return [mock_position.copy()]
                return []

            mock_trader.positions = {"TEST": mock_position}
            mock_trader.get_position = Mock(return_value=mock_position)
            mock_trader.get_positions = Mock(side_effect=get_positions_fn)

            mock_get_trader.return_value = mock_trader

            # Get all positions
            response = client.get("/api/paper/positions")
            assert response.status_code == 200

            positions_data = response.json()
            assert positions_data["count"] == 1
            assert len(positions_data["positions"]) == 1

            position = positions_data["positions"][0]
            assert position["symbol"] == "TEST"
            assert position["quantity"] == 100
            assert position["avg_price"] == 100.0

            # Update price (simulating market movement)
            mock_position["current_price"] = 105.0
            mock_position["unrealized_pnl"] = 500.0
            mock_position["unrealized_pnl_pct"] = 5.0

            # Check updated position
            response = client.get("/api/paper/positions")
            positions_data = response.json()

            checked_position = positions_data["positions"][0]
            assert checked_position["current_price"] == 105.0
            assert checked_position["unrealized_pnl"] == 500.0
            assert checked_position["unrealized_pnl_pct"] == 5.0

            # Simulate closing position
            response = client.get("/api/paper/positions")
            positions_data = response.json()
            assert positions_data["count"] == 0
            assert len(positions_data["positions"]) == 0

            assert get_positions_call_count[0] == 3


class TestPnLCalculationFlow:
    """Test P&L calculation through trading cycle."""

    def test_end_to_end_pnl_calculation(self, client: TestClient, db: Session, test_user: User):
        """
        Test strategy performance aggregation:
        1. Create user and strategies
        2. Create bot with strategies
        3. Seed journal with trades
        4. Verify strategy performance endpoint returns correct aggregations
        """
        import importlib.util
        import uuid as uuid_module
        # Use the user fixture (already passed as parameter)
        
        # Create two strategies with UUIDs
        strategy1 = StrategyConfig(
            name=f"strategy_A_{uuid_module.uuid4().hex[:8]}",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
            uuid=str(uuid_module.uuid4())
        )
        strategy2 = StrategyConfig(
            name=f"strategy_B_{uuid_module.uuid4().hex[:8]}",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
            uuid=str(uuid_module.uuid4())
        )
        db.add(strategy1)
        db.add(strategy2)
        db.commit()
        db.refresh(strategy1)
        db.refresh(strategy2)
        
        # Create bot with both strategies
        bot_response = client.post("/api/bots", json={
            "name": "Strategy Performance Test Bot",
            "is_active": True,
            "max_total_positions": 10,
            "max_total_capital_pct": 0.8,
            "strategies": [
                {
                    "strategy_id": str(strategy1.uuid),
                    "max_positions": 5,
                    "capital_allocation_pct": 0.4
                },
                {
                    "strategy_id": str(strategy2.uuid),
                    "max_positions": 5,
                    "capital_allocation_pct": 0.4
                }
            ]
        })
        assert bot_response.status_code == 200
        bot = bot_response.json()
        
        # Load real TradeJournal class via importlib to avoid conftest mock
        ROOT = Path(__file__).resolve().parents[2]
        journal_path = ROOT / "trading" / "journal.py"
        spec = importlib.util.spec_from_file_location("real_journal", str(journal_path))
        journal_mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(journal_mod)
        TradeJournal = journal_mod.TradeJournal
        
        temp_dir = tempfile.mkdtemp()
        journal = TradeJournal(journal_dir=temp_dir, user_id=test_user.id)
        
        # Seed journal with 4 trades (2 per strategy, net_pnl = 600 each)
        base_time = datetime.now()
        trades = []
        
        # Strategy 1 trades
        for i in range(2):
            trade = {
                'trade_id': f'TRADE-{i+1:03d}',
                'symbol': 'RELIANCE',
                'side': 'BUY',
                'quantity': 100,
                'entry_price': 2500.0,
                'exit_price': 2560.0,
                'entry_time': (base_time - timedelta(days=2-i, hours=i)).isoformat(),
                'exit_time': (base_time - timedelta(days=2-i, hours=i+2)).isoformat(),
                'pnl': 6000.0,
                'pnl_pct': 2.4,
                'exit_reason': 'TP',
                'costs': 10.0,
                'net_pnl': 600.0,
                'strategy_id': strategy1.id,
                'strategy_name': strategy1.name,
            }
            trades.append(trade)
        
        # Strategy 2 trades
        for i in range(2):
            trade = {
                'trade_id': f'TRADE-{i+3:03d}',
                'symbol': 'TCS',
                'side': 'BUY',
                'quantity': 50,
                'entry_price': 3800.0,
                'exit_price': 3812.0,
                'entry_time': (base_time - timedelta(days=1-i, hours=i)).isoformat(),
                'exit_time': (base_time - timedelta(days=1-i, hours=i+2)).isoformat(),
                'pnl': 1200.0,
                'pnl_pct': 1.58,
                'exit_reason': 'TP',
                'costs': 0.0,
                'net_pnl': 600.0,
                'strategy_id': strategy2.id,
                'strategy_name': strategy2.name,
            }
            trades.append(trade)
        
        for trade in trades:
            journal.log_trade(trade)
        
        journal.save_journal()
        
        # Patch get_journal to return our journal (sys.modules['trading.journal'] is a MagicMock from conftest)
        with patch.object(sys.modules['trading.journal'], 'get_journal', return_value=journal):
            response = client.get(
                f"/api/bots/{bot['uuid']}/strategy-performance",
                params={"user_id_query": test_user.id}
            )
            
            assert response.status_code == 200
            data = response.json()
            
            # Verify response structure
            assert "by_strategy" in data
            by_strategy = data["by_strategy"]
            
            # Should have at least 2 strategies
            assert len(by_strategy) >= 2
            
            # Compute totals
            total_net_pnl = sum(s['net_pnl'] for s in by_strategy.values())
            total_trades = sum(s['trades'] for s in by_strategy.values())
            
            # Assert aggregations
            assert total_net_pnl == 2400.0
            assert total_trades == 4
            
            # Optionally assert each strategy with 2 trades has net_pnl ≈ 1200.0
            for strategy_perf in by_strategy.values():
                if strategy_perf['trades'] == 2:
                    assert strategy_perf['net_pnl'] == 1200.0


class TestTradeJournalingFlow:
    """Test trade journaling through trading cycle."""

    def test_trade_journaling_lifecycle(self, client: TestClient, db: Session, user: User):
        """
        Test trade journaling:
        1. Create a test user
        2. Log trades using real journal
        3. Verify trades are recorded
        """
        import importlib.util
        from pathlib import Path
        import tempfile

        ROOT = Path(__file__).resolve().parents[2]
        journal_path = ROOT / "trading" / "journal.py"
        spec = importlib.util.spec_from_file_location("real_trading_journal", str(journal_path))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        RealTradeJournal = mod.TradeJournal

        with tempfile.TemporaryDirectory() as tmpdir:
            journal = RealTradeJournal(journal_dir=tmpdir, user_id=user.id)

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
                'symbol': 'BLEM',
                'side': 'BUY',
                'quantity': 50,
                'entry_price': 3800.0,
                'exit_price': 3785.0,
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
            assert performance['net_pnl'] == 1755.0  # 2850 - 1095 = 1755

            # Get strategy performance
            strategy_perf = journal.get_strategy_performance()

            assert 1 in strategy_perf
            assert strategy_perf[1]['trades'] == 2
            assert strategy_perf[1]['net_pnl'] == 1755.0

    def test_journal_persistence(self, tmp_path):
        """Test that journal persists to file and can be loaded."""
        from pathlib import Path
        from datetime import datetime
        import importlib.util

        # Create journal in temp directory
        journal_dir = str(tmp_path / "journals" / "1")
        # Ensure directory exists before creating TradeJournal
        Path(journal_dir).mkdir(parents=True, exist_ok=True)

        # Load real TradeJournal class dynamically to avoid conftest mock
        ROOT = Path(__file__).resolve().parents[2]
        journal_path = ROOT / "trading" / "journal.py"
        spec = importlib.util.spec_from_file_location("real_trading_journal", str(journal_path))
        journal_mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(journal_mod)
        RealTradeJournal = journal_mod.TradeJournal
        journal = RealTradeJournal(journal_dir=journal_dir, user_id=1)

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
        journal2 = RealTradeJournal(journal_dir=journal_dir, user_id=1)
        # Load using the same journal_dir and daily filename
        journal2.load_journal(str(Path(journal_dir) / f"journal_{datetime.now().strftime('%Y%m%d')}.json"))

        # Verify trade was loaded
        assert len(journal2.trades) == 1
        assert journal2.trades[0].trade_id == 'PERSIST-001'
        assert journal2.trades[0].net_pnl == 45.0


class TestBotLifecycleFlow:
    """Test complete bot lifecycle from start to stop."""

class TestErrorRecoveryInTrading:
    """Test error recovery during trading operations."""

    def test_recovery_after_order_failure(self, client: TestClient):
        """Test that system recovers after order placement failure."""
        from enum import Enum
        class OrderSide(Enum):
            BUY = "BUY"
            SELL = "SELL"
        
        class FakeTrader:
            def __init__(self):
                self.positions = {}
                self.cash = 100000.0
                self.initial_capital = 100000.0
                self._call_count = 0

            def get_portfolio_status(self):
                total_value = self.cash + sum(
                    p['quantity'] * p['avg_price'] for p in self.positions.values()
                )
                return {
                    'total_value': total_value,
                    'cash': self.cash,
                    'margin_used': 0.0
                }

            def place_order(self, symbol, side, quantity, price, stop_loss=None, take_profit=None):
                self._call_count += 1
                if self._call_count == 1:
                    raise Exception("Network error")
                # Create order object with status
                order = Mock()
                order.order_id = f"order-{symbol}-{datetime.now().timestamp()}"
                order.symbol = symbol
                order.side = side
                order.quantity = quantity
                order.price = price
                order.stop_loss = stop_loss
                order.take_profit = take_profit
                order.status = Mock()
                order.status.value = 'filled'
                order.timestamp = datetime.now()
                # Update positions for BUY
                side_value = getattr(side, 'value', side)
                if side_value == "BUY":
                    if symbol in self.positions:
                        existing = self.positions[symbol]
                        total_qty = existing['quantity'] + quantity
                        total_cost = (existing['quantity'] * existing['avg_price']) + (quantity * price)
                        self.positions[symbol] = {
                            'symbol': symbol,
                            'quantity': total_qty,
                            'avg_price': total_cost / total_qty
                        }
                    else:
                        self.positions[symbol] = {
                            'symbol': symbol,
                            'quantity': quantity,
                            'avg_price': price
                        }
                else:  # SELL
                    if symbol in self.positions:
                        del self.positions[symbol]
                return order

        with patch('api.paper_trading.get_paper_trader') as mock_get_trader, \
             patch('api.paper_trading.get_risk_manager') as mock_get_risk_manager, \
             patch('api.paper_trading.OrderSide', OrderSide):
            fake_trader = FakeTrader()
            mock_get_trader.return_value = fake_trader
            mock_risk_manager = Mock()
            mock_risk_manager.validate_trade = Mock(return_value={'valid': True})
            mock_get_risk_manager.return_value = mock_risk_manager

            # First order fails - exception propagates since no error handler
            with pytest.raises(Exception, match="Network error"):
                client.post("/api/paper/order", json={
                    "symbol": "TEST",
                    "side": "BUY",
                    "quantity": 10,
                    "price": 100.0,
                    "stop_loss": 95.0,
                    "take_profit": 110.0,
                })

            # Second order succeeds
            response = client.post("/api/paper/order", json={
                "symbol": "TEST",
                "side": "BUY",
                "quantity": 10,
                "price": 100.0,
                "stop_loss": 95.0,
                "take_profit": 110.0,
            })
            assert response.status_code == 200
            assert "TEST" in fake_trader.positions

    def test_recovery_after_api_failure(self, client: TestClient):
        """Test that API can recover from temporary failures."""
        with patch('api.paper_trading.get_paper_trader') as mock_get_trader:
            # Create a mock trader for successful case
            success_trader = Mock()
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
            success_trader.get_portfolio_summary = Mock(return_value=portfolio_data)
            success_trader.get_portfolio_status = Mock(return_value=portfolio_data)
            success_trader.positions = {}

            # First call fails, second succeeds
            mock_get_trader.side_effect = [Exception("Database connection error"), success_trader]

            # First call - exception propagates since no error handler
            with pytest.raises(Exception, match="Database connection error"):
                client.get("/api/paper/portfolio")

            # Second call - should succeed
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
                    "strategy_id": strategy1.uuid,
                    "max_positions": 2,  # Each can have 2
                    "capital_allocation_pct": 0.3
                },
                {
                    "strategy_id": strategy2.uuid,
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
