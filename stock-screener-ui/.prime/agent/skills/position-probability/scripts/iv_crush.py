#!/usr/bin/env python
"""IV crush around an earnings event, measured on real Upstox option prices.

Fetches the option chain of an NSE stock directly from Upstox (``/option/chain``
with the *equity's* instrument key — stock options are monthly-only for most
names), then rebuilds the ATM straddle's implied volatility day by day from
Upstox historical candles of the same contracts.

    pre-event IV  (session before results)  -> event premium
    post-event IV (session after results)   -> crushed
    priced move  (IV x sqrt(T) x spot)      -> what the market was charging for
    actual move                           -> what actually happened

Usage (run from the repo root):

    .venv/bin/python .prime/agent/skills/position-probability/scripts/iv_crush.py \
        --symbol SBIN --earnings 2026-11-03

    # scan several names at once
    .venv/bin/python .../iv_crush.py --examples SBIN,ITC,TITAN,BAJAJFINSV,POWERGRID

    # live chain snapshot only
    .venv/bin/python .../iv_crush.py --symbol SBIN --expiry 2026-11-23 --chain-only
"""

from __future__ import annotations

import argparse
import math
import sys
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import brentq
from scipy.stats import norm

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import fetch_market_data as fmd  # noqa: E402

UPSTOX_BASE = "https://api.upstox.com/v2"
RISK_FREE = 0.055          # repo 5.50% (RBI, 7-Oct-2026)


# --------------------------------------------------------------------------
# option maths
# --------------------------------------------------------------------------

def bs_price(sigma: float, spot: float, strike: float, t: float, r: float,
             is_call: bool) -> float:
    if t <= 0:
        return max(spot - strike, 0.0) if is_call else max(strike - spot, 0.0)
    d1 = (math.log(spot / strike) + (r + 0.5 * sigma ** 2) * t) / (sigma * math.sqrt(t))
    d2 = d1 - sigma * math.sqrt(t)
    if is_call:
        return spot * norm.cdf(d1) - strike * math.exp(-r * t) * norm.cdf(d2)
    return strike * math.exp(-r * t) * norm.cdf(-d2) - spot * norm.cdf(-d1)


def implied_vol(price: float, spot: float, strike: float, t: float, r: float,
                is_call: bool) -> float:
    """Implied vol from an option price; NaN when the price is outside no-arbitrage."""
    intrinsic = max(spot - strike, 0.0) if is_call else max(strike - spot, 0.0)
    if price <= intrinsic or price <= 0 or t <= 0:
        return float("nan")
    try:
        return brentq(lambda s: bs_price(s, spot, strike, t, r, is_call) - price,
                      1e-4, 5.0, xtol=1e-6)
    except Exception:
        return float("nan")


# --------------------------------------------------------------------------
# Upstox access
# --------------------------------------------------------------------------

def upstox_token() -> str:
    from api.upstox_token import require_upstox_token
    return require_upstox_token(use_env=False, cache_ttl=30)


def http_get(path: str, params: dict, token: str, timeout: int = 30) -> dict:
    import requests
    r = requests.get(f"{UPSTOX_BASE}{path}", params=params,
                     headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                     timeout=timeout)
    r.raise_for_status()
    return r.json()


def equity_chain(symbol: str, expiry: str, token: str, client=None) -> Optional[dict]:
    """Option chain for a stock underlying (Upstox /option/chain, equity key)."""
    api = client or fmd.upstox_client()
    key = api.get_instrument_key(symbol)
    if not key:
        return None
    data = http_get("/option/chain", {"instrument_key": key, "expiry_date": expiry}, token)
    rows = data.get("data") or []
    if not rows:
        return None
    # the spot travels on every row, not at the top level
    spot = 0.0
    for r in rows:
        v = r.get("underlying_spot_price") or 0
        if v:
            spot = float(v)
            break
    return {"symbol": symbol, "underlying_key": key, "expiry": expiry,
            "rows": rows, "spot": spot or float(data.get("underlying_spot_price") or 0)}


