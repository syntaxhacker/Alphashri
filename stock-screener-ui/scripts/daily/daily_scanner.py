"""Screener and signal scanning functions for daily ORB trading."""

import random
from datetime import datetime, timedelta
from typing import List

from rich.console import Console
from rich.table import Table

from trading.orb_signals import SignalType, create_entry_signal

console = Console()


def refresh_watchlist(runner):
    """Refresh watchlist from screener."""
    console.print("\n[cyan]Refreshing watchlist from screener...[/cyan]")

    screener = runner._get_screener()
    df = screener.screen(limit=50, verify_nse=True)

    if df.empty:
        console.print("[red]No stocks found from screener[/red]")
        return

    runner.watchlist = df['name'].tolist()[:20]
    console.print(f"[green]Watchlist updated: {len(runner.watchlist)} stocks[/green]")
    runner._write_scan_snapshot([
        {
            "symbol": symbol,
            "status": "watching",
            "reason": "In watchlist, waiting for next scan",
        }
        for symbol in runner.watchlist
    ], [])

    table = Table(title="Today's ORB Watchlist")
    table.add_column("#", width=3)
    table.add_column("Symbol")
    table.add_column("Price", justify="right")
    table.add_column("RSI", justify="right")
    table.add_column("ADX", justify="right")
    table.add_column("Score", justify="right")

    for i, (_, row) in enumerate(df.head(20).iterrows(), 1):
        table.add_row(
            str(i),
            row['name'],
            f"\u20b9{row['close']:.0f}",
            f"{row['RSI']:.1f}",
            f"{row['ADX']:.1f}",
            f"{row.get('orb_score', 0):.1f}",
        )

    console.print(table)


def fetch_or_data(runner, symbol: str) -> dict:
    """Fetch opening range data for a symbol using intraday API."""
    try:
        fetcher = runner._get_data_fetcher()

        df = fetcher.upstox_api.fetch_intraday_data_v3(
            symbol=symbol,
            interval='5'
        )

        if df is None or df.empty:
            return None

        candles = []
        for idx, row in df.iterrows():
            candles.append({
                'time': idx.isoformat() if hasattr(idx, 'isoformat') else str(idx),
                'open': row['open'],
                'high': row['high'],
                'low': row['low'],
                'close': row['close'],
            })

        or_levels = runner.signal_generator.calculate_or_levels(candles)

        if or_levels and candles:
            or_levels['latest_price'] = candles[-1]['close']
            or_levels['latest_high'] = candles[-1]['high']
            or_levels['latest_low'] = candles[-1]['low']

        return or_levels

    except Exception as e:
        console.print(f"[dim red]Error fetching OR for {symbol}: {e}[/dim red]")
        return None


def fetch_live_price_for_exit(runner, symbol: str) -> dict:
    """Fetch 1-minute data for accurate exit monitoring (checks candle high/low)."""
    try:
        fetcher = runner._get_data_fetcher()

        df = fetcher.upstox_api.fetch_intraday_data_v3(
            symbol=symbol,
            interval='1'
        )

        if df is None or df.empty:
            return None

        last_candle = df.iloc[-1]
        return {
            'high': last_candle['high'],
            'low': last_candle['low'],
            'close': last_candle['close'],
            'time': df.index[-1].isoformat() if hasattr(df.index[-1], 'isoformat') else str(df.index[-1]),
        }

    except Exception as e:
        console.print(f"[dim red]Error fetching 1-min data for {symbol}: {e}[/dim red]")
        return None


