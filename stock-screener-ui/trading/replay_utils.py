from typing import Optional

DEFAULT_WATCHLIST = [
    "RELIANCE", "TCS", "HDFC", "INFY", "ICICIBANK", "HDFCBANK", "SBIN",
    "BHARTIARTL", "ITC", "KOTAKBANK", "LT", "AXISBANK", "BAJFINANCE",
    "MARUTI", "ASIANPAINT", "HCLTECH", "SUNPHARMA", "TITAN", "WIPRO",
    "ULTRACEMCO",
]

STRATEGY_FILTER_MAP = {
    "ORB": ("ORB",),
    "SR": ("SR_BREAKOUT",),
    "EMA": ("EMA_CROSS",),
    "52W": ("52W_CHASER", "52W_TARGET"),
}


def build_trade_close_event(trade, runner=None) -> dict:
    return {
        "type": "trade_close",
        "symbol": trade.symbol,
        "side": trade.side.value,
        "entry_price": trade.entry_price,
        "exit_price": trade.exit_price,
        "quantity": trade.quantity,
        "pnl": trade.pnl,
        "pnl_pct": trade.pnl_pct,
        "reason": trade.exit_reason,
        "costs": trade.costs,
        "net_pnl": trade.net_pnl,
        "strategy": runner.strategy_name if runner else '',
        "entry_time": trade.entry_time.isoformat(),
        "exit_time": trade.exit_time.isoformat(),
    }
