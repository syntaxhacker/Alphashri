"""
SR Breakout SL/TP Optimization — Apr 2, 2026

Tests multiple SL/TP combinations against real 1-min Upstox data
to find optimal levels for the Classic S/R Breakout strategy.

Uses the FIXED entry method (live 1-min close, not daily close).

Usage:
    cd stock-screener-ui && python scripts/optimize_sr_sltp.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import os
import time
from datetime import datetime, timedelta
from itertools import product

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

SL_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]
TP_OPTIONS = [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0]
BUFFER_PCT = 0.1

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
    return api.fetch_historical_data_v3(
        symbol=symbol, unit="days", interval=1,
        to_date=TRADE_DATE, from_date=from_date,
    )


def fetch_1min_data(api, symbol):
    return api.fetch_historical_data_v3(
        symbol=symbol, unit="minutes", interval=1,
        to_date=TRADE_DATE, from_date=TRADE_DATE,
    )


def simulate(symbol, candles_1m, entry_price, sl_price, tp_price, side="BUY"):
    if candles_1m is None or candles_1m.empty:
        return None

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

    max_price = -float("inf")
    min_price = float("inf")

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

    exit_price = None
    exit_reason = None
    exit_idx = None

    for i in range(entry_idx + 1, len(candles_1m)):
        h = float(candles_1m.iloc[i]["high"])
        l = float(candles_1m.iloc[i]["low"])
        c = float(candles_1m.iloc[i]["close"])

        if side == "BUY":
            if l <= sl_price:
                exit_price = sl_price
                exit_reason = "SL"
                exit_idx = i
                break
            if h >= tp_price:
                exit_price = tp_price
                exit_reason = "TP"
                exit_idx = i
                break
        else:
            if h >= sl_price:
                exit_price = sl_price
                exit_reason = "SL"
                exit_idx = i
                break
            if l <= tp_price:
                exit_price = tp_price
                exit_reason = "TP"
                exit_idx = i
                break

    if exit_idx is None:
        exit_price = float(candles_1m.iloc[-1]["close"])
        exit_reason = "EOD"
        exit_idx = len(candles_1m) - 1

    entry_time = candles_1m.iloc[entry_idx].name
    exit_time = candles_1m.iloc[exit_idx].name
    entry_time_str = entry_time.strftime("%H:%M") if hasattr(entry_time, "strftime") else str(entry_time)
    exit_time_str = exit_time.strftime("%H:%M") if hasattr(exit_time, "strftime") else str(exit_time)

    hold_minutes = exit_idx - entry_idx
    pnl_pct = ((exit_price - entry_price) / entry_price * 100) if side == "BUY" else ((entry_price - exit_price) / entry_price * 100)
    pnl = pnl_pct / 100 * entry_price

    return {
        "entry_time": entry_time_str,
        "exit_time": exit_time_str,
        "hold_minutes": hold_minutes,
        "exit_price": exit_price,
        "exit_reason": exit_reason,
        "mfe_pct": round(mfe_pct, 2),
        "mae_pct": round(mae_pct, 2),
        "pnl_pct": round(pnl_pct, 2),
        "pnl": round(pnl, 2),
    }


def main():
    console.print(Panel(
        f"[bold cyan]SR Breakout SL/TP Optimization[/bold cyan]\n"
        f"Date: {TRADE_DATE} | Symbols: {len(SYMBOLS)}\n"
        f"SL options: {SL_OPTIONS}\n"
        f"TP options: {TP_OPTIONS}\n"
        f"Entry: live 1-min close (fixed method)",
        border_style="cyan",
    ))

    api = get_upstox_api()

    symbol_data = {}
    for i, symbol in enumerate(SYMBOLS):
        console.print(f"[dim]Fetching {symbol} ({i+1}/{len(SYMBOLS)})...[/dim]", end=" ")
        time.sleep(0.3)

        daily_df = fetch_daily_data(api, symbol)
        if daily_df is None or daily_df.empty or len(daily_df) < 2:
            console.print("[red]skip[/red]")
            continue

        prev_row = daily_df.iloc[-2]
        prev_high = float(prev_row["high"])
        prev_low = float(prev_row["low"])
        prev_close = float(prev_row["close"])

        gen = SRBreakoutSignalGenerator({"sl_pct": 1.0, "tp_pct": 3.0, "pivot_type": "classic", "breakout_buffer_pct": BUFFER_PCT})
        pivot_points = gen.calculate_pivot_points(prev_high, prev_low, prev_close)
        r1 = pivot_points["R1"]
        s1 = pivot_points["S1"]

        intraday_df = fetch_1min_data(api, symbol)
        if intraday_df is None or intraday_df.empty:
            console.print("[red]skip[/red]")
            continue

        buf = BUFFER_PCT / 100
        entry_price = None
        side = None

        for idx, (ts, row) in enumerate(intraday_df.iterrows()):
            c = float(row["close"])
            h = float(row["high"])
            l = float(row["low"])
            if c > r1 * (1 + buf):
                entry_price = c
                side = "BUY"
                break
            if l < s1 * (1 - buf):
                entry_price = c
                side = "SELL"
                break

        if entry_price is None:
            console.print("[dim]no breakout[/dim]")
            continue

        symbol_data[symbol] = {
            "intraday_df": intraday_df,
            "entry_price": entry_price,
            "side": side,
            "r1": r1,
        }
        console.print(f"[green]{side} @ {entry_price:.2f}[/green]")

    console.print(f"\n[bold]Breakout signals found: {len(symbol_data)} symbols[/bold]\n")

    results = {}

    for sl_pct, tp_pct in product(SL_OPTIONS, TP_OPTIONS):
        key = (sl_pct, tp_pct)
        trades = []

        for symbol, data in symbol_data.items():
            side = data["side"]
            entry_price = data["entry_price"]

            if side == "BUY":
                sl_price = round(entry_price * (1 - sl_pct / 100), 2)
                tp_price = round(entry_price * (1 + tp_pct / 100), 2)
            else:
                sl_price = round(entry_price * (1 + sl_pct / 100), 2)
                tp_price = round(entry_price * (1 - tp_pct / 100), 2)

            sim = simulate(symbol, data["intraday_df"], entry_price, sl_price, tp_price, side)
            if sim is None:
                continue

            trades.append({
                "symbol": symbol,
                "side": side,
                "entry_price": entry_price,
                "sl_price": sl_price,
                "tp_price": tp_price,
                **sim,
            })

        tp_trades = [t for t in trades if t["exit_reason"] == "TP"]
        sl_trades = [t for t in trades if t["exit_reason"] == "SL"]
        eod_trades = [t for t in trades if t["exit_reason"] == "EOD"]

        total_pnl = sum(t["pnl"] for t in trades)
        win_rate = len(tp_trades) / len(trades) * 100 if trades else 0
        avg_win = sum(t["pnl"] for t in tp_trades) / len(tp_trades) if tp_trades else 0
        avg_loss = sum(t["pnl"] for t in sl_trades) / len(sl_trades) if sl_trades else 0
        profit_factor = abs(sum(t["pnl"] for t in tp_trades) / sum(t["pnl"] for t in sl_trades)) if sl_trades and sum(t["pnl"] for t in sl_trades) != 0 else float("inf")
        avg_hold = sum(t["hold_minutes"] for t in tp_trades) / len(tp_trades) if tp_trades else 0
        avg_mfe = sum(t["mfe_pct"] for t in tp_trades) / len(tp_trades) if tp_trades else 0
        avg_left = sum(max(0, t["mfe_pct"] - tp_pct) for t in tp_trades) / len(tp_trades) if tp_trades else 0

        results[key] = {
            "trades": trades,
            "total": len(trades),
            "wins": len(tp_trades),
            "losses": len(sl_trades),
            "eod": len(eod_trades),
            "win_rate": win_rate,
            "total_pnl": total_pnl,
            "avg_win": avg_win,
            "avg_loss": avg_loss,
            "profit_factor": profit_factor,
            "avg_hold": avg_hold,
            "avg_mfe": avg_mfe,
            "avg_left": avg_left,
        }

    ranked = sorted(results.items(), key=lambda x: x[1]["total_pnl"], reverse=True)

    table = Table(title="SL/TP Combination Results (ranked by total P&L)", show_lines=True)
    table.add_column("SL%", justify="center", width=5)
    table.add_column("TP%", justify="center", width=5)
    table.add_column("RR", justify="center", width=5)
    table.add_column("Trades", justify="center", width=6)
    table.add_column("W", style="green", justify="center", width=3)
    table.add_column("L", style="red", justify="center", width=3)
    table.add_column("EOD", style="dim", justify="center", width=4)
    table.add_column("Win%", justify="center", width=6)
    table.add_column("Total P&L", justify="right", width=10)
    table.add_column("Avg Win", justify="right", width=9)
    table.add_column("Avg Loss", justify="right", width=9)
    table.add_column("PF", justify="center", width=5)
    table.add_column("Avg Hold", justify="center", width=8)
    table.add_column("Left%", justify="center", width=7)

    for i, ((sl, tp), r) in enumerate(ranked):
        rr = tp / sl
        pnl_style = "green" if r["total_pnl"] > 0 else "red"
        is_best = i == 0

        prefix = "[bold]" if is_best else ""
        suffix = "[/bold]" if is_best else ""

        pf_str = f"{r['profit_factor']:.1f}" if r['profit_factor'] != float("inf") else "inf"

        table.add_row(
            f"{prefix}{sl}{suffix}",
            f"{prefix}{tp}{suffix}",
            f"{rr:.1f}",
            f"{prefix}{r['total']}{suffix}",
            f"{r['wins']}",
            f"{r['losses']}",
            f"{r['eod']}",
            f"{r['win_rate']:.0f}",
            f"[{pnl_style}]{prefix}{r['total_pnl']:+.0f}[/{pnl_style}]{suffix}",
            f"{r['avg_win']:+.0f}",
            f"{r['avg_loss']:+.0f}",
            pf_str,
            f"{r['avg_hold']:.0f}m",
            f"{r['avg_left']:.2f}",
        )

    console.print(table)

    best_sl, best_tp = ranked[0][0]
    best = ranked[0][1]

    console.print()
    console.print(Panel(
        f"[bold green]Best: SL={best_sl}% TP={best_tp}% (RR={best_tp/best_sl:.1f})[/bold green]\n\n"
        f"Trades: {best['total']} | Wins: {best['wins']} | Losses: {best['losses']} | EOD: {best['eod']}\n"
        f"Win rate: {best['win_rate']:.0f}%\n"
        f"Total P&L: {best['total_pnl']:+.0f}\n"
        f"Avg win: {best['avg_win']:+.0f} | Avg loss: {best['avg_loss']:+.0f}\n"
        f"Profit factor: {best['profit_factor']:.1f}\n"
        f"Avg hold (wins): {best['avg_hold']:.0f}m\n"
        f"Avg left on table: {best['avg_left']:.2f}%",
        border_style="green",
    ))

    console.print()
    detail_table = Table(title=f"Trade-by-Trade for Best Config (SL={best_sl}%, TP={best_tp}%)", show_lines=True)
    detail_table.add_column("Symbol", style="cyan", width=12)
    detail_table.add_column("Side", width=4)
    detail_table.add_column("Entry", justify="right", width=9)
    detail_table.add_column("Entry Time", width=9)
    detail_table.add_column("SL", justify="right", width=9)
    detail_table.add_column("TP", justify="right", width=9)
    detail_table.add_column("Exit", justify="right", width=9)
    detail_table.add_column("Exit Time", width=9)
    detail_table.add_column("Hold", justify="right", width=5)
    detail_table.add_column("P&L", justify="right", width=8)
    detail_table.add_column("MFE%", justify="right", width=7)

    for t in best["trades"]:
        exit_style = "green" if t["exit_reason"] == "TP" else "red" if t["exit_reason"] == "SL" else "dim"
        pnl_style = "green" if t["pnl"] > 0 else "red"
        detail_table.add_row(
            t["symbol"],
            t["side"],
            f"{t['entry_price']:.2f}",
            t["entry_time"],
            f"{t['sl_price']:.2f}",
            f"{t['tp_price']:.2f}",
            f"[{exit_style}]{t['exit_price']:.2f}[/{exit_style}]",
            t["exit_time"],
            f"{t['hold_minutes']}m",
            f"[{pnl_style}]{t['pnl']:+.0f}[/{pnl_style}]",
            f"{t['mfe_pct']:.2f}",
        )

    console.print(detail_table)


if __name__ == "__main__":
    main()
