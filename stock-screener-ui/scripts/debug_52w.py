#!/usr/bin/env python3
"""Debug 52-week high data for a symbol.

Usage:
    python scripts/debug_52w.py TATACOMM
    python scripts/debug_52w.py TATACOMM --date 2026-05-22
"""

import argparse
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv()

from rich.console import Console
from rich.table import Table
from rich.panel import Panel

from trading.week52_utils import calculate_52w_high

console = Console()


def fetch_daily_data(api, symbol: str, date_str: str | None = None):
    if date_str:
        to_date = date_str
        from_date = (datetime.strptime(date_str, "%Y-%m-%d") - timedelta(days=400)).strftime("%Y-%m-%d")
    else:
        to_date = datetime.now().strftime("%Y-%m-%d")
        from_date = (datetime.now() - timedelta(days=400)).strftime("%Y-%m-%d")

    df = api.fetch_historical_data_v3(
        symbol=symbol, unit="days", interval=1,
        to_date=to_date, from_date=from_date,
    )
    if df is None or df.empty:
        return None

    closes = df["close"].tolist()
    highs = df["high"].tolist()
    lows = df["low"].tolist()
    volumes = df["volume"].tolist() if "volume" in df.columns else []

    high_52w = calculate_52w_high(highs, period=252, exclude_current=True) or 0.0

    days_since_52w_high = 0
    if high_52w > 0 and len(highs) >= 2:
        past_highs = highs[:-1]
        window = past_highs[-252:] if len(past_highs) >= 252 else past_highs
        if len(window) >= 2:
            reversed_window = list(reversed(window))
            try:
                days_since_52w_high = reversed_window.index(high_52w)
            except ValueError:
                pass

    avg_volume_20d = 0.0
    if len(volumes) >= 20:
        avg_volume_20d = sum(volumes[-20:]) / 20

    ma50 = 0.0
    ma200 = 0.0
    if len(closes) >= 50:
        ma50 = sum(closes[-50:]) / 50
    if len(closes) >= 200:
        ma200 = sum(closes[-200:]) / 200

    current_price = closes[-1]
    try:
        intraday = api.fetch_intraday_data_v3(symbol=symbol, interval="1")
    except Exception:
        intraday = None

    if intraday is not None and not intraday.empty:
        current_price = float(intraday["close"].iloc[-1])

    return {
        "current_price": current_price,
        "high_52w": high_52w,
        "days_since_52w_high": days_since_52w_high,
        "daily_highs": highs,
        "daily_closes": closes,
        "daily_lows": lows,
        "volume": volumes[-1] if volumes else 0,
        "avg_volume_20d": avg_volume_20d,
        "ma50": ma50,
        "ma200": ma200,
        "prev_high": highs[-2] if len(highs) >= 2 else highs[-1],
        "prev_low": lows[-2] if len(lows) >= 2 else lows[-1],
        "prev_close": closes[-2] if len(closes) >= 2 else closes[-1],
        "df_length": len(df),
    }


def check_52w_chaser(md: dict) -> dict:
    from trading.week52_chaser_signals import Week52ChaserSignalGenerator
    gen = Week52ChaserSignalGenerator({})
    cp = md["current_price"]
    h52 = md["high_52w"]
    pct_above = ((cp - h52) / h52) * 100 if h52 > 0 else 0
    in_range = gen.min_breakout_pct <= pct_above <= gen.entry_threshold_pct
    return {
        "would_enter": bool(in_range),
        "pct_above": round(pct_above, 2),
        "min_breakout_pct": gen.min_breakout_pct,
        "entry_threshold_pct": gen.entry_threshold_pct,
        "sl_pct": gen.sl_pct,
        "tp_pct": gen.tp_pct,
    }


def check_52w_target(md: dict) -> dict:
    from trading.week52_target_signals import Week52TargetSignalGenerator
    gen = Week52TargetSignalGenerator({})
    cp = md["current_price"]
    h52 = md["high_52w"]
    days_since = md["days_since_52w_high"]
    below_high = cp < h52 if h52 else False
    entry_threshold = h52 * (1 - gen.entry_threshold_pct / 100) if h52 else 0
    within = cp >= entry_threshold if h52 else False
    cooldown_ok = days_since >= gen.recent_touch_days
    return {
        "would_enter": bool(below_high and within and cooldown_ok),
        "below_high": below_high,
        "within_threshold": within,
        "entry_threshold_price": round(entry_threshold, 2) if h52 else 0,
        "days_since": days_since,
        "min_days": gen.recent_touch_days,
        "sl_pct": gen.sl_pct,
    }


def check_blind_52w(md: dict) -> dict:
    from trading.blind_52w_signals import Blind52WSignalGenerator
    gen = Blind52WSignalGenerator({})
    cp = md["current_price"]
    h52 = md["high_52w"]
    days_since = md["days_since_52w_high"]
    below_high = cp < h52 if h52 else False
    pct_from = (h52 - cp) / h52 * 100 if h52 > 0 else 0
    near_enough = pct_from <= gen.near_high_threshold_pct
    cooldown_ok = days_since >= gen.min_days_since_52w_high
    return {
        "would_enter": bool(below_high and near_enough and cooldown_ok),
        "below_high": below_high,
        "pct_from_high": round(pct_from, 2),
        "near_high_threshold_pct": gen.near_high_threshold_pct,
        "days_since": days_since,
        "min_days_since": gen.min_days_since_52w_high,
        "sl_pct": gen.sl_pct,
    }