def scan_for_signals(runner):
    """Scan watchlist for ORB signals."""
    scan_items: List[dict] = []

    if not runner.is_trading_hours():
        console.print("[dim]Outside trading hours, skipping signal scan[/dim]")
        runner._write_scan_snapshot([{
            "symbol": "*",
            "status": "outside_trading_hours",
            "reason": "Outside OR scan window",
        }], [])
        return []

    new_signals = []

    if runner.force_signals:
        console.print("[yellow]Force signals mode: Generating test signals...[/yellow]")

        available = [s for s in runner.watchlist if s not in runner.trader.positions]
        if available and len(runner.trader.positions) < runner.max_positions:
            num_signals = min(2, runner.max_positions - len(runner.trader.positions), len(available))
            selected = random.sample(available, num_signals)

            for symbol in selected:
                price = 400 + random.uniform(-50, 50)

                or_high = price * 0.98
                or_low = price * 0.95
                or_range_pct = 3.0

                signal = create_entry_signal(
                    symbol=symbol,
                    price=price,
                    or_high=or_high,
                    or_low=or_low,
                    sl_pct=0.4,
                    tp_pct=1.2,
                    side="LONG",
                )
                signal.notes = f"[TEST] Synthetic breakout above OR high \u20b9{or_high:.2f}"
                new_signals.append(signal)
                scan_items.append({
                    "symbol": symbol,
                    "status": "signal",
                    "side": "LONG",
                    "price": round(price, 2),
                    "or_high": round(or_high, 2),
                    "or_low": round(or_low, 2),
                    "reason": "Force-signal test mode",
                })
                console.print(f"[green]Generated test signal for {symbol}[/green]")

        runner._write_scan_snapshot(scan_items, new_signals)
        return new_signals

    symbols_to_scan = []
    for symbol in runner.watchlist:
        if symbol in runner.trader.positions:
            scan_items.append({
                "symbol": symbol,
                "status": "skipped",
                "reason": "Already in position",
            })
            continue

        if symbol in runner.cooldown_stocks:
            exit_time = runner.cooldown_stocks[symbol]
            cooldown_end = exit_time + timedelta(minutes=runner.COOLDOWN_MINUTES)
            if datetime.now() < cooldown_end:
                remaining = (cooldown_end - datetime.now()).seconds // 60
                console.print(f"[dim yellow]  {symbol}: In cooldown ({remaining}m remaining)[/dim yellow]")
                scan_items.append({
                    "symbol": symbol,
                    "status": "cooldown",
                    "reason": f"In cooldown ({remaining}m remaining)",
                })
                continue
            else:
                del runner.cooldown_stocks[symbol]

        symbols_to_scan.append(symbol)

    for symbol in symbols_to_scan:
        or_levels = fetch_or_data(runner, symbol)
        if not or_levels:
            scan_items.append({
                "symbol": symbol,
                "status": "no_data",
                "reason": "No intraday OR data",
            })
            continue

        runner.or_levels[symbol] = or_levels

        current_price = or_levels.get('latest_price', or_levels['or_close'])
        or_high = or_levels['or_high']
        or_low = or_levels['or_low']
        or_range_pct = or_levels['or_range_pct']

        distance_from_or_high = ((current_price - or_high) / or_high) * 100
        distance_from_or_low = ((or_low - current_price) / or_low) * 100

        console.print(f"[dim]  {symbol}: Price \u20b9{current_price:.2f} | OR High \u20b9{or_high:.2f} | OR Low \u20b9{or_low:.2f}[/dim]")

        MAX_DISTANCE_FROM_OR = runner.config.max_distance_from_or_pct if runner.config else 1.5

        day_open = or_levels.get('or_open', current_price)
        day_change_pct = ((current_price - day_open) / day_open) * 100 if day_open > 0 else 0
        or_range_pct = or_levels.get('or_range_pct', 0)

        if current_price > or_high:
            if distance_from_or_high > MAX_DISTANCE_FROM_OR:
                console.print(f"[yellow]  \u26a0\ufe0f {symbol}: Skip LONG - too far from OR high ({distance_from_or_high:.2f}%)[/yellow]")
                scan_items.append({
                    "symbol": symbol,
                    "status": "blocked",
                    "side": "LONG",
                    "price": round(current_price, 2),
                    "or_high": round(or_high, 2),
                    "or_low": round(or_low, 2),
                    "reason": f"Too far above OR high ({distance_from_or_high:.2f}%)",
                })
                continue

            if day_change_pct > 2.0:
                console.print(f"[yellow]  \u26a0\ufe0f {symbol}: Skip LONG - day already up {day_change_pct:.1f}%[/yellow]")
                scan_items.append({
                    "symbol": symbol,
                    "status": "blocked",
                    "side": "LONG",
                    "price": round(current_price, 2),
                    "or_high": round(or_high, 2),
                    "or_low": round(or_low, 2),
                    "reason": f"Day already up {day_change_pct:.1f}%",
                })
                continue

            signal = create_entry_signal(
                symbol=symbol,
                price=current_price,
                or_high=or_high,
                or_low=or_low,
                sl_pct=0.4,
                tp_pct=1.2,
                side="LONG",
            )
            signal.notes = f"Breakout above OR high \u20b9{or_high:.2f} (+{distance_from_or_high:.2f}%)"
            new_signals.append(signal)
            scan_items.append({
                "symbol": symbol,
                "status": "signal",
                "side": "LONG",
                "price": round(current_price, 2),
                "or_high": round(or_high, 2),
                "or_low": round(or_low, 2),
                "reason": f"Breakout +{distance_from_or_high:.2f}%",
            })
            console.print(f"[green]\u2713 Breakout detected: {symbol} @ \u20b9{current_price:.2f} (OR High: \u20b9{or_high:.2f}, +{distance_from_or_high:.2f}%)[/green]")

        elif current_price < or_low:
            if distance_from_or_low > MAX_DISTANCE_FROM_OR:
                console.print(f"[yellow]  \u26a0\ufe0f {symbol}: Skip SHORT - too far from OR low ({distance_from_or_low:.2f}%)[/yellow]")
                scan_items.append({
                    "symbol": symbol,
                    "status": "blocked",
                    "side": "SHORT",
                    "price": round(current_price, 2),
                    "or_high": round(or_high, 2),
                    "or_low": round(or_low, 2),
                    "reason": f"Too far below OR low ({distance_from_or_low:.2f}%)",
                })
                continue

            if day_change_pct > 1.0:
                console.print(f"[yellow]  \u26a0\ufe0f {symbol}: Skip SHORT - uptrend (day +{day_change_pct:.1f}%)[/yellow]")
                scan_items.append({
                    "symbol": symbol,
                    "status": "blocked",
                    "side": "SHORT",
                    "price": round(current_price, 2),
                    "or_high": round(or_high, 2),
                    "or_low": round(or_low, 2),
                    "reason": f"Uptrend day +{day_change_pct:.1f}%",
                })
                continue

            signal = create_entry_signal(
                symbol=symbol,
                price=current_price,
                or_high=or_high,
                or_low=or_low,
                sl_pct=0.4,
                tp_pct=1.2,
                side="SHORT",
            )
            signal.notes = f"Breakdown below OR low \u20b9{or_low:.2f} (-{distance_from_or_low:.2f}%)"
            new_signals.append(signal)
            scan_items.append({
                "symbol": symbol,
                "status": "signal",
                "side": "SHORT",
                "price": round(current_price, 2),
                "or_high": round(or_high, 2),
                "or_low": round(or_low, 2),
                "reason": f"Breakdown -{distance_from_or_low:.2f}%",
            })
            console.print(f"[red]\u2713 Breakdown detected: {symbol} @ \u20b9{current_price:.2f} (OR Low: \u20b9{or_low:.2f}, -{distance_from_or_low:.2f}%)[/red]")
        else:
            scan_items.append({
                "symbol": symbol,
                "status": "watching",
                "price": round(current_price, 2),
                "or_high": round(or_high, 2),
                "or_low": round(or_low, 2),
                "reason": "Waiting for OR breakout",
            })

    runner._write_scan_snapshot(scan_items, new_signals)
    return new_signals
