#!/usr/bin/env python3
"""Daily alpha snapshot from the Unusual Whales API.

Demonstrates, in one command, the highest-signal free-tier datasets:
aggregate market positioning, unusual options flow, dark-pool prints,
squeeze candidates, congressional/insider activity, and dealer gamma levels.

Usage:
    python scripts/daily_snapshot.py
    python scripts/daily_snapshot.py --tickers NVDA,SPY,TSLA
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from uw_client import UWClient  # noqa: E402


def rows(client: UWClient, path: str, **params):
    try:
        resp = client.get(path, **params)
        if resp.status_code != 200:
            return []
        data = resp.json().get("data")
        if isinstance(data, dict):
            return [data]
        return data or []
    except Exception:  # noqa: BLE001
        return []


def section(title: str) -> None:
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def fmt(x):
    try:
        return f"{float(x):,.2f}"
    except (TypeError, ValueError):
        return str(x)


def s(v, width: int | None = None) -> str:
    text = "?" if v is None else str(v)
    return text[:width].ljust(width) if width else text


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", default="NVDA,SPY,TSLA", help="watchlist for gamma levels")
    args = ap.parse_args()
    c = UWClient()

    section("1. MARKET TIDE (aggregate options positioning)")
    tide = rows(c, "/api/market/market-tide", interval_5m="false")
    for r in tide[-3:]:
        print(f"  {r.get('timestamp')}  call_prem={fmt(r.get('net_call_premium')):>16s}  "
              f"put_prem={fmt(r.get('net_put_premium')):>16s}  net_vol={r.get('net_volume')}")

    section("2. TOP NET IMPACT (net premium by ticker)")
    for r in rows(c, "/api/market/top-net-impact", limit=10)[:10]:
        print(f"  {r.get('ticker'):6s} net_premium={fmt(r.get('net_premium'))}")

    section("3. UNUSUAL OPTIONS ACTIVITY (premium-ranked)")
    for r in rows(c, "/api/option-activity/unusual", limit=12)[:12]:
        print(f"  {s(r.get('ticker_symbol') or r.get('underlying_symbol'), 6)} "
              f"{s(r.get('option_symbol'), 22)}  vol={s(r.get('volume')):>8}  prem={fmt(r.get('premium')):>16s}  "
              f"sweep={r.get('sweep_volume')}")

    section("4. LARGEST OI CHANGES")
    for r in rows(c, "/api/market/oi-change", limit=10)[:10]:
        print(f"  {s(r.get('underlying_symbol'), 6)} {s(r.get('option_symbol'), 22)}  "
              f"oi_change={r.get('oi_change')}  vol={r.get('volume')}")

    section("5. DARK POOL PRINTS (largest)")
    dp = rows(c, "/api/darkpool/recent", limit=100)
    for r in sorted(dp, key=lambda x: float(x.get("premium") or 0), reverse=True)[:8]:
        print(f"  {s(r.get('ticker'), 6)} {s(r.get('executed_at'))}  size={s(r.get('size')):>10}  "
              f"price={s(r.get('price'))}  prem={fmt(r.get('premium'))}")

    section("6. SQUEEZE CANDIDATES (high days-to-cover)")
    ss = rows(c, "/api/short_screener", limit=200)
    ranked = sorted(
        [r for r in ss if r.get("days_to_cover")],
        key=lambda x: float(x.get("days_to_cover") or 0),
        reverse=True,
    )[:10]
    for r in ranked:
        print(f"  {r.get('symbol'):6s} SI/float={r.get('si_float')}  days_to_cover={r.get('days_to_cover')}  "
              f"fee_rate={r.get('fee_rate')}")

    section("7. CONGRESS — RECENT BUYS")
    for r in rows(c, "/api/congress/recent-trades", limit=200):
        if r.get("txn_type") == "Buy":
            print(f"  {s(r.get('transaction_date'))}  {s(r.get('name'), 22)} {s(r.get('ticker'), 6)} "
                  f"{r.get('txn_type')}")

    section("8. INSIDERS — RECENT OPEN-MARKET ACTIVITY")
    for r in rows(c, "/api/insider/transactions", limit=200)[:12]:
        print(f"  {s(r.get('transaction_date'))}  {s(r.get('ticker'), 6)}  amount={s(r.get('amount')):>12}  "
              f"price={s(r.get('price'))}  {s(r.get('owner_name'), 24)}")

    section("9. VOLATILITY ANOMALIES (long-vol candidates)")
    for r in rows(c, "/api/volatility/anomaly/top", direction="long_vol", limit=10)[:10]:
        print(f"  {s(r.get('ticker'), 6)} score={r.get('score')}  {s(r.get('components'), 90)}")

    section("10. DEALER GAMMA LEVELS")
    for t in [t.strip().upper() for t in args.tickers.split(",") if t.strip()]:
        d = rows(c, f"/api/stock/{t}/gex-levels")
        if d:
            r = d[0]
            print(f"  {t:6s} call_wall={s(r.get('call_wall')):>8}  put_wall={s(r.get('put_wall')):>8}  "
                  f"gamma_flip={s(r.get('gamma_flip')):>8}  magnet={s(r.get('gamma_magnet'))}")

    print("\n" + "-" * 72)
    print("usage:", c.usage())
    print("Educational research only — not investment advice.")


if __name__ == "__main__":
    main()
