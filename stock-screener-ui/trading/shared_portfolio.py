"""
Shared Portfolio Manager - Manages a single capital pool shared across multiple strategies.

This module provides:
- Single cash pool management
- Per-strategy capital tracking
- Combined P&L tracking
- Position attribution to strategies
"""

from datetime import datetime
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from enum import Enum
import asyncio

from rich.console import Console

console = Console()


class OrderSide(Enum):
    BUY = "BUY"
    SELL = "SELL"


@dataclass
class StrategyAllocation:
    """Capital allocation for a single strategy."""
    strategy_id: int
    strategy_name: str
    allocation_pct: float  # Percentage of total capital allocated
    max_positions: int     # Max concurrent positions for this strategy
    capital_used: float = 0.0  # Currently used capital
    positions_count: int = 0   # Current number of positions
    realized_pnl: float = 0.0  # Realized P&L for this strategy


@dataclass
class SharedPosition:
    """A position in the shared portfolio."""
    symbol: str
    side: OrderSide
    quantity: int
    entry_price: float
    stop_loss: float
    take_profit: float
    entry_time: datetime
    strategy_id: int
    strategy_name: str
    current_price: float = 0.0
    unrealized_pnl: float = 0.0
    unrealized_pnl_pct: float = 0.0
    peak_price: float = 0.0
    low_price: float = float('inf')


@dataclass
class CompletedTrade:
    """A completed trade record."""
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
    exit_reason: str
    costs: float = 0.0
    net_pnl: float = 0.0
    strategy_id: int = 0
    strategy_name: str = ""
    sl_price: float = 0.0
    tp_price: float = 0.0