def contract_candles(instrument_key: str, from_date: str, to_date: str, client=None) -> pd.DataFrame:
    """Daily candles for one option contract (NSE_FO key) from Upstox history."""
    api = client or fmd.upstox_client()
    df = api._fetch_single_chunk_v3("opt", "days", 1, to_date, from_date, instrument_key)
    if df is None or df.empty:
        return pd.DataFrame()
    return df[["open", "high", "low", "close", "volume"]].copy()


# --------------------------------------------------------------------------
# chain maths
# --------------------------------------------------------------------------

def chain_table(chain: dict) -> pd.DataFrame:
    """Flatten an Upstox chain: one row per strike, CE/PE quotes + greeks."""
    def leg(opt: dict, prefix: str) -> dict:
        md = (opt or {}).get("market_data") or {}
        gk = (opt or {}).get("option_greeks") or {}
        return {
            f"{prefix}_key": (opt or {}).get("instrument_key"),
            f"{prefix}_ltp": md.get("ltp", (opt or {}).get("ltp")),
            f"{prefix}_oi": md.get("oi", (opt or {}).get("open_interest")),
            f"{prefix}_vol": md.get("volume", (opt or {}).get("volume")),
            f"{prefix}_bid": md.get("bid_price", (opt or {}).get("bid_price")),
            f"{prefix}_ask": md.get("ask_price", (opt or {}).get("ask_price")),
            f"{prefix}_prev_oi": md.get("prev_oi"),
            f"{prefix}_iv": gk.get("iv"),
            f"{prefix}_delta": gk.get("delta"),
            f"{prefix}_gamma": gk.get("gamma"),
            f"{prefix}_vega": gk.get("vega"),
            f"{prefix}_theta": gk.get("theta"),
            f"{prefix}_pop": gk.get("pop"),
        }

    rows = []
    for r in chain["rows"]:
        row = {"strike": float(r.get("strike_price") or 0), "pcr": r.get("pcr")}
        row.update(leg(r.get("call_options"), "ce"))
        row.update(leg(r.get("put_options"), "pe"))
        rows.append(row)
    return pd.DataFrame(rows).sort_values("strike").reset_index(drop=True)


def max_pain(t: pd.DataFrame, spot: float) -> float:
    """Strike where total option writers' payout is minimal."""
    strikes = t["strike"].values
    best, best_val = None, None
    for settle in strikes:
        payoff = ((np.maximum(strikes - settle, 0) * t["ce_oi"].fillna(0).values).sum() +
                  (np.maximum(settle - strikes, 0) * t["pe_oi"].fillna(0).values).sum())
        if best_val is None or payoff < best_val:
            best, best_val = settle, payoff
    return float(best)


def atm_row(t: pd.DataFrame, spot: float) -> pd.Series:
    return t.iloc[(t["strike"] - spot).abs().argmin()]


def leg_mid(row: pd.Series, prefix: str) -> float:
    """Mid of bid/ask when both are quoted, else the last traded price."""
    bid, ask, ltp = row.get(f"{prefix}_bid"), row.get(f"{prefix}_ask"), row.get(f"{prefix}_ltp")
    if bid and ask and float(ask) >= float(bid) and float(bid) > 0:
        return (float(bid) + float(ask)) / 2
    return float(ltp or 0)


