"""Covered-call retro: "what if we sold a call last week?"

Data sources
  * spot  : FYERS (`NSE:<SYM>-EQ`) when a token is available, else yfinance (<SYM>.NS)
  * premium: REAL FYERS option premium when the contract is cached / fetchable,
             else Black-Scholes (IV = realised_vol × vrp_mult). Every modeled number
             is labelled MODEL.

Usage
  # now (no token): yfinance spot + modeled premium
  .venv/bin/python stock_cc_retro.py --symbols RELIANCE TMPV --entry 2026-09-21 --exit 2026-09-24
  # with token: real spot + real premium (fetches & caches stock option contracts)
  .venv/bin/python stock_cc_retro.py --symbols RELIANCE TMPV --entry 2026-09-21 --exit 2026-09-24 --fyers
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pricing  # noqa: E402
import costs  # noqa: E402

OUT = Path(__file__).resolve().parent / "stock_cc"
OUT.mkdir(exist_ok=True)

# spot tickers + NSE F&O contract metadata (step = strike spacing, lot = NSE F&O lot)
UNIVERSE = {
    "RELIANCE":   {"yf": "RELIANCE.NS",   "fyers": "NSE:RELIANCE-EQ",   "step": 10, "lot": 500},
    "TMPV":       {"yf": "TMPV.NS",       "fyers": "NSE:TMPV-EQ",       "step": 5,  "lot": 1600},
    "TATAMOTORS": {"yf": "TMPV.NS",       "fyers": "NSE:TMPV-EQ",       "step": 5,  "lot": 1600,
                   "note": "post-demerger = TMPV (passenger vehicles)"},
    "TMLCV":      {"yf": "TMLCV.NS",      "fyers": "NSE:TMLCV-EQ",      "step": 10, "lot": 700},
    "TCS":        {"yf": "TCS.NS",        "fyers": "NSE:TCS-EQ",        "step": 20, "lot": 175},
    "INFY":       {"yf": "INFY.NS",       "fyers": "NSE:INFY-EQ",       "step": 10, "lot": 400},
    "HDFCBANK":   {"yf": "HDFCBANK.NS",   "fyers": "NSE:HDFCBANK-EQ",   "step": 10, "lot": 550},
    "ICICIBANK":  {"yf": "ICICIBANK.NS",  "fyers": "NSE:ICICIBANK-EQ",  "step": 10, "lot": 700},
    "SBIN":       {"yf": "SBIN.NS",       "fyers": "NSE:SBIN-EQ",       "step": 10, "lot": 750},
    "ITC":        {"yf": "ITC.NS",        "fyers": "NSE:ITC-EQ",        "step": 5,  "lot": 1600},
}


def yf_daily(sym, entry, exit_):
    import yfinance as yf
    start = (pd.Timestamp(entry) - pd.Timedelta(days=40)).strftime("%Y-%m-%d")
    end = (pd.Timestamp(exit_) + pd.Timedelta(days=5)).strftime("%Y-%m-%d")
    df = yf.Ticker(sym).history(start=start, end=end, interval="1d")
    df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
    return df


def yf_intraday(sym, entry, exit_):
    import yfinance as yf
    try:
        start = (pd.Timestamp(entry) - pd.Timedelta(days=2)).strftime("%Y-%m-%d")
        end = (pd.Timestamp(exit_) + pd.Timedelta(days=2)).strftime("%Y-%m-%d")
        df = yf.Ticker(sym).history(start=start, end=end, interval="5m")
        if len(df):
            df.index = pd.to_datetime(df.index).tz_convert("Asia/Kolkata")
        return df
    except Exception:
        return pd.DataFrame()


def realized_vol(df, window=20):
    r = np.log(df["Close"] / df["Close"].shift(1)).dropna()
    return float(r.tail(window).std() * math.sqrt(252))


def month_expiry_after(d):
    """Last Tuesday of the calendar month containing d (NSE F&O monthly now aligns to Tuesday)."""
    if d.month == 12:
        nxt = date(d.year + 1, 1, 1)
    else:
        nxt = date(d.year, d.month + 1, 1)
    x = nxt - timedelta(days=1)
    while x.weekday() != 1:   # Tuesday
        x -= timedelta(days=1)
    return x


def call_premium_model(S, K, T, iv, r=pricing.RISK_FREE):
    return pricing.bs_price(S, K, T, iv, "CE", r)


def _fyers_overrides(symbol, entry, exit_, daily):
    """Real FYERS spot + real chain IV when the token is valid; else fall back."""
    try:
        import fyers_stock_options as fso
        import fyers_data as fd
    except Exception:
        return None, daily, False
    if not fso.preflight(verbose=False):
        print("  [fyers] token invalid -> falling back to yfinance + modelled IV")
        return None, daily, False
    meta = UNIVERSE.get(symbol, {})
    fsym = meta.get("fyers")
    try:
        c = fd.FyersData(min_interval=0.5, verbose=False)
        frm = (pd.Timestamp(entry) - pd.Timedelta(days=60)).strftime("%Y-%m-%d")
        to = (pd.Timestamp(exit_) + pd.Timedelta(days=2)).strftime("%Y-%m-%d")
        df = fd.fetch_candles_cached(c, fsym, "D", frm, to)
        if len(df):
            df = df.set_index("ts")
            df.index = pd.to_datetime(df.index).tz_convert("Asia/Kolkata").tz_localize(None).normalize()
            daily = df.rename(columns={"open": "Open", "high": "High", "low": "Low",
                                       "close": "Close", "volume": "Volume"})[["Open", "High", "Low", "Close", "Volume"]]
    except Exception as e:
        print(f"  [fyers] spot fetch failed ({e}); keeping yfinance spot")
    iv = None
    try:
        iv = fso.atm_iv(symbol)
    except Exception as e:
        print(f"  [fyers] chain IV fetch failed ({e})")
    return iv, daily, True


def _fyers_real_premium(symbol, exp, K, opt, ts):
    """Real listed-contract close at ts (None if the contract is expired/unavailable)."""
    try:
        import fyers_data as fd
        sym = f"NSE:{symbol}{exp:%y}{fd._MONTH3[exp.month - 1]}{K}{opt}"
        c = fd.FyersData(min_interval=0.5, verbose=False)
        frm = (date(exp.year, exp.month, 1) - timedelta(days=45)).isoformat()
        df = fd.fetch_candles_cached(c, sym, "5", frm, date.today().isoformat())
        if df is None or df.empty:
            return None
        df = df.set_index("ts")
        idx = df.index[df.index <= ts]
        return float(df.loc[idx[-1], "close"]) if len(idx) else None
    except Exception:
        return None


def fyers_spot(sym):
    import fyers_data as fd
    c = fd.FyersData(min_interval=0.5, verbose=False)
    q = c.quotes([UNIVERSE[sym]["fyers"]])
    return q


def run(symbol, entry, exit_, vrp=1.15, offsets=(0.0, 0.01, 0.02, 0.03, 0.05),
        use_fyers=False, exec_half_spread=0.0035, exec_slip=0.0015):
    meta = UNIVERSE.get(symbol, {})
    ysym = meta.get("yf")
    if not ysym:
        return {"symbol": symbol, "error": "unknown symbol"}
    daily = yf_daily(ysym, entry, exit_)
    if daily.empty:
        return {"symbol": symbol, "error": f"no yfinance data for {ysym}"}
    iv_override = None
    prem_real = None
    if use_fyers:
        iv_override, daily, prem_real = _fyers_overrides(symbol, entry, exit_, daily)
    intra = yf_intraday(ysym, entry, exit_)
    entry_d = pd.Timestamp(entry).normalize()
    exit_d = pd.Timestamp(exit_).normalize()

    def px(day, col="Close"):
        if day in daily.index:
            return float(daily.loc[day, col])
        return None

    S0 = px(entry_d, "Open")
    S1 = px(exit_d, "Close")
    if S0 is None or S1 is None:
        # fall back to nearest available session
        idx = daily.index
        e = idx[idx <= entry_d][-1]
        x = idx[idx <= exit_d][-1]
        S0, S1 = float(daily.loc[e, "Open"]), float(daily.loc[x, "Close"])
        entry_d, exit_d = e, x

    iv = iv_override if iv_override else realized_vol(daily) * vrp
    exp = month_expiry_after(entry_d.date())
    T = max((exp - entry_d.date()).days, 1) / 365.0
    entry_ts = pd.Timestamp(entry_d).tz_localize("Asia/Kolkata") + pd.Timedelta(hours=9, minutes=30)
    exit_ts = pd.Timestamp(exit_d).tz_localize("Asia/Kolkata") + pd.Timedelta(hours=15, minutes=15)
    step = meta.get("step", 10)
    lot = meta.get("lot", 1)
    week = daily.loc[entry_d:exit_d]

    rows = []
    seen = set()
    for off in offsets:
        K = int(round(S0 * (1 + off) / step) * step)
        if K in seen:
            continue
        seen.add(K)
        prem = call_premium_model(S0, K, T, iv)
        prem_src = "MODEL"
        if use_fyers and prem_real:
            rp = _fyers_real_premium(symbol, exp, K, "CE", entry_ts)
            if rp and rp > 0:
                prem, prem_src = rp, "FYERS"
        # sell at bid (receive), buy back at ask
        sell_fill = prem * (1 - exec_half_spread - exec_slip)
        # if the expiry is still in the future we mark-to-market, else settle at intrinsic
        marking = exit_d.date() < exp
        if marking:
            mk = None
            if use_fyers and prem_real:
                mk = _fyers_real_premium(symbol, exp, K, "CE", exit_ts)
            if mk is None:
                mk = call_premium_model(S1, K, max((exp - exit_d.date()).days, 1) / 365.0, iv)
            buyback = mk * (1 + exec_half_spread + exec_slip)
        else:
            buyback = max(0.0, S1 - K) * (1 + exec_half_spread + exec_slip)
        stock_pl = S1 - S0
        call_pl = sell_fill - buyback
        net_pl = stock_pl + call_pl
        fees = costs.leg_costs(sell_fill, lot, "SELL") + costs.leg_costs(buyback, lot, "BUY")
        rows.append({
            "strike": K, "offset_pct": off, "premium_used": round(prem, 2), "prem_src": prem_src,
            "sell_fill": round(sell_fill, 2), "call_payoff": round(buyback, 2),
            "stock_pl": round(stock_pl, 2), "call_pl": round(call_pl, 2),
            "net_pl_per_share": round(net_pl, 2),
            "net_pl_pct": round(net_pl / S0 * 100, 2),
            "net_pl_per_lot": round(net_pl * lot - fees, 0),
            "expired_worthless": bool((not marking) and S1 <= K),
            "settled": not marking,
        })
    bh = S1 - S0
    return {
        "symbol": symbol, "yf": ysym, "entry": str(entry_d.date()), "exit": str(exit_d.date()),
        "spot_entry": round(S0, 2), "spot_exit": round(S1, 2),
        "week_high": round(float(week["High"].max()), 2), "week_low": round(float(week["Low"].min()), 2),
        "buy_hold_pl": round(bh, 2), "buy_hold_pct": round(bh / S0 * 100, 2),
        "realized_vol_ann": round(iv / vrp, 4), "iv_used": round(iv, 4), "vrp_mult": vrp,
        "expiry": str(exp), "days_to_expiry": (exp - entry_d.date()).days,
        "premium_mode": ("FYERS-real premium" if (use_fyers and any(r["prem_src"] == "FYERS" for r in rows))
                         else ("FYERS spot + modelled premium" if (use_fyers and prem_real)
                               else ("MODEL (BS) [FYERS token invalid]" if use_fyers else "MODEL (BS)"))),
        "call_rows": rows,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", nargs="+", default=["RELIANCE", "TMPV"])
    ap.add_argument("--entry", default="2026-09-21")
    ap.add_argument("--exit", default="2026-09-24")
    ap.add_argument("--vrp", type=float, default=1.15)
    ap.add_argument("--fyers", action="store_true", help="use FYERS spot/premiums (needs token)")
    args = ap.parse_args()

    out = {}
    for s in args.symbols:
        r = run(s, args.entry, args.exit, vrp=args.vrp, use_fyers=args.fyers)
        out[s] = r
        if "error" in r:
            print(f"{s}: {r['error']}")
            continue
        print(f"\n=== {s} ({r['yf']})  {r['entry']} -> {r['exit']} ===")
        print(f"  spot {r['spot_entry']} -> {r['spot_exit']}  (week {r['week_low']}..{r['week_high']})")
        print(f"  buy&hold {r['buy_hold_pct']:+.2f}%   realised vol {r['realized_vol_ann']*100:.1f}%  "
              f"IV used {r['iv_used']*100:.1f}%  expiry {r['expiry']} ({r['days_to_expiry']}d)  [{r['premium_mode']}]")
        print(f"  {'strike':>8} {'prem':>7} {'payoff':>7} {'stock':>8} {'call':>8} {'net/sh':>8} {'net%':>7} {'per lot':>10}  worthless")
        for row in r["call_rows"]:
            print(f"  {row['strike']:>8} {row['premium_used']:>7} {row['call_payoff']:>7} "
                  f"{row['stock_pl']:>8} {row['call_pl']:>8} {row['net_pl_per_share']:>8} "
                  f"{row['net_pl_pct']:>6}% {row['net_pl_per_lot']:>10,.0f}  {row['expired_worthless']}")
    (OUT / f"cc_retro_{args.entry}_{args.exit}.json").write_text(json.dumps(out, indent=2))
    print(f"\nsaved -> stock_cc/cc_retro_{args.entry}_{args.exit}.json")


if __name__ == "__main__":
    main()