class SharedPortfolioManager:
    """
    Manages a single capital pool shared across multiple strategies.

    Features:
    - Unified cash management
    - Per-strategy capital tracking
    - Position limits per strategy
    - Combined P&L tracking
    """

    def __init__(
        self,
        initial_capital: float = 1_000_000,
        max_total_capital_pct: float = 0.80,
        max_total_positions: int = 10,
        max_symbol_exposure_pct: float = 0.20,
        user_id: Optional[int] = None,
    ):
        """
        Initialize shared portfolio manager.

        Args:
            initial_capital: Starting capital in INR
            max_total_capital_pct: Maximum total capital usage (default 80%)
            max_total_positions: Maximum positions across all strategies
            max_symbol_exposure_pct: Maximum exposure to single symbol (default 20%)
            user_id: User ID for multi-user support
        """
        self.initial_capital = initial_capital
        self.cash = initial_capital
        self.max_total_capital_pct = max_total_capital_pct
        self.max_total_positions = max_total_positions
        self.max_symbol_exposure_pct = max_symbol_exposure_pct
        self.user_id = user_id

        # Per-strategy allocations
        self.strategy_allocations: Dict[int, StrategyAllocation] = {}

        # Positions keyed by (strategy_id, symbol) for uniqueness
        # But stored in a flat dict for easy lookup
        self.positions: Dict[str, SharedPosition] = {}  # key: f"{strategy_id}_{symbol}"

        # Completed trades
        self.trades: List[CompletedTrade] = []

        # Counters
        self._trade_counter = 0

        # Lock for thread-safe operations
        self._lock = asyncio.Lock()

        # Daily tracking
        self.daily_pnl = 0.0
        self.daily_trades = 0
        self.day_start = datetime.now().date()

    def _generate_trade_id(self) -> str:
        self._trade_counter += 1
        return f"TRADE-{self._trade_counter:06d}"

    def set_strategy_allocation(
        self,
        strategy_id: int,
        strategy_name: str,
        allocation_pct: float,
        max_positions: int,
    ):
        """
        Set capital allocation for a strategy.

        Args:
            strategy_id: Strategy ID
            strategy_name: Strategy name
            allocation_pct: Percentage of total capital (0.0-1.0)
            max_positions: Maximum concurrent positions
        """
        self.strategy_allocations[strategy_id] = StrategyAllocation(
            strategy_id=strategy_id,
            strategy_name=strategy_name,
            allocation_pct=allocation_pct,
            max_positions=max_positions,
        )

    def get_strategy_capital(self, strategy_id: int) -> float:
        """Get the allocated capital for a strategy."""
        if strategy_id not in self.strategy_allocations:
            return 0.0
        alloc = self.strategy_allocations[strategy_id]
        return self.initial_capital * alloc.allocation_pct

    def get_strategy_available_capital(self, strategy_id: int) -> float:
        """Get available capital for a strategy (allocated - used)."""
        if strategy_id not in self.strategy_allocations:
            return 0.0
        alloc = self.strategy_allocations[strategy_id]
        allocated = self.initial_capital * alloc.allocation_pct
        return max(0, allocated - alloc.capital_used)

    def get_total_capital_used(self) -> float:
        """Get total capital used across all strategies."""
        return sum(alloc.capital_used for alloc in self.strategy_allocations.values())

    def get_total_positions(self) -> int:
        """Get total positions across all strategies."""
        return sum(alloc.positions_count for alloc in self.strategy_allocations.values())

    def get_symbol_exposure(self, symbol: str) -> float:
        """Get total exposure to a specific symbol across all strategies."""
        total = 0.0
        for key, pos in self.positions.items():
            if pos.symbol == symbol:
                total += pos.entry_price * pos.quantity
        return total

    def can_open_position(
        self,
        strategy_id: int,
        symbol: str,
        trade_value: float,
    ) -> tuple:
        """
        Check if a position can be opened.

        Args:
            strategy_id: Strategy ID
            symbol: Stock symbol
            trade_value: Value of the trade

        Returns:
            (allowed: bool, reason: str)
        """
        # Check if strategy is configured
        if strategy_id not in self.strategy_allocations:
            return False, f"Strategy {strategy_id} not configured"

        alloc = self.strategy_allocations[strategy_id]

        # Check strategy position limit
        if alloc.positions_count >= alloc.max_positions:
            return False, f"Strategy {alloc.strategy_name} max positions ({alloc.max_positions}) reached"

        # Check strategy capital limit
        allocated_capital = self.initial_capital * alloc.allocation_pct
        if alloc.capital_used + trade_value > allocated_capital:
            available = allocated_capital - alloc.capital_used
            return False, f"Strategy {alloc.strategy_name} capital limit exceeded (available: ₹{available:,.0f})"

        # Check total positions
        if self.get_total_positions() >= self.max_total_positions:
            return False, f"Total portfolio positions limit ({self.max_total_positions}) reached"

        # Check total capital
        total_used = self.get_total_capital_used()
        max_total = self.initial_capital * self.max_total_capital_pct
        if total_used + trade_value > max_total:
            return False, f"Total capital limit ({self.max_total_capital_pct:.0%}) would be exceeded"

        # Check cash available
        if trade_value > self.cash:
            return False, f"Insufficient cash (need ₹{trade_value:,.0f}, have ₹{self.cash:,.0f})"

        # Check symbol exposure limit
        current_exposure = self.get_symbol_exposure(symbol)
        max_exposure = self.initial_capital * self.max_symbol_exposure_pct
        if current_exposure + trade_value > max_exposure:
            return False, f"Symbol {symbol} exposure limit ({self.max_symbol_exposure_pct:.0%}) would be exceeded"

        return True, "OK"

    def open_position(
        self,
        strategy_id: int,
        strategy_name: str,
        symbol: str,
        side: OrderSide,
        quantity: int,
        entry_price: float,
        stop_loss: float,
        take_profit: float,
    ) -> Optional[SharedPosition]:
        """
        Open a new position.

        Args:
            strategy_id: Strategy ID
            strategy_name: Strategy name
            symbol: Stock symbol
            side: BUY or SELL
            quantity: Number of shares
            entry_price: Entry price
            stop_loss: Stop loss price
            take_profit: Take profit price

        Returns:
            SharedPosition if successful, None otherwise
        """
        trade_value = entry_price * quantity

        # Check if allowed
        allowed, reason = self.can_open_position(strategy_id, symbol, trade_value)
        if not allowed:
            console.print(f"[red]Position rejected: {reason}[/red]")
            return None

        # Create position key
        key = f"{strategy_id}_{symbol}"

        # Check if position already exists for this strategy+symbol
        if key in self.positions:
            console.print(f"[yellow]Position already exists for {strategy_name}/{symbol}[/yellow]")
            return None

        # Deduct cash
        self.cash -= trade_value

        # Create position
        position = SharedPosition(
            symbol=symbol,
            side=side,
            quantity=quantity,
            entry_price=entry_price,
            stop_loss=stop_loss,
            take_profit=take_profit,
            entry_time=datetime.now(),
            strategy_id=strategy_id,
            strategy_name=strategy_name,
            current_price=entry_price,
            peak_price=entry_price,
            low_price=entry_price,
        )

        self.positions[key] = position

        # Update strategy allocation
        if strategy_id in self.strategy_allocations:
            self.strategy_allocations[strategy_id].capital_used += trade_value
            self.strategy_allocations[strategy_id].positions_count += 1

        console.print(f"[green]✓ Position opened: {strategy_name} - {side.value} {quantity} {symbol} @ ₹{entry_price:.2f}[/green]")
        return position

    def close_position(
        self,
        strategy_id: int,
        symbol: str,
        exit_price: float,
        exit_reason: str = "MANUAL",
        costs: float = 0.0,
    ) -> Optional[CompletedTrade]:
        """
        Close a position.

        Args:
            strategy_id: Strategy ID
            symbol: Stock symbol
            exit_price: Exit price
            exit_reason: Reason for exit
            costs: Trading costs

        Returns:
            CompletedTrade if successful, None otherwise
        """
        key = f"{strategy_id}_{symbol}"

        if key not in self.positions:
            return None

        position = self.positions[key]

        # Calculate P&L
        if position.side == OrderSide.BUY:
            pnl = (exit_price - position.entry_price) * position.quantity
            pnl_pct = (exit_price - position.entry_price) / position.entry_price * 100
        else:
            pnl = (position.entry_price - exit_price) * position.quantity
            pnl_pct = (position.entry_price - exit_price) / position.entry_price * 100

        net_pnl = pnl - costs

        # Create trade record
        trade = CompletedTrade(
            trade_id=self._generate_trade_id(),
            symbol=symbol,
            side=position.side,
            quantity=position.quantity,
            entry_price=position.entry_price,
            exit_price=exit_price,
            entry_time=position.entry_time,
            exit_time=datetime.now(),
            pnl=round(pnl, 2),
            pnl_pct=round(pnl_pct, 2),
            exit_reason=exit_reason,
            costs=round(costs, 2),
            net_pnl=round(net_pnl, 2),
            strategy_id=strategy_id,
            strategy_name=position.strategy_name,
        )

        # Return cash
        exit_value = exit_price * position.quantity
        self.cash += exit_value

        # Update strategy allocation
        entry_value = position.entry_price * position.quantity
        if strategy_id in self.strategy_allocations:
            self.strategy_allocations[strategy_id].capital_used -= entry_value
            self.strategy_allocations[strategy_id].positions_count -= 1
            self.strategy_allocations[strategy_id].realized_pnl += net_pnl

        # Remove position
        del self.positions[key]

        # Record trade
        self.trades.append(trade)

        # Update daily tracking
        self.daily_pnl += net_pnl
        self.daily_trades += 1

        pnl_color = "green" if net_pnl >= 0 else "red"
        console.print(f"[{pnl_color}]✓ Position closed: {position.strategy_name} - {symbol}[/{pnl_color}]")
        console.print(f"   P&L: ₹{pnl:.2f} | Net: ₹{net_pnl:.2f} | Reason: {exit_reason}")

        return trade

    def update_prices(self, prices: Dict[str, float]):
        """
        Update current prices for all positions.

        Args:
            prices: Dict mapping symbol to current price
        """
        for key, position in self.positions.items():
            if position.symbol in prices:
                current_price = prices[position.symbol]
                position.current_price = current_price
                position.peak_price = max(position.peak_price, current_price)
                position.low_price = min(position.low_price, current_price)

                # Calculate unrealized P&L
                if position.side == OrderSide.BUY:
                    position.unrealized_pnl = (current_price - position.entry_price) * position.quantity
                    position.unrealized_pnl_pct = (current_price - position.entry_price) / position.entry_price * 100
                else:
                    position.unrealized_pnl = (position.entry_price - current_price) * position.quantity
                    position.unrealized_pnl_pct = (position.entry_price - current_price) / position.entry_price * 100

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
            'capital_used': round(self.get_total_capital_used(), 2),
            'position_value': round(total_position_value, 2),
            'unrealized_pnl': round(total_unrealized_pnl, 2),
            'realized_pnl': round(realized_pnl, 2),
            'total_value': round(total_value, 2),
            'total_pnl': round(total_value - self.initial_capital, 2),
            'total_pnl_pct': round((total_value - self.initial_capital) / self.initial_capital * 100, 2),
            'total_positions': self.get_total_positions(),
            'total_trades': len(self.trades),
            'daily_pnl': round(self.daily_pnl, 2),
            'daily_trades': self.daily_trades,
            'strategies_count': len(self.strategy_allocations),
        }

    def get_strategy_status(self, strategy_id: int) -> Optional[dict]:
        """Get status for a specific strategy."""
        if strategy_id not in self.strategy_allocations:
            return None

        alloc = self.strategy_allocations[strategy_id]
        allocated_capital = self.initial_capital * alloc.allocation_pct

        # Get positions for this strategy
        strategy_positions = [
            pos for key, pos in self.positions.items()
            if pos.strategy_id == strategy_id
        ]

        # Get trades for this strategy
        strategy_trades = [t for t in self.trades if t.strategy_id == strategy_id]

        unrealized_pnl = sum(pos.unrealized_pnl for pos in strategy_positions)
        realized_pnl = sum(t.net_pnl for t in strategy_trades)

        return {
            'strategy_id': strategy_id,
            'strategy_name': alloc.strategy_name,
            'allocation_pct': alloc.allocation_pct,
            'allocated_capital': round(allocated_capital, 2),
            'capital_used': round(alloc.capital_used, 2),
            'available_capital': round(allocated_capital - alloc.capital_used, 2),
            'capital_used_pct': round(alloc.capital_used / allocated_capital * 100, 1) if allocated_capital > 0 else 0,
            'positions_count': alloc.positions_count,
            'max_positions': alloc.max_positions,
            'unrealized_pnl': round(unrealized_pnl, 2),
            'realized_pnl': round(realized_pnl, 2),
            'total_pnl': round(unrealized_pnl + realized_pnl, 2),
            'trades_count': len(strategy_trades),
        }

    def get_all_strategy_statuses(self) -> List[dict]:
        """Get status for all strategies."""
        return [
            self.get_strategy_status(strategy_id)
            for strategy_id in self.strategy_allocations.keys()
        ]

    def get_positions_by_strategy(self, strategy_id: int) -> List[dict]:
        """Get all positions for a specific strategy."""
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
            for key, pos in self.positions.items()
            if pos.strategy_id == strategy_id
        ]

    def get_all_positions(self) -> List[dict]:
        """Get all positions across all strategies."""
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

    def restore_state(self, state: dict):
        """Restore portfolio state from serialized data."""
        self.cash = state.get('cash', self.initial_capital)
        self.daily_pnl = state.get('daily_pnl', 0.0)
        self.daily_trades = state.get('daily_trades', 0)

    def restore_position(self, pos_data: dict):
        """Restore a position from serialized data."""
        symbol = pos_data['symbol']
        strategy_id = pos_data['strategy_id']
        key = f"{strategy_id}_{symbol}"
        
        if key in self.positions:
            return

        pos = SharedPosition(
            symbol=symbol,
            side=OrderSide(pos_data['side']),
            quantity=pos_data['quantity'],
            entry_price=pos_data['entry_price'],
            stop_loss=pos_data['stop_loss'],
            take_profit=pos_data['take_profit'],
            entry_time=datetime.fromisoformat(pos_data['entry_time']),
            strategy_id=strategy_id,
            strategy_name=pos_data['strategy_name'],
            current_price=pos_data.get('current_price', pos_data['entry_price']),
        )
        
        self.positions[key] = pos
        
        # Update strategy attribution
        if strategy_id in self.strategy_allocations:
            entry_value = pos.entry_price * pos.quantity
            self.strategy_allocations[strategy_id].capital_used += entry_value
            self.strategy_allocations[strategy_id].positions_count += 1

    def reset_daily(self):
        """Reset daily tracking."""
        self.daily_pnl = 0.0
        self.daily_trades = 0
        self.day_start = datetime.now().date()


if __name__ == '__main__':
    # Demo
    portfolio = SharedPortfolioManager(
        initial_capital=1_000_000,
        max_total_capital_pct=0.80,
        max_total_positions=10,
    )

    # Configure strategies
    portfolio.set_strategy_allocation(1, "ORB Conservative", 0.40, 3)
    portfolio.set_strategy_allocation(2, "ORB Aggressive", 0.40, 3)
    portfolio.set_strategy_allocation(3, "52W Chaser", 0.15, 2)

    print("Strategy Allocations:")
    for status in portfolio.get_all_strategy_statuses():
        print(f"  {status['strategy_name']}: ₹{status['allocated_capital']:,.0f} ({status['allocation_pct']:.0%})")

    print(f"\nTotal Portfolio Status:")
    status = portfolio.get_portfolio_status()
    print(f"  Capital: ₹{status['initial_capital']:,.0f}")
    print(f"  Cash: ₹{status['cash']:,.0f}")
    print(f"  Max Positions: {portfolio.max_total_positions}")