def summarise_chain(t: pd.DataFrame, spot: float, expiry: str, dte: int) -> dict:
    atm = atm_row(t, spot)
    straddle = leg_mid(atm, "ce") + leg_mid(atm, "pe")
    sigma = straddle / (0.7979 * spot) if spot else float("nan")
    ce_oi = float(t["ce_oi"].fillna(0).sum())
    pe_oi = float(t["pe_oi"].fillna(0).sum())
    t_ = max(dte, 0) / 365
    # skew from the two nearest strikes either side of ATM
    def iv_at(strike, is_call):
        row = t.iloc[(t["strike"] - strike).abs().argmin()]
        px = leg_mid(row, "ce" if is_call else "pe")
        iv = implied_vol(px, spot, float(row["strike"]), t_, RISK_FREE, is_call)
        if not np.isfinite(iv):
            gk = row.get("ce_iv" if is_call else "pe_iv")
            iv = float(gk) / 100 if gk else float("nan")
        return iv
    k = atm["strike"]
    call_iv = iv_at(k, True)
    put_iv = iv_at(k, False)
    up = t[t["strike"] > k].head(1)
    dn = t[t["strike"] < k].tail(1)
    call_iv_up = iv_at(float(up["strike"].iloc[0]), True) if len(up) else float("nan")
    put_iv_dn = iv_at(float(dn["strike"].iloc[0]), False) if len(dn) else float("nan")
    return {
        "expiry": expiry, "dte": dte, "spot": spot, "atm_strike": float(k),
        "ce_ltp": leg_mid(atm, "ce"), "pe_ltp": leg_mid(atm, "pe"),
        "atm_ce_iv_upstox": float(atm.get("ce_iv") or 0),
        "atm_pe_iv_upstox": float(atm.get("pe_iv") or 0),
        "atm_ce_delta": float(atm.get("ce_delta") or 0),
        "atm_pe_delta": float(atm.get("pe_delta") or 0),
        "atm_ce_vega": float(atm.get("ce_vega") or 0),
        "atm_ce_theta": float(atm.get("ce_theta") or 0),
        "straddle": straddle, "sigma_move": sigma,
        "atm_iv_call": call_iv * 100, "atm_iv_put": put_iv * 100,
        "skew_atm": (put_iv - call_iv) * 100,
        "iv_up_1": call_iv_up * 100, "iv_down_1": put_iv_dn * 100,
        "max_pain": max_pain(t, spot),
        "pcr_oi": (pe_oi / ce_oi) if ce_oi else float("nan"),
        "ce_oi": ce_oi, "pe_oi": pe_oi,
        "atm_call_oi": float(atm["ce_oi"] or 0), "atm_put_oi": float(atm["pe_oi"] or 0),
    }


# --------------------------------------------------------------------------
# the crush measurement
# --------------------------------------------------------------------------

def iv_series(symbol: str, expiry: str, chain: dict, spot_series: pd.Series,
              from_date: str, to_date: str, client=None, anchor_spot: float | None = None,
              max_pairs: int = 22) -> pd.DataFrame:
    """ATM straddle price + implied IV for every session in the window.

    The strike is re-picked per session (nearest to that day's spot) from a
    band of contracts around the anchor spot: reusing today's ATM strike for a
    stock that has moved 5% mis-states IV by several vol points.
    """
    t = chain_table(chain)
    spot_now = chain["spot"] or float(spot_series.iloc[-1])
    anchor = anchor_spot or float(spot_series.iloc[-1])
    band = t[(t["strike"] >= anchor * 0.90) & (t["strike"] <= anchor * 1.10)]
    if len(band) > max_pairs:
        band = band.iloc[(band["strike"] - anchor).abs().argsort()[:max_pairs]].sort_values("strike")
    pairs = []
    for _, r in band.iterrows():
        if not r["ce_key"] or not r["pe_key"]:
            continue
        ce = contract_candles(r["ce_key"], from_date, to_date, client)
        pe = contract_candles(r["pe_key"], from_date, to_date, client)
        if ce.empty or pe.empty:
            continue
        ce = ce.rename(columns={"close": "ce_close"})
        pe = pe.rename(columns={"close": "pe_close"})
        j = ce[["ce_close"]].join(pe[["pe_close"]], how="inner").dropna()
        if j.empty:
            continue
        j["strike"] = float(r["strike"])
        pairs.append(j)
    if not pairs:
        return pd.DataFrame()
    df = pd.concat(pairs).sort_index()
    # pick, per session, the strike nearest that session's spot (index has dupes)
    rows = []
    for ts, g in df.groupby(level=0):
        sp = spot_series.reindex([ts]).ffill().iloc[0]
        if pd.isna(sp):
            continue
        g = g.copy()
        g["dist"] = (g["strike"] - sp).abs()
        r = g.sort_values("dist").iloc[0]
        if r["dist"] / sp > 0.03:      # no near-ATM contract traded that session
            continue
        rows.append({"ts": ts, "ce_close": float(r["ce_close"]), "pe_close": float(r["pe_close"]),
                     "strike": float(r["strike"])})
    df = pd.DataFrame(rows).set_index("ts").sort_index()

    spot = spot_series.reindex(df.index).ffill()
    exp_ts = pd.Timestamp(expiry).tz_localize(df.index.tz)
    t_years = (exp_ts - df.index).total_seconds() / (365 * 24 * 3600)
    df["spot"] = spot.values
    df["straddle"] = df["ce_close"] + df["pe_close"]
    df["t"] = t_years.values
    ivs = []
    for _, r in df.iterrows():
        iv_c = implied_vol(r["ce_close"], r["spot"], r["strike"], r["t"], RISK_FREE, True)
        iv_p = implied_vol(r["pe_close"], r["spot"], r["strike"], r["t"], RISK_FREE, False)
        ivs.append(np.nanmean([iv_c, iv_p]))
    df["iv"] = ivs
    df["iv_move_pts"] = df["iv"] * 100
    df["implied_move_pct"] = df["straddle"] / (0.7979 * df["spot"]) * 100
    return df


