"""
Paper Trading Engine - Simulated trading with virtual money.

This module provides a paper trading environment for testing strategies
before risking real capital.
"""

import sys
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from enum import Enum
import json

# Add project paths
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

# Import config loader
try:
    from trading.config_loader import get_strategy_config
    _config_available = True
except ImportError:
    _config_available = False

from rich.console import Console
from rich.table import Table

console = Console()


class OrderSide(Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderStatus(Enum):
    PENDING = "PENDING"
    FILLED = "FILLED"
    CANCELLED = "CANCELLED"


class ExitReason(Enum):
    TAKE_PROFIT = "TP"
    STOP_LOSS = "SL"
    END_OF_DAY = "EOD"
    MANUAL = "MANUAL"


@dataclass
class PaperOrder:
    """Paper trading order."""
    order_id: str
    symbol: str
    side: OrderSide
    quantity: int
    price: float
    stop_loss: float
    take_profit: float
    timestamp: datetime
    status: OrderStatus = OrderStatus.PENDING
    fill_price: Optional[float] = None
    fill_time: Optional[datetime] = None


@dataclass
class PaperPosition:
    """Active paper trading position."""
    symbol: str
    side: OrderSide
    quantity: int
    entry_price: float
    stop_loss: float
    take_profit: float
    entry_time: datetime
    current_price: float = 0.0
    unrealized_pnl: float = 0.0
    unrealized_pnl_pct: float = 0.0
    peak_price: float = 0.0  # Highest price during position
    low_price: float = float('inf')  # Lowest price during position
    strategy_id: int = 0  # Strategy that opened this position
    strategy_name: str = ""  # Strategy name for quick reference


@dataclass
class PaperTrade:
    """Completed paper trade."""
    trade_id: str
    symbol: str
    side: OrderSide
    quantity: int
    entry_price: float
    exit_price: float
    entry_time: datetime
    exit_time: datetime
    pnl: float
    pnl_pct: float
    exit_reason: ExitReason
    costs: float = 0.0
    net_pnl: float = 0.0
    peak_price: float = 0.0  # Highest price during trade
    low_price: float = 0.0   # Lowest price during trade
    strategy_id: int = 0  # Strategy that opened this trade
    strategy_name: str = ""  # Strategy name for quick reference


class PaperTrader:
    """
    Paper trading engine with virtual money.

    Features:
    - Virtual portfolio with configurable capital
    - Order placement with SL/TP
    - Automatic exit monitoring
    - Trading cost simulation
    - Performance tracking
    """

    def __init__(
        self,
        initial_capital: float = 1_000_000,
        brokerage_pct: float = None,
        min_brokerage: float = None,
        stt_pct: float = None,
        exchange_pct: float = None,
        sebi_pct: float = None,
        stamp_pct: float = None,
        gst_pct: float = None,
        user_id: Optional[int] = None,
        config_name: str = None,
        strategy_id: int = 0,
        strategy_name: str = "",
        # Slippage and Fill parameters
        slippage_pct: float = 0,            # No slippage by default
        fill_probability: float = 1.0,     # Probability of order being filled
        max_fill_pct: float = 1.0,         # Maximum percentage of quantity that can be filled
    ):
        """
        Initialize paper trader.

        Args:
            initial_capital: Starting capital in INR
            brokerage_pct: Brokerage percentage (overrides config)
            min_brokerage: Minimum brokerage per order (overrides config)
            stt_pct: STT percentage (sell side) (overrides config)
            exchange_pct: Exchange charges percentage (overrides config)
            sebi_pct: SEBI fee percentage (overrides config)
            stamp_pct: Stamp duty percentage (buy side) (overrides config)
            gst_pct: GST on brokerage+exchange+sebi (overrides config)
            user_id: User ID for multi-user support
            config_name: Name of config to load from database
            strategy_id: ID of the strategy to use for tracking trades
            strategy_name: Name of the strategy for quick reference
        """
        self.user_id = user_id
        self.initial_capital = initial_capital
        self.cash = initial_capital
        self.margin_used = 0.0

        # Strategy tracking
        self.strategy_id = strategy_id
        self.strategy_name = strategy_name

        # Load cost parameters from config if available
        if _config_available:
            config = get_strategy_config(config_name)
            self.brokerage_pct = brokerage_pct if brokerage_pct is not None else config.brokerage_pct
            self.min_brokerage = min_brokerage if min_brokerage is not None else config.min_brokerage
            self.stt_pct = stt_pct if stt_pct is not None else config.stt_pct
            self.exchange_pct = exchange_pct if exchange_pct is not None else config.exchange_pct
            self.sebi_pct = sebi_pct if sebi_pct is not None else config.sebi_pct
            self.stamp_pct = stamp_pct if stamp_pct is not None else config.stamp_pct
            self.gst_pct = gst_pct if gst_pct is not None else config.gst_pct
            # Set strategy info from config if available
            if strategy_id == 0 and config.id > 0:
                self.strategy_id = config.id
                self.strategy_name = config.name
        else:
            # Fall back to hardcoded defaults
            self.brokerage_pct = brokerage_pct if brokerage_pct is not None else 0.0003
            self.min_brokerage = min_brokerage if min_brokerage is not None else 20
            self.stt_pct = stt_pct if stt_pct is not None else 0.00025
            self.exchange_pct = exchange_pct if exchange_pct is not None else 0.0000297
            self.sebi_pct = sebi_pct if sebi_pct is not None else 0.000001
            self.stamp_pct = stamp_pct if stamp_pct is not None else 0.00003
            self.gst_pct = gst_pct if gst_pct is not None else 0.18

        # Slippage and fill parameters
        self.slippage_pct = slippage_pct
        self.fill_probability = fill_probability
        self.max_fill_pct = max_fill_pct

        # Positions and orders
        self.positions: Dict[str, PaperPosition] = {}
        self.pending_orders: Dict[str, PaperOrder] = {}
        self.trades: List[PaperTrade] = []

        # Counters
        self._order_counter = 0
        self._trade_counter = 0

        # Daily tracking
        self.daily_pnl = 0.0
        self.daily_trades = 0
        self.day_start = datetime.now().date()

        # Load today's trades from journal
        self._load_todays_trades_from_journal()

    def _generate_order_id(self) -> str:
        self._order_counter += 1
        return f"PAPER-{self._order_counter:06d}"

    def _generate_trade_id(self) -> str:
        self._trade_counter += 1
        return f"TRADE-{self._trade_counter:06d}"

    def _load_todays_trades_from_journal(self):
        """Load today's trades from journal file to restore state after restart."""
        try:
            from trading.journal import TradeJournal, get_journal

            journal = get_journal(self.user_id) if self.user_id else TradeJournal()
            today_str = datetime.now().strftime('%Y%m%d')
            if self.user_id:
                journal_file = Path(__file__).parent.parent / 'journals' / str(self.user_id) / f'journal_{today_str}.json'
            else:
                journal_file = Path(__file__).parent.parent / 'journals' / f'journal_{today_str}.json'

            if not journal_file.exists():
                return

            with open(journal_file) as f:
                data = json.load(f)

            today_trades = data.get('trades', [])

            # Map exit reason strings to enum
            exit_reason_map = {
                'SL': ExitReason.STOP_LOSS,
                'TP': ExitReason.TAKE_PROFIT,
                'EOD': ExitReason.END_OF_DAY,
                'MANUAL': ExitReason.MANUAL,
            }

            # Convert journal trades to PaperTrade objects
            for trade_data in today_trades:
                try:
                    exit_reason_str = trade_data.get('exit_reason', 'MANUAL')
                    exit_reason = exit_reason_map.get(exit_reason_str, ExitReason.MANUAL)

                    trade = PaperTrade(
                        trade_id=trade_data['trade_id'],
                        symbol=trade_data['symbol'],
                        side=OrderSide.BUY if trade_data['side'] == 'BUY' else OrderSide.SELL,
                        quantity=trade_data['quantity'],
                        entry_price=trade_data['entry_price'],
                        exit_price=trade_data['exit_price'],
                        entry_time=datetime.fromisoformat(trade_data['entry_time']),
                        exit_time=datetime.fromisoformat(trade_data['exit_time']),
                        pnl=trade_data['pnl'],
                        pnl_pct=trade_data['pnl_pct'],
                        exit_reason=exit_reason,
                        costs=trade_data.get('costs', 0),
                        net_pnl=trade_data.get('net_pnl', 0),
                        peak_price=trade_data.get('peak_price', 0),
                        low_price=trade_data.get('low_price', 0),
                        strategy_id=trade_data.get('strategy_id', 0),
                        strategy_name=trade_data.get('strategy_name', ''),
                    )
                    self.trades.append(trade)

                    # Update trade counter to avoid ID conflicts
                    trade_num = int(trade_data['trade_id'].split('-')[1])
                    self._trade_counter = max(self._trade_counter, trade_num)

                    # Update daily P&L
                    self.daily_pnl += trade.net_pnl
                    self.daily_trades += 1

                    # Update cash balance
                    self.cash += trade.net_pnl

                except Exception as e:
                    console.print(f"[yellow]Warning: Could not load trade {trade_data.get('trade_id')}: {e}[/yellow]")

            if today_trades:
                console.print(f"[green]Loaded {len(today_trades)} trades from journal[/green]")

        except Exception as e:
            console.print(f"[yellow]Warning: Could not load journal: {e}[/yellow]")

    def calculate_costs(self, price: float, quantity: int, side: OrderSide) -> dict:
        """
        Calculate trading costs for an order.

        Returns dict with cost breakdown.
        """
        trade_value = price * quantity

        # Brokerage
        brokerage = max(trade_value * self.brokerage_pct, self.min_brokerage)

        # STT (sell side only)
        stt = trade_value * self.stt_pct if side == OrderSide.SELL else 0

        # Exchange charges
        exchange = trade_value * self.exchange_pct

        # SEBI fee
        sebi = trade_value * self.sebi_pct

        # Stamp duty (buy side only)
        stamp = trade_value * self.stamp_pct if side == OrderSide.BUY else 0

        # GST on brokerage + exchange + sebi
        gst = (brokerage + exchange + sebi) * self.gst_pct

        total = brokerage + stt + exchange + sebi + stamp + gst

        return {
            'brokerage': round(brokerage, 2),
            'stt': round(stt, 2),
            'exchange': round(exchange, 2),
            'sebi': round(sebi, 4),
            'stamp': round(stamp, 2),
            'gst': round(gst, 2),
            'total': round(total, 2),
        }

    def place_order(
        self,
        symbol: str,
        side: OrderSide,
        quantity: int,
        price: float,
        stop_loss: float,
        take_profit: float,
    ) -> PaperOrder:
        """
        Place a paper trading order.

        Args:
            symbol: Stock symbol
            side: BUY or SELL
            quantity: Number of shares
            price: Entry price
            stop_loss: Stop loss price
            take_profit: Take profit price

        Returns:
            PaperOrder object
        """
        # Check if already have position in this symbol
        if symbol in self.positions:
            console.print(f"[yellow]Warning: Already have position in {symbol}[/yellow]")
            order = PaperOrder(
                order_id=self._generate_order_id(),
                symbol=symbol,
                side=side,
                quantity=quantity,
                price=price,
                stop_loss=stop_loss,
                take_profit=take_profit,
                timestamp=datetime.now(),
                status=OrderStatus.CANCELLED,
            )
            return order

        import random
        
        # Create order skeleton
        order = PaperOrder(
            order_id=self._generate_order_id(),
            symbol=symbol,
            side=side,
            quantity=quantity,
            price=price,
            stop_loss=stop_loss,
            take_profit=take_profit,
            timestamp=datetime.now(),
        )

        # Check fill probability
        if random.random() > self.fill_probability:
            console.print(f"[yellow]⚠ Order for {symbol} failed to fill (probability check)[/yellow]")
            order.status = OrderStatus.CANCELLED
            return order

        # Determine fill quantity (partial fills)
        fill_pct = random.uniform(0.5, 1.0) if self.max_fill_pct < 1.0 else 1.0
        fill_quantity = int(quantity * min(fill_pct, self.max_fill_pct))
        
        if fill_quantity == 0:
            console.print(f"[yellow]⚠ Order for {symbol} cancelled (zero fill quantity)[/yellow]")
            order.status = OrderStatus.CANCELLED
            return order

        # Update order with actual fill quantity if partial
        order.quantity = fill_quantity

        # Calculate fill price with slippage
        if side == OrderSide.BUY:
            fill_price = price * (1 + self.slippage_pct)
        else:
            fill_price = price * (1 - self.slippage_pct)

        margin_required = fill_price * fill_quantity

        # Check insufficient cash
        if margin_required > self.cash:
            console.print(f"[yellow]⚠ Order for {symbol} cancelled (insufficient cash: need ₹{margin_required:.2f}, have ₹{self.cash:.2f})[/yellow]")
            order.status = OrderStatus.CANCELLED
            return order

        # Immediately fill (paper trading)
        order.status = OrderStatus.FILLED
        order.fill_price = fill_price
        order.fill_time = datetime.now()

        # Deduct margin
        self.cash -= margin_required
        self.margin_used += margin_required

        # Create position
        self.positions[symbol] = PaperPosition(
            symbol=symbol,
            side=side,
            quantity=fill_quantity,
            entry_price=fill_price,
            stop_loss=stop_loss,
            take_profit=take_profit,
            entry_time=datetime.now(),
            current_price=fill_price,
            peak_price=fill_price,
            low_price=fill_price,
            strategy_id=self.strategy_id,
            strategy_name=self.strategy_name,
        )

        console.print(f"[green]✓ Order filled: {side.value} {fill_quantity}/{quantity} {symbol} @ ₹{fill_price:.2f}[/green]")
        if fill_quantity < quantity:
            console.print(f"   [yellow]Partial fill: {fill_quantity} of {quantity} shares[/yellow]")
        console.print(f"   Slippage: {self.slippage_pct*100:.3f}% | SL: ₹{stop_loss:.2f} | TP: ₹{take_profit:.2f}")

        return order

    def update_prices(self, prices: Dict[str, float]):
        """
        Update current prices and check exit conditions.

        Args:
            prices: Dict mapping symbol to current price
        """
        positions_to_close = []

        for symbol, position in self.positions.items():
            if symbol not in prices:
                continue

            current_price = prices[symbol]
            position.current_price = current_price

            # Track peak and low prices
            position.peak_price = max(position.peak_price, current_price)
            if position.low_price == float('inf'):
                position.low_price = current_price
            else:
                position.low_price = min(position.low_price, current_price)

            # Calculate unrealized P&L
            if position.side == OrderSide.BUY:
                position.unrealized_pnl = (current_price - position.entry_price) * position.quantity
                position.unrealized_pnl_pct = (current_price - position.entry_price) / position.entry_price * 100
            else:
                position.unrealized_pnl = (position.entry_price - current_price) * position.quantity
                position.unrealized_pnl_pct = (position.entry_price - current_price) / position.entry_price * 100

            # Check exit conditions
            exit_reason = None

            if position.side == OrderSide.BUY:
                if current_price >= position.take_profit:
                    exit_reason = ExitReason.TAKE_PROFIT
                elif current_price <= position.stop_loss:
                    exit_reason = ExitReason.STOP_LOSS
            else:  # SELL (short)
                if current_price <= position.take_profit:
                    exit_reason = ExitReason.TAKE_PROFIT
                elif current_price >= position.stop_loss:
                    exit_reason = ExitReason.STOP_LOSS

            if exit_reason:
                positions_to_close.append((symbol, exit_reason))

        # Close positions
        for symbol, exit_reason in positions_to_close:
            self.close_position(symbol, prices[symbol], exit_reason)

    def close_position(
        self,
        symbol: str,
        exit_price: float,
        exit_reason: ExitReason = ExitReason.MANUAL,
    ) -> Optional[PaperTrade]:
        """
        Close a position.

        Args:
            symbol: Stock symbol
            exit_price: Exit price
            exit_reason: Reason for exit

        Returns:
            PaperTrade if position was closed
        """
        if symbol not in self.positions:
            return None

        position = self.positions[symbol]

        # Apply slippage on exit
        if position.side == OrderSide.BUY:
            actual_exit_price = exit_price * (1 - self.slippage_pct)
            exit_side = OrderSide.SELL
        else:
            actual_exit_price = exit_price * (1 + self.slippage_pct)
            exit_side = OrderSide.BUY

        # Calculate P&L
        if position.side == OrderSide.BUY:
            pnl = (actual_exit_price - position.entry_price) * position.quantity
            pnl_pct = (actual_exit_price - position.entry_price) / position.entry_price * 100
        else:
            pnl = (position.entry_price - actual_exit_price) * position.quantity
            pnl_pct = (position.entry_price - actual_exit_price) / position.entry_price * 100

        # Calculate costs
        entry_costs = self.calculate_costs(position.entry_price, position.quantity, position.side)
        exit_costs = self.calculate_costs(actual_exit_price, position.quantity, exit_side)
        total_costs = entry_costs['total'] + exit_costs['total']

        # Net P&L
        net_pnl = pnl - total_costs

        # Create trade record
        trade = PaperTrade(
            trade_id=self._generate_trade_id(),
            symbol=symbol,
            side=position.side,
            quantity=position.quantity,
            entry_price=position.entry_price,
            exit_price=actual_exit_price,
            entry_time=position.entry_time,
            exit_time=datetime.now(),
            pnl=round(pnl, 2),
            pnl_pct=round(pnl_pct, 2),
            exit_reason=exit_reason,
            costs=round(total_costs, 2),
            net_pnl=round(net_pnl, 2),
            peak_price=round(position.peak_price, 2),
            low_price=round(position.low_price, 2),
            strategy_id=position.strategy_id,
            strategy_name=position.strategy_name,
        )

        # Update cash and margin
        exit_value = exit_price * position.quantity
        self.cash += exit_value
        self.margin_used -= position.entry_price * position.quantity

        # Remove position
        del self.positions[symbol]

        # Record trade
        self.trades.append(trade)

        # Update daily tracking
        self.daily_pnl += net_pnl
        self.daily_trades += 1

        # Print result
        pnl_color = "green" if net_pnl >= 0 else "red"
        console.print(f"\n[{pnl_color}]✓ Position closed: {symbol}[/{pnl_color}]")
        console.print(f"   Entry: ₹{position.entry_price:.2f} → Exit: ₹{exit_price:.2f}")
        console.print(f"   P&L: ₹{pnl:.2f} | Costs: ₹{total_costs:.2f} | Net: ₹{net_pnl:.2f}")
        console.print(f"   Reason: {exit_reason.value}")

        return trade

    def close_all_positions(self, prices: Dict[str, float], exit_reason: ExitReason = ExitReason.END_OF_DAY):
        """Close all open positions."""
        for symbol in list(self.positions.keys()):
            if symbol in prices:
                self.close_position(symbol, prices[symbol], exit_reason)

    def get_portfolio_status(self) -> dict:
        """Get current portfolio status."""
        total_position_value = sum(
            pos.current_price * pos.quantity
            for pos in self.positions.values()
        )

        total_unrealized_pnl = sum(
            pos.unrealized_pnl
            for pos in self.positions.values()
        )

        total_value = self.cash + total_position_value

        realized_pnl = sum(t.net_pnl for t in self.trades)

        return {
            'initial_capital': self.initial_capital,
            'cash': round(self.cash, 2),
            'margin_used': round(self.margin_used, 2),
            'position_value': round(total_position_value, 2),
            'unrealized_pnl': round(total_unrealized_pnl, 2),
            'realized_pnl': round(realized_pnl, 2),
            'total_value': round(total_value, 2),
            'total_pnl': round(total_value - self.initial_capital, 2),
            'total_pnl_pct': round((total_value - self.initial_capital) / self.initial_capital * 100, 2),
            'positions': len(self.positions),
            'trades': len(self.trades),
            'daily_pnl': round(self.daily_pnl, 2),
            'daily_trades': self.daily_trades,
        }

    def get_positions(self) -> List[dict]:
        """Get list of current positions."""
        return [
            {
                'symbol': pos.symbol,
                'side': pos.side.value,
                'quantity': pos.quantity,
                'entry_price': pos.entry_price,
                'current_price': pos.current_price,
                'stop_loss': pos.stop_loss,
                'take_profit': pos.take_profit,
                'unrealized_pnl': pos.unrealized_pnl,
                'unrealized_pnl_pct': pos.unrealized_pnl_pct,
                'entry_time': pos.entry_time.isoformat(),
                'strategy_id': pos.strategy_id,
                'strategy_name': pos.strategy_name,
            }
            for pos in self.positions.values()
        ]

    def get_trades(self, limit: int = 50) -> List[dict]:
        """Get trade history."""
        return [
            {
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
                'exit_reason': t.exit_reason.value,
                'costs': t.costs,
                'net_pnl': t.net_pnl,
                'peak_price': t.peak_price,
                'low_price': t.low_price,
                'strategy_id': t.strategy_id,
                'strategy_name': t.strategy_name,
            }
            for t in self.trades[-limit:]
        ]

    def reset_daily(self):
        """Reset daily tracking."""
        self.daily_pnl = 0.0
        self.daily_trades = 0
        self.day_start = datetime.now().date()

    def display_status(self):
        """Display portfolio status in a table."""
        status = self.get_portfolio_status()

        console.print("\n[bold cyan]═══ Paper Trading Portfolio ═══[/bold cyan]")

        table = Table()
        table.add_column("Metric", style="cyan")
        table.add_column("Value", justify="right")

        table.add_row("Initial Capital", f"₹{status['initial_capital']:,.0f}")
        table.add_row("Cash", f"₹{status['cash']:,.0f}")
        table.add_row("Margin Used", f"₹{status['margin_used']:,.0f}")
        table.add_row("Position Value", f"₹{status['position_value']:,.0f}")
        table.add_row("Total Value", f"₹{status['total_value']:,.0f}")
        table.add_row("Realized P&L", f"₹{status['realized_pnl']:,.0f}")
        table.add_row("Unrealized P&L", f"₹{status['unrealized_pnl']:,.0f}")
        table.add_row("Total P&L", f"₹{status['total_pnl']:,.0f} ({status['total_pnl_pct']:.2f}%)")
        table.add_row("Open Positions", str(status['positions']))
        table.add_row("Total Trades", str(status['trades']))
        table.add_row("Today's P&L", f"₹{status['daily_pnl']:,.0f}")

        console.print(table)


# User-scoped instances for multi-user API
_paper_traders: Dict[int, PaperTrader] = {}
_default_paper_trader: Optional[PaperTrader] = None


def get_paper_trader(
    user_id: Optional[int] = None,
    initial_capital: Optional[float] = None,
    strategy_id: int = 0,
    strategy_name: str = "",
    config_name: str = None,
) -> PaperTrader:
    """
    Get paper trader instance for a specific user.

    Args:
        user_id: User ID. If None, returns the default (legacy) instance.
        initial_capital: Initial capital for new traders.
        strategy_id: ID of the strategy to use for tracking trades.
        strategy_name: Name of the strategy for quick reference.
        config_name: Name of config to load from database.

    Returns:
        PaperTrader instance for the user.
    """
    global _default_paper_trader

    if user_id is None:
        # Legacy single-user mode
        if _default_paper_trader is None:
            _default_paper_trader = PaperTrader(
                initial_capital=initial_capital or 1_000_000,
                strategy_id=strategy_id,
                strategy_name=strategy_name,
                config_name=config_name,
            )
        return _default_paper_trader

    if user_id not in _paper_traders:
        # Load user's initial capital from database if not provided
        if initial_capital is None:
            try:
                from db.database import SessionLocal
                from db.models import User
                with SessionLocal() as db:
                    user = db.query(User).filter(User.id == user_id).first()
                    initial_capital = user.initial_capital if user else 1_000_000
            except Exception:
                initial_capital = 1_000_000

        _paper_traders[user_id] = PaperTrader(
            initial_capital=initial_capital,
            user_id=user_id,
            strategy_id=strategy_id,
            strategy_name=strategy_name,
            config_name=config_name,
        )

    return _paper_traders[user_id]


def reset_paper_trader(user_id: Optional[int] = None, capital: float = 1_000_000):
    """
    Reset paper trader with new capital.

    Args:
        user_id: User ID. If None, resets the default instance.
        capital: New initial capital.
    """
    global _default_paper_trader

    if user_id is None:
        _default_paper_trader = PaperTrader(initial_capital=capital)
        return _default_paper_trader

    _paper_traders[user_id] = PaperTrader(initial_capital=capital, user_id=user_id)
    return _paper_traders[user_id]


def clear_paper_trader(user_id: int):
    """Clear a user's paper trader instance (e.g., on logout)."""
    if user_id in _paper_traders:
        del _paper_traders[user_id]


if __name__ == '__main__':
    # Demo
    trader = PaperTrader(initial_capital=1_000_000)
    trader.display_status()

    # Place a test order
    order = trader.place_order(
        symbol="NETWEB",
        side=OrderSide.BUY,
        quantity=100,
        price=3500.0,
        stop_loss=3360.0,  # 4% SL
        take_profit=3920.0,  # 12% TP (1:3 ratio)
    )

    trader.display_status()

    # Simulate price update to TP
    trader.update_prices({"NETWEB": 3925.0})

    trader.display_status()
