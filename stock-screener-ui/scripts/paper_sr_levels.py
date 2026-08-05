#!/usr/bin/env python3
"""SENSEX support/resistance scanner for the paper options strategy.

Computes multi-source S/R levels:
  - Classic/Fibonacci pivot points from today's OHL (R1-R3 / S1-S3)
  - Option OI concentration: high CE OI = resistance magnet, high PE OI = support
  - Max pain (from OI-weighted chain)
  - Nearest levels around current spot, ranked by strength

Usage:
  python scripts/paper_sr_levels.py                 # print all levels
  python scripts/paper_sr_levels.py --json          # machine-readable
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


def get_token() -> str:
    from db.models import get_shared_broker_token
    data = get_shared_broker_token("upstox")
    if data and data.get("access_token"):
        return data["access_token"]
    raise SystemExit("ERROR: No Upstox token in DB.")


INDEX_KEY = "BSE_INDEX|SENSEX"
EXPIRY = "2026-08-06"


def fetch_day_ohlc(token: str) -> dict:
    import httpx
    r = httpx.get(
        "https://api.upstox.com/v2/market-quote/ohlc",
        params={"instrument_key": INDEX_KEY, "interval": "1d"},
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=15,
    )
    j = r.json()
    k = list(j["data"].keys())[0]
    o = j["data"][k].get("ohlc", {})
    return {
        "open": float(o.get("open") or 0),
        "high": float(o.get("high") or 0),
        "low": float(o.get("low") or 0),
        "close": float(o.get("close") or 0),
        "last": float(j["data"][k].get("last_price") or 0),
    }


def fetch_chain(token: str, expiry: str = EXPIRY) -> dict:
    import httpx
    r = httpx.get(
        "https://api.upstox.com/v2/option/chain",
        params={"instrument_key": INDEX_KEY, "expiry_date": expiry},
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=20,
    )
    return r.json()


def pivot_levels(o, h, l, c, style: str = "classic") -> dict:
    """Classic / Fibonacci / Camarilla pivots from daily OHL(C)."""
    pp = (h + l + c) / 3 if c else (h + l + o) / 3
    hl = h - l
    if style == "fibonacci":
        return {
            "r3": pp + 1.0 * hl, "r2": pp + 0.618 * hl, "r1": pp + 0.382 * hl,
            "pp": pp, "s1": pp - 0.382 * hl, "s2": pp - 0.618 * hl, "s3": pp - 1.0 * hl,
        }
    if style == "camarilla":
        return {
            "r3": c + hl * 1.1 / 4, "r2": c + hl * 1.1 / 6, "r1": c + hl * 1.1 / 12,
            "pp": pp, "s1": c - hl * 1.1 / 12, "s2": c - hl * 1.1 / 6, "s3": c - hl * 1.1 / 4,
        }
    return {
        "r3": h + 2 * (pp - l), "r2": pp + hl, "r1": 2 * pp - l,
        "pp": pp, "s1": 2 * pp - h, "s2": pp - hl, "s3": l - 2 * (h - pp),
    }


def oi_levels(chain: dict, top_n: int = 6, min_oi: float = 1_000_000) -> dict:
    """Resistance from high CE OI, support from high PE OI (OI magnets)."""
    ce = []
    pe = []
    for c in chain.get("data", []):
        st = c.get("strike_price")
        if not st:
            continue
        ce_oi = ((c.get("call_options") or {}).get("market_data") or {}).get("oi", 0) or 0
        pe_oi = ((c.get("put_options") or {}).get("market_data") or {}).get("oi", 0) or 0
        if ce_oi >= min_oi:
            ce.append((st, float(ce_oi)))
        if pe_oi >= min_oi:
            pe.append((st, float(pe_oi)))
    ce.sort(key=lambda x: x[1], reverse=True)
    pe.sort(key=lambda x: x[1], reverse=True)
    return {
        "resistance": ce[:top_n],   # (strike, oi)
        "support": pe[:top_n],
    }


def max_pain(chain: dict, spot: float) -> float:
    """Max pain strike: level where option writers lose the least (OI-weighted)."""
    rows = []
    for c in chain.get("data", []):
        st = c.get("strike_price")
        if not st:
            continue
        ce_oi = ((c.get("call_options") or {}).get("market_data") or {}).get("oi", 0) or 0
        pe_oi = ((c.get("put_options") or {}).get("market_data") or {}).get("oi", 0) or 0
        rows.append({"strike": float(st), "ce": float(ce_oi), "pe": float(pe_oi)})
    if not rows:
        return spot
    strikes = [r["strike"] for r in rows]
    best_strike, min_loss = 0, float("inf")
    for t in strikes:
        loss = 0.0
        for r in rows:
            if t > r["strike"]:
                loss += (t - r["strike"]) * r["ce"]
            elif t < r["strike"]:
                loss += (r["strike"] - t) * r["pe"]
        if loss < min_loss:
            min_loss, best_strike = loss, t
    return best_strike


def nearest_levels(levels: dict, spot: float) -> dict:
    """Pick the nearest support & resistance clusters around spot."""
    res = sorted(levels.get("resistance", []), key=lambda x: x[0])
    sup = sorted(levels.get("support", []), key=lambda x: x[0])
    near_res = [r for r in res if r[0] >= spot]
    near_sup = [r for r in sup if r[0] <= spot]
    return {
        "next_resistance": near_res[0] if near_res else None,
        "next_support": near_sup[-1] if near_sup else None,
        "resistance_all": res,
        "support_all": sup,
    }


def scan(token: str | None = None, expiry: str = EXPIRY) -> dict:
    token = token or get_token()
    ohlc = fetch_day_ohlc(token)
    chain = fetch_chain(token, expiry)
    spot = ohlc["last"] or ohlc["close"]
    piv = pivot_levels(ohlc["open"], ohlc["high"], ohlc["low"], ohlc["close"])
    oi = oi_levels(chain)
    mp = max_pain(chain, spot)
    near = nearest_levels(oi, spot)
    # Combine OI magnets with day high/low to get the NEAREST live levels around spot.
    oi_sup = near["next_support"][0] if near["next_support"] else None
    oi_res = near["next_resistance"][0] if near["next_resistance"] else None
    day_low = ohlc["low"]
    day_high = ohlc["high"]
    # Candidates strictly below spot (support): OI magnet, day low, pivot S1
    sup_candidates = [x for x in [oi_sup, day_low, piv["s1"]] if x and x < spot]
    res_candidates = [x for x in [oi_res, day_high, piv["r1"]] if x and x > spot]
    eff_support = max(sup_candidates) if sup_candidates else (oi_sup or day_low)
    eff_resistance = min(res_candidates) if res_candidates else (oi_res or day_high)
    return {
        "spot": round(spot, 2),
        "day": {"open": ohlc["open"], "high": ohlc["high"], "low": ohlc["low"]},
        "pivots": {k: round(v, 2) for k, v in piv.items()},
        "oi_support": [(round(s, 2), round(oi_v, 0)) for s, oi_v in oi["support"]],
        "oi_resistance": [(round(s, 2), round(oi_v, 0)) for s, oi_v in oi["resistance"]],
        "max_pain": round(mp, 2),
        "next_support": round(eff_support, 2),
        "next_resistance": round(eff_resistance, 2),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = scan()
    if args.json:
        print(json.dumps(result, indent=2))
        return
    print(f"SENSEX spot: {result['spot']:,.2f}   max pain: {result['max_pain']:,.0f}")
    print(f"Day: O={result['day']['open']:,.0f} H={result['day']['high']:,.0f} L={result['day']['low']:,.0f}")
    print(f"\nPivots (classic): R3={result['pivots']['r3']:,.0f} R2={result['pivots']['r2']:,.0f} R1={result['pivots']['r1']:,.0f} "
          f"PP={result['pivots']['pp']:,.0f} S1={result['pivots']['s1']:,.0f} S2={result['pivots']['s2']:,.0f} S3={result['pivots']['s3']:,.0f}")
    print(f"\nNEAREST: support {result['next_support']:,.0f} | resistance {result['next_resistance']:,.0f}")
    print("\nResistance (CE OI magnets):")
    for s, oi in result["oi_resistance"][:6]:
        print(f"  {s:,.0f}  CE OI {oi:,.0f}")
    print("\nSupport (PE OI magnets):")
    for s, oi in result["oi_support"][:6]:
        print(f"  {s:,.0f}  PE OI {oi:,.0f}")


if __name__ == "__main__":
    main()
