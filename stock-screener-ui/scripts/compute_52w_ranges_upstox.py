#!/usr/bin/env python3
"""Compute 52-week high/low for NSE equities via Upstox daily candles.

Uses trading.week52_utils (same logic as debug_52w.py / runner_risk) and upserts
into stock_52w_range (+ optional Redis cache used by /api/52w-range).

Usage:
    cd stock-screener-ui
    source .venv/bin/activate
    python scripts/compute_52w_ranges_upstox.py --limit 10          # smoke test
    python scripts/compute_52w_ranges_upstox.py --redis             # full run + cache
    python scripts/compute_52w_ranges_upstox.py --symbol RELIANCE   # single symbol
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from threading import Lock

_project_root = Path(__file__).resolve().parents[1]
# Parent first so project_root ends up at sys.path[0]: config/db/trading must resolve
# to stock-screener-ui (its DB has stock_52w_range), not the parent project.
sys.path.insert(0, str(_project_root.parent))
sys.path.insert(0, str(_project_root))

from dotenv import load_dotenv

load_dotenv()

import config
from db.database import SessionLocal, init_db
from db.models import Instrument
from db.models.stock_52w_touch import Stock52WeekRange
from trading.week52_utils import build_52w_range_from_ohlc, days_since_52w_high_touch_from_df
from trading.week52_job_status import (
    finish_job,
    fail_job,
    get_job_status,
    start_job,
    update_job_progress,
)

NSE_INSTRUMENTS_JSON = (
    _project_root.parent / "upstox_trader" / "config_and_utils" / "nse_instruments.json"
)

LOOKBACK_CALENDAR_DAYS = 400
DEFAULT_WORKERS = 3
DEFAULT_DELAY_SEC = 0.35
DB_FLUSH_EVERY = 500


def load_symbols(
    source: str,
    equity_only: bool,
    symbols_arg: list[str] | None,
) -> list[str]:
    if symbols_arg:
        return sorted({s.upper() for s in symbols_arg})

    # Equity filter needs instrument_type from Upstox JSON (not stored on Instrument model).
    if equity_only and NSE_INSTRUMENTS_JSON.exists():
        with open(NSE_INSTRUMENTS_JSON, encoding="utf-8") as f:
            data = json.load(f)
        symbols = []
        for item in data:
            if item.get("segment") != "NSE_EQ" or item.get("instrument_type") != "EQ":
                continue
            sym = (item.get("trading_symbol") or "").strip().upper()
            if sym:
                symbols.append(sym)
        if symbols:
            return sorted(set(symbols))

    if source == "db":
        db = SessionLocal()
        try:
            q = db.query(Instrument.trading_symbol).filter(Instrument.segment == "NSE_EQ")
            if equity_only:
                q = q.filter(Instrument.isin.isnot(None), Instrument.isin.like("INE%"))
            rows = q.all()
            symbols = sorted({r[0].upper() for r in rows if r[0]})
            if symbols:
                return symbols
        finally:
            db.close()

    if not NSE_INSTRUMENTS_JSON.exists():
        raise FileNotFoundError(
            f"Instruments file not found: {NSE_INSTRUMENTS_JSON}\n"
            "Run: python scripts/fetch_instruments.py"
        )

    with open(NSE_INSTRUMENTS_JSON, encoding="utf-8") as f:
        data = json.load(f)

    symbols = []
    for item in data:
        if item.get("segment") != "NSE_EQ":
            continue
        if equity_only and item.get("instrument_type") != "EQ":
            continue
        sym = (item.get("trading_symbol") or "").strip().upper()
        if sym:
            symbols.append(sym)
    return sorted(set(symbols))


def _date_range(to_date: str | None) -> tuple[str, str]:
    if to_date:
        end = datetime.strptime(to_date, "%Y-%m-%d")
    else:
        end = datetime.now(config.IST).replace(tzinfo=None)
    to_str = end.strftime("%Y-%m-%d")
    from_str = (end - timedelta(days=LOOKBACK_CALENDAR_DAYS)).strftime("%Y-%m-%d")
    return from_str, to_str


def fetch_range_for_symbol(api, symbol: str, to_date: str | None) -> dict | None:
    from_date, to_str = _date_range(to_date)
    df = api.fetch_historical_data_v3(
        symbol=symbol,
        unit="days",
        interval=1,
        to_date=to_str,
        from_date=from_date,
    )
    if df is None or df.empty or len(df) < 2:
        return None

    highs = df["high"].astype(float).tolist()
    lows = df["low"].astype(float).tolist()
    closes = df["close"].astype(float).tolist()
    entry = build_52w_range_from_ohlc(highs, lows, closes)
    if entry:
        days = days_since_52w_high_touch_from_df(df, entry["high"])
        if days is not None:
            entry["days_ago"] = days
    return entry


def persist_ranges(data: dict, redis: bool) -> tuple[int, int]:
    """Upsert into stock_52w_range; optionally refresh Redis cache."""
    if not data:
        return 0, 0

    db = SessionLocal()
    added = 0
    updated = 0
    try:
        existing = {r.symbol: r for r in db.query(Stock52WeekRange).all()}
        now = datetime.now(config.IST).replace(tzinfo=None)
        for symbol, info in data.items():
            cur = existing.get(symbol)
            if cur:
                # Always record the fresh computation time. Values are overwritten
                # (even if unchanged) so that "updated_at" reflects last verification.
                cur.high_52w = info["high"]
                cur.low_52w = info["low"]
                cur.close = info["close"]
                cur.days_ago = info.get("days_ago")
                cur.updated_at = now
                updated += 1
            else:
                db.add(
                    Stock52WeekRange(
                        symbol=symbol,
                        high_52w=info["high"],
                        low_52w=info["low"],
                        close=info["close"],
                        days_ago=info.get("days_ago"),
                        updated_at=now,
                    )
                )
                existing[symbol] = None  # noqa: track in-memory only
                added += 1
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    # Redis write is deferred to the merge step below (line ~348) so the bulk
    # key is written ONCE with the complete merged data, not twice in a row.
    return added, updated


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compute 52W high/low from Upstox daily data for NSE equities"
    )
    parser.add_argument(
        "--source",
        choices=("json", "db", "auto"),
        default="auto",
        help="Instrument list source (default: auto = db if seeded, else json)",
    )
    parser.add_argument(
        "--equity-only",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Only NSE_EQ stocks with instrument_type EQ (json) or ISIN INE%% (db)",
    )
    parser.add_argument("--symbol", action="append", help="Run for specific symbol(s) only")
    parser.add_argument("--limit", type=int, default=0, help="Max symbols to process (0 = all)")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help="Parallel fetch workers")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY_SEC, help="Sleep after each API call")
    parser.add_argument("--to-date", dest="to_date", help="As-of date YYYY-MM-DD (default: today IST)")
    parser.add_argument("--dry-run", action="store_true", help="Fetch only; do not write DB/Redis")
    parser.add_argument("--redis", action="store_true", help="Also update Redis 52w_range cache")
    parser.add_argument("--skip-existing", action="store_true", help="Skip symbols already in stock_52w_range")
    parser.add_argument(
        "--skip-updated-today",
        action="store_true",
        help="Skip symbols whose updated_at is today (IST) — daily staleness refresh",
    )
    parser.add_argument(
        "--migrate",
        action="store_true",
        help="Run Alembic migrations before processing (default: skip, set SKIP_ALEMBIC=1)",
    )
    args = parser.parse_args()

    source = args.source
    if source == "auto" and not args.symbol:
        try:
            db = SessionLocal()
            try:
                n = db.query(Instrument).filter(Instrument.segment == "NSE_EQ").count()
                source = "db" if n > 0 else "json"
            finally:
                db.close()
        except Exception:
            source = "json"
        print(f"Auto source: {source}")
    elif source == "auto":
        source = "json"

    symbols = load_symbols(source, args.equity_only, args.symbol)
    if args.skip_existing and not args.dry_run:
        db = SessionLocal()
        try:
            have = {r.symbol for r in db.query(Stock52WeekRange.symbol).all()}
            before = len(symbols)
            symbols = [s for s in symbols if s not in have]
            print(f"Skip-existing: {before - len(symbols)} already in DB, {len(symbols)} remaining")
        finally:
            db.close()

    if args.skip_updated_today and not args.dry_run:
        db = SessionLocal()
        try:
            today = datetime.now(config.IST).date()
            fresh = {
                r.symbol
                for r in db.query(Stock52WeekRange.symbol, Stock52WeekRange.updated_at).all()
                if r.updated_at and r.updated_at.date() >= today
            }
            before = len(symbols)
            symbols = [s for s in symbols if s not in fresh]
            print(f"Skip-updated-today: {before - len(symbols)} already fresh today, {len(symbols)} remaining")
        finally:
            db.close()

    if args.limit > 0:
        symbols = symbols[: args.limit]

    if not symbols:
        print("No symbols to process.")
        sys.exit(1)

    api_key = config.UPSTOX_API_KEY
    api_secret = config.UPSTOX_API_SECRET
    if not api_key or not api_secret:
        print("UPSTOX_API_KEY and UPSTOX_API_SECRET must be set (config / .env)")
        sys.exit(1)

    from upstox_trader.config_and_utils.upstox_api import UpstoxAPI

    api = UpstoxAPI(api_key=api_key, api_secret=api_secret, quiet=True)

    if not args.dry_run and args.migrate:
        init_db()

    print(f"Processing {len(symbols)} symbols (workers={args.workers}, delay={args.delay}s)...")

    if not args.dry_run:
        existing = get_job_status()
        if existing and existing.get("status") == "running":
            print("Another 52W batch job is already running (see Admin > 52W Range).")
            sys.exit(1)
        start_job(len(symbols), skip_existing=args.skip_existing, skip_updated_today=args.skip_updated_today)

    rate_lock = Lock()
    last_call = [0.0]

    def _throttle():
        with rate_lock:
            elapsed = time.monotonic() - last_call[0]
            if elapsed < args.delay:
                time.sleep(args.delay - elapsed)
            last_call[0] = time.monotonic()

    def _work(symbol: str) -> tuple[str, dict | None, str | None]:
        try:
            _throttle()
            entry = fetch_range_for_symbol(api, symbol, args.to_date)
            if entry is None:
                return symbol, None, "no_data"
            return symbol, entry, None
        except Exception as exc:
            return symbol, None, str(exc)

    ok = 0
    failed = 0
    skipped = 0
    pending: dict = {}
    all_ok: dict = {}
    total_added = 0
    total_updated = 0
    t0 = time.monotonic()

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(_work, sym): sym for sym in symbols}
        done = 0
        for fut in as_completed(futures):
            done += 1
            symbol, entry, err = fut.result()
            if entry:
                ok += 1
                pending[symbol] = entry
                all_ok[symbol] = entry
                if not args.dry_run and (done <= 5 or done % 25 == 0 or done == len(symbols)):
                    elapsed = time.monotonic() - t0
                    rate = done / elapsed if elapsed > 0 else 0
                    eta_sec = (len(symbols) - done) / rate if rate > 0 else 0
                    update_job_progress(
                        done, len(symbols), ok=ok, failed=failed, skipped=skipped, last_symbol=symbol
                    )
                if done <= 5 or done % 50 == 0 or done == len(symbols):
                    elapsed = time.monotonic() - t0
                    rate = done / elapsed if elapsed > 0 else 0
                    eta_sec = (len(symbols) - done) / rate if rate > 0 else 0
                    print(
                        f"  [{done}/{len(symbols)}] {symbol}: "
                        f"H={entry['high']:.2f} L={entry['low']:.2f} C={entry['close']:.2f}"
                        + (f" | {int(eta_sec // 60)}m{int(eta_sec % 60)}s remaining" if eta_sec > 60 else "")
                    )
            elif err == "no_data":
                skipped += 1
            else:
                failed += 1
                if failed <= 10:
                    print(f"  [{done}/{len(symbols)}] {symbol}: ERROR {err}")

            if not args.dry_run and len(pending) >= DB_FLUSH_EVERY:
                a, u = persist_ranges(pending, redis=False)
                total_added += a
                total_updated += u
                pending.clear()

    if not args.dry_run and all_ok:
        a, u = persist_ranges(all_ok, redis=False)
        total_added += a
        total_updated += u

    if args.redis and not args.dry_run and all_ok:
        from api_server_fastapi import _load_52w_ranges_from_redis, _store_52w_ranges_in_redis

        # Try Redis first (has days_ago), fall back to DB if cache was cleared
        merged = _load_52w_ranges_from_redis()
        if not merged:
            db = SessionLocal()
            try:
                rows = db.query(Stock52WeekRange).all()
                merged = {r.symbol: {"high": r.high_52w, "low": r.low_52w, "close": r.close, "days_ago": r.days_ago} for r in rows}
            finally:
                db.close()
        merged.update(all_ok)
        _store_52w_ranges_in_redis(merged)
        print(f"Redis cache updated ({len(merged)} symbols).")

    if args.dry_run and all_ok:
        sym, entry = next(iter(all_ok.items()))
        print(f"Dry-run sample {sym}: {entry}")

    elapsed = time.monotonic() - t0
    if not args.dry_run:
        finish_job(
            ok=ok,
            failed=failed,
            skipped=skipped,
            total=len(symbols),
            elapsed_sec=elapsed,
        )
    print(
        f"\nDone in {elapsed:.1f}s — ok={ok} skipped={skipped} failed={failed} "
        f"(db +{total_added} ~{total_updated} updated)"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        fail_job(str(exc))
        raise