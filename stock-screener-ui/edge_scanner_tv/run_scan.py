"""CLI: one-shot or --watch scan over india / america / both.

Examples:
    python -m edge_scanner_tv.run_scan --market india --limit 50
    python -m edge_scanner_tv.run_scan --market america --limit 50 --setup momentum
    python -m edge_scanner_tv.run_scan --market both --limit 30 --no-history
    python -m edge_scanner_tv.run_scan --market india --watch --interval 60
"""
from __future__ import annotations

import argparse
import logging
import time

from .markets import MarketSpec, resolve_markets
from .scanner import ALL_SETUPS, EdgeScannerTV
from .triggers import SETUPS
from .tv_feed import TradingViewFeed, subscribe_minute_bars_once
from .tv_universe import fetch_universe

log = logging.getLogger("edge_scanner_tv")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Edge-scanner-style scan via TradingView (India + US)")
    p.add_argument("--market", default="india", help="'india' | 'america' | 'both'")
    p.add_argument("--limit", type=int, default=50, help="universe size per market")
    p.add_argument("--setup", default="all",
                   help="'all' or comma list of: " + ",".join(ALL_SETUPS))
    p.add_argument("--symbols", default="",
                   help="comma-separated explicit symbols (skips universe fetch)")
    p.add_argument("--min-price", type=float, default=20.0)
    p.add_argument("--min-volume", type=int, default=100_000)
    p.add_argument("--min-mcap", type=float, default=10_000_000_000)
    p.add_argument("--no-history", action="store_true",
                   help="skip yfinance warmup (snapshot-only, faster)")
    p.add_argument("--watch", action="store_true", help="poll loop instead of one-shot")
    p.add_argument("--interval", type=int, default=60, help="poll seconds for --watch")
    return p


def parse_setups(raw: str) -> list[str]:
    raw = (raw or "all").strip().lower()
    if raw == "all":
        return list(ALL_SETUPS)
    wanted = [s.strip() for s in raw.split(",") if s.strip()]
    unknown = [s for s in wanted if s not in ALL_SETUPS]
    if unknown:
        raise ValueError(f"unknown setups {unknown}; valid: {list(ALL_SETUPS)}")
    return wanted


def scan_market(market: MarketSpec, args, setups: list[str]) -> list[dict]:
    feed = TradingViewFeed(market)
    if args.symbols:
        symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
        tv_tickers: dict[str, str] = {}
    else:
        uni = fetch_universe(market, limit=args.limit, min_price=args.min_price,
                             min_volume=args.min_volume, min_mcap=args.min_mcap)
        symbols = [r["symbol"] for r in uni]
        tv_tickers = {r["symbol"]: r["tv_ticker"] for r in uni if r.get("tv_ticker")}
    if not symbols:
        print(f"[{market.key}] no symbols (TV returned empty universe)")
        return []
    scanner = EdgeScannerTV(symbols, feed, market, setups=setups, tv_tickers=tv_tickers)
    if not args.no_history:
        scanner.warmup()
    alerts = scanner.scan_snapshot()
    print(f"[{market.key}] {len(symbols)} symbols → {len(alerts)} alerts")
    for a in alerts:
        arrow = "▲" if a["direction"] == "long" else "▼"
        print(f"  {arrow} {a['symbol']:<16} {a['setup']:<18} {a['price']:>10}  {a['why']}")
    if args.watch:
        print(f"[{market.key}] watching every {args.interval}s (Ctrl-C to stop)…")
        prev_vol: dict[str, float] = {}
        try:
            while True:
                for bar in subscribe_minute_bars_once(feed, symbols, prev_vol):
                    for alert in scanner.on_bar(bar):
                        print(f"  ⚡ {alert.symbol} {alert.setup} "
                              f"{alert.direction} @ {alert.price:.2f} — {alert.why}")
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("stopped.")
    return alerts


def main(argv=None) -> int:
    logging.basicConfig(level=logging.WARNING)
    args = build_parser().parse_args(argv)
    try:
        markets = resolve_markets(args.market)
        setups = parse_setups(args.setup)
    except ValueError as exc:
        print(f"error: {exc}")
        return 2
    print(f"setups: {', '.join(f'{s} ({SETUPS[s]})' for s in setups)}")
    total = 0
    for market in markets:
        try:
            total += len(scan_market(market, args, setups))
        except Exception as exc:
            print(f"[{market.key}] scan failed: {exc}")
    print(f"done: {total} alerts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
