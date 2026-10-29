"""Who is moving NIFTY right now — live constituent contribution table.

Pulls the Nifty-50 constituents from the `instruments` table, batch-quotes them
on Upstox v2, and prints two views:

* **day** — change vs previous close (is the index up/down on the day?)
* **fade** — change vs today's open (who is giving back the opening move?)

Weighted contribution = Nifty-50 weight x change. Weights are the Tickertape
free-float snapshot from 2026-10-15 in
``scripts/research/nifty_breadth/breadth_predictor.py`` (research source, drifts
daily — good enough to name the driver, not for index replication).

Usage
-----
    .venv/bin/python scripts/nifty_drivers.py            # top 8 each way
    .venv/bin/python scripts/nifty_drivers.py --top 12   # deeper lists

Read-only: no DB writes, no orders.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts/research/nifty_breadth"))

from breadth_predictor import NIFTY50_WEIGHTS  # noqa: E402
from scripts import upstox_common  # noqa: E402

QUOTES_URL = "https://api.upstox.com/v2/market-quote/quotes"
INDEX_KEY = "NSE_INDEX|Nifty 50"
BANK_KEY = "NSE_INDEX|Nifty Bank"


def _token() -> str:
    token = upstox_common.token()
    if not token:
        raise SystemExit("no Upstox token (DB broker_connections / .upstox_token.json)")
    return token


def _quote(session: requests.Session, token: str, keys: str) -> dict:
    r = session.get(
        QUOTES_URL,
        params={"instrument_key": keys},
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=20,
    )
    r.raise_for_status()
    # Upstox keys the payload by "NSE_EQ:SYMBOL" / "NSE_INDEX:Nifty 50".
    return {k.split(":", 1)[-1]: v for k, v in r.json().get("data", {}).items()}


def _index_row(q: dict) -> str:
    last = q.get("last_price") or 0.0
    net = q.get("net_change") or 0.0
    ohlc = q.get("ohlc") or {}
    prev = last - net
    pct = (net / prev * 100) if prev else 0.0
    return (f"last {last:,.2f} | {net:+,.2f} ({pct:+.2f}%) vs prev {prev:,.2f} "
            f"| open {ohlc.get('open', 0):,.2f} high {ohlc.get('high', 0):,.2f} "
            f"low {ohlc.get('low', 0):,.2f}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="nifty_drivers")
    ap.add_argument("--top", type=int, default=8, help="rows per side (default 8)")
    args = ap.parse_args(argv)

    weights = dict(NIFTY50_WEIGHTS)
    total_w = sum(weights.values())
    weights = {k: v / total_w for k, v in weights.items()}

    conn = sqlite3.connect(ROOT / "db/alphashri.db")
    rows = conn.execute(
        "select trading_symbol, instrument_key from instruments "
        "where segment='NSE_EQ' and trading_symbol in (%s)"
        % ",".join("?" * len(weights)),
        list(weights),
    ).fetchall()
    conn.close()
    keymap = {sym: key for sym, key in rows}
    missing = sorted(set(weights) - set(keymap))
    if missing:
        print(f"missing instruments ({len(missing)}): {', '.join(missing)}")

    token = _token()
    with requests.Session() as s:
        idx = _quote(s, token, f"{INDEX_KEY},{BANK_KEY}")
        quotes = _quote(s, token, ",".join(keymap.values()))

    print(f"NIFTY  : {_index_row(idx.get('Nifty 50', {}))}")
    print(f"BANKNIF: {_index_row(idx.get('Nifty Bank', {}))}")
    print()

    out = []
    for sym, wt in weights.items():
        q = quotes.get(sym)
        if not q:
            continue
        last = q.get("last_price") or 0.0
        net = q.get("net_change") or 0.0
        prev = last - net
        op = (q.get("ohlc") or {}).get("open") or 0.0
        if not last or not prev or not op:
            continue
        day = (last - prev) / prev * 100
        fade = (last - op) / op * 100
        out.append({
            "sym": sym, "wt": wt, "last": last,
            "day": day, "day_c": wt * day,
            "fade": fade, "fade_c": wt * fade,
        })

    adv = sum(1 for r in out if r["day"] > 0)
    print(f"covered {len(out)}/{len(weights)} | advancers {adv} / decliners {len(out) - adv}")
    print(f"weighted day contribution : {sum(r['day_c'] for r in out):+.3f}%")
    print(f"weighted fade since open  : {sum(r['fade_c'] for r in out):+.3f}%")
    print()

    print(f"{'sym':<14}{'wt%':>6}{'last':>10}{'day%':>8}{'fade%':>8}{'fade contrib%':>14}")
    faded = sorted(out, key=lambda r: r["fade_c"])
    for r in faded:
        print(f"{r['sym']:<14}{r['wt']*100:>6.2f}{r['last']:>10.1f}"
              f"{r['day']:>8.2f}{r['fade']:>8.2f}{r['fade_c']:>14.3f}")

    n = max(1, args.top)
    print(f"\nTop {n} drags since open:")
    for r in faded[:n]:
        print(f"  {r['sym']:<13} {r['fade']:+6.2f}%  contrib {r['fade_c']:+.3f}%")
    print(f"\nTop {n} holding up since open:")
    for r in faded[-n:][::-1]:
        print(f"  {r['sym']:<13} {r['fade']:+6.2f}%  contrib {r['fade_c']:+.3f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
