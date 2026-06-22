#!/usr/bin/env python3
"""Fetch top 10 stocks per sector → run ORB benchmark → report."""
import os, sys, pickle, time, json
from datetime import datetime, timedelta, timezone

import pandas as pd
import numpy as np
import yfinance as yf
from tradingview_screener import Query

CACHE_DIR = os.environ.get("CACHE_DIR", "../experiments/data")
SECTOR_CACHE = os.path.join(CACHE_DIR, "sector_scan_cache.pkl")
ORB_CACHE_FILE = os.path.join(CACHE_DIR, "sector_orb_cache.pkl")
IST = timezone(timedelta(hours=5, minutes=30))

ORB_PARAMS = {
    "OR_MIN": 45, "SL": 1.2, "TP": 2.0, "BUFFER": 0.62,
    "COOLDOWN": 50, "SHORTS": 0, "TRADE_SIZE": 100,
    "MIN_ENTRY": 0, "MAX_PER_DAY": 0, "EOD_EXIT": 900,
}

###############################################################################
# Step 1 — Get sectors + top 10 stocks per sector
###############################################################################
def get_sector_stocks(max_per_sector=10, max_sectors=20):
    print("Getting sectors from TradingView...", file=sys.stderr)
    q = Query().set_markets("india").select(
        "name", "close", "sector", "Perf.YTD", "market_cap_basic"
    ).limit(5000)
    n, df = q.get_scanner_data()
    df = df.dropna(subset=["sector", "name"])
    
    sectors = {}
    for sector in df["sector"].unique()[:max_sectors]:
        stocks = (
            df[df["sector"] == sector]
            .sort_values("market_cap_basic", ascending=False)
            .head(max_per_sector)
        )
        sectors[sector] = stocks["name"].tolist()
        print(f"  {sector:<28} → {len(stocks)} stocks: {', '.join(stocks['name'].tolist()[:3])}...", file=sys.stderr)
    
    return sectors, df

###############################################################################
# Step 2 — Fetch 5-min data via yfinance
###############################################################################
def normalize_symbol(name):
    """Convert TV screener name to yfinance ticker."""
    s = name.replace("_", "-").replace("&", "")
    return s

def fetch_yfinance_5min(symbol, lookback_days=55):
    """Fetch 5-min data using explicit date range (max 59 days for 5-min)."""
    try:
        end_dt = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0)
        start_dt = end_dt - timedelta(days=lookback_days)
        s = start_dt.strftime("%Y-%m-%d")
        e = end_dt.strftime("%Y-%m-%d")
        sym = normalize_symbol(symbol)
        ticker = yf.Ticker(f"{sym}.NS")
        df = ticker.history(start=s, end=e, interval="5m")
        if df.empty:
            ticker = yf.Ticker(sym)
            df = ticker.history(start=s, end=e, interval="5m")
        if df.empty:
            return symbol, None
        if df.index.tz is None:
            df.index = df.index.tz_localize("Asia/Kolkata")
        else:
            df.index = df.index.tz_convert("Asia/Kolkata")
        return symbol, df
    except Exception:
        return symbol, None

def fetch_all_stocks(sectors, max_workers=1):
    """Fetch cached or fresh data for all sector stocks."""
    if os.path.exists(SECTOR_CACHE):
        print(f"Loading cached sector data: {SECTOR_CACHE}", file=sys.stderr)
        with open(SECTOR_CACHE, "rb") as f:
            return pickle.load(f)
    
    all_symbols = set()
    for stocks in sectors.values():
        all_symbols.update(stocks)
    all_symbols = sorted(all_symbols)
    print(f"\nSerial-fetching {len(all_symbols)} stocks via yfinance (delay=1s)...", file=sys.stderr)
    
    results = {}
    for i, sym in enumerate(all_symbols):
        sym2, df = fetch_yfinance_5min(sym)
        if df is not None:
            results[sym2] = df
        if (i + 1) % 50 == 0:
            print(f"  Progress: {i+1}/{len(all_symbols)} ({len(results)} succeeded)", file=sys.stderr)
            # Save intermediate
            os.makedirs(CACHE_DIR, exist_ok=True)
            with open(SECTOR_CACHE, "wb") as f:
                pickle.dump(results, f)
        time.sleep(0.5)
    
    print(f"  Done: {len(results)}/{len(all_symbols)} stocks fetched successfully", file=sys.stderr)
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(SECTOR_CACHE, "wb") as f:
        pickle.dump(results, f)
    print(f"  Cached to {SECTOR_CACHE}", file=sys.stderr)
    return results

