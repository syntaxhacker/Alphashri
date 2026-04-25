"""Trade execution and position monitoring for daily ORB trading."""

from datetime import datetime

from rich.console import Console

from trading.paper_trader import OrderSide, ExitReason
from trading.orb_signals import SignalType

console = Console()


def execute_signal(runner, signal):
    """Execute a trading signal."""
    if runner.test_mode:
        console.print(f"[yellow]TEST MODE: Would execute {signal.signal_type.value} {signal.symbol} @ \u20b9{signal.price:.2f}[/yellow]")
        return None

    portfolio = runner.trader.get_portfolio_status()
    validation = runner.risk_manager.validate_trade(
        capital=portfolio['total_value'],
        cash=portfolio['cash'],
        current_positions=len(runner.trader.positions),
        current_exposure=portfolio['margin_used'],
        entry_price=signal.price,
        stop_loss=signal.stop_loss,
        take_profit=signal.take_profit,
        side="BUY" if signal.signal_type == SignalType.LONG_ENTRY else "SELL",
    )

    if not validation['valid']:
        console.print(f"[red]Signal rejected: {validation['reason']}[/red]")
        return None

    order = runner.trader.place_order(
        symbol=signal.symbol,
        side=OrderSide.BUY if signal.signal_type == SignalType.LONG_ENTRY else OrderSide.SELL,
        quantity=validation['shares'],
        price=signal.price,
        stop_loss=signal.stop_loss,
        take_profit=signal.take_profit,
    )

    return order


def monitor_positions(runner):
    """Monitor open positions for exits using 1-min candle high/low."""
    if not runner.trader.positions:
        return

    from .daily_scanner import fetch_live_price_for_exit, fetch_or_data

    positions_before = set(runner.trader.positions.keys())

    price_data = {}

    for symbol in list(runner.trader.positions.keys()):
        try:
            live_data = fetch_live_price_for_exit(runner, symbol)
            if live_data:
                price_data[symbol] = live_data
            else:
                or_data = fetch_or_data(runner, symbol)
                if or_data and 'latest_price' in or_data:
                    price_data[symbol] = {
                        'high': or_data.get('latest_high', or_data['latest_price']),
                        'low': or_data.get('latest_low', or_data['latest_price']),
                        'close': or_data['latest_price'],
                    }
        except Exception as e:
            pos = runner.trader.positions[symbol]
            price_data[symbol] = {
                'high': pos.current_price,
                'low': pos.current_price,
                'close': pos.current_price,
            }

    for symbol, pos in list(runner.trader.positions.items()):
        if symbol not in price_data:
            continue

        data = price_data[symbol]
        candle_high = data['high']
        candle_low = data['low']
        candle_close = data['close']

        exit_triggered = False
        exit_price = None
        exit_reason = None

        if pos.side.value == 'BUY':
            if candle_low <= pos.stop_loss:
                exit_triggered = True
                exit_price = pos.stop_loss
                exit_reason = 'SL'
                console.print(f"[red]\U0001f534 {symbol} SL hit! Low \u20b9{candle_low:.2f} <= SL \u20b9{pos.stop_loss:.2f}[/red]")
            elif candle_high >= pos.take_profit:
                exit_triggered = True
                exit_price = pos.take_profit
                exit_reason = 'TP'
                console.print(f"[green]\U0001f7e2 {symbol} TP hit! High \u20b9{candle_high:.2f} >= TP \u20b9{pos.take_profit:.2f}[/green]")

        elif pos.side.value == 'SELL':
            if candle_high >= pos.stop_loss:
                exit_triggered = True
                exit_price = pos.stop_loss
                exit_reason = 'SL'
                console.print(f"[red]\U0001f534 {symbol} SL hit! High \u20b9{candle_high:.2f} >= SL \u20b9{pos.stop_loss:.2f}[/red]")
            elif candle_low <= pos.take_profit:
                exit_triggered = True
                exit_price = pos.take_profit
                exit_reason = 'TP'
                console.print(f"[green]\U0001f7e2 {symbol} TP hit! Low \u20b9{candle_low:.2f} <= TP \u20b9{pos.take_profit:.2f}[/green]")

        if exit_triggered:
            exit_reason_enum = ExitReason.TAKE_PROFIT if exit_reason == 'TP' else ExitReason.STOP_LOSS
            trade = runner.trader.close_position(symbol, exit_price, exit_reason_enum)

            if trade:
                runner.journal.log_trade({
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
                    'sl_price': pos.stop_loss,
                    'tp_price': pos.take_profit,
                })
                console.print(f"[green]\U0001f4dd Logged trade to journal: {symbol} ({exit_reason})[/green]")
                runner.journal.save_journal()

    if runner.is_force_exit_time():
        console.print("\n[yellow]Force exit time reached. Closing all positions...[/yellow]")
        current_prices = {s: d['close'] for s, d in price_data.items()}
        runner.trader.close_all_positions(current_prices)
        for symbol in positions_before:
            runner.cooldown_stocks[symbol] = datetime.now()
        return

    current_prices = {s: d['close'] for s, d in price_data.items()}
    if current_prices:
        runner.trader.update_prices(current_prices)

    positions_after = set(runner.trader.positions.keys())
    closed_positions = positions_before - positions_after

    for symbol in closed_positions:
        runner.cooldown_stocks[symbol] = datetime.now()
        console.print(f"[yellow]\u23f3 {symbol} added to 30-min cooldown[/yellow]")

        if trades_after > trades_before:
            new_trades = runner.trader.trades[trades_before:]
            for trade in new_trades:
                runner.journal.log_trade({
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
                    'sl_price': 0,
                    'tp_price': 0,
                })
                console.print(f"[green]\U0001f4dd Logged trade to journal: {trade.symbol} ({trade.exit_reason.value})[/green]")

    positions_after = set(runner.trader.positions.keys())
    closed_positions = positions_before - positions_after

    for symbol in closed_positions:
        runner.cooldown_stocks[symbol] = datetime.now()
        console.print(f"[yellow]\u23f3 {symbol} added to 30-min cooldown[/yellow]")