def main():
    parser = argparse.ArgumentParser(description="Debug 52-week high data for a symbol")
    parser.add_argument("symbol", help="Stock symbol (e.g., TATACOMM)")
    parser.add_argument("--date", "-d", help="Date (YYYY-MM-DD) - default: today")
    args = parser.parse_args()

    symbol = args.symbol.upper()
    date_str = args.date

    from upstox_trader.config_and_utils.upstox_api import UpstoxAPI
    import config as app_config

    api_key = app_config.UPSTOX_API_KEY
    api_secret = app_config.UPSTOX_API_SECRET
    if not api_key or not api_secret:
        console.print("[red]UPSTOX_API_KEY and UPSTOX_API_SECRET must be set[/red]")
        sys.exit(1)

    api = UpstoxAPI(api_key=api_key, api_secret=api_secret, quiet=True)

    console.print(f"[bold]Fetching data for {symbol}...[/bold]")
    md = fetch_daily_data(api, symbol, date_str)
    if md is None:
        console.print("[red]No daily data returned[/red]")
        sys.exit(1)

    cp = md["current_price"]
    h52 = md["high_52w"]
    days_since = md["days_since_52w_high"]
    pct_from = ((h52 - cp) / cp) * 100 if cp > 0 else 0

    # --- Overview ---
    overview = Table.grid(padding=(0, 2))
    overview.add_row("[bold]Symbol[/bold]", symbol)
    overview.add_row("[bold]Date[/bold]", date_str or datetime.now().strftime("%Y-%m-%d"))
    overview.add_row(f"[bold]Current Price[/bold]", f"₹{cp:,.2f}")
    overview.add_row(f"[bold]52W High[/bold]", f"₹{h52:,.2f}" if h52 > 0 else "N/A")
    overview.add_row(f"[bold]% from 52W High[/bold]", f"[red]{pct_from:+.2f}%[/red]" if pct_from < 0 else f"[green]{pct_from:+.2f}%[/green]")
    overview.add_row(f"[bold]Days since 52W High[/bold]", f"{days_since}")
    overview.add_row(f"[bold]Total daily bars[/bold]", f'{md["df_length"]}')
    overview.add_row(f"[bold]MA50 / MA200[/bold]", f"₹{md['ma50']:,.0f} / ₹{md['ma200']:,.0f}")
    overview.add_row(f"[bold]Volume / Avg20[/bold]", f"{md['volume']:,.0f} / {md['avg_volume_20d']:,.0f}")
    console.print(Panel(overview, title="52W High Overview"))

    # --- Recent 52W touches ---
    touches = []
    threshold_52w = 0.99 * h52
    if h52 > 0:
        for i in range(len(md["daily_highs"]) - 1, -1, -1):
            if len(touches) >= 10:
                break
            h = md["daily_highs"][i]
            if h >= threshold_52w:
                dist_pct = ((h - h52) / h52) * 100
                label = ""
                if abs(dist_pct) < 0.01:
                    label = " (52W high)"
                touches.append(f"  ₹{h:>10,.2f}  {dist_pct:+7.2f}%{label}")
    if touches:
        console.print(Panel("\n".join(touches), title="Recent 52W touches (last 10)"))

    # --- Strategy checks ---
    chaser = check_52w_chaser(md)
    target = check_52w_target(md)
    blind = check_blind_52w(md)

    strat_table = Table(title="Strategy Checks")
    strat_table.add_column("Strategy", style="bold")
    strat_table.add_column("Entry?", style="bold")
    strat_table.add_column("Details")

    chaser_label = "[green]YES[/green]" if chaser["would_enter"] else "[red]NO[/red]"
    chaser_detail = (
        f"price {chaser['pct_above']:+.2f}% above 52W high "
        f"(need {chaser['min_breakout_pct']}-{chaser['entry_threshold_pct']}%)"
    )
    strat_table.add_row("52W CHASER", chaser_label, chaser_detail)

    target_label = "[green]YES[/green]" if target["would_enter"] else "[red]NO[/red]"
    target_detail = (
        f"{'below' if target['below_high'] else 'above'} high, "
        f"{'within' if target['within_threshold'] else 'outside'} {target['entry_threshold_price']} threshold, "
        f"days since: {target['days_since']}/{target['min_days']}"
    )
    strat_table.add_row("52W TARGET", target_label, target_detail)

    blind_label = "[green]YES[/green]" if blind["would_enter"] else "[red]NO[/red]"
    blind_detail = (
        f"{'below' if blind['below_high'] else 'at/above'} 52W high, "
        f"{blind['pct_from_high']:.2f}% from high (thresh {blind['near_high_threshold_pct']}%), "
        f"days since: {blind['days_since']}/{blind['min_days_since']}"
    )
    strat_table.add_row("BLIND 52W", blind_label, blind_detail)

    console.print(strat_table)

    # --- Raw market data ---
    raw = {k: v for k, v in md.items() if k not in ("daily_highs", "daily_closes", "daily_lows")}
    console.print(Panel(str(raw), title="Raw Market Data"))


if __name__ == "__main__":
    main()