###############################################################################
# Step 3 — Run ORB simulation
###############################################################################
def simulate_orb(df: pd.DataFrame, params: dict) -> dict:
    """Simplified ORB simulator — returns metrics dict."""
    or_min = params["OR_MIN"]
    sl_pct = params["SL"] / 100.0
    tp_pct = params["TP"] / 100.0
    buffer_pct = params["BUFFER"] / 100.0
    cooldown = params["COOLDOWN"]
    enable_shorts = params["SHORTS"]
    trade_size = params["TRADE_SIZE"]
    eod_exit_min = params["EOD_EXIT"]
    
    if df.empty or len(df) < 20:
        return {"pf": 0, "wr": 0, "net_pnl": 0, "trades": 0}
    
    # Filter market hours (9:15-15:30 IST)
    market_open = 9*60 + 15
    market_close = 15*60 + 30
    
    # Date grouping
    df = df.copy()
    df["date"] = df.index.date
    df["minute"] = df.index.hour * 60 + df.index.minute
    
    trades = []
    cooldown_until = {}
    
    for date, day_df in df.groupby("date"):
        day_df = day_df.sort_index()
        # OR formation: first `or_min` minutes after 9:15
        or_end = market_open + or_min
        or_mask = (day_df["minute"] >= market_open) & (day_df["minute"] < or_end)
        or_slice = day_df[or_mask]
        if or_slice.empty:
            continue
        or_high = or_slice["High"].max()
        or_low = or_slice["Low"].min()
        or_range = or_high - or_low
        if or_range == 0:
            continue
        
        # Rest of day
        post_mask = (day_df["minute"] >= or_end) & (day_df["minute"] < eod_exit_min)
        post_day = day_df[post_mask]
        if post_day.empty:
            continue
        
        long_entry = or_high * (1 + buffer_pct)
        short_entry = or_low * (1 - buffer_pct)
        
        for idx, row in post_day.iterrows():
            sym = str(date)
            if sym in cooldown_until and idx < cooldown_until[sym]:
                continue
            
            o, h, l, c = row["Open"], row["High"], row["Low"], row["Close"]
            
            # Long entry: close-based (matches ORBSignalGenerator.check_breakout)
            if c > long_entry:
                entry_price = c
                sl = entry_price * (1 - sl_pct)
                tp = entry_price * (1 + tp_pct)
                
                # Check SL/TP within entry candle, then forward-scan rest of day
                exit_price = c
                exit_reason = "EOD"
                if l <= sl:
                    exit_price = sl
                    exit_reason = "SL"
                elif h >= tp:
                    exit_price = tp
                    exit_reason = "TP"
                else:
                    rest = post_day.loc[post_day.index > idx]
                    for _, r2 in rest.iterrows():
                        exit_price = r2["Close"]
                        if r2["Low"] <= sl:
                            exit_price = sl
                            exit_reason = "SL"
                            break
                        if r2["High"] >= tp:
                            exit_price = tp
                            exit_reason = "TP"
                            break
                pnl = (exit_price - entry_price) / entry_price * trade_size * entry_price
                trades.append({
                    "pnl": pnl, "reason": exit_reason, "direction": "LONG",
                    "entry": entry_price, "exit": exit_price
                })
                cooldown_until[sym] = idx + pd.Timedelta(minutes=cooldown)
                continue
            
            # Short entry: close-based
            if enable_shorts and c < short_entry:
                entry_price = c
                sl = entry_price * (1 + sl_pct)
                tp = entry_price * (1 - tp_pct)
                
                exit_price = c
                exit_reason = "EOD"
                if h >= sl:
                    exit_price = sl
                    exit_reason = "SL"
                elif l <= tp:
                    exit_price = tp
                    exit_reason = "TP"
                else:
                    rest = post_day.loc[post_day.index > idx]
                    for _, r2 in rest.iterrows():
                        exit_price = r2["Close"]
                        if r2["High"] >= sl:
                            exit_price = sl
                            exit_reason = "SL"
                            break
                        if r2["Low"] <= tp:
                            exit_price = tp
                            exit_reason = "TP"
                            break
                pnl = (entry_price - exit_price) / entry_price * trade_size * entry_price
                trades.append({
                    "pnl": pnl, "reason": exit_reason, "direction": "SHORT",
                    "entry": entry_price, "exit": exit_price
                })
                cooldown_until[sym] = idx + pd.Timedelta(minutes=cooldown)
    
    if not trades:
        return {"pf": 0, "wr": 0, "net_pnl": 0, "trades": 0}
    
    gross_profit = sum(t["pnl"] for t in trades if t["pnl"] > 0)
    gross_loss = abs(sum(t["pnl"] for t in trades if t["pnl"] < 0))
    net_pnl = sum(t["pnl"] for t in trades)
    wins = sum(1 for t in trades if t["pnl"] > 0)
    pf = gross_profit / gross_loss if gross_loss > 0 else (gross_profit if gross_profit > 0 else 0)
    wr = wins / len(trades) * 100
    
    return {
        "pf": round(pf, 4),
        "wr": round(wr, 1),
        "net_pnl": round(net_pnl, 2),
        "trades": len(trades),
        "tp_exits": sum(1 for t in trades if t["reason"] == "TP"),
        "sl_exits": sum(1 for t in trades if t["reason"] == "SL"),
        "eod_exits": sum(1 for t in trades if t["reason"] == "EOD"),
    }

