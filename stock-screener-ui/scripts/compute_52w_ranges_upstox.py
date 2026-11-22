#!/usr/bin/env python3

from __future__ import annotations

import argparse
import gzip
import json
import os
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

# Cleared when a run is compute-only or Redis-free so the top-level exception
# handler never reaches for the Redis-backed job status.
JOB_STATUS_ENABLED = True


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


def build_ranges_payload(as_of: str, ranges: dict) -> dict:
    """Compact release payload: {as_of, count, symbols{symbol: {high, low, close, days_ago}}}."""
    symbols = {}
    for symbol in sorted(ranges):
        info = ranges[symbol]
        days = info.get("days_ago")
        symbols[symbol] = {
            "high": float(info["high"]),
            "low": float(info["low"]),
            "close": float(info["close"]),
            "days_ago": None if days is None else max(0, int(days)),
        }
    return {"as_of": as_of, "count": len(symbols), "symbols": symbols}


def write_ranges_json(path: str | Path, payload: dict) -> Path:
    """Write the payload atomically; a ``.gz`` target is gzipped deterministically."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".tmp")
    blob = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    if target.suffix == ".gz":
        blob = gzip.compress(blob, mtime=0)
    try:
        with open(tmp, "wb") as f:
            f.write(blob)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, target)
    finally:
        if tmp.exists():
            tmp.unlink()
    return target


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


def _range_changed(row: Stock52WeekRange, info: dict) -> bool:
    return (
        row.high_52w != info["high"]
        or row.low_52w != info["low"]
        or row.close != info["close"]
        or row.days_ago != info.get("days_ago")
    )


def persist_ranges(data: dict, redis: bool) -> tuple[int, int]:
    """Upsert into stock_52w_range; optionally refresh Redis cache.

    Only rows whose values actually changed are written. Running a batch that
    recomputes identical ranges used to dirty all ~3k rows and hold the SQLite
    writer for seconds, which is what stalled the auth/config reads.
    """
    if not data:
        return 0, 0

    db = SessionLocal()
    added = 0
    updated = 0
    try:
        # Scope the read to this chunk: the caller batches at DB_FLUSH_EVERY, so
        # this stays well under SQLite's bound-parameter limit and avoids
        # reloading the whole table for every flush.
        existing = {
            r.symbol: r
            for r in db.query(Stock52WeekRange)
            .filter(Stock52WeekRange.symbol.in_(list(data)))
            .all()
        }
        now = datetime.now(config.IST).replace(tzinfo=None)
        for symbol, info in data.items():
            cur = existing.get(symbol)
            if cur is None:
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
                added += 1
            elif _range_changed(cur, info):
                cur.high_52w = info["high"]
                cur.low_52w = info["low"]
                cur.close = info["close"]
                cur.days_ago = info.get("days_ago")
                cur.updated_at = now
                updated += 1
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    # Redis write is deferred to the merge step in main() so the bulk key is
    # written ONCE with the complete merged data, not once per chunk.
    return added, updated


def flush_pending(pending: dict) -> tuple[int, int]:
    """Persist and clear the buffered chunk. Never re-writes already-flushed rows."""
    if not pending:
        return 0, 0
    added, updated = persist_ranges(pending, redis=False)
    pending.clear()
    return added, updated


def queue_range(
    pending: dict,
    symbol: str,
    info: dict,
    flush_every: int = DB_FLUSH_EVERY,
) -> tuple[int, int]:
    pending[symbol] = info
    if len(pending) >= flush_every:
        return flush_pending(pending)
    return 0, 0


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
    parser.add_argument(
        "--limit",
        "--max-symbols",
        dest="limit",
        type=int,
        default=0,
        help="Max symbols to process (0 = all); --max-symbols is an alias for smoke tests",
    )
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help="Parallel fetch workers")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY_SEC, help="Sleep after each API call")
    parser.add_argument("--to-date", dest="to_date", help="As-of date YYYY-MM-DD (default: today IST)")
    parser.add_argument("--dry-run", action="store_true", help="Fetch only; do not write DB/Redis")
    parser.add_argument(
        "--output-json",
        metavar="PATH",
        help=(
            "Compute-only: write compact ranges JSON to PATH ('.gz' compresses). "
            "Implies --no-db --no-redis and skips the Redis job status."
        ),
    )
    parser.add_argument(
        "--no-db",
        action="store_true",
        help="Skip stock_52w_range writes (reads for skip flags still run unless --dry-run)",
    )
    parser.add_argument(
        "--no-redis",
        action="store_true",
        help="Skip Redis job status and the 52w_range bulk cache write",
    )
    parser.add_argument(
        "--allow-empty",
        action="store_true",
        help="Exit 0 when no symbols remain (scheduled catch-up no-op)",
    )
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

    global JOB_STATUS_ENABLED
    compute_only = bool(args.output_json)
    db_writes = not (args.dry_run or args.no_db or compute_only)
    db_reads = not (args.dry_run or args.no_db)
    redis_enabled = not (args.dry_run or args.no_redis or compute_only) and args.redis
    JOB_STATUS_ENABLED = not (args.dry_run or args.no_redis or compute_only)

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
    if args.skip_existing and db_reads:
        db = SessionLocal()
        try:
            have = {r.symbol for r in db.query(Stock52WeekRange.symbol).all()}
            before = len(symbols)
            symbols = [s for s in symbols if s not in have]
            print(f"Skip-existing: {before - len(symbols)} already in DB, {len(symbols)} remaining")
        finally:
            db.close()

    if args.skip_updated_today and db_reads:
        try:
            db = SessionLocal()
            try:
                # updated_at only moves when a range actually changed, so a symbol
                # that recomputes identically keeps its older stamp and is fetched
                # again on the next run. In practice `close` moves for most names
                # intraday, so the daily dedupe still holds during market hours.
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
        except Exception as exc:
            # A compute-only host has no seeded table; catch-up freshness is then
            # unknowable, so process the full list instead of failing the run.
            if not compute_only:
                raise
            print(f"Skip-updated-today unavailable ({exc}); processing all symbols")

    if args.limit > 0:
        symbols = symbols[: args.limit]

    if not symbols:
        if args.allow_empty:
            print("No symbols to process (no-op).")
            return
        print("No symbols to process.")
        sys.exit(1)

    api_key = config.UPSTOX_API_KEY
    api_secret = config.UPSTOX_API_SECRET
    if not api_key or not api_secret:
        print("UPSTOX_API_KEY and UPSTOX_API_SECRET must be set (config / .env)")
        sys.exit(1)

    from upstox_trader.config_and_utils.upstox_api import UpstoxAPI

    api = UpstoxAPI(api_key=api_key, api_secret=api_secret, quiet=True)

    if db_writes and args.migrate:
        init_db()

    print(f"Processing {len(symbols)} symbols (workers={args.workers}, delay={args.delay}s)...")

    if JOB_STATUS_ENABLED:
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
                all_ok[symbol] = entry
                if db_writes:
                    a, u = queue_range(pending, symbol, entry)
                    total_added += a
                    total_updated += u
                if JOB_STATUS_ENABLED and (done <= 5 or done % 25 == 0 or done == len(symbols)):
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

    if db_writes and pending:
        a, u = flush_pending(pending)
        total_added += a
        total_updated += u

    if redis_enabled and all_ok:
        from cache.week52 import load_52w_ranges, store_52w_ranges

        merged = load_52w_ranges()
        if not merged and db_reads:
            db = SessionLocal()
            try:
                rows = db.query(Stock52WeekRange).all()
                merged = {r.symbol: {"high": r.high_52w, "low": r.low_52w, "close": r.close, "days_ago": r.days_ago} for r in rows}
            finally:
                db.close()
        merged.update(all_ok)
        store_52w_ranges(merged)
        print(f"Redis cache updated ({len(merged)} symbols).")

    if compute_only:
        as_of = _date_range(args.to_date)[1]
        payload = build_ranges_payload(as_of, all_ok)
        written = write_ranges_json(args.output_json, payload)
        print(f"Wrote {payload['count']} ranges ({as_of}) to {written}")

    if args.dry_run and all_ok:
        sym, entry = next(iter(all_ok.items()))
        print(f"Dry-run sample {sym}: {entry}")

    elapsed = time.monotonic() - t0
    if JOB_STATUS_ENABLED:
        finish_job(
            ok=ok,
            failed=failed,
            skipped=skipped,
            total=len(symbols),
            elapsed_sec=elapsed,
        )
    if compute_only:
        print(
            f"\nDone in {elapsed:.1f}s — ok={ok} skipped={skipped} failed={failed} "
            f"(compute-only, {len(all_ok)} ranges written)"
        )
    else:
        print(
            f"\nDone in {elapsed:.1f}s — ok={ok} skipped={skipped} failed={failed} "
            f"(db +{total_added} ~{total_updated} changed)"
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        if JOB_STATUS_ENABLED:
            fail_job(str(exc))
        raise