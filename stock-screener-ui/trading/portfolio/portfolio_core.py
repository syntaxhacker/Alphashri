from datetime import datetime
from typing import Dict, List, Optional
import asyncio

import config

from rich.console import Console

from .portfolio_models import (
    StrategyAllocation,
    SharedPosition,
    CompletedTrade,
    OrderSide,
)
from .portfolio_risk import validate_can_open_position
from .portfolio_state import restore_state, restore_position, reset_daily

console = Console()


class SharedPortfolioManager:

    def __init__(
        self,
        initial_capital: float = 1_000_000,
        max_total_capital_pct: float = 0.80,
        max_total_positions: int = 10,
        max_symbol_exposure_pct: float = 0.20,
        user_id: Optional[int] = None,
    ):
        self.initial_capital = initial_capital
        self.cash = initial_capital
        self.max_total_capital_pct = max_total_capital_pct
        self.max_total_positions = max_total_positions
        self.max_symbol_exposure_pct = max_symbol_exposure_pct
        self.user_id = user_id

        self.strategy_allocations: Dict[int, StrategyAllocation] = {}
        self.positions: Dict[str, SharedPosition] = {}
        self.trades: List[CompletedTrade] = []

        self._trade_counter = 0
        self._lock = asyncio.Lock()

        self.daily_pnl = 0.0
        self.daily_trades = 0
        self.day_start = datetime.now(config.IST).date()

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
        self.strategy_allocations[strategy_id] = StrategyAllocation(
            strategy_id=strategy_id,
            strategy_name=strategy_name,
            allocation_pct=allocation_pct,
            max_positions=max_positions,
        )

    def get_strategy_capital(self, strategy_id: int) -> float:
        if strategy_id not in self.strategy_allocations:
            return 0.0
        alloc = self.strategy_allocations[strategy_id]
        return self.initial_capital * alloc.allocation_pct

    def get_strategy_available_capital(self, strategy_id: int) -> float:
        if strategy_id not in self.strategy_allocations:
            return 0.0
        alloc = self.strategy_allocations[strategy_id]
        allocated = self.initial_capital * alloc.allocation_pct
        return max(0, allocated - alloc.capital_used)

    def get_total_capital_used(self) -> float:
        return sum(alloc.capital_used for alloc in self.strategy_allocations.values())

    def get_total_positions(self) -> int:
        return sum(alloc.positions_count for alloc in self.strategy_allocations.values())

    def get_symbol_exposure(self, symbol: str) -> float:
        from .portfolio_risk import get_symbol_exposure as _get_symbol_exposure
        return _get_symbol_exposure(self, symbol)

    def can_open_position(
        self,
        strategy_id: int,
        symbol: str,
        trade_value: float,
    ) -> tuple:
        return validate_can_open_position(self, strategy_id, symbol, trade_value)

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
        trade_value = entry_price * quantity

        allowed, reason = self.can_open_position(strategy_id, symbol, trade_value)
        if not allowed:
            console.print(f"[red]Position rejected: {reason}[/red]")
            return None

        key = f"{strategy_id}_{symbol}"

        if key in self.positions:
            console.print(f"[yellow]Position already exists for {strategy_name}/{symbol}[/yellow]")
            return None

        self.cash -= trade_value

        position = SharedPosition(
            symbol=symbol,
            side=side,
            quantity=quantity,
            entry_price=entry_price,
            stop_loss=stop_loss,
            take_profit=take_profit,
            entry_time=datetime.now(config.IST),
            strategy_id=strategy_id,
            strategy_name=strategy_name,
            current_price=entry_price,
            peak_price=entry_price,
            low_price=entry_price,
        )

        self.positions[key] = position

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
        key = f"{strategy_id}_{symbol}"

        if key not in self.positions:
            return None

        position = self.positions[key]

        if position.side == OrderSide.BUY:
            pnl = (exit_price - position.entry_price) * position.quantity
            pnl_pct = (exit_price - position.entry_price) / position.entry_price * 100
        else:
            pnl = (position.entry_price - exit_price) * position.quantity
            pnl_pct = (position.entry_price - exit_price) / position.entry_price * 100

        net_pnl = pnl - costs

        trade = CompletedTrade(
            trade_id=self._generate_trade_id(),
            symbol=symbol,
            side=position.side,
            quantity=position.quantity,
            entry_price=position.entry_price,
            exit_price=exit_price,
            entry_time=position.entry_time,
            exit_time=datetime.now(config.IST),
            pnl=round(pnl, 2),
            pnl_pct=round(pnl_pct, 2),
            exit_reason=exit_reason,
            costs=round(costs, 2),
            net_pnl=round(net_pnl, 2),
            strategy_id=strategy_id,
            strategy_name=position.strategy_name,
        )

        exit_value = exit_price * position.quantity
        self.cash += exit_value - costs

        entry_value = position.entry_price * position.quantity
        if strategy_id in self.strategy_allocations:
            self.strategy_allocations[strategy_id].capital_used -= entry_value
            self.strategy_allocations[strategy_id].positions_count -= 1
            self.strategy_allocations[strategy_id].realized_pnl += net_pnl

        del self.positions[key]

        self.trades.append(trade)

        self.daily_pnl += net_pnl
        self.daily_trades += 1

        pnl_color = "green" if net_pnl >= 0 else "red"
        console.print(f"[{pnl_color}]✓ Position closed: {position.strategy_name} - {symbol}[/{pnl_color}]")
        console.print(f"   P&L: ₹{pnl:.2f} | Net: ₹{net_pnl:.2f} | Reason: {exit_reason}")

        return trade

    def update_prices(self, prices: Dict[str, float]):
        for key, position in self.positions.items():
            if position.symbol in prices:
                current_price = prices[position.symbol]
                position.current_price = current_price
                position.peak_price = max(position.peak_price, current_price)
                position.low_price = min(position.low_price, current_price)

                if position.side == OrderSide.BUY:
                    position.unrealized_pnl = (current_price - position.entry_price) * position.quantity
                    position.unrealized_pnl_pct = (current_price - position.entry_price) / position.entry_price * 100
                else:
                    position.unrealized_pnl = (position.entry_price - current_price) * position.quantity
                    position.unrealized_pnl_pct = (position.entry_price - current_price) / position.entry_price * 100

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
        if strategy_id not in self.strategy_allocations:
            return None

        alloc = self.strategy_allocations[strategy_id]
        allocated_capital = self.initial_capital * alloc.allocation_pct

        strategy_positions = [
            pos for key, pos in self.positions.items()
            if pos.strategy_id == strategy_id
        ]

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
        return [
            self.get_strategy_status(strategy_id)
            for strategy_id in self.strategy_allocations.keys()
        ]

    def get_positions_by_strategy(self, strategy_id: int) -> List[dict]:
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
                'peak_price': pos.peak_price,
                'metadata': pos.metadata,
            }
            for pos in self.positions.values()
        ]

    def restore_state(self, state: dict):
        restore_state(self, state)

    def restore_position(self, pos_data: dict):
        restore_position(self, pos_data)

    def reset_daily(self):
        reset_daily(self)


if __name__ == '__main__':
    portfolio = SharedPortfolioManager(
        initial_capital=1_000_000,
        max_total_capital_pct=0.80,
        max_total_positions=10,
    )

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
