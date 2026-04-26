def build_trade_log_entry(trade) -> dict:
    return {
        'trade_id': trade.trade_id,
        'symbol': trade.symbol,
        'side': trade.side.value,
        'quantity': trade.quantity,
        'entry_price': trade.entry_price,
        'exit_price': trade.exit_price,
        'entry_time': trade.entry_time.isoformat(),
        'exit_time': trade.exit_time.isoformat(),
        'pnl': trade.pnl,
        'pnl_pct': trade.pnl_pct,
        'exit_reason': trade.exit_reason.value,
        'costs': trade.costs,
        'net_pnl': trade.net_pnl,
        'peak_price': trade.peak_price,
        'low_price': trade.low_price,
    }
