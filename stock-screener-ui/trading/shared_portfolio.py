"""
Shared Portfolio Manager - Backward-compatible wrapper.

All public API is now in trading/portfolio/.
"""

from trading.portfolio import (
    SharedPortfolioManager,
    OrderSide,
    StrategyAllocation,
    SharedPosition,
    CompletedTrade,
)

__all__ = [
    "SharedPortfolioManager",
    "OrderSide",
    "StrategyAllocation",
    "SharedPosition",
    "CompletedTrade",
]


if __name__ == '__main__':
    from datetime import datetime
    import config

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
