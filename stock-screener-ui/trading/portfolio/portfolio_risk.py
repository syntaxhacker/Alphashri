from typing import Dict


def validate_can_open_position(
    portfolio,
    strategy_id: int,
    symbol: str,
    trade_value: float,
) -> tuple:
    if strategy_id not in portfolio.strategy_allocations:
        return False, f"Strategy {strategy_id} not configured"

    alloc = portfolio.strategy_allocations[strategy_id]

    if alloc.positions_count >= alloc.max_positions:
        return False, f"Strategy {alloc.strategy_name} max positions ({alloc.max_positions}) reached"

    allocated_capital = portfolio.initial_capital * alloc.allocation_pct
    if alloc.capital_used + trade_value > allocated_capital:
        available = allocated_capital - alloc.capital_used
        return False, f"Strategy {alloc.strategy_name} capital limit exceeded (available: ₹{available:,.0f})"

    if portfolio.get_total_positions() >= portfolio.max_total_positions:
        return False, f"Total portfolio positions limit ({portfolio.max_total_positions}) reached"

    total_used = portfolio.get_total_capital_used()
    max_total = portfolio.initial_capital * portfolio.max_total_capital_pct
    if total_used + trade_value > max_total:
        return False, f"Total capital limit ({portfolio.max_total_capital_pct:.0%}) would be exceeded"

    if trade_value > portfolio.cash:
        return False, f"Insufficient cash (need ₹{trade_value:,.0f}, have ₹{portfolio.cash:,.0f})"

    current_exposure = get_symbol_exposure(portfolio, symbol)
    max_exposure = portfolio.initial_capital * portfolio.max_symbol_exposure_pct
    if current_exposure + trade_value > max_exposure:
        return False, f"Symbol {symbol} exposure limit ({portfolio.max_symbol_exposure_pct:.0%}) would be exceeded"

    return True, "OK"


def get_symbol_exposure(portfolio, symbol: str) -> float:
    total = 0.0
    for pos in portfolio.positions.values():
        if pos.symbol == symbol:
            total += pos.entry_price * pos.quantity
    return total
