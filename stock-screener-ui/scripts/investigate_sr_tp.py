"""
SR Breakout TP Investigation — Apr 2, 2026

Replays the Classic S/R Breakout strategy minute-by-minute using real Upstox 1-min data.
Simulates the exact same logic as multi_strategy_runner.py:
  1. Uses Apr 1 daily HLC for pivot point calculation
  2. Walks through 1-min candles on Apr 2 to find the breakout moment
  3. Checks exit on the SAME candle (matching the monitor_positions behavior)

Answers:
- How far did stocks actually run past the 1.5% TP?
- Does the breakout candle itself already exceed TP? (0-min hold time bug)
- Would a structure-based TP (R2) be better?

Usage:
    cd stock-screener-ui && python scripts/investigate_sr_tp.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import os
import time
from datetime import datetime, timedelta

from rich.console import Console
from rich.table import Table
from rich.panel import Panel

import config as app_config
from trading.sr_breakout_signals import SRBreakoutSignalGenerator

IST = app_config.IST

SYMBOLS = [
    "APOLLOPIPE", "CARBORUNIV", "COFORGE", "DEEDEV", "GOKULAGRO",
    "JBMA", "NOCIL", "PERSISTENT", "POLYMED", "PREMIERENE",
    "ROSSARI", "SANGHVIMOV", "SGMART", "SHILPAMED", "SOLARWORLD",
    "SPORTKING", "STERTOOLS", "TMB",
]

TRADE_DATE = "2026-04-02"
PREV_DATE = "2026-04-01"
STRATEGY_CONFIG = {
    "sl_pct": 0.5,
    "tp_pct": 1.5,
    "pivot_type": "classic",
    "breakout_buffer_pct": 0.1,
}

console = Console()


def get_upstox_api():
    from upstox_trader.config_and_utils.upstox_api import UpstoxAPI

    api_key = os.getenv("UPSTOX_API_KEY") or os.getenv("UPSTOX_CLIENT_ID")
    api_secret = os.getenv("UPSTOX_API_SECRET") or os.getenv("UPSTOX_CLIENT_SECRET")
    if not api_key or not api_secret:
        console.print("[red]UPSTOX_API_KEY and UPSTOX_API_SECRET env vars required[/red]")
        sys.exit(1)
    return UpstoxAPI(api_key=api_key, api_secret=api_secret, quiet=True)


def fetch_daily_data(api, symbol):
    from_date = (datetime.strptime(PREV_DATE, "%Y-%m-%d") - timedelta(days=10)).strftime("%Y-%m-%d")
    df = api.fetch_historical_data_v3(
        symbol=symbol,
        unit="days",
        interval=1,
        to_date=TRADE_DATE,
        from_date=from_date,
    )
    return df


def fetch_1min_data(api, symbol):
    df = api.fetch_historical_data_v3(
        symbol=symbol,
        unit="minutes",
        interval=1,
        to_date=TRADE_DATE,
        from_date=TRADE_DATE,
    )
    return df


def simulate_trade_minute_by_minute(candles_1m, entry_price, sl_price, tp_price, side="BUY"):
    """
    Simulate the exact bot behavior:
    - Bot enters when price > R1 (we pass entry_price as the price at that moment)
    - On the SAME cycle, monitor_positions checks the last 1-min candle's high/low
    - If candle_high >= TP → instant TP (0-min hold)
    - If candle_low <= SL → instant SL (0-min hold)
    - Then continues checking subsequent candles

    We simulate TWO scenarios:
    A) Same-cycle check (what the bot does): check TP/SL on the entry candle immediately
    B) Next-cycle check (fixed): skip entry candle, start checking from next candle
    """
    if candles_1m is None or candles_1m.empty:
        return None

    def run_sim(skip_entry_candle=False):
        entry_idx = None
        for i, (ts, row) in enumerate(candles_1m.iterrows()):
            h, l, c = float(row["high"]), float(row["low"]), float(row["close"])
            if side == "BUY":
                if c >= entry_price or h >= entry_price:
                    entry_idx = i
                    break
            else:
                if c <= entry_price or l <= entry_price:
                    entry_idx = i
                    break

        if entry_idx is None:
            return None

        start_idx = entry_idx + 1 if skip_entry_candle else entry_idx

        max_price = -float("inf")
        min_price = float("inf")
        exit_idx = None
        exit_price = None
        exit_reason = None
        entry_candle_high = float(candles_1m.iloc[entry_idx]["high"])
        entry_candle_low = float(candles_1m.iloc[entry_idx]["low"])
        entry_candle_close = float(candles_1m.iloc[entry_idx]["close"])
        entry_time = candles_1m.iloc[entry_idx].name
        entry_time_str = entry_time.strftime("%H:%M") if hasattr(entry_time, "strftime") else str(entry_time)

        for i in range(start_idx, len(candles_1m)):
            ts = candles_1m.iloc[i].name
            h = float(candles_1m.iloc[i]["high"])
            l = float(candles_1m.iloc[i]["low"])
            c = float(candles_1m.iloc[i]["close"])
            t_str = ts.strftime("%H:%M") if hasattr(ts, "strftime") else str(ts)

            max_price = max(max_price, h)
            min_price = min(min_price, l)

            if side == "BUY":
                if l <= sl_price:
                    exit_idx = i
                    exit_price = sl_price
                    exit_reason = "SL"
                    break
                if h >= tp_price:
                    exit_idx = i
                    exit_price = tp_price
                    exit_reason = "TP"
                    break
            else:
                if h >= sl_price:
                    exit_idx = i
                    exit_price = sl_price
                    exit_reason = "SL"
                    break
                if l <= tp_price:
                    exit_idx = i
                    exit_price = tp_price
                    exit_reason = "TP"
                    break

        if exit_idx is None:
            last_ts = candles_1m.iloc[-1].name
            exit_idx = len(candles_1m) - 1
            exit_price = float(candles_1m.iloc[-1]["close"])
            exit_reason = "EOD"

        exit_time = candles_1m.iloc[exit_idx].name
        exit_time_str = exit_time.strftime("%H:%M") if hasattr(exit_time, "strftime") else str(exit_time)

        for i in range(entry_idx, len(candles_1m)):
            h = float(candles_1m.iloc[i]["high"])
            l = float(candles_1m.iloc[i]["low"])
            max_price = max(max_price, h)
            min_price = min(min_price, l)

        if side == "BUY":
            mfe_pct = (max_price - entry_price) / entry_price * 100
            mae_pct = (entry_price - min_price) / entry_price * 100
        else:
            mfe_pct = (entry_price - min_price) / entry_price * 100
            mae_pct = (max_price - entry_price) / entry_price * 100

        same_candle_tp = False
        same_candle_sl = False
        if not skip_entry_candle:
            if side == "BUY":
                same_candle_tp = entry_candle_high >= tp_price
                same_candle_sl = entry_candle_low <= sl_price
            else:
                same_candle_tp = entry_candle_low <= tp_price
                same_candle_sl = entry_candle_high >= sl_price

        hold_minutes = exit_idx - entry_idx

        return {
            "entry_time": entry_time_str,
            "exit_time": exit_time_str,
            "hold_minutes": hold_minutes,
            "entry_candle_high": entry_candle_high,
            "entry_candle_low": entry_candle_low,
            "entry_candle_close": entry_candle_close,
            "max_price": max_price,
            "min_price": min_price,
            "mfe_pct": round(mfe_pct, 2),
            "mae_pct": round(mae_pct, 2),
            "exit_price": exit_price,
            "exit_reason": exit_reason,
            "same_candle_tp": same_candle_tp,
            "same_candle_sl": same_candle_sl,
        }

    current_bot = run_sim(skip_entry_candle=False)
    fixed_bot = run_sim(skip_entry_candle=True)

    return {"current_bot": current_bot, "fixed_bot": fixed_bot}


def main():
    console.print(Panel(
        f"[bold cyan]SR Breakout TP Investigation[/bold cyan]\n"
        f"Date: {TRADE_DATE} | Symbols: {len(SYMBOLS)}\n"
        f"Config: SL={STRATEGY_CONFIG['sl_pct']}%, TP={STRATEGY_CONFIG['tp_pct']}%, "
        f"Buffer={STRATEGY_CONFIG['breakout_buffer_pct']}%, Pivot={STRATEGY_CONFIG['pivot_type']}\n\n"
        f"[yellow]Simulates TWO modes:[/yellow]\n"
        f"  A) Current bot: checks TP/SL on entry candle (same cycle)\n"
        f"  B) Fixed bot: skips entry candle, starts checking from next candle",
        border_style="cyan",
    ))

    api = get_upstox_api()
    gen = SRBreakoutSignalGenerator(STRATEGY_CONFIG)

    results = []

    for i, symbol in enumerate(SYMBOLS):
        console.print(f"[dim]({i+1}/{len(SYMBOLS)}) {symbol}...[/dim]", end=" ")
        time.sleep(0.3)

        daily_df = fetch_daily_data(api, symbol)
        if daily_df is None or daily_df.empty or len(daily_df) < 2:
            console.print("[red]no daily data[/red]")
            continue

        prev_row = daily_df.iloc[-2]
        prev_high = float(prev_row["high"])
        prev_low = float(prev_row["low"])
        prev_close = float(prev_row["close"])

        pivot_points = gen.calculate_pivot_points(prev_high, prev_low, prev_close)
        r1 = pivot_points["R1"]
        r2 = pivot_points["R2"]
        s1 = pivot_points["S1"]
        s2 = pivot_points["S2"]

        intraday_df = fetch_1min_data(api, symbol)
        if intraday_df is None or intraday_df.empty:
            console.print("[red]no intraday data[/red]")
            continue

        buf = STRATEGY_CONFIG["breakout_buffer_pct"] / 100
        entry_price = None
        entry_idx = None
        side = None

        for idx, (ts, row) in enumerate(intraday_df.iterrows()):
            c = float(row["close"])
            h = float(row["high"])
            l = float(row["low"])

            if c > r1 * (1 + buf):
                entry_price = c
                entry_idx = idx
                side = "BUY"
                break
            if h > r1 * (1 + buf):
                entry_price = r1 * (1 + buf)
                entry_idx = idx
                side = "BUY"
                break
            if c < s1 * (1 - buf):
                entry_price = c
                entry_idx = idx
                side = "SELL"
                break
            if l < s1 * (1 - buf):
                entry_price = s1 * (1 - buf)
                entry_idx = idx
                side = "SELL"
                break

        if entry_price is None:
            console.print("[dim]no breakout in 1-min data[/dim]")
            continue

        sl_price = round(entry_price * (1 - STRATEGY_CONFIG["sl_pct"] / 100), 2) if side == "BUY" else round(entry_price * (1 + STRATEGY_CONFIG["sl_pct"] / 100), 2)
        tp_price = round(entry_price * (1 + STRATEGY_CONFIG["tp_pct"] / 100), 2) if side == "BUY" else round(entry_price * (1 - STRATEGY_CONFIG["tp_pct"] / 100), 2)

        sim = simulate_trade_minute_by_minute(intraday_df, entry_price, sl_price, tp_price, side)
        if sim is None:
            console.print("[red]sim failed[/red]")
            continue

        cur = sim["current_bot"]
        fix = sim["fixed_bot"]

        if side == "BUY":
            gap_to_r2 = round((r2 - entry_price) / entry_price * 100, 2)
        else:
            gap_to_r2 = round((entry_price - s2) / entry_price * 100, 2)

        entry_time = intraday_df.iloc[entry_idx].name
        entry_time_str = entry_time.strftime("%H:%M") if hasattr(entry_time, "strftime") else str(entry_time)

        console.print(f"[green]{side} @ {entry_price:.2f} ({entry_time_str})[/green] "
                      f"cur={cur['exit_reason']}({cur['hold_minutes']}m) "
                      f"fix={fix['exit_reason']}({fix['hold_minutes']}m) "
                      f"MFE={cur['mfe_pct']}%")

        results.append({
            "symbol": symbol,
            "side": side,
            "entry_price": entry_price,
            "entry_time": entry_time_str,
            "r1": r1,
            "r2": r2,
            "sl_price": sl_price,
            "tp_price": tp_price,
            "gap_to_r2": gap_to_r2,
            "cur": cur,
            "fix": fix,
        })

    if not results:
        console.print("[red]No results[/red]")
        return

    console.print()

    table = Table(title="Current Bot Behavior (same-cycle TP/SL check)", show_lines=True)
    table.add_column("Symbol", style="cyan", width=12)
    table.add_column("Side", width=4)
    table.add_column("Entry", justify="right", width=9)
    table.add_column("Entry Time", width=9)
    table.add_column("R1", justify="right", width=9)
    table.add_column("TP", justify="right", width=9)
    table.add_column("SL", justify="right", width=9)
    table.add_column("Exit", justify="right", width=9)
    table.add_column("Exit Time", width=9)
    table.add_column("Hold", justify="right", width=5)
    table.add_column("MFE%", justify="right", width=7)
    table.add_column("Entry candle TP?", width=16)
    table.add_column("Left on table", justify="right", width=14)

    for r in results:
        cur = r["cur"]
        exit_style = "green" if cur["exit_reason"] == "TP" else "red" if cur["exit_reason"] == "SL" else "dim"
        if cur["same_candle_tp"]:
            candle_tag = "[red]YES → 0min[/red]"
        elif cur["same_candle_sl"]:
            candle_tag = "[red]YES (SL)[/red]"
        else:
            candle_tag = "[green]no[/green]"

        left = max(0, cur["mfe_pct"] - STRATEGY_CONFIG["tp_pct"]) if cur["exit_reason"] == "TP" else 0

        table.add_row(
            r["symbol"],
            r["side"],
            f"{r['entry_price']:.2f}",
            r["entry_time"],
            f"{r['r1']:.2f}",
            f"{r['tp_price']:.2f}",
            f"{r['sl_price']:.2f}",
            f"[{exit_style}]{cur['exit_price']:.2f}[/{exit_style}]",
            cur["exit_time"],
            f"{cur['hold_minutes']}m",
            f"{cur['mfe_pct']:.2f}",
            candle_tag,
            f"{left:.2f}%" if left > 0 else "-",
        )

    console.print(table)

    console.print()

    table2 = Table(title="Fixed Bot Behavior (skip entry candle, check from next)", show_lines=True)
    table2.add_column("Symbol", style="cyan", width=12)
    table2.add_column("Entry", justify="right", width=9)
    table2.add_column("TP", justify="right", width=9)
    table2.add_column("SL", justify="right", width=9)
    table2.add_column("Exit", justify="right", width=9)
    table2.add_column("Hold", justify="right", width=5)
    table2.add_column("MFE%", justify="right", width=7)
    table2.add_column("Left on table", justify="right", width=14)
    table2.add_column("vs Current", width=20)

    for r in results:
        fix = r["fix"]
        cur = r["cur"]
        exit_style = "green" if fix["exit_reason"] == "TP" else "red" if fix["exit_reason"] == "SL" else "dim"
        left = max(0, fix["mfe_pct"] - STRATEGY_CONFIG["tp_pct"]) if fix["exit_reason"] == "TP" else 0

        changed = ""
        if cur["exit_reason"] != fix["exit_reason"]:
            changed = f"[yellow]changed {cur['exit_reason']}→{fix['exit_reason']}[/yellow]"
        elif cur["hold_minutes"] != fix["hold_minutes"]:
            changed = f"[dim]hold {cur['hold_minutes']}m→{fix['hold_minutes']}m[/dim]"

        table2.add_row(
            r["symbol"],
            f"{r['entry_price']:.2f}",
            f"{r['tp_price']:.2f}",
            f"{r['sl_price']:.2f}",
            f"[{exit_style}]{fix['exit_price']:.2f}[/{exit_style}]",
            f"{fix['hold_minutes']}m",
            f"{fix['mfe_pct']:.2f}",
            f"{left:.2f}%" if left > 0 else "-",
            changed,
        )

    console.print(table2)

    console.print()

    tp_cur = [r for r in results if r["cur"]["exit_reason"] == "TP"]
    sl_cur = [r for r in results if r["cur"]["exit_reason"] == "SL"]
    eod_cur = [r for r in results if r["cur"]["exit_reason"] == "EOD"]
    tp_fix = [r for r in results if r["fix"]["exit_reason"] == "TP"]
    sl_fix = [r for r in results if r["fix"]["exit_reason"] == "SL"]

    same_candle_tps = sum(1 for r in results if r["cur"]["same_candle_tp"])
    same_candle_sls = sum(1 for r in results if r["cur"]["same_candle_sl"])

    avg_mfe_tp = sum(r["cur"]["mfe_pct"] for r in tp_cur) / len(tp_cur) if tp_cur else 0
    avg_left = sum(max(0, r["cur"]["mfe_pct"] - STRATEGY_CONFIG["tp_pct"]) for r in tp_cur) / len(tp_cur) if tp_cur else 0

    console.print(Panel(
        f"[bold]Summary[/bold]\n\n"
        f"[bold]Current bot:[/bold] TP={len(tp_cur)} SL={len(sl_cur)} EOD={len(eod_cur)}\n"
        f"[bold]Fixed bot:  [/bold] TP={len(tp_fix)} SL={len(sl_fix)}\n\n"
        f"[red]Same-candle TP hits (0-min hold): {same_candle_tps}/{len(results)}[/red]\n"
        f"[red]Same-candle SL hits (0-min hold): {same_candle_sls}/{len(results)}[/red]\n\n"
        f"Avg MFE on TP trades: {avg_mfe_tp:.2f}%\n"
        f"Avg left on table (TP trades): {avg_left:.2f}%\n"
        f"Max MFE: {max(r['cur']['mfe_pct'] for r in results):.2f}% ({max(results, key=lambda x: x['cur']['mfe_pct'])['symbol']})\n\n"
        f"[bold]TP trades with entry candle already > TP:[/bold] {same_candle_tps}/{len(tp_cur)}\n"
        f"  → These are the 'phantom' 0-min trades where the bot enters and exits on the same candle",
        border_style="yellow",
    ))


if __name__ == "__main__":
    main()
