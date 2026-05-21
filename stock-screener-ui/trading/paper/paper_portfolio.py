"""Paper trading portfolio management."""

import sys
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

try:
    from trading.config_loader import get_strategy_config
    _config_available = True
except ImportError:
    _config_available = False

import config as app_config

from rich.console import Console
from rich.table import Table

from .paper_models import (
    OrderSide, OrderStatus, ExitReason,
    PaperOrder, PaperPosition, PaperTrade,
)
from .paper_risk import (
    has_duplicate_position, simulate_fill,
    calculate_fill_price, calculate_margin_required, has_sufficient_cash,
)
from .paper_journal import load_todays_trades

console = Console()


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
        slippage_pct: float = 0,
        fill_probability: float = 1.0,
        max_fill_pct: float = 1.0,
    ):
        self.user_id = user_id
        self.initial_capital = initial_capital
        self.cash = initial_capital
        self.margin_used = 0.0

        self.strategy_id = strategy_id
        self.strategy_name = strategy_name

        if _config_available:
            config = get_strategy_config(config_name)
            self.brokerage_pct = brokerage_pct if brokerage_pct is not None else config.brokerage_pct
            self.min_brokerage = min_brokerage if min_brokerage is not None else config.min_brokerage
            self.stt_pct = stt_pct if stt_pct is not None else config.stt_pct
            self.exchange_pct = exchange_pct if exchange_pct is not None else config.exchange_pct
            self.sebi_pct = sebi_pct if sebi_pct is not None else config.sebi_pct
            self.stamp_pct = stamp_pct if stamp_pct is not None else config.stamp_pct
            self.gst_pct = gst_pct if gst_pct is not None else config.gst_pct
            if strategy_id == 0 and config.id > 0:
                self.strategy_id = config.id
                self.strategy_name = config.name
        else:
            self.brokerage_pct = brokerage_pct if brokerage_pct is not None else 0.0003
            self.min_brokerage = min_brokerage if min_brokerage is not None else 20
            self.stt_pct = stt_pct if stt_pct is not None else 0.00025
            self.exchange_pct = exchange_pct if exchange_pct is not None else 0.0000297
            self.sebi_pct = sebi_pct if sebi_pct is not None else 0.000001
            self.stamp_pct = stamp_pct if stamp_pct is not None else 0.00003
            self.gst_pct = gst_pct if gst_pct is not None else 0.18

        self.slippage_pct = slippage_pct
        self.fill_probability = fill_probability
        self.max_fill_pct = max_fill_pct

        self.positions: Dict[str, PaperPosition] = {}
        self.pending_orders: Dict[str, PaperOrder] = {}
        self.trades: List[PaperTrade] = []

        self._order_counter = 0
        self._trade_counter = 0

        self.daily_pnl = 0.0
        self.daily_trades = 0
        self.day_start = datetime.now(app_config.IST).date()

        self._load_todays_trades_from_journal()

    def _generate_order_id(self) -> str:
        self._order_counter += 1
        return f"PAPER-{self._order_counter:06d}"

    def _generate_trade_id(self) -> str:
        self._trade_counter += 1
        return f"TRADE-{self._trade_counter:06d}"

    def _load_todays_trades_from_journal(self):
        try:
            trades, max_counter = load_todays_trades(self.user_id)

            for trade in trades:
                self.trades.append(trade)
                self._trade_counter = max(self._trade_counter, max_counter)
                self.daily_pnl += trade.net_pnl
                self.daily_trades += 1
                self.cash += trade.net_pnl

        except Exception as e:
            console.print(f"[yellow]Warning: Could not load journal: {e}[/yellow]")

    def calculate_costs(self, price: float, quantity: int, side: OrderSide) -> dict:
        trade_value = price * quantity

        brokerage = max(trade_value * self.brokerage_pct, self.min_brokerage)
        stt = trade_value * self.stt_pct if side == OrderSide.SELL else 0
        exchange = trade_value * self.exchange_pct
        sebi = trade_value * self.sebi_pct
        stamp = trade_value * self.stamp_pct if side == OrderSide.BUY else 0
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
        if has_duplicate_position(self.positions, symbol):
            console.print(f"[yellow]Warning: Already have position in {symbol}[/yellow]")
            return PaperOrder(
                order_id=self._generate_order_id(),
                symbol=symbol,
                side=side,
                quantity=quantity,
                price=price,
                stop_loss=stop_loss,
                take_profit=take_profit,
                timestamp=datetime.now(app_config.IST),
                status=OrderStatus.CANCELLED,
            )

        fill_quantity, cancelled = simulate_fill(quantity, self.fill_probability, self.max_fill_pct)

        if cancelled:
            console.print(f"[yellow]\u26a0 Order for {symbol} failed to fill (simulation)[/yellow]")
            return PaperOrder(
                order_id=self._generate_order_id(),
                symbol=symbol,
                side=side,
                quantity=quantity,
                price=price,
                stop_loss=stop_loss,
                take_profit=take_profit,
                timestamp=datetime.now(app_config.IST),
                status=OrderStatus.CANCELLED,
            )

        fill_price = calculate_fill_price(price, side, self.slippage_pct)
        margin_required = fill_price * fill_quantity

        if not has_sufficient_cash(self.cash, margin_required):
            console.print(f"[yellow]\u26a0 Order for {symbol} cancelled (insufficient cash: need \u20b9{margin_required:.2f}, have \u20b9{self.cash:.2f})[/yellow]")
            return PaperOrder(
                order_id=self._generate_order_id(),
                symbol=symbol,
                side=side,
                quantity=fill_quantity,
                price=price,
                stop_loss=stop_loss,
                take_profit=take_profit,
                timestamp=datetime.now(app_config.IST),
                status=OrderStatus.CANCELLED,
            )

        now = datetime.now(app_config.IST)

        order = PaperOrder(
            order_id=self._generate_order_id(),
            symbol=symbol,
            side=side,
            quantity=fill_quantity,
            price=price,
            stop_loss=stop_loss,
            take_profit=take_profit,
            timestamp=now,
            status=OrderStatus.FILLED,
            fill_price=fill_price,
            fill_time=now,
        )

        self.cash -= margin_required
        self.margin_used += margin_required

        self.positions[symbol] = PaperPosition(
            symbol=symbol,
            side=side,
            quantity=fill_quantity,
            entry_price=fill_price,
            stop_loss=stop_loss,
            take_profit=take_profit,
            entry_time=now,
            current_price=fill_price,
            peak_price=fill_price,
            low_price=fill_price,
            strategy_id=self.strategy_id,
            strategy_name=self.strategy_name,
        )

        console.print(f"[green]\u2713 Order filled: {side.value} {fill_quantity}/{quantity} {symbol} @ \u20b9{fill_price:.2f}[/green]")
        if fill_quantity < quantity:
            console.print(f"   [yellow]Partial fill: {fill_quantity} of {quantity} shares[/yellow]")
        console.print(f"   Slippage: {self.slippage_pct*100:.3f}% | SL: \u20b9{stop_loss:.2f} | TP: \u20b9{take_profit:.2f}")

        return order

    def update_prices(self, prices: Dict[str, float]):
        positions_to_close = []

        for symbol, position in self.positions.items():
            if symbol not in prices:
                continue

            current_price = prices[symbol]
            position.current_price = current_price

            position.peak_price = max(position.peak_price, current_price)
            if position.low_price == float('inf'):
                position.low_price = current_price
            else:
                position.low_price = min(position.low_price, current_price)

            if position.side == OrderSide.BUY:
                position.unrealized_pnl = (current_price - position.entry_price) * position.quantity
                position.unrealized_pnl_pct = (current_price - position.entry_price) / position.entry_price * 100
            else:
                position.unrealized_pnl = (position.entry_price - current_price) * position.quantity
                position.unrealized_pnl_pct = (position.entry_price - current_price) / position.entry_price * 100

            exit_reason = None

            if position.side == OrderSide.BUY:
                if current_price >= position.take_profit:
                    exit_reason = ExitReason.TAKE_PROFIT
                elif current_price <= position.stop_loss:
                    exit_reason = ExitReason.STOP_LOSS
            else:
                if current_price <= position.take_profit:
                    exit_reason = ExitReason.TAKE_PROFIT
                elif current_price >= position.stop_loss:
                    exit_reason = ExitReason.STOP_LOSS

            if exit_reason:
                positions_to_close.append((symbol, exit_reason))

        for symbol, exit_reason in positions_to_close:
            self.close_position(symbol, prices[symbol], exit_reason)

    def close_position(
        self,
        symbol: str,
        exit_price: float,
        exit_reason: ExitReason = ExitReason.MANUAL,
    ) -> Optional[PaperTrade]:
        if symbol not in self.positions:
            return None

        position = self.positions[symbol]

        if position.side == OrderSide.BUY:
            actual_exit_price = exit_price * (1 - self.slippage_pct)
            exit_side = OrderSide.SELL
        else:
            actual_exit_price = exit_price * (1 + self.slippage_pct)
            exit_side = OrderSide.BUY

        if position.side == OrderSide.BUY:
            pnl = (actual_exit_price - position.entry_price) * position.quantity
            pnl_pct = (actual_exit_price - position.entry_price) / position.entry_price * 100
        else:
            pnl = (position.entry_price - actual_exit_price) * position.quantity
            pnl_pct = (position.entry_price - actual_exit_price) / position.entry_price * 100

        entry_costs = self.calculate_costs(position.entry_price, position.quantity, position.side)
        exit_costs = self.calculate_costs(actual_exit_price, position.quantity, exit_side)
        total_costs = entry_costs['total'] + exit_costs['total']

        net_pnl = pnl - total_costs

        trade = PaperTrade(
            trade_id=self._generate_trade_id(),
            symbol=symbol,
            side=position.side,
            quantity=position.quantity,
            entry_price=position.entry_price,
            exit_price=actual_exit_price,
            entry_time=position.entry_time,
            exit_time=datetime.now(app_config.IST),
            pnl=round(pnl, 2),
            pnl_pct=round(pnl_pct, 2),
            exit_reason=exit_reason,
            costs=round(total_costs, 2),
            net_pnl=round(net_pnl, 2),
            peak_price=round(position.peak_price, 2),
            low_price=round(position.low_price, 2),
            strategy_id=position.strategy_id,
            strategy_name=position.strategy_name,
            reason=position.metadata.get('entry_reason', '') if hasattr(position, 'metadata') else '',
        )

        exit_value = actual_exit_price * position.quantity
        self.cash += exit_value
        self.margin_used -= position.entry_price * position.quantity

        del self.positions[symbol]

        self.trades.append(trade)

        self.daily_pnl += net_pnl
        self.daily_trades += 1

        pnl_color = "green" if net_pnl >= 0 else "red"
        console.print(f"\n[{pnl_color}]\u2713 Position closed: {symbol}[/{pnl_color}]")
        console.print(f"   Entry: \u20b9{position.entry_price:.2f} \u2192 Exit: \u20b9{exit_price:.2f}")
        console.print(f"   P&L: \u20b9{pnl:.2f} | Costs: \u20b9{total_costs:.2f} | Net: \u20b9{net_pnl:.2f}")
        console.print(f"   Reason: {exit_reason.value}")

        return trade

    def close_all_positions(self, prices: Dict[str, float], exit_reason: ExitReason = ExitReason.END_OF_DAY):
        for symbol in list(self.positions.keys()):
            if symbol in prices:
                self.close_position(symbol, prices[symbol], exit_reason)

    def get_portfolio_status(self) -> dict:
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
                'strategy_type': pos.strategy_type,
                'entry_reason': getattr(pos, 'metadata', {}).get('entry_reason', ''),
            }
            for pos in self.positions.values()
        ]

    def get_trades(self, limit: int = 50) -> List[dict]:
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
        self.daily_pnl = 0.0
        self.daily_trades = 0
        self.day_start = datetime.now(app_config.IST).date()

    def display_status(self):
        status = self.get_portfolio_status()

        console.print("\n[bold cyan]\u2550\u2550\u2550 Paper Trading Portfolio \u2550\u2550\u2550[/bold cyan]")

        table = Table()
        table.add_column("Metric", style="cyan")
        table.add_column("Value", justify="right")

        table.add_row("Initial Capital", f"\u20b9{status['initial_capital']:,.0f}")
        table.add_row("Cash", f"\u20b9{status['cash']:,.0f}")
        table.add_row("Margin Used", f"\u20b9{status['margin_used']:,.0f}")
        table.add_row("Position Value", f"\u20b9{status['position_value']:,.0f}")
        table.add_row("Total Value", f"\u20b9{status['total_value']:,.0f}")
        table.add_row("Realized P&L", f"\u20b9{status['realized_pnl']:,.0f}")
        table.add_row("Unrealized P&L", f"\u20b9{status['unrealized_pnl']:,.0f}")
        table.add_row("Total P&L", f"\u20b9{status['total_pnl']:,.0f} ({status['total_pnl_pct']:.2f}%)")
        table.add_row("Open Positions", str(status['positions']))
        table.add_row("Total Trades", str(status['trades']))
        table.add_row("Today's P&L", f"\u20b9{status['daily_pnl']:,.0f}")

        console.print(table)