def run_sector_orb(sectors, data):
    """Run ORB per sector — aggregate each sector's stocks."""
    results = {}
    for sector, stocks in sectors.items():
        sector_dfs = {s: data[s] for s in stocks if s in data}
        if not sector_dfs:
            continue
        
        sector_trades = []
        sector_pfs = []
        stock_results = []
        
        for sym, df in sector_dfs.items():
            m = simulate_orb(df, ORB_PARAMS)
            stock_results.append((sym, m))
            sector_pfs.append(m["pf"])
        
        # Aggregate: combined portfolio (run on all stocks together)
        combined_df = None
        for sym, df in sector_dfs.items():
            df2 = df.copy()
            df2["_symbol"] = sym
            if combined_df is None:
                combined_df = df2
            else:
                combined_df = pd.concat([combined_df, df2])
        
        if combined_df is not None:
            port = simulate_orb(combined_df, ORB_PARAMS)
        else:
            port = {"pf": 0, "wr": 0, "net_pnl": 0, "trades": 0}
        
        profitable = sum(1 for _, m in stock_results if m["pf"] >= 1.0)
        results[sector] = {
            "stocks": len(sector_dfs),
            "profitable": profitable,
            "portfolio": port,
            "stock_results": stock_results,
        }
        pf_str = f"{port['pf']:.2f}" if port["pf"] > 0 else "0.00"
        print(f"  {sector:<28} → PF={pf_str:>6}  WR={port['wr']:.0f}%  Trades={port['trades']:<4}  {profitable}/{len(sector_dfs)} stocks OK", file=sys.stderr)
    
    return results

###############################################################################
# Main
###############################################################################
def main():
    start = time.time()
    print("=" * 74, file=sys.stderr)
    print("SECTOR ORB SCAN", file=sys.stderr)
    print(f"Params: OR_MIN={ORB_PARAMS['OR_MIN']} SL={ORB_PARAMS['SL']}% TP={ORB_PARAMS['TP']}% buf={ORB_PARAMS['BUFFER']}% CD={ORB_PARAMS['COOLDOWN']}", file=sys.stderr)
    print("=" * 74, file=sys.stderr)
    
    sectors, all_df = get_sector_stocks(max_per_sector=10)
    print(f"\nSectors found: {len(sectors)}", file=sys.stderr)
    
    data = fetch_all_stocks(sectors, max_workers=10)
    print(f"\nData available: {len(data)} stocks", file=sys.stderr)
    
    print(f"\nRunning ORB per sector...", file=sys.stderr)
    results = run_sector_orb(sectors, data)
    
    # Print report
    elapsed = time.time() - start
    print("\n" + "=" * 74)
    print("SECTOR ORB RESULTS")
    print(f"Params: OR_MIN=45 SL=1.2% TP=2.0% buf=0.62% CD=50 EOD=15:00")
    print(f"Data: yfinance 5-min ~60 days")
    print("=" * 74)
    print(f"\n{'Sector':<30} {'PF':<9} {'WR%':<6} {'Trades':<7} {'Net P&L':<14} {'Stk OK':<7}")
    print("-" * 74)
    
    total_pf = 0
    total_pnl = 0
    total_stocks = 0
    total_profitable = 0
    sorted_sectors = sorted(results.items(), key=lambda x: x[1]["portfolio"]["pf"], reverse=True)
    
    for sector, r in sorted_sectors:
        p = r["portfolio"]
        total_pf += p["pf"]
        total_pnl += p["net_pnl"]
        total_stocks += r["stocks"]
        total_profitable += r["profitable"]
        arrow = "✅" if p["pf"] >= 1.0 else "❌"
        print(f"{arrow} {sector:<28} {p['pf']:<9.4f} {p['wr']:<6.1f} {p['trades']:<7} Rs {p['net_pnl']:>10,.2f} {r['profitable']}/{r['stocks']}")
    
    print("-" * 74)
    avg_pf = total_pf / len(results) if results else 0
    print(f"{'OVERALL':<30} {avg_pf:<9.4f} ({total_profitable}/{total_stocks} profitable stocks)")
    print(f"\nTime: {elapsed:.0f}s")
    
    # Save detailed JSON
    report = {}
    for sector, r in sorted_sectors:
        stocks_detail = [
            {"sym": s, "pf": m["pf"], "wr": m["wr"], "net_pnl": m["net_pnl"], "trades": m["trades"]}
            for s, m in r["stock_results"]
        ]
        stocks_detail.sort(key=lambda x: x["pf"], reverse=True)
        report[sector] = {
            "portfolio_pf": r["portfolio"]["pf"],
            "portfolio_wr": r["portfolio"]["wr"],
            "portfolio_net_pnl": r["portfolio"]["net_pnl"],
            "portfolio_trades": r["portfolio"]["trades"],
            "profitable_stocks": r["profitable"],
            "total_stocks": r["stocks"],
            "stocks": stocks_detail,
        }
    
    report_path = os.path.join(CACHE_DIR, "sector_scan_report.json")
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"Report saved to {report_path}", file=sys.stderr)
    print(f"Cached data at {SECTOR_CACHE}", file=sys.stderr)

if __name__ == "__main__":
    main()
