"""FYERS-ready stock option data plumbing (spot + chain + contract premiums).

Everything is defensive: if no valid token is present it prints exactly what is
wrong and exits non-zero, so it can be run unattended the moment a token exists.

Commands
  preflight                 - validate the token (quotes NIFTY + RELIANCE)
  spot SYM[,SYM...]         - cache daily + 5-min spot for stocks
  chain SYM [--expiry E]    - cache the option-chain snapshot (strikes/OI/IV/greeks)
  premiums SYM --expiry YYYY-MM-DD --strikes K,K - cache 5-min option history
  all                       - preflight + spot+chain for a default universe

Cache root: experiments/data/nifty_options/stock_fyers/
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fyers_data as fd  # noqa: E402

ROOT = fd.CACHE_DIR / "stock_fyers"
ROOT.mkdir(parents=True, exist_ok=True)

DEFAULT_UNIVERSE = ["RELIANCE", "TMPV", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN", "ITC"]


def fyers_symbol(sym: str) -> str:
    return sym if ":" in sym else f"NSE:{sym}-EQ"


def preflight(verbose: bool = True) -> bool:
    """Return True iff the stored FYERS token is currently accepted."""
    try:
        c = fd.FyersData(min_interval=0.4, verbose=False)
    except Exception as e:
        if verbose:
            print(f"PREFLIGHT FAIL: no token ({e})")
        return False
    q = c.quotes(["NSE:NIFTY50-INDEX", "NSE:RELIANCE-EQ"])
    ok = bool(q)
    if verbose:
        if ok:
            n = q.get("NSE:NIFTY50-INDEX", {}).get("lp")
            print(f"PREFLIGHT OK: FYERS token valid (NIFTY={n})")
        else:
            print("PREFLIGHT FAIL: token rejected (expired?). Re-auth via "
                  "http://localhost:8765/api/brokers/fyers/auth or set FYERS_ACCESS_TOKEN.")
    return ok


def fetch_spot(symbols: list[str], frm: str, to: str, resolutions=("D", "5")) -> dict:
    c = fd.FyersData(min_interval=0.5)
    out = {}
    for s in symbols:
        sym = fyers_symbol(s)
        for res in resolutions:
            df = fd.fetch_candles_cached(c, sym, res, frm, to)
            out[f"{s}__{res}"] = len(df)
    return out


def fetch_chain(symbol: str, strikecount: int = 25, expiry: str | None = None) -> dict:
    c = fd.FyersData(min_interval=0.5)
    ch = c.option_chain(underlying=fyers_symbol(symbol), strikecount=strikecount, expiry=expiry, greeks=True)
    if ch:
        day = date.today().isoformat()
        tag = f"{symbol}_{expiry or 'nearest'}"
        p = ROOT / f"chain_{tag}_{day}.json"
        p.write_text(json.dumps(ch, indent=2))
        legs = [r for r in ch.get("optionsChain", []) if r.get("option_type") in ("CE", "PE")]
        ivs = [r["greeks"]["iv"] for r in legs if r.get("greeks") and r["greeks"].get("iv")]
        print(f"chain {symbol}: {len(legs)} legs, expiries={[e['date'] for e in ch.get('expiryData',[])][:4]}, "
              f"ATM IV ~ {sorted(ivs)[len(ivs)//2] if ivs else None}")
    return ch or {}


def atm_iv(symbol: str, expiry: str | None = None) -> float | None:
    """Median IV across near-ATM legs from the live chain (causal at call time)."""
    c = fd.FyersData(min_interval=0.5)
    ch = c.option_chain(underlying=fyers_symbol(symbol), strikecount=5, expiry=expiry, greeks=True)
    if not ch:
        return None
    spot = next((r.get("ltp") for r in ch.get("optionsChain", []) if r.get("option_type") == ""), None)
    legs = [r for r in ch.get("optionsChain", []) if r.get("option_type") in ("CE", "PE") and r.get("greeks")]
    if not legs or not spot:
        return None
    near = sorted(legs, key=lambda r: abs(r["strike_price"] - spot))[:6]
    ivs = [r["greeks"]["iv"] for r in near if r["greeks"].get("iv")]
    return sorted(ivs)[len(ivs) // 2] / 100.0 if ivs else None


def fetch_premiums(symbol: str, expiry: str, strikes: list[int], opts=("CE", "PE"),
                   frm: str | None = None, to: str | None = None) -> dict:
    """Cache 5-min history for specific stock option contracts (listed only)."""
    from datetime import datetime as dt
    exp = date.fromisoformat(expiry)
    frm = frm or (exp - __import__("datetime").timedelta(days=45)).isoformat()
    to = to or date.today().isoformat()
    c = fd.FyersData(min_interval=0.5)
    out = {}
    for k in strikes:
        for opt in opts:
            sym = fd.nifty_weekly_symbol(exp, k, opt)  # placeholder; replaced below
            # stock weekly symbol differs; use NSE:<SYM><YY><MMM><STRIKE><OPT> for monthlies
            sym = f"NSE:{symbol}{exp:%y}{fd._MONTH3[exp.month - 1]}{k}{opt}"
            df = fd.fetch_candles_cached(c, sym, "5", frm, to)
            out[sym] = len(df)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["preflight", "spot", "chain", "premiums", "all"])
    ap.add_argument("symbols", nargs="*", default=None)
    ap.add_argument("--expiry", default=None)
    ap.add_argument("--strikes", default="")
    ap.add_argument("--from", dest="frm", default="2026-06-01")
    ap.add_argument("--to", default=None)
    args = ap.parse_args()
    to = args.to or date.today().isoformat()
    syms = args.symbols or DEFAULT_UNIVERSE

    if args.cmd == "preflight":
        sys.exit(0 if preflight() else 2)
    if not preflight():
        sys.exit(2)
    if args.cmd in ("spot", "all"):
        print(fetch_spot(syms, args.frm, to))
    if args.cmd in ("chain", "all"):
        for s in syms:
            fetch_chain(s)
    if args.cmd == "premiums":
        strikes = [int(x) for x in args.strikes.split(",") if x.strip()]
        print(fetch_premiums(syms[0], args.expiry, strikes, frm=args.frm, to=to))


if __name__ == "__main__":
    main()
