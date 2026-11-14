#!/usr/bin/env python
"""Intraday momentum scan across the optionable (F&O) universe.

Ranks every NSE stock that has listed options by live momentum, then checks the
option chain of the leaders so the idea can actually be traded: IV vs realised
vol, ATM straddle, expected move, open interest and the bid/ask you would cross.

    .venv/bin/python .prime/agent/skills/position-probability/scripts/fno_momentum_scan.py \
        --top 8 --chains IRFC,SBIN

Output: a ranked table on stdout, plus reports/fno_scan/<date>/fno_momentum.csv.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import fetch_market_data as fmd  # noqa: E402
import lib_probability as lp  # noqa: E402
import iv_crush as ivc  # noqa: E402

#: NSE stocks with listed options (verified against Upstox /option/contract)
FNO_UNIVERSE = [
    "RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "SBIN", "AXISBANK", "LT",
    "ITC", "HINDUNILVR", "BAJAJFINSV", "MARUTI", "HINDALCO", "SBILIFE", "KOTAKBANK",
    "WIPRO", "SUNPHARMA", "TITAN", "ASIANPAINT", "BHARTIARTL", "ULTRACEMCO", "CIPLA",
    "DRREDDY", "EICHERMOT", "BAJAJ-AUTO", "GRASIM", "HDFCLIFE", "POWERGRID", "IRFC",
    "M&M", "SBILIFE",
]


def scan(client, universe: list[str]) -> pd.DataFrame:
    rows = []
    for sym in universe:
        try:
            px = fmd.upstox_daily(sym, from_date="2024-06-01", client=client)
            if px is None or px.empty:
                continue
            sess = fmd.upstox_intraday_session(sym, client=client)
            if not sess:
                continue
            prev_close = float(px["close"].iloc[-1])
            today = sess["close"]
            px = fmd.append_session(px, sess)
            f = lp.build_features(px)
            last = f.iloc[-1]
            c = px["close"]
            r = c.pct_change().dropna()
            vol_ratio = float(px["volume"].iloc[-2] / px["volume"].iloc[-63:-2].median()) if len(px) > 65 else np.nan
            rows.append({
                "symbol": sym,
                "price": today,
                "prev": prev_close,
                "chg_today": (today / prev_close - 1) * 100,
                "ret5": (c.iloc[-1] / c.iloc[-6] - 1) * 100,
                "ret10": (c.iloc[-1] / c.iloc[-11] - 1) * 100,
                "ret20": (c.iloc[-1] / c.iloc[-21] - 1) * 100,
                "ret60": (c.iloc[-1] / c.iloc[-61] - 1) * 100,
                "rsi": float(last["rsi"]),
                "d20": float(last["d20"]) * 100,
                "d50": float(last["d50"]) * 100,
                "d200": float(last["d200"]) * 100,
                "slope200": float(last["slope200"]) * 100,
                "vol_ratio": vol_ratio,
                "sig60": float(r.tail(60).std() * np.sqrt(252)) * 100,
                "atr_pct": float((px["high"] - px["low"]).tail(14).mean() / today) * 100,
                "intraday_range": (sess["high"] - sess["low"]) / prev_close * 100,
                "vol_today_m": sess["volume"] / 1e6,
            })
        except Exception as e:  # noqa: BLE001 — one bad symbol must not kill the scan
            print(f"  {sym}: {e}", file=sys.stderr)
    return pd.DataFrame(rows)


def score(df: pd.DataFrame, nifty_chg: float) -> pd.DataFrame:
    """Transparent composite momentum score (z-scores inside the universe)."""
    d = df.copy()

    def z(col, weight, sign=1):
        s = d[col]
        mu, sd = s.mean(), s.std()
        zsc = (s - mu) / (sd if sd else 1)
        return sign * weight * zsc

    d["s_chg"] = z("chg_today", 1.0)
    d["s_r5"] = z("ret5", 1.0)
    d["s_r10"] = z("ret10", 0.6)
    d["s_r20"] = z("ret20", 0.5)
    d["s_rs"] = z("chg_today", 1.0)          # relative to the index, see below
    d["s_vol"] = z("vol_ratio", 0.5)
    d["s_trend"] = z("d50", 0.5) + z("slope200", 0.4)
    # RSI is a band, not a monotonic score: reward 55-72, punish >78 and <40
    d["s_rsi"] = np.where(d["rsi"] > 78, -1.5, np.where(d["rsi"] > 72, -0.6,
                     np.where(d["rsi"].between(55, 72), 0.8,
                              np.where(d["rsi"] < 40, -0.8, 0.0))))
    d["s_rs"] = d["s_chg"] * 0 + (d["chg_today"] - nifty_chg) / (d["chg_today"].std() or 1) * 0.8
    d["score"] = (d["s_chg"] + d["s_r5"] + d["s_r10"] + d["s_r20"] + d["s_vol"] +
                  d["s_trend"] + d["s_rsi"] + d["s_rs"])
    # a single huge day on no volume is a spike, not momentum
    d.loc[(d["chg_today"] > 7) & (d["vol_ratio"] < 1.0), "score"] -= 1.5
    return d.sort_values("score", ascending=False)


def chain_report(symbol: str, expiry: str, token: str, client) -> dict | None:
    try:
        ch = ivc.equity_chain(symbol, expiry, token, client)
        if not ch:
            return None
        t = ivc.chain_table(ch)
        spot = ch["spot"]
        dte = (datetime.fromisoformat(expiry).date() - datetime.now().date()).days
        summ = ivc.summarise_chain(t, spot, expiry, dte)
        atm = t.iloc[(t["strike"] - spot).abs().argmin()]
        rows = []
        for _, r in t.iterrows():
            bid_c, ask_c = r.get("ce_bid") or 0, r.get("ce_ask") or 0
            bid_p, ask_p = r.get("pe_bid") or 0, r.get("pe_ask") or 0
            rows.append({
                "strike": r["strike"], "type": "CE", "bid": bid_c, "ask": ask_c,
                "ltp": r.get("ce_ltp"), "oi": r.get("ce_oi"), "vol": r.get("ce_vol"),
                "iv": r.get("ce_iv"), "delta": r.get("ce_delta"),
                "vega": r.get("ce_vega"), "theta": r.get("ce_theta"),
                "spread_pct": ((ask_c - bid_c) / ask_c * 100) if ask_c else np.nan,
            })
            rows.append({
                "strike": r["strike"], "type": "PE", "bid": bid_p, "ask": ask_p,
                "ltp": r.get("pe_ltp"), "oi": r.get("pe_oi"), "vol": r.get("pe_vol"),
                "iv": r.get("pe_iv"), "delta": r.get("pe_delta"),
                "vega": r.get("pe_vega"), "theta": r.get("pe_theta"),
                "spread_pct": ((ask_p - bid_p) / ask_p * 100) if ask_p else np.nan,
            })
        return {"symbol": symbol, "expiry": expiry, "dte": dte, "spot": spot,
                "summary": summ, "atm": atm.to_dict(), "legs": pd.DataFrame(rows)}
    except Exception as e:  # noqa: BLE001
        print(f"  chain {symbol}: {e}", file=sys.stderr)
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--universe", default=",".join(sorted(set(FNO_UNIVERSE))))
    ap.add_argument("--top", type=int, default=8)
    ap.add_argument("--chains", default="", help="comma list of symbols to pull chains for")
    ap.add_argument("--expiry", default="", help="option expiry (default: nearest on the stock)")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    client = fmd.upstox_client()
    universe = [s.strip().upper() for s in args.universe.split(",") if s.strip()]
    print(f"scanning {len(universe)} optionable names…")

    df = scan(client, universe)
    if df.empty:
        print("no data")
        return 2

    nifty = scan(client, ["NIFTY"])
    nifty_chg = float(nifty["chg_today"].iloc[0]) if not nifty.empty else 0.0
    print(f"NIFTY today: {nifty_chg:+.2f}%")

    ranked = score(df, nifty_chg)
    cols = ["symbol", "price", "chg_today", "ret5", "ret20", "rsi", "d20", "d50", "d200",
            "slope200", "vol_ratio", "sig60", "atr_pct", "score"]
    print("\n=== MOMENTUM RANKING (live, 12-Nov-2026) ===")
    print(ranked[cols].head(args.top).to_string(index=False, float_format=lambda v: f"{v:,.2f}"))
    print("\n=== weakest ===")
    print(ranked[cols].tail(4).to_string(index=False, float_format=lambda v: f"{v:,.2f}"))

    out_dir = Path(args.out) if args.out else fmd.REPO_ROOT / "reports" / "fno_scan" / datetime.now().strftime("%Y-%m-%d")
    out_dir.mkdir(parents=True, exist_ok=True)
    ranked.to_csv(out_dir / "fno_momentum.csv", index=False)

    if args.chains:
        token = ivc.upstox_token()
        for sym in [s.strip().upper() for s in args.chains.split(",") if s.strip()]:
            expiry = args.expiry
            if not expiry:
                import requests
                key = client.get_instrument_key(sym)
                exps = sorted({c.get("expiry") for c in (requests.get(
                    "https://api.upstox.com/v2/option/contract",
                    params={"instrument_key": key},
                    headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                    timeout=30).json().get("data") or []) if c.get("expiry")})
                if not exps:
                    print(f"{sym}: no contracts")
                    continue
                expiry = exps[0]
            rep = chain_report(sym, expiry, token, client)
            if not rep:
                continue
            summ = rep["summary"]
            legs = rep["legs"]
            print(f"\n=== {sym} {expiry} (DTE {rep['dte']}) ===")
            print(f"  spot {rep['spot']:,.2f} | ATM {summ['atm_strike']:,.0f} | straddle {summ['straddle']:.2f} "
                  f"| 1σ {summ['sigma_move'] * 100:.2f}% | CE IV {summ['atm_iv_call']:.1f}% | "
                  f"PE IV {summ['atm_iv_put']:.1f}% | skew {summ['skew_atm']:+.1f} | "
                  f"max pain {summ['max_pain']:,.0f} | PCR {summ['pcr_oi']:.2f}")
            liq = legs[(legs["vol"].fillna(0) > 0) & (legs["spread_pct"].fillna(99) < 8)]
            liq = liq[liq["delta"].abs().between(0.2, 0.7)].sort_values("vol", ascending=False)
            print("  most-traded strikes with a workable spread and 0.2-0.7 delta:")
            print(liq.head(8)[["strike", "type", "bid", "ask", "ltp", "vol", "oi", "iv", "delta",
                               "vega", "theta", "spread_pct"]].to_string(index=False))
            json.dump({"summary": {k: (float(v) if isinstance(v, (int, float, np.floating)) else v)
                                   for k, v in summ.items()},
                       "dte": rep["dte"], "spot": rep["spot"], "expiry": expiry},
                      open(out_dir / f"chain_{sym}.json", "w"), indent=1, default=str)

    print(f"\ncsv → {out_dir / 'fno_momentum.csv'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
