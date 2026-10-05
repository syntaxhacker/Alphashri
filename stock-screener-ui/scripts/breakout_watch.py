#!/usr/bin/env python
"""Long-consolidation breakout watch — run at/after the open.

Two phases (mirrors how the edge actually appears: the breakout is a *crossing*
of the box high, which can happen any time after 09:15, not at the open):

  1. build   — (evening / pre-open) detect long bases on **completed** daily
               bars and save each box's high/low. Fast to re-run.
  2. watch   — (09:20 onward) batch LTP + TradingView rel-vol for the
               watchlist and flag names trading **above their box high** with
               rel-vol >= threshold. ``--loop N`` keeps re-checking every N sec.

Usage
-----
  # after close or before the open
  python scripts/breakout_watch.py build --universe nifty500 --min-base-days 60

  # at/after 09:20 (once)
  python scripts/breakout_watch.py watch --min-rel-vol 1.5

  # from 09:20 keep scanning every 60s
  python scripts/breakout_watch.py watch --min-rel-vol 1.5 --loop 60

Caveats
-------
* rel-vol from TradingView is time-of-day adjusted, but at 09:20 it is built on
  only a few minutes of tape — noisier than the close. Consider 09:30-10:00.
* A signal is a *candidate*, not advice: confirm price holds above the box high
  and the volume is real. Use a stop back inside the box (base_low / the box).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import config  # noqa: E402
from chart_patterns import candles  # noqa: E402
from chart_patterns import features as F  # noqa: E402
from chart_patterns.detectors.consolidation import (  # noqa: E402
    _is_range_bound,
    _trailing_base_end,
    _window_base,
)
from chart_patterns.tv_prefilter import fetch_tv_volume_metrics  # noqa: E402

WATCH_FILE = ROOT / "experiments" / "data" / "breakout_watch.json"
LTP_URL = "https://api.upstox.com/v3/market-quote/ltp"


# --------------------------------------------------------------------------- #
# phase 1 — build the box watchlist
# --------------------------------------------------------------------------- #
def _universe(name: str) -> list[str]:
    from chart_patterns import universes

    syms = universes.get_universe(name)
    if syms:
        return [str(s).upper() for s in syms]
    from chart_patterns.constituents import NIFTY500

    return list(NIFTY500)


def _find_long_base(df, min_days: int, max_range_pct: float):
    """Longest range-bound base in the trailing window (oscillation-validated).

    Unlike ``detect_consolidation`` this ignores the close's position in the box,
    so a base whose price already sits near the top — the breakout candidates —
    is still returned. A trailing breakout leg is trimmed first.
    """
    n = len(df)
    if n < 30:
        return None
    atr = F.atr_value(df)
    best = None
    for w in (250, 180, 120, 90, 60, 30):
        if n < w:
            continue
        start = n - w
        box_end = _trailing_base_end(df, start, n - 1, atr)
        b = _window_base(df, start, box_end, w, check_pos=False)
        if b is None or b["range_pct"] > max_range_pct:
            continue
        days = int((df.index[box_end] - df.index[start]).days)
        if days < min_days:
            continue
        if not _is_range_bound(df, None, start, box_end, b["hi"], b["lo"], atr):
            continue
        if best is None or days > best["days"]:
            best = {"days": days, "hi": b["hi"], "lo": b["lo"],
                    "range_pct": b["range_pct"], "box_end": int(box_end)}
    return best


def cmd_build(args: argparse.Namespace) -> int:
    from concurrent.futures import ThreadPoolExecutor

    syms = ([s.strip().upper() for s in args.symbols.split(",") if s.strip()]
            if args.symbols else _universe(args.universe))
    print(f"universe {args.symbols or args.universe}: {len(syms)} symbols")

    def work(sym: str):
        try:
            # No ``include_partial_today``: the box is measured on completed bars.
            df = candles.fetch_for_timeframe(sym, "1D")
        except Exception:
            return None
        if df is None or df.empty:
            return None
        base = _find_long_base(df, args.min_base_days, args.max_range_pct)
        if base is None:
            return None
        return {
            "symbol": sym,
            "base_high": round(float(base["hi"]), 2),
            "base_low": round(float(base["lo"]), 2),
            "base_days": int(base["days"]),
            "range_pct": round(float(base["range_pct"]), 1),
            "end_date": df.index[base["box_end"]].strftime("%Y-%m-%d"),
            "last_close": round(float(df["close"].iloc[-1]), 2),
        }
        return best

    rows = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for r in pool.map(work, syms):
            if r:
                rows.append(r)
    rows.sort(key=lambda r: -r["base_days"])
    WATCH_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {"built_at": datetime.now(config.IST).isoformat(), "universe": args.symbols or args.universe,
               "min_base_days": args.min_base_days, "items": rows}
    WATCH_FILE.write_text(json.dumps(payload, indent=2))
    print(f"watchlist: {len(rows)} long bases -> {WATCH_FILE}")
    print(f"{'SYMBOL':<12}{'base_d':>7}{'rng%':>6}{'box_hi':>10}{'box_lo':>10}{'last':>10}")
    for r in rows[:40]:
        print(f"{r['symbol']:<12}{r['base_days']:>7}{r['range_pct']:>6}{r['base_high']:>10}{r['base_low']:>10}{r['last_close']:>10}")
    return 0


# --------------------------------------------------------------------------- #
# phase 2 — watch for the cross
# --------------------------------------------------------------------------- #
def _token() -> str | None:
    try:
        from db.models import get_shared_broker_token

        td = get_shared_broker_token("upstox")
        if td and td.get("access_token"):
            return td["access_token"]
    except Exception:
        pass
    f = ROOT / ".upstox_token.json"
    if f.exists():
        try:
            tok = json.loads(f.read_text()).get("access_token")
            if tok:
                return tok
        except Exception:
            pass
    return os.getenv("UPSTOX_ACCESS_TOKEN")


def _instrument_keys(symbols: list[str]) -> dict[str, str]:
    from api.symbols import _load_instruments

    want = set(symbols)
    out: dict[str, str] = {}
    for i in _load_instruments():
        s = i.get("trading_symbol")
        if s in want and i.get("instrument_key"):
            out[s] = i["instrument_key"]
    return out


def _batch_ltp(token: str, keys: list[str], chunk: int = 400) -> dict[str, float]:
    import requests

    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    out: dict[str, float] = {}
    for i in range(0, len(keys), chunk):
        part = keys[i:i + chunk]
        try:
            r = requests.get(LTP_URL, params={"instrument_key": ",".join(part)},
                             headers=headers, timeout=15)
            if r.status_code != 200:
                print(f"  LTP HTTP {r.status_code}: {r.text[:100]}")
                continue
            for k, v in (r.json().get("data") or {}).items():
                bare = k.split(":")[-1].upper()
                px = v.get("last_price")
                if px is not None:
                    out[bare] = float(px)
        except Exception as exc:  # noqa: BLE001
            print(f"  LTP batch failed: {exc}")
    return out


def _tape_prices(symbols: list[str], timeframe: str = "1m") -> dict[str, float]:
    """Latest price from the market-data tape (API-key auth — no OAuth needed)."""
    from concurrent.futures import ThreadPoolExecutor

    def one(sym: str):
        try:
            df = candles.fetch_for_timeframe(sym, timeframe)
            if df is not None and not df.empty:
                return sym, float(df["close"].iloc[-1])
        except Exception:
            pass
        return sym, None

    out: dict[str, float] = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for sym, px in pool.map(one, symbols):
            if px is not None:
                out[sym] = px
    return out


def _watch_once(args: argparse.Namespace, items: list[dict]) -> None:
    syms = [it["symbol"] for it in items]
    prices: dict[str, float] = {}
    token = _token()
    if token:
        keys = _instrument_keys(syms)
        prices = _batch_ltp(token, list(keys.values())) if keys else {}
    # OAuth token missing/expired (or thin) -> fall back to the market-data tape,
    # which authenticates with the API key/secret only.
    if len(prices) < max(1, len(syms) // 2):
        tape = _tape_prices(syms)
        for s, px in tape.items():
            prices.setdefault(s, px)
    metrics = fetch_tv_volume_metrics(syms)

    now = datetime.now(config.IST).strftime("%H:%M:%S")
    rows = []
    for it in items:
        sym = it["symbol"]
        px = prices.get(sym)
        if px is None:
            continue
        m = metrics.get(sym) or {}
        rel = m.get("rel_volume")
        if rel is None or rel < args.min_rel_vol:
            continue
        if px <= it["base_high"]:
            continue
        # Only flag a *new* cross: skip names already above the box on the last
        # completed session (a stale breakout, not today's event).
        if it.get("last_close") is not None and it["last_close"] > it["base_high"]:
            continue
        rows.append((sym, px, it["base_high"], (px - it["base_high"]) / it["base_high"] * 100,
                     rel, it["base_days"], it["base_low"]))
    rows.sort(key=lambda r: -r[4])
    print(f"[{now} IST] breakouts (rel-vol >= {args.min_rel_vol}, LTP > box high): {len(rows)}")
    print(f"{'SYMBOL':<12}{'ltp':>10}{'box_hi':>10}{'%>box':>8}{'relvol':>8}{'base_d':>7}{'box_lo':>10}")
    for sym, px, bh, pct, rel, bd, bl in rows:
        print(f"{sym:<12}{px:>10.2f}{bh:>10.2f}{pct:>8.2f}{rel:>8.2f}{bd:>7}{bl:>10.2f}")


def cmd_watch(args: argparse.Namespace) -> int:
    if not WATCH_FILE.exists():
        print(f"no watchlist at {WATCH_FILE} — run `build` first")
        return 1
    payload = json.loads(WATCH_FILE.read_text())
    items = payload.get("items") or []
    print(f"watchlist built {payload.get('built_at')} ({len(items)} names, universe {payload.get('universe')})")
    while True:
        _watch_once(args, items)
        if not args.loop:
            return 0
        try:
            time.sleep(args.loop)
        except KeyboardInterrupt:
            return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="precompute long-base box levels (completed bars)")
    b.add_argument("--universe", default="nifty500")
    b.add_argument("--symbols", default=None, help="comma-separated symbols (overrides --universe)")
    b.add_argument("--min-base-days", type=int, default=60)
    b.add_argument("--max-range-pct", type=float, default=20.0)
    b.add_argument("--workers", type=int, default=3)
    b.set_defaults(func=cmd_build)

    w = sub.add_parser("watch", help="monitor the watchlist for crosses (at/after 09:20)")
    w.add_argument("--min-rel-vol", type=float, default=1.5)
    w.add_argument("--loop", type=int, default=0, help="seconds between checks (0 = once)")
    w.set_defaults(func=cmd_watch)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