def crush_report(symbol: str, earnings: date, expiry: str, client=None) -> dict:
    """Pre-event vs post-event IV on the expiry that straddles the results."""
    api = client or fmd.upstox_client()
    token = upstox_token()
    spot_series = api.fetch_historical_data_v3(
        symbol, unit="days", interval=1, to_date="2026-11-11", from_date="2026-09-01")
    if spot_series is None or spot_series.empty:
        return {"symbol": symbol, "error": "no spot history"}
    spot_series = spot_series["close"].astype(float)

    chain = equity_chain(symbol, expiry, token, api)
    if chain is None:
        return {"symbol": symbol, "error": f"no chain for {expiry}"}

    event = pd.Timestamp(earnings)
    if event.tzinfo is None:
        event = event.tz_localize(spot_series.index.tz)
    anchor = float(spot_series[spot_series.index < event].iloc[-1]) if len(spot_series[spot_series.index < event]) else float(spot_series.iloc[-1])
    df = iv_series(symbol, expiry, chain, spot_series, "2026-09-15", "2026-11-11", api,
                   anchor_spot=anchor)
    if df.empty:
        return {"symbol": symbol, "error": "no option history"}

    pre = df[df.index < event]
    after = df[df.index >= event]
    pre_row = pre.iloc[-1] if len(pre) else None
    first_after = after.iloc[0] if len(after) else None
    # announcement after the close on a trading day -> the next session is the reaction
    # announcement on a weekend/holiday -> the first session after IS the reaction
    if first_after is not None and first_after.name.date() == event.date():
        event_row = first_after
        react = after.iloc[1] if len(after) > 1 else None
    else:
        event_row = pre_row
        react = first_after

    out = {
        "symbol": symbol, "expiry": expiry, "earnings": str(earnings),
        "atm_strike": float(df["strike"].iloc[-1]),
        "series": df[["spot", "strike", "ce_close", "pe_close", "straddle", "iv_move_pts", "implied_move_pct"]],
    }
    if pre_row is not None:
        out["pre_date"] = str(pre_row.name.date())
        out["pre_iv"] = float(pre_row["iv_move_pts"])
        out["pre_straddle"] = float(pre_row["straddle"])
        out["pre_implied_move_pct"] = float(pre_row["implied_move_pct"])
    if event_row is not None:
        out["event_date"] = str(event_row.name.date())
        out["event_iv"] = float(event_row["iv_move_pts"])
        out["event_straddle"] = float(event_row["straddle"])
        out["event_implied_move_pct"] = float(event_row["implied_move_pct"])
    if react is not None:
        out["post_date"] = str(react.name.date())
        out["post_iv"] = float(react["iv_move_pts"])
        out["post_straddle"] = float(react["straddle"])
        out["post_implied_move_pct"] = float(react["implied_move_pct"])
    if event_row is not None and react is not None:
        out["crush_pts"] = out["event_iv"] - out["post_iv"]
        out["crush_pct"] = (out["event_iv"] - out["post_iv"]) / out["event_iv"] * 100
        out["straddle_change_pct"] = (out["post_straddle"] / out["event_straddle"] - 1) * 100
        out["move_crush_pts"] = out["event_implied_move_pct"] - out["post_implied_move_pct"]
    if react is not None and event_row is not None:
        out["actual_move_pct"] = float((react["spot"] / event_row["spot"] - 1) * 100)
        out["priced_move_pct"] = out["event_implied_move_pct"]
        out["move_vs_priced"] = abs(out["actual_move_pct"]) - out["priced_move_pct"]
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--symbol")
    ap.add_argument("--earnings", help="results date YYYY-MM-DD")
    ap.add_argument("--expiry", help="option expiry to measure (default: auto)")
    ap.add_argument("--examples", help="comma list of SYMBOL:DATE pairs")
    ap.add_argument("--chain-only", action="store_true")
    ap.add_argument("--spot", type=float, default=0.0)
    args = ap.parse_args()

    api = fmd.upstox_client()
    token = upstox_token()

    pairs = []
    if args.symbol:
        if not args.earnings and not args.chain_only:
            ap.error("--symbol needs --earnings (or use --chain-only)")
        pairs.append((args.symbol, args.earnings))
    if args.examples:
        for item in args.examples.split(","):
            item = item.strip()
            if not item:
                continue
            if ":" in item:
                s, d = item.split(":")
            else:
                s, d = item, ""
            pairs.append((s.upper(), d))

    for symbol, earnings in pairs:
        expiry = args.expiry
        if not expiry and not args.chain_only:
            expiries = sorted({c.get("expiry") for c in
                               http_get("/option/contract", {"instrument_key": api.get_instrument_key(symbol)},
                                        token).get("data") or [] if c.get("expiry")})
            if not expiries:
                print(f"{symbol}: no contracts")
                continue
            expiry = args.expiry or expiries[0]
        print(f"\n{'=' * 78}\n{symbol}  expiry {expiry}")
        if args.chain_only:
            ch = equity_chain(symbol, expiry, token, api)
            t = chain_table(ch)
            spot = ch["spot"] or args.spot
            summ = summarise_chain(t, spot, expiry, 12)
            for k, v in summ.items():
                print(f"  {k:<16} {v}")
            cols = ["strike", "ce_ltp", "ce_iv", "ce_oi", "ce_delta", "pe_ltp", "pe_iv", "pe_oi", "pe_delta"]
            print(t[cols].to_string(index=False))
            continue

        rep = crush_report(symbol, date.fromisoformat(earnings), expiry, api)
        if rep.get("error"):
            print(f"  {rep['error']}")
            continue
        print(f"  ATM strike {rep['atm_strike']}")
        def g(key, fmt="{:+.1f}", suffix=""):
            v = rep.get(key)
            return (fmt.format(v) + suffix) if isinstance(v, (int, float)) else "n/a"
        print(f"  pre-event  {rep.get('pre_date')}: IV {g('pre_iv','{:.1f}','%')} | "
              f"straddle ₹{g('pre_straddle','{:.2f}')} | implied move ±{g('pre_implied_move_pct','{:.1f}','%')}")
        print(f"  event day  {rep.get('event_date')}: IV {g('event_iv','{:.1f}','%')} | "
              f"straddle ₹{g('event_straddle','{:.2f}')} | implied move ±{g('event_implied_move_pct','{:.1f}','%')}")
        print(f"  reaction   {rep.get('post_date')}: IV {g('post_iv','{:.1f}','%')} | "
              f"straddle ₹{g('post_straddle','{:.2f}')} | implied move ±{g('post_implied_move_pct','{:.1f}','%')}")
        print(f"  >> IV CRUSH {g('crush_pts')} vol pts ({g('crush_pct','{:+.0f}','%')} of IV) | "
              f"implied move {g('move_crush_pts')}pp | straddle {g('straddle_change_pct','{:+.0f}','%')}")
        if "actual_move_pct" in rep:
            verdict = ("EXCEEDED the priced range by" if rep["move_vs_priced"] > 0
                       else "inside the priced range by")
            print(f"  actual move on reaction day {rep['actual_move_pct']:+.1f}% vs priced "
                  f"±{rep['priced_move_pct']:.1f}% -> {verdict} {abs(rep['move_vs_priced']):.1f}pp")
        print("  IV path:")
        s = rep["series"]
        print(s.tail(12).to_string())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
