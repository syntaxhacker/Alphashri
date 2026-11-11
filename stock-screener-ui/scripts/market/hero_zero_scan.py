#!/usr/bin/env python3
"""Hero-zero scanner: cheap-premium, expected-move options candidates.

READ-ONLY. This script never places an order. It polls the local options chain
endpoint, ranks cheap OTM options by "probability of being touched before
expiry" per rupee of premium, and appends every scan to a JSONL audit log.

The setup it looks for
----------------------
Buy a cheap option whose strike is inside the 1-sigma expected move, with real
liquidity (volume/OI) and a tight spread — the classic "hero or zero" lottery
ticket. Two probability views are printed:

* ``pop``   — broker greeks' probability of profit at expiry (ITM at expiry).
* ``touch`` — ``2 x |delta|``, a driftless approximation of the chance the spot
  *touches* the strike at some point before expiry. For a scalp (exit before
  expiry) this is the more relevant number, and it is why a 0.1-delta option
  can still be a reasonable quick trade.

Score (0-100) — deliberately transparent, no fitted weights:
    touch^0.6 x reach^0.4 x cheapness^0.3 x liquidity^0.3 x spread^0.3

where ``reach = 1 - move_needed / expected_move_range`` (1 = at-the-money
break-even, 0 = a full 1-sigma move away), ``cheapness`` rewards a smaller
premium as a fraction of spot, and liquidity/spread come from the chain.

Usage
-----
    # one snapshot
    python scripts/market/hero_zero_scan.py

    # the requested loop: re-scan every 5s until the close
    python scripts/market/hero_zero_scan.py --loop --interval 5 --until 15:30

    # weekly expiry instead of the nearest
    python scripts/market/hero_zero_scan.py --expiry next --max-premium-pct 0.3

    # bank nifty, tighter liquidity gates
    python scripts/market/hero_zero_scan.py --underlying BANKNIFTY --min-volume 50000

Notes
-----
* The chain endpoint is served by the local FastAPI process (token, caching and
  broker auth live there). Start the app with ``./start.sh`` first.
* Index volume/OI are large; the defaults are tuned for NIFTY. For stock options
  lower ``--min-volume`` / ``--min-oi``.
* ``--paper`` only *prints* a paper ticket; it does not book anything. Use
  ``python -m options_paper.live`` for the repo's paper book.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_API = "http://localhost:8765"
DEFAULT_OUT_DIR = ROOT / "reports" / "hero_zero"
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


def _get_json(url: str, timeout: float = 15.0) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_expiries(api: str, underlying: str) -> list[dict]:
    url = f"{api.rstrip('/')}/api/options/expiries/{urllib.parse.quote(underlying)}"
    return (_get_json(url) or {}).get("expiries") or []


def resolve_expiry(expiries: list[dict], choice: str) -> str:
    """``nearest`` | ``next`` | an explicit ``YYYY-MM-DD``."""
    dates = [e.get("date") for e in expiries if e.get("date")]
    if not dates:
        raise SystemExit("no expiries returned by the API")
    if choice in ("", "nearest", "today"):
        return dates[0]
    if choice == "next":
        for d in dates[1:]:
            if d != dates[0]:
                return d
        return dates[0]
    if choice in dates:
        return choice
    raise SystemExit(f"expiry {choice} not in {dates[:6]}")


def fetch_chain(api: str, underlying: str, expiry: str) -> dict:
    url = (
        f"{api.rstrip('/')}/api/options/chain/{urllib.parse.quote(underlying)}"
        f"?expiry={urllib.parse.quote(expiry)}"
    )
    return _get_json(url)


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def _num(value, default: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if math.isfinite(out) else default


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def candidate_rows(
    payload: dict,
    *,
    max_premium_pct: float,
    delta_min: float,
    delta_max: float,
    reach_max: float,
    min_volume: float,
    min_oi: float,
    max_spread_pct: float,
    min_pop: float,
) -> list[dict]:
    spot = _num(payload.get("spot"))
    summary = payload.get("summary") or {}
    em = summary.get("expected_move") or {}
    em_range = _num(em.get("range"))
    if spot <= 0 or em_range <= 0:
        return []

    out: list[dict] = []
    for row in payload.get("chain") or []:
        strike = _num(row.get("strike"))
        if strike <= 0:
            continue
        for side in ("ce", "pe"):
            opt = row.get(side) or {}
            md = opt.get("market_data") or {}
            greeks = opt.get("option_greeks") or {}
            ltp = _num(md.get("ltp"))
            bid = _num(md.get("bid_price"))
            ask = _num(md.get("ask_price"))
            volume = _num(md.get("volume"))
            oi = _num(md.get("oi"))
            delta = _num(greeks.get("delta"))
            pop = _num(greeks.get("pop"))
            if ltp <= 0 or bid <= 0 or ask <= 0 or ask < bid:
                continue

            premium_pct = ltp / spot * 100.0
            if premium_pct > max_premium_pct:
                continue
            abs_delta = abs(delta)
            if abs_delta < delta_min or abs_delta > delta_max:
                continue
            if pop < min_pop:
                continue
            if volume < min_volume or oi < min_oi:
                continue

            mid = (bid + ask) / 2.0
            spread_pct = (ask - bid) / mid * 100.0 if mid > 0 else 999.0
            if spread_pct > max_spread_pct:
                continue

            # Break-even at expiry (long premium): strike +/- premium paid.
            breakeven = strike + ltp if side == "ce" else strike - ltp
            move_needed = abs(breakeven - spot)
            reach = move_needed / em_range
            if reach > reach_max:
                continue

            touch = _clamp(2.0 * abs_delta, 0.0, 0.95)
            cheapness = _clamp(1.0 - (premium_pct / max(max_premium_pct, 1e-9)))
            reach_score = _clamp(1.0 - reach)
            liquidity = _clamp(math.log10(1.0 + volume) / 8.0) * _clamp(
                math.log10(1.0 + oi) / 7.5
            )
            spread_score = _clamp(1.0 - spread_pct / 10.0)

            score = (
                100.0
                * (touch ** 0.6)
                * (reach_score ** 0.4)
                * (cheapness ** 0.3)
                * (liquidity ** 0.3)
                * (spread_score ** 0.3)
            )

            out.append(
                {
                    "side": side.upper(),
                    "strike": strike,
                    "ltp": round(ltp, 2),
                    "premium_pct": round(premium_pct, 3),
                    "delta": round(delta, 4),
                    "pop": round(pop, 2),
                    "touch": round(touch * 100.0, 1),
                    "breakeven": round(breakeven, 2),
                    "move_needed": round(move_needed, 2),
                    "reach_pct": round(reach * 100.0, 1),
                    "spread_pct": round(spread_pct, 2),
                    "volume": int(volume),
                    "oi": int(oi),
                    "iv": round(_num(greeks.get("iv")), 2),
                    "gamma": _num(greeks.get("gamma")),
                    "theta": _num(greeks.get("theta")),
                    "score": round(score, 2),
                    "symbol": opt.get("trading_symbol"),
                }
            )
    out.sort(key=lambda r: r["score"], reverse=True)
    return out


# ---------------------------------------------------------------------------
# Rendering / logging
# ---------------------------------------------------------------------------


def header(payload: dict) -> str:
    s = payload.get("summary") or {}
    em = s.get("expected_move") or {}
    return (
        f"{payload.get('underlying')} {payload.get('expiry')}  "
        f"spot {_num(payload.get('spot')):,.2f}  "
        f"1σ [{_num(em.get('lower')):,.0f} .. {_num(em.get('upper')):,.0f}] "
        f"({_num(em.get('range')):,.0f} pts)  "
        f"ATM IV {_num(s.get('atm_iv')):.1f}  DTE {s.get('dte')}  "
        f"PCR {_num(s.get('pcr')):.2f}  max-pain {_num(s.get('max_pain')):,.0f}"
    )


def render(rows: list[dict], top: int) -> str:
    if not rows:
        return "  no candidates pass the filters (loosen --max-premium-pct / --reach-max / liquidity)"
    head = (
        f"  {'#':>2} {'side':<2} {'strike':>8} {'ltp':>7} {'prem%':>6} "
        f"{'Δ':>6} {'pop%':>5} {'touch%':>6} {'reach%':>6} {'spr%':>5} "
        f"{'vol':>10} {'oi':>10} {'score':>6}"
    )
    lines = [head]
    for i, r in enumerate(rows[:top], 1):
        lines.append(
            f"  {i:>2} {r['side']:<2} {r['strike']:>8.0f} {r['ltp']:>7.2f} "
            f"{r['premium_pct']:>6.2f} {r['delta']:>6.3f} {r['pop']:>5.1f} "
            f"{r['touch']:>6.1f} {r['reach_pct']:>6.0f} {r['spread_pct']:>5.2f} "
            f"{r['volume']:>10,} {r['oi']:>10,} {r['score']:>6.1f}"
        )
    return "\n".join(lines)


def log_scan(out_dir: pathlib.Path, payload: dict, rows: list[dict], top: int) -> pathlib.Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    day = dt.datetime.now(IST).strftime("%Y-%m-%d")
    path = out_dir / f"scan_{day}.jsonl"
    record = {
        "ts": dt.datetime.now(IST).isoformat(),
        "underlying": payload.get("underlying"),
        "expiry": payload.get("expiry"),
        "spot": payload.get("spot"),
        "summary": payload.get("summary"),
        "candidates": rows[:top],
    }
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, separators=(",", ":")) + "\n")
    return path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_until(value: str) -> dt.time:
    try:
        hh, mm = value.split(":", 1)
        return dt.time(int(hh), int(mm))
    except (ValueError, AttributeError):
        raise SystemExit(f"--until must be HH:MM, got {value!r}")


def run_once(args) -> tuple[dict, list[dict], pathlib.Path]:
    expiries = fetch_expiries(args.api, args.underlying)
    expiry = resolve_expiry(expiries, args.expiry)
    payload = fetch_chain(args.api, args.underlying, expiry)
    rows = candidate_rows(
        payload,
        max_premium_pct=args.max_premium_pct,
        delta_min=args.delta_min,
        delta_max=args.delta_max,
        reach_max=args.reach_max,
        min_volume=args.min_volume,
        min_oi=args.min_oi,
        max_spread_pct=args.max_spread_pct,
        min_pop=args.min_pop,
    )
    path = log_scan(args.out_dir, payload, rows, args.top)
    return payload, rows, path


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Read-only hero-zero options scanner")
    p.add_argument("--api", default=DEFAULT_API, help="local FastAPI base URL")
    p.add_argument("--underlying", default="NIFTY")
    p.add_argument("--expiry", default="nearest", help="nearest | next | YYYY-MM-DD")
    p.add_argument("--max-premium-pct", type=float, default=0.15,
                   help="max premium as %% of spot (default 0.15 = ~₹34 on 22.7k)")
    p.add_argument("--delta-min", type=float, default=0.04)
    p.add_argument("--delta-max", type=float, default=0.35)
    p.add_argument("--reach-max", type=float, default=1.0,
                   help="max move-to-breakeven as a fraction of the 1σ expected move")
    p.add_argument("--min-pop", type=float, default=0.0,
                   help="minimum broker POP %% (0 = no gate; hero-zero POP is low by design)")
    p.add_argument("--min-volume", type=float, default=100_000)
    p.add_argument("--min-oi", type=float, default=500_000)
    p.add_argument("--max-spread-pct", type=float, default=8.0)
    p.add_argument("--top", type=int, default=8)
    p.add_argument("--loop", action="store_true", help="re-scan until --until")
    p.add_argument("--interval", type=float, default=5.0, help="seconds between scans")
    p.add_argument("--until", default="15:30", help="IST cutoff HH:MM")
    p.add_argument("--out", dest="out_dir", type=pathlib.Path, default=DEFAULT_OUT_DIR)
    p.add_argument("--quiet", action="store_true", help="only print new candidates")
    args = p.parse_args(argv)

    if not args.loop:
        payload, rows, path = run_once(args)
        print(header(payload))
        print(render(rows, args.top))
        print(f"  logged -> {path}")
        return 0

    if args.interval < 1:
        raise SystemExit("--interval must be >= 1s")

    cutoff = _parse_until(args.until)
    seen: set[str] = set()
    scans = 0
    print(
        f"hero-zero scanner: {args.underlying} every {args.interval:g}s until {args.until} IST "
        f"(read-only; no orders)",
        flush=True,
    )
    while True:
        now = dt.datetime.now(IST)
        if now.time() >= cutoff:
            print(f"[{now:%H:%M:%S}] cutoff reached — stopping after {scans} scans", flush=True)
            break
        try:
            payload, rows, path = run_once(args)
            scans += 1
            fresh = [r for r in rows if f"{r['side']}{r['strike']}" not in seen]
            seen.update(f"{r['side']}{r['strike']}" for r in rows)
            changed = fresh if args.quiet else rows
            if changed or scans == 1:
                print(f"\n[{now:%H:%M:%S}] {header(payload)}", flush=True)
                print(render(changed, args.top), flush=True)
                if fresh and scans > 1:
                    names = ", ".join(f"{r['side']}{r['strike']:.0f}" for r in fresh[:6])
                    print(f"  new on this scan: {names}", flush=True)
                print(f"  logged -> {path}", flush=True)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            print(f"[{dt.datetime.now(IST):%H:%M:%S}] scan failed: {exc}", flush=True)
            time.sleep(min(30.0, args.interval * 2))
            continue
        time.sleep(args.interval)
    return 0


if __name__ == "__main__":
    sys.exit(main())
