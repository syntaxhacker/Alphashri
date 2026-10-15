#!/usr/bin/env python3
"""NSE bulk/block deals -> "how have those stocks moved since?" EDA.

Question
--------
For the **last few NSE sessions** of disclosed bulk/block deals, how have the
involved stocks moved *since* (right now)? This script produces a self-contained
EDA report (Markdown + HTML + CSVs + PNGs) for the *current* state — it is a
descriptive study, **not** a strategy, backtest, or recommendation.

Data sources (all verified live)
--------------------------------
* **Deals** — NSE archive API, fetched **day by day** (a multi-day range returns
  only the first day, capped at ~70 rows)::

      GET https://www.nseindia.com/api/historicalOR/bulk-block-short-deals
          ?optionType=bulk_deals|block_deals&from=DD-MM-YYYY&to=DD-MM-YYYY

  Raw JSON is cached under ``india_board/data/bulk_deals_hist/raw/``.
* **Latest-day supplement** — ``snapshot-capital-market-largedeal`` (full
  bulk + block list for the latest session) and ``archives.../bulk.csv``.
* **Classification / valuation** — reuses
  :func:`india_board.scripts.bulk_deals.classify_client` and
  ``_instrument_type`` (this file is imported, never edited).
* **Prices** — ``yfinance`` daily bars (``<SYMBOL>.NS``), ``^NSEI`` benchmark.
  A trailing row whose ``Close`` is NaN (the not-yet-settled current session)
  is dropped; when the *latest* session's daily close is NaN but its intraday
  5-minute bars exist, that session's last intraday close is used as a clearly
  flagged **proxy** so "right now" stays current.

Honesty rules
-------------
* No advice language, no claimed edge.
* ``n`` is printed on every statistic; means/expectancy with ``n < 20`` are
  replaced by ``insufficient sample (n<20)`` in the rendered report.
* The archive API caps at ~70 rows/day → coverage is **partial**.
* The NSE *deal date* need not be the start of the price impact.
* The report is always written, even when a cohort is empty.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402
import requests  # noqa: E402
import yfinance as yf  # noqa: E402

# ---------------------------------------------------------------------------
# paths / imports
# ---------------------------------------------------------------------------
_HERE = Path(__file__).resolve()
REPO_ROOT = _HERE.parents[2]  # .../stock-screener-ui
SCRIPTS_DIR = _HERE.parent  # .../india_board/scripts
for _p in (str(SCRIPTS_DIR), str(REPO_ROOT)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from bulk_deals import (  # noqa: E402  (reuse, do not re-implement)
    INSTITUTIONAL_TYPES,
    _instrument_type,
    classify_client,
    read_day as read_backfilled_day,
)

try:  # package import (india_board.scripts.bulk_deals)
    from bulk_deals import DATA_DIR as BACKFILLED_DIR  # type: ignore
except ImportError:  # pragma: no cover - defensive
    BACKFILLED_DIR = REPO_ROOT / "india_board" / "data" / "bulk_deals"


def _load_costs_fn():
    """Load ``backtest/costs.py:calculate_trading_costs`` without importing the
    whole ``backtest`` package. Mirrors ``bulk_deal_study._load_costs_fn`` so
    costs stay the repo's single source of truth.
    """
    import importlib.util

    path = REPO_ROOT / "backtest" / "costs.py"
    spec = importlib.util.spec_from_file_location("_alphashri_eda_costs", path)
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise RuntimeError("cannot load backtest/costs.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.calculate_trading_costs


calculate_trading_costs = _load_costs_fn()
#: Free share quantity used for the follower cost model.
DEFAULT_QTY = 100

IST = ZoneInfo("Asia/Kolkata")
DATA_ROOT = REPO_ROOT / "india_board" / "data" / "bulk_deals_hist"
RAW_DIR = DATA_ROOT / "raw"
DEALS_CACHE = DATA_ROOT / "deals_combined.json"
CANDLES_CACHE = DATA_ROOT / "candles.json"

NSE_HIST_URL = "https://www.nseindia.com/api/historicalOR/bulk-block-short-deals"
NSE_SNAPSHOT_URL = "https://www.nseindia.com/api/snapshot-capital-market-largedeal"
NSE_BULK_CSV_URL = "https://archives.nseindia.com/content/equities/bulk.csv"
NSE_REFERER = "https://www.nseindia.com/report-detail/display-bulk-and-block-deals"
UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
NSE_HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": NSE_REFERER,
}

ARCHIVE_TYPES = (("bulk_deals", "bulk"), ("block_deals", "block"))
BUCKETS = ("20-50", "50-100", "100+")
LARGE_BUY_CR = 50.0
MIN_USABLE_ROWS = 30
HORIZONS = (("+1", "fwd_1", "nifty_1"), ("+2", "fwd_2", "nifty_2"),
            ("+5", "fwd_5", "nifty_5"), ("since", "since_deal", "nifty_since"))
CLIENT_MIN_N = 3          # rank clients with at least this many stock-days
CONTROL_Z = 10.0          # control cohort: volume z-score threshold
CONTROL_CAP = 200         # control cohort: max sampled observations
CONTROL_SEED = 20261001   # control cohort: fixed RNG seed (reproducible)
PRE_HORIZONS = (5, 10)    # pre-deal decomposition windows (sessions)

#: Passive (index / ETF / benchmark-mandate) client markers. An index-rebalance
#: buy carries no stock-specific conviction, so it must be split out of the
#: "active" institutional cohort before any per-client claim is made.
PASSIVE_PATTERNS = (
    "VANGUARD", "INDEX", "ETF", "ISHARES", "NIFTY", "SENSEX", "MSCI",
    "BLACKROCK INDEX",
)

EVENT_FIELDS = [
    "cohort", "deal_date", "entry_date", "symbol", "name", "client",
    "client_type", "client_confidence", "side", "deal_type", "instrument_type",
    "qty", "watp", "value_cr", "bucket", "is_large_buy", "activity",
    "vol_ratio_20", "vol_z_20", "day_ret_pct",
    "pre_5", "pre_10",
    "fwd_1", "fwd_2", "fwd_5", "since_deal",
    "net_1", "net_2", "net_5",
    "nifty_1", "nifty_2", "nifty_5", "nifty_since",
    "excess_1", "excess_2", "excess_5", "excess_since",
    "max_fav_pct", "max_adv_pct", "days_since_deal", "cal_days_since_deal",
    "above_entry", "pct_from_deal_low", "pct_from_deal_high", "entry_note",
    "n_clients", "stock_day_value_cr",
]

#: One row per ``(symbol, deal_date)`` — the honest unit of observation when
#: several clients bought the same name on the same session.
STOCK_DAY_FIELDS = [
    "cohort", "deal_date", "entry_date", "symbol", "name", "client",
    "client_type", "activity", "side", "instrument_type",
    "n_clients", "stock_day_value_cr", "value_cr",
    "vol_z_20", "day_ret_pct",
    "pre_5", "pre_10", "fwd_1", "fwd_2", "fwd_5", "since_deal",
    "net_1", "net_2", "net_5",
    "excess_1", "excess_2", "excess_5", "excess_since",
]

#: Per-client leaderboard row (BUY and SELL written to the same CSV/table).
CLIENT_FIELDS = [
    "side", "client", "client_type", "activity", "n_stock_days",
    "total_value_cr", "mean_since", "median_since", "mean_1", "mean_2",
    "mean_5", "pct_positive", "value_weighted_since", "ranked",
]



# ---------------------------------------------------------------------------
# tiny helpers
# ---------------------------------------------------------------------------
def _clean(value) -> str:
    return " ".join(str(value or "").split()).strip()


def _num(value):
    """Finite float or ``None`` (comma/str tolerated)."""
    if value is None or isinstance(value, bool):
        return None
    try:
        f = float(str(value).replace(",", "").strip()) if not isinstance(
            value, (int, float)) else float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _r2(value):
    return None if value is None else round(float(value), 2)


def _js(value):
    """Recursively make a structure JSON-safe (NaN/Inf -> None)."""
    if isinstance(value, float):
        return None if (math.isnan(value) or math.isinf(value)) else value
    if isinstance(value, dict):
        return {str(k): _js(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_js(v) for v in value]
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def _pct(value, digits: int = 2) -> str:
    if value is None:
        return "–"
    return f"{value:+.{digits}f}%"


def _num_fmt(value, digits: int = 2) -> str:
    if value is None:
        return "–"
    return f"{value:.{digits}f}"


def _mean(values):
    vals = [v for v in values if v is not None]
    return statistics.mean(vals) if vals else None


def _median(values):
    vals = [v for v in values if v is not None]
    return statistics.median(vals) if vals else None


def _stdev(values):
    vals = [v for v in values if v is not None]
    return statistics.stdev(vals) if len(vals) >= 2 else None


def _pct_positive(values):
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    return 100.0 * sum(1 for v in vals if v > 0) / len(vals)


def _value_weighted_mean(values, weights):
    """Weighted mean over pairs where both value and weight are usable."""
    pairs = [(v, w) for v, w in zip(values, weights)
             if v is not None and w is not None and w > 0]
    tot = sum(w for _v, w in pairs)
    if not pairs or tot <= 0:
        return None
    return sum(v * w for v, w in pairs) / tot


def classify_activity(client) -> str:
    """``passive`` for index/ETF/benchmark mandates, else ``active``.

    Rationale: an index-rebalance or ETF-creation buy is mechanical and carries
    no stock-specific conviction, so it must not be pooled with discretionary
    institutional buying.
    """
    name = _clean(client).upper()
    if not name:
        return "active"
    return "passive" if any(p in name for p in PASSIVE_PATTERNS) else "active"


def net_return_pct(entry_price, exit_price, quantity=DEFAULT_QTY):
    """Gross return % minus the repo cost model's round-trip cost %."""
    entry = _num(entry_price)
    exit_ = _num(exit_price)
    qty = int(quantity)
    if entry in (None, 0.0) or exit_ is None or qty <= 0:
        return None
    gross = (exit_ - entry) / entry * 100.0
    costs = calculate_trading_costs(entry, exit_, qty, side="LONG")
    cost_pct = costs["total_costs"] / (entry * qty) * 100.0
    return gross - cost_pct


def _jsonl_record_to_deal(rec: dict) -> dict | None:
    """Map a backfilled ``bulk_deals`` JSONL record to the EDA deal shape."""
    if not isinstance(rec, dict):
        return None
    symbol = _clean(rec.get("symbol")).upper()
    client = _clean(rec.get("client"))
    if not symbol or not client:
        return None
    side = _clean(rec.get("side")).upper()
    if side in ("B", "BUY"):
        side = "BUY"
    elif side in ("S", "SELL"):
        side = "SELL"
    cls = classify_client(client)
    return {
        "deal_date": _clean(rec.get("date"))[:10],
        "symbol": symbol,
        "name": _clean(rec.get("name")),
        "client": client,
        "side": side,
        "qty": int(_num(rec.get("qty")) or 0),
        "watp": float(_num(rec.get("watp")) or 0.0),
        "value_cr": _r2(rec.get("value_cr")),
        "deal_type": _clean(rec.get("deal_type") or "bulk").lower(),
        "client_type": rec.get("client_type") or cls["client_type"],
        "client_confidence": rec.get("client_confidence") or cls["client_confidence"],
        "matched_pattern": rec.get("matched_pattern") or cls["matched_pattern"],
        "instrument_type": rec.get("instrument_type")
        or _instrument_type(symbol, _clean(rec.get("name"))),
        "source": "nse_jsonl_archive",
    }


def _json_load(path: Path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def _json_dump(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(_js(payload), fh, indent=2, sort_keys=True)
    tmp.replace(path)


def _write_csv(path: Path, rows, fields) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: _js(row.get(k)) for k in fields})


# ---------------------------------------------------------------------------
# dates
# ---------------------------------------------------------------------------
def _ist_now() -> datetime:
    return datetime.now(IST)


def default_anchor() -> date:
    """Latest session that should already have published deals.

    NSE publishes after ~18:00 IST, so before that we anchor to the previous
    weekday; weekends roll back to Friday.
    """
    now = _ist_now()
    d = now.date()
    if now.hour < 18:
        d -= timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def trading_days(end: date, n: int) -> list[date]:
    """Last ``n`` weekdays (Sat/Sun skipped) ending at ``end`` inclusive."""
    days: list[date] = []
    d = end
    while len(days) < n:
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    return list(reversed(days))


def _parse_iso(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if hasattr(value, "date") and not isinstance(value, str):
        try:
            return value.date()
        except Exception:
            return None
    s = str(value).strip()[:11]
    for fmt in ("%Y-%m-%d", "%d-%b-%Y", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------------------
# NSE fetch
# ---------------------------------------------------------------------------
def _http_get_json(url: str, params=None, *, retries: int = 3, timeout: int = 25):
    last = None
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=NSE_HEADERS, params=params,
                                timeout=timeout)
            if resp.status_code == 200 and resp.text.strip():
                return resp.json()
            last = f"HTTP {resp.status_code}"
        except Exception as exc:  # noqa: BLE001
            last = f"{type(exc).__name__}: {exc}"
        if attempt < retries - 1:
            time.sleep(2 ** attempt)
    print(f"  [warn] {url} failed ({last})", file=sys.stderr)
    return None


def fetch_deal_rows(day: date, option_type: str, *, offline: bool) -> list[dict]:
    """Raw archive rows for one day+type (cache-first when offline)."""
    ds = day.strftime("%d-%m-%Y")
    cache = RAW_DIR / f"{ds}_{option_type}.json"
    if offline:
        payload = _json_load(cache)
        return (payload or {}).get("data", []) if isinstance(payload, dict) else []
    payload = _http_get_json(NSE_HIST_URL,
                             {"optionType": option_type, "from": ds, "to": ds})
    if payload is None:
        payload = _json_load(cache)  # fall back to a previous capture
    if payload is None:
        return []
    _json_dump(cache, payload)
    data = payload.get("data", []) if isinstance(payload, dict) else []
    return data if isinstance(data, list) else []


def fetch_latest_supplement(latest: date, *, offline: bool) -> list[dict]:
    """Full latest-day lists (snapshot API + archives CSV), tagged with type."""
    rows: list[dict] = []
    snap_cache = RAW_DIR / f"{latest.isoformat()}_snapshot.json"
    csv_cache = RAW_DIR / f"{latest.isoformat()}_bulk.csv"

    if offline:
        payload = _json_load(snap_cache)
        csv_text = None
    else:
        payload = _http_get_json(NSE_SNAPSHOT_URL)
        if payload is not None:
            _json_dump(snap_cache, payload)
        else:
            payload = _json_load(snap_cache)
        try:
            resp = requests.get(NSE_BULK_CSV_URL, headers={"User-Agent": UA},
                                timeout=25)
            csv_text = resp.text if resp.status_code == 200 else None
        except Exception:  # noqa: BLE001
            csv_text = None
        if csv_text:
            csv_cache.parent.mkdir(parents=True, exist_ok=True)
            csv_cache.write_text(csv_text, encoding="utf-8")

    if isinstance(payload, dict):
        for key, dt in (("BULK_DEALS_DATA", "bulk"), ("BLOCK_DEALS_DATA", "block")):
            for r in payload.get(key, []) or []:
                if isinstance(r, dict):
                    rows.append({"__type": dt, "__row": r, "__src": "snapshot"})

    if not offline and csv_text is None and csv_cache.exists():
        csv_text = csv_cache.read_text(encoding="utf-8")
    if csv_text:
        import io as _io
        reader = csv.DictReader(_io.StringIO(csv_text))
        for r in reader:
            rows.append({"__type": "bulk", "__row": r, "__src": "bulk_csv"})
    return rows


# ---------------------------------------------------------------------------
# normalize + classify + dedupe
# ---------------------------------------------------------------------------
def _archive_row_to_deal(row: dict, fallback_date: date, deal_type: str,
                         src: str) -> dict | None:
    """Map an archive/snapshot/CSV row to a normalized deal record."""
    symbol = _clean(row.get("BD_SYMBOL") or row.get("symbol") or row.get("Symbol"))
    client = _clean(row.get("BD_CLIENT_NAME") or row.get("clientName")
                    or row.get("Client Name"))
    if not symbol or not client:
        return None
    raw_date = (row.get("BD_DT_DATE") or row.get("date") or row.get("Date"))
    deal_day = _parse_iso(raw_date) or fallback_date

    side = _clean(row.get("BD_BUY_SELL") or row.get("buySell")
                  or row.get("Buy/Sell")).upper()
    if side in ("B", "BUY"):
        side = "BUY"
    elif side in ("S", "SELL"):
        side = "SELL"

    qty = _num(row.get("BD_QTY_TRD") or row.get("qty")
               or row.get("Quantity Traded")) or 0
    watp = _num(row.get("BD_TP_WATP") or row.get("watp")
                or row.get("Trade Price / Wght. Avg. Price")) or 0.0
    name = _clean(row.get("BD_SCRIP_NAME") or row.get("name")
                  or row.get("Security Name"))
    cls = classify_client(client)
    return {
        "deal_date": deal_day.isoformat(),
        "symbol": symbol.upper(),
        "name": name,
        "client": client,
        "side": side,
        "qty": int(qty),
        "watp": float(watp),
        "value_cr": round(float(qty) * float(watp) / 1e7, 2),
        "deal_type": deal_type,
        "client_type": cls["client_type"],
        "client_confidence": cls["client_confidence"],
        "matched_pattern": cls["matched_pattern"],
        "instrument_type": _instrument_type(symbol, name),
        "source": src,
    }


def _backfilled_day_deals(day: date) -> list[dict]:
    """Deals recorded on disk by ``bulk_deals.backfill`` for one session.

    Reads ``india_board/data/bulk_deals/{YYYY-MM-DD}.jsonl`` (the Task-1
    deliverable) and maps each normalized record into the EDA deal shape.
    Returns ``[]`` when the day has no file or the file is empty.
    """
    try:
        records = read_backfilled_day(day.isoformat(), root=BACKFILLED_DIR)
    except Exception:  # noqa: BLE001 - a bad archive file must not abort the run
        return []
    out: list[dict] = []
    for rec in records:
        d = _jsonl_record_to_deal(rec)
        if d is not None and d["deal_date"] == day.isoformat():
            out.append(d)
    return out


def collect_deals(days: list[date], *, offline: bool) -> tuple[list[dict], dict]:
    """Fetch/normalize/dedupe deals over ``days``. Returns (deals, stats).

    Online: prefers the backfilled JSONL archive (fast, already deduped) and
    only hits NSE for sessions it does not cover. Offline: prefers the cached
    combined payload, then the JSONL archive, then the per-day raw cache.
    """
    day_iso_set = {d.isoformat() for d in days}
    raw_count = 0
    deals: list[dict] = []
    per_day: dict[str, int] = {}
    jsonl_days = 0
    fetched_days = 0

    if offline:
        cached = _json_load(DEALS_CACHE)
        cached_deals = cached.get("deals") if isinstance(cached, dict) else None
        if isinstance(cached_deals, list) and cached_deals:
            deals = [d for d in cached_deals
                     if isinstance(d, dict) and d.get("deal_date") in day_iso_set]
            for d in deals:
                per_day[d["deal_date"]] = per_day.get(d["deal_date"], 0) + 1
            if deals:
                stats = dict(cached.get("stats") or {})
                stats.update({"per_day": per_day, "deduped_rows": len(deals),
                              "source_mode": "deals_cache"})
                return deals, stats

    for day in days:
        iso = day.isoformat()
        seeded = _backfilled_day_deals(day)
        if seeded:
            deals.extend(seeded)
            per_day[iso] = len(seeded)
            jsonl_days += 1
            continue
        if offline:
            # no combined cache and no JSONL: fall back to the per-day raw cache
            day_n = 0
            for option_type, deal_type in ARCHIVE_TYPES:
                for r in fetch_deal_rows(day, option_type, offline=True):
                    d = _archive_row_to_deal(r, day, deal_type, "nse_archive")
                    if d is not None:
                        deals.append(d)
                        day_n += 1
            per_day[iso] = day_n
            continue
        day_n = 0
        fetched_days += 1
        for option_type, deal_type in ARCHIVE_TYPES:
            rows = fetch_deal_rows(day, option_type, offline=False)
            raw_count += len(rows)
            for r in rows:
                d = _archive_row_to_deal(r, day, deal_type, "nse_archive")
                if d is not None:
                    deals.append(d)
                    day_n += 1
            time.sleep(1.0)  # polite gap
        per_day[iso] = day_n

    # full latest-day supplement (only when online — it is a network-only top-up)
    latest = days[-1]
    if not offline:
        for item in fetch_latest_supplement(latest, offline=offline):
            d = _archive_row_to_deal(item["__row"], latest, item["__type"], item["__src"])
            if d is not None:
                deals.append(d)

    # global dedupe (the same trade can appear in both the bulk + block feeds,
    # and in both the archive + snapshot/CSV)
    seen: dict[tuple, dict] = {}
    deduped: list[dict] = []
    for d in deals:
        key = (d["deal_date"], d["symbol"], d["client"], d["side"], d["qty"],
               round(d["watp"], 4))
        prev = seen.get(key)
        if prev is not None:
            if prev.get("deal_type") != d["deal_type"]:
                prev["deal_type_alt"] = d["deal_type"]
            if prev.get("source") != d["source"]:
                prev["source_alt"] = d["source"]
            continue
        seen[key] = d
        deduped.append(d)

    stats = {
        "raw_rows": raw_count,
        "normalized_rows": len(deals),
        "deduped_rows": len(deduped),
        "per_day": per_day,
        "latest_day_supplement": latest.isoformat(),
        "archive_cap": 70,
        "jsonl_days_seeded": jsonl_days,
        "network_days_fetched": fetched_days,
    }
    return deduped, stats


# ---------------------------------------------------------------------------
# prices (yfinance)
# ---------------------------------------------------------------------------
def _guess_reason(text: str) -> str:
    t = (text or "").lower()
    if "delisted" in t or "no data" in t or "not found" in t or "no timezone" in t:
        return "yfinance: no data (delisted / unsupported symbol)"
    return f"yfinance error: {text[:120]}"


def _yf_daily(tickers: list[str], start: date, end: date) -> dict:
    """Daily bars for many tickers (batch, per-symbol fallback)."""
    out: dict[str, dict] = {}
    errs: dict[str, str] = {}
    if not tickers:
        return out, errs
    df = None
    try:
        df = yf.download(tickers, start=start.isoformat(), end=end.isoformat(),
                         auto_adjust=False, progress=False, threads=True,
                         group_by="ticker")
    except Exception as exc:  # noqa: BLE001
        errs["__batch__"] = str(exc)
    for t in tickers:
        sub = None
        if df is not None and len(df):
            try:
                sub = df[t].copy() if isinstance(df.columns, pd.MultiIndex) else df.copy()
            except Exception:  # noqa: BLE001
                sub = None
        if sub is None or sub.empty:
            try:
                sub = yf.Ticker(t).history(start=start.isoformat(),
                                            end=end.isoformat(), auto_adjust=False)
            except Exception as exc:  # noqa: BLE001
                errs[t] = _guess_reason(str(exc))
                continue
        if sub is None or sub.empty:
            errs[t] = "yfinance: no data (delisted / unsupported symbol)"
            continue
        out[t] = sub
    return out, errs


def _yf_intraday(tickers: list[str], period: str = "7d") -> dict:
    out: dict[str, dict] = {}
    if not tickers:
        return out
    df = None
    try:
        df = yf.download(tickers, period=period, interval="5m",
                        auto_adjust=False, progress=False, threads=True,
                        group_by="ticker")
    except Exception:  # noqa: BLE001
        df = None
    for t in tickers:
        sub = None
        if df is not None and len(df):
            try:
                sub = df[t].copy() if isinstance(df.columns, pd.MultiIndex) else df.copy()
            except Exception:  # noqa: BLE001
                sub = None
        if sub is None or sub.empty:
            try:
                sub = yf.Ticker(t).history(period=period, interval="5m",
                                            auto_adjust=False)
            except Exception:  # noqa: BLE001
                sub = None
        if sub is not None and not sub.empty:
            out[t] = sub
    return out


def _to_ist_index(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return df
    out = df.copy()
    try:
        if out.index.tz is None:
            out.index = out.index.tz_localize("UTC")
        out.index = out.index.tz_convert(IST)
    except Exception:  # noqa: BLE001
        pass
    return out


def build_series(df_daily, df_intra) -> dict[str, dict]:
    """``{ISO date: {close, volume, source}}`` for one symbol.

    Daily rows with a NaN ``Close`` are dropped. If the *latest* session has no
    settled daily close but intraday 5-minute bars exist, its last intraday
    close is added as an explicitly flagged ``intraday_proxy`` row so the
    "right now" price stays as fresh as the source allows.
    """
    series: dict[str, dict] = {}
    raw_vol: dict[str, float] = {}
    if df_daily is not None and not df_daily.empty:
        d = _to_ist_index(df_daily)
        for ts, row in d.iterrows():
            close = _num(row.get("Close"))
            vol = _num(row.get("Volume"))
            day = ts.date().isoformat()
            if vol is not None:
                raw_vol[day] = vol
            if close is None:
                continue
            series[day] = {"close": float(close), "volume": vol, "source": "daily"}
    if df_intra is not None and not df_intra.empty:
        ii = _to_ist_index(df_intra)
        ii = ii[ii["Close"].notna()]
        for day_ts, grp in ii.groupby(ii.index.date):
            day = day_ts.isoformat()
            if day in series:
                continue
            try:
                close = float(grp["Close"].iloc[-1])
            except Exception:  # noqa: BLE001
                continue
            if math.isnan(close) or math.isinf(close):
                continue
            series[day] = {"close": close,
                           "volume": raw_vol.get(day),
                           "source": "intraday_proxy"}
    return dict(sorted(series.items()))


def load_prices(symbols: list[str], start: date, end: date, *,
                offline: bool) -> tuple[dict, dict, dict]:
    """Return (series_by_symbol, status, meta). ``status`` explains skips."""
    cached = _json_load(CANDLES_CACHE)
    if offline:
        if not isinstance(cached, dict):
            raise SystemExit(f"--offline but no candles cache at {CANDLES_CACHE}")
        return cached.get("series", {}), cached.get("status", {}), {
            "source": "cache", "fetched_at": cached.get("fetched_at")}

    tickers = [f"{s}.NS" for s in symbols]
    daily, errs = _yf_daily(tickers, start, end)
    intra = _yf_intraday(tickers, period="7d")
    bench_daily, bench_errs = _yf_daily(["^NSEI"], start, end)
    bench_intra = _yf_intraday(["^NSEI"], period="7d")

    series: dict[str, dict] = {}
    status: dict[str, dict] = {}
    for sym in symbols:
        t = f"{sym}.NS"
        ser = build_series(daily.get(t), intra.get(t))
        usable = sum(1 for v in ser.values() if v["source"] == "daily")
        total = len(ser)
        if not ser:
            status[sym] = {
                "ok": False, "usable_rows": 0,
                "reason": errs.get(t, "yfinance: no data (delisted / unsupported symbol)")}
        elif total < MIN_USABLE_ROWS:
            status[sym] = {"ok": False, "usable_rows": total,
                           "reason": f"insufficient history ({total} usable rows < {MIN_USABLE_ROWS})"}
        else:
            status[sym] = {"ok": True, "usable_rows": total, "daily_rows": usable,
                           "last_bar": max(ser) if ser else None,
                           "used_intraday_proxy": any(
                               v["source"] == "intraday_proxy" for v in ser.values())}
        series[sym] = ser

    bench_series = build_series(bench_daily.get("^NSEI"), bench_intra.get("^NSEI"))
    meta = {
        "source": "yfinance",
        "fetched_at": _ist_now().isoformat(),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "benchmark_ok": bool(bench_series),
        "benchmark_err": bench_errs.get("^NSEI"),
    }
    payload = {"meta": meta, "series": series, "benchmark": bench_series,
               "status": status}
    _json_dump(CANDLES_CACHE, payload)
    bench = {"^NSEI": bench_series}
    return series, status, {"source": "yfinance", "fetched_at": meta["fetched_at"],
                            "benchmark": bench, "benchmark_ok": bool(bench_series),
                            "benchmark_err": meta["benchmark_err"]}


def _load_benchmark(offline: bool) -> dict:
    cached = _json_load(CANDLES_CACHE) or {}
    return cached.get("benchmark") or {}


# ---------------------------------------------------------------------------
# metrics
# ---------------------------------------------------------------------------
def _nifty_ret(nifty: dict, d0: str, d1: str):
    """NIFTY return (%) between the first close on/after d0 and on/after d1."""
    if not nifty:
        return None
    dates = sorted(nifty)
    if d0 not in nifty or d1 not in nifty:
        return None
    c0 = nifty[d0]["close"]
    c1 = nifty[d1]["close"]
    if not c0:
        return None
    return 100.0 * (c1 / c0 - 1.0)


def _price_metrics(dates: list[str], series: dict, nifty: dict, idx: int,
                   *, qty: int = DEFAULT_QTY) -> dict:
    """All price/volume/benchmark metrics for the observation at ``dates[idx]``.

    Shared by the deal-event builder and the volume-spike control cohort so both
    are measured identically. ``None`` where a window is unavailable.
    """
    entry_date = dates[idx]
    entry_close = series[entry_date]["close"]
    latest_date = dates[-1]
    latest_close = series[latest_date]["close"]

    def close_at(target_idx):
        if target_idx < 0 or target_idx >= len(dates):
            return None
        return series[dates[target_idx]]["close"]

    def ret_to(target_idx):
        c = close_at(target_idx)
        if c is None or not entry_close:
            return None
        return 100.0 * (c / entry_close - 1.0)

    fwd = {k: ret_to(idx + k) for k in (1, 2, 5)}
    since = 100.0 * (latest_close / entry_close - 1.0) if entry_close else None

    pre = {}
    for k in PRE_HORIZONS:
        c = close_at(idx - k)
        pre[k] = 100.0 * (entry_close / c - 1.0) if (c and entry_close) else None

    # volume stats vs the prior 20 sessions
    prior = dates[max(0, idx - 20):idx]
    prior_vol = [series[d]["volume"] for d in prior if series[d].get("volume") is not None]
    deal_vol = series[entry_date].get("volume")
    vol_ratio = vol_z = None
    if deal_vol is not None and prior_vol:
        base = statistics.mean(prior_vol)
        if base > 0:
            vol_ratio = deal_vol / base
        sd = _stdev(prior_vol)
        if sd:
            vol_z = (deal_vol - statistics.mean(prior_vol)) / sd

    day_ret = None
    if idx > 0:
        prev_close = series[dates[idx - 1]]["close"]
        if prev_close:
            day_ret = 100.0 * (entry_close / prev_close - 1.0)

    window = [series[d]["close"] for d in dates[idx:]]
    hi = max(window) if window else None
    lo = min(window) if window else None
    max_fav = 100.0 * (hi / entry_close - 1.0) if (hi and entry_close) else None
    max_adv = 100.0 * (lo / entry_close - 1.0) if (lo and entry_close) else None

    nifty_vals = {}
    for k in (1, 2, 5):
        nifty_vals[k] = (_nifty_ret(nifty, entry_date, dates[idx + k])
                         if idx + k < len(dates) else None)
    nifty_since = _nifty_ret(nifty, entry_date, latest_date)

    def _excess(v, b):
        return None if (v is None or b is None) else v - b

    return {
        "entry_date": entry_date,
        "fwd_1": _r2(fwd[1]),
        "fwd_2": _r2(fwd[2]),
        "fwd_5": _r2(fwd[5]),
        "since_deal": _r2(since),
        "pre_5": _r2(pre.get(5)),
        "pre_10": _r2(pre.get(10)),
        "net_1": _r2(net_return_pct(entry_close, close_at(idx + 1), qty)),
        "net_2": _r2(net_return_pct(entry_close, close_at(idx + 2), qty)),
        "net_5": _r2(net_return_pct(entry_close, close_at(idx + 5), qty)),
        "vol_ratio_20": _r2(vol_ratio),
        "vol_z_20": _r2(vol_z),
        "day_ret_pct": _r2(day_ret),
        "nifty_1": _r2(nifty_vals[1]),
        "nifty_2": _r2(nifty_vals[2]),
        "nifty_5": _r2(nifty_vals[5]),
        "nifty_since": _r2(nifty_since),
        "excess_1": _r2(_excess(fwd[1], nifty_vals[1])),
        "excess_2": _r2(_excess(fwd[2], nifty_vals[2])),
        "excess_5": _r2(_excess(fwd[5], nifty_vals[5])),
        "excess_since": _r2(_excess(since, nifty_since)),
        "max_fav_pct": _r2(max_fav),
        "max_adv_pct": _r2(max_adv),
        "days_since_deal": len(dates) - 1 - idx,
        "cal_days_since_deal": (latest_date and entry_date and
                                (_parse_iso(latest_date) - _parse_iso(entry_date)).days),
        "above_entry": bool(entry_close and latest_close and latest_close > entry_close),
        "pct_from_deal_low": _r2(100.0 * (latest_close / lo - 1.0)) if lo else None,
        "pct_from_deal_high": _r2(100.0 * (latest_close / hi - 1.0)) if hi else None,
    }


def compute_event(deal: dict, series: dict, nifty: dict, *, min_cr: float):
    """Return (event_row, skip_reason)."""
    dates = sorted(series)
    if not dates:
        return None, "no price history"
    deal_iso = deal["deal_date"]
    if deal_iso in dates:
        entry_date = deal_iso
        entry_note = ""
    else:
        nxt = next((d for d in dates if d > deal_iso), None)
        if nxt is None:
            return None, "no bar on or after deal date"
        entry_date = nxt
        entry_note = f"deal date {deal_iso} had no bar; entry = next session {nxt}"
    idx = dates.index(entry_date)
    entry_close = series[entry_date]["close"]
    if not entry_close:
        return None, "no usable entry close"

    m = _price_metrics(dates, series, nifty, idx)
    event = {
        "cohort": "institutional_sell" if deal["side"] == "SELL" else "institutional_buy",
        "deal_date": deal_iso,
        "symbol": deal["symbol"],
        "name": deal["name"],
        "client": deal["client"],
        "client_type": deal["client_type"],
        "client_confidence": deal["client_confidence"],
        "side": deal["side"],
        "deal_type": deal.get("deal_type"),
        "instrument_type": deal["instrument_type"],
        "qty": deal["qty"],
        "watp": _r2(deal["watp"]),
        "value_cr": _r2(deal["value_cr"]),
        "bucket": bucket_for(deal["value_cr"]),
        "is_large_buy": bool(deal["side"] == "BUY" and deal["value_cr"] >= LARGE_BUY_CR),
        "activity": classify_activity(deal["client"]),
        "n_clients": 1,
        "stock_day_value_cr": _r2(deal["value_cr"]),
        "entry_note": entry_note,
    }
    event.update(m)
    return event, None


def build_control_events(symbols: list[str], series_by_symbol: dict, status: dict,
                         nifty: dict, *, first_day: str, anchor: str,
                         deal_stock_days: set, cap: int = CONTROL_CAP,
                         threshold: float = CONTROL_Z,
                         seed: int = CONTROL_SEED) -> tuple[list[dict], dict]:
    """Volume-spike days **without** an institutional deal (control cohort).

    Scans the same symbol universe for sessions whose volume z-score (vs the
    prior 20 sessions) is ``>= threshold``, excluding every ``(symbol, date)``
    that already has an institutional deal, requires at least +5 forward
    sessions inside the series, then samples up to ``cap`` deterministically.
    """
    import random as _random

    candidates: list[tuple[str, int]] = []
    for sym in symbols:
        if not status.get(sym, {}).get("ok"):
            continue
        ser = series_by_symbol.get(sym) or {}
        dates = sorted(ser)
        for i in range(len(dates)):
            d = dates[i]
            if d < first_day or d > anchor:
                continue
            if (sym, d) in deal_stock_days:
                continue
            if i + 5 >= len(dates):
                continue
            prior = dates[max(0, i - 20):i]
            prior_vol = [ser[x]["volume"] for x in prior
                         if ser[x].get("volume") is not None]
            vol = ser[d].get("volume")
            if vol is None or len(prior_vol) < 5:
                continue
            sd = _stdev(prior_vol)
            if not sd:
                continue
            z = (vol - statistics.mean(prior_vol)) / sd
            if z >= threshold:
                candidates.append((sym, i))

    rng = _random.Random(int(seed))
    candidates.sort(key=lambda t: (t[0], t[1]))
    sampled = rng.sample(candidates, min(cap, len(candidates))) if candidates else []
    sampled.sort()
    events: list[dict] = []
    for sym, i in sampled:
        ser = series_by_symbol.get(sym) or {}
        dates = sorted(ser)
        m = _price_metrics(dates, ser, nifty, i)
        events.append({
            "cohort": "control_volume_spike",
            "deal_date": dates[i],
            "symbol": sym,
            "name": None,
            "client": "(volume spike, no institutional deal)",
            "client_type": "control",
            "activity": "n/a",
            "side": "NONE",
            "instrument_type": "equity",
            "value_cr": None,
            "n_clients": 1,
            "stock_day_value_cr": None,
            **m,
        })
    meta = {
        "candidates": len(candidates),
        "sampled": len(events),
        "cap": cap,
        "threshold_z": threshold,
        "seed": seed,
        "excluded_deal_stock_days": len(deal_stock_days),
    }
    return events, meta


def bucket_for(value_cr) -> str:
    if value_cr is None:
        return "?"
    if value_cr < 50:
        return "20-50"
    if value_cr < 100:
        return "50-100"
    return "100+"


# ---------------------------------------------------------------------------
# aggregates
# ---------------------------------------------------------------------------
def _scope_rows(events: list[dict], *, include_activity=True,
                include_buckets=True) -> list[tuple[str, str, list[dict]]]:
    buys = [e for e in events if e["cohort"] == "institutional_buy"]
    sells = [e for e in events if e["cohort"] == "institutional_sell"]
    scopes = [
        ("cohort", "institutional_buy", buys),
        ("cohort", "large_buy (≥₹50 Cr BUY)", [e for e in buys if e["is_large_buy"]]),
        ("cohort", "institutional_sell", sells),
    ]
    if include_activity:
        for label, cohort in (("BUY", buys), ("SELL", sells)):
            for activity in ("passive", "active"):
                scopes.append(("activity", f"{label} {activity}",
                               [e for e in cohort if e.get("activity") == activity]))
    if include_buckets:
        for b in BUCKETS:
            scopes.append(("bucket", f"BUY {b} Cr",
                           [e for e in buys if e.get("bucket") == b]))
    return scopes


def _aggregate_group(scope_type: str, scope: str, evs: list[dict],
                     view: str) -> list[dict]:
    rows: list[dict] = []
    scope_n = len(evs)
    volz = [e["vol_z_20"] for e in evs if e.get("vol_z_20") is not None]
    for label, key, nkey in HORIZONS:
        pairs = [(e[key], e.get(nkey)) for e in evs if e.get(key) is not None]
        vals = [p[0] for p in pairs]
        n = len(vals)
        excess = [p[0] - p[1] for p in pairs if p[1] is not None]
        net_vals = [e.get("net_" + key.split("_")[1]) for e in evs
                    if key != "since_deal"]
        net_vals = [v for v in net_vals if v is not None]
        rows.append({
            "view": view,
            "scope_type": scope_type,
            "scope": scope,
            "scope_n": scope_n,
            "horizon": label,
            "n": n,
            "mean_pct": _r2(_mean(vals)),
            "median_pct": _r2(_median(vals)),
            "pct_positive": _r2(_pct_positive(vals)),
            "nifty_mean_pct": _r2(_mean([p[1] for p in pairs if p[1] is not None])),
            "excess_mean_pct": _r2(_mean(excess)),
            "mean_net_pct": _r2(_mean(net_vals)) if key != "since_deal" else None,
            "mean_vol_z": _r2(_mean(volz)),
            "insufficient_sample": bool(n < 20),
        })
    return rows


def compute_aggregates(events: list[dict], *, view: str = "raw") -> list[dict]:
    rows: list[dict] = []
    for scope_type, scope, evs in _scope_rows(events):
        rows.extend(_aggregate_group(scope_type, scope, evs, view))
    return rows


def compute_control_aggregates(control_events: list[dict]) -> list[dict]:
    """Aggregates for the volume-spike control cohort (single scope)."""
    return _aggregate_group("control", "volume-spike control (no deal)",
                            control_events, "control")


def build_stock_days(events: list[dict]) -> tuple[list[dict], dict]:
    """Collapse raw deal events to one observation per (symbol, date, cohort).

    Multiple clients buying the same name on the same session are a single
    clustered event; counting each client inflates n and every mean. The
    representative row keeps the **largest** client for attribution and records
    ``n_clients`` / ``stock_day_value_cr``.
    """
    groups: dict[tuple, list[dict]] = {}
    for e in events:
        if e["cohort"] not in ("institutional_buy", "institutional_sell"):
            continue
        groups.setdefault((e["symbol"], e["deal_date"], e["cohort"]), []).append(e)
    out: list[dict] = []
    for (_sym, _day, _cohort), grp in groups.items():
        primary = max(grp, key=lambda e: (e.get("value_cr") or 0))
        total = sum((e.get("value_cr") or 0) for e in grp)
        row = {k: primary.get(k) for k in STOCK_DAY_FIELDS}
        row["n_clients"] = len(grp)
        row["stock_day_value_cr"] = _r2(total)
        # Rebucket / re-flag on the *aggregated* value so bucket scopes are honest.
        row["bucket"] = bucket_for(total)
        row["is_large_buy"] = bool(_cohort == "institutional_buy"
                                   and total >= LARGE_BUY_CR)
        out.append(row)
    meta = {
        "n_stock_days": len(out),
        "n_raw_events": sum(len(g) for g in groups.values()),
        "max_clients_one_stock_day": max((len(g) for g in groups.values()), default=0),
    }
    return out, meta


def _dedupe_client_days(events: list[dict]) -> list[dict]:
    """One observation per (client, symbol, deal_date) — largest value wins."""
    seen: dict[tuple, dict] = {}
    for e in events:
        key = (e["client"], e["symbol"], e["deal_date"])
        prev = seen.get(key)
        if prev is None or (e.get("value_cr") or 0) > (prev.get("value_cr") or 0):
            seen[key] = e
    return list(seen.values())


def client_leaderboard(events: list[dict], *, side: str) -> list[dict]:
    """Per-client forward-return stats from de-duplicated client stock-days."""
    cohort = "institutional_buy" if side == "BUY" else "institutional_sell"
    evs = _dedupe_client_days([e for e in events if e["cohort"] == cohort])
    by_client: dict[str, list[dict]] = {}
    for e in evs:
        by_client.setdefault(e["client"], []).append(e)
    rows: list[dict] = []
    for client, grp in by_client.items():
        since = [e["since_deal"] for e in grp if e["since_deal"] is not None]
        weights = [e.get("value_cr") for e in grp if e["since_deal"] is not None]
        rows.append({
            "side": side,
            "client": client,
            "client_type": grp[0].get("client_type"),
            "activity": grp[0].get("activity"),
            "n_stock_days": len(grp),
            "total_value_cr": _r2(sum(e.get("value_cr") or 0 for e in grp)),
            "mean_since": _r2(_mean(since)),
            "median_since": _r2(_median(since)),
            "mean_1": _r2(_mean([e["fwd_1"] for e in grp])),
            "mean_2": _r2(_mean([e["fwd_2"] for e in grp])),
            "mean_5": _r2(_mean([e["fwd_5"] for e in grp])),
            "pct_positive": _r2(_pct_positive(since)),
            "value_weighted_since": _r2(_value_weighted_mean(since, weights)),
            "ranked": len(grp) >= CLIENT_MIN_N,
        })
    rows.sort(key=lambda r: (r["ranked"], r["n_stock_days"],
                             r["mean_since"] if r["mean_since"] is not None else -1e9),
              reverse=True)
    return rows


# ---------------------------------------------------------------------------
# charts
# ---------------------------------------------------------------------------
def _cleanup_ax(ax):
    ax.grid(True, alpha=0.25, linestyle="--")
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)


def make_charts(events: list[dict], nifty: dict, out_dir: Path, *,
                stock_days: list[dict] | None = None,
                control_events: list[dict] | None = None,
                clients: list[dict] | None = None) -> list[str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    made: list[str] = []
    stock_days = stock_days or []
    control_events = control_events or []
    clients = clients or []
    try:
        plt.style.use("dark_background")   # matches the dark report
        plt.rcParams.update({
            "figure.facecolor": "#111a2b",
            "axes.facecolor": "#111a2b",
            "savefig.facecolor": "#111a2b",
            "axes.edgecolor": "#24324a",
            "grid.color": "#1e293b",
            "text.color": "#e2e8f0",
            "axes.labelcolor": "#cbd5e1",
            "xtick.color": "#94a3b8",
            "ytick.color": "#94a3b8",
            "axes.titlecolor": "#f1f5f9",
        })
    except Exception:  # noqa: BLE001
        pass

    # (a) since_deal % by symbol — top 25 distinct symbol-days by value
    try:
        seen_sd: dict = {}
        for e in sorted(events, key=lambda e: (e["value_cr"] or 0), reverse=True):
            if e["since_deal"] is None:
                continue
            seen_sd.setdefault((e["symbol"], e["deal_date"]), e)
        top = list(seen_sd.values())[:25]
        fig, ax = plt.subplots(figsize=(11, 8), dpi=130)
        labels = [f"{e['symbol']} ({e['deal_date'][5:]})" for e in top][::-1]
        vals = [e["since_deal"] for e in top][::-1]
        colors = ["#16A34A" if v >= 0 else "#DC2626" for v in vals]
        ax.barh(labels, vals, color=colors, alpha=0.85)
        ax.axvline(0, color="#555", linewidth=0.9)
        ax.set_xlabel("Since deal (%)")
        ax.set_title("Since-deal return — top 25 events by value")
        _cleanup_ax(ax)
        fig.text(0.01, 0.005, f"n={len(top)} events · source: NSE deals + yfinance",
                 fontsize=8, color="#444")
        fig.tight_layout(rect=(0, 0.02, 1, 1))
        fig.savefig(out_dir / "chart_a_since_by_symbol.png", facecolor="#111a2b", bbox_inches="tight")
        plt.close(fig)
        made.append("chart_a_since_by_symbol.png")
    except Exception as exc:  # noqa: BLE001
        print(f"  [warn] chart a failed: {exc}", file=sys.stderr)

    # (b) value vs since_deal %
    try:
        pts = [e for e in events if e["since_deal"] is not None and e["value_cr"]]
        fig, ax = plt.subplots(figsize=(10, 6), dpi=130)
        for cohort, color in (("institutional_buy", "#2563EB"),
                              ("institutional_sell", "#DC2626")):
            xs = [e["value_cr"] for e in pts if e["cohort"] == cohort]
            ys = [e["since_deal"] for e in pts if e["cohort"] == cohort]
            ax.scatter(xs, ys, s=34, alpha=0.7, color=color, label=cohort)
        ax.axhline(0, color="#555", linewidth=0.9)
        ax.set_xscale("log")
        ax.set_xlabel("Deal value (Rs Cr, log scale)")
        ax.set_ylabel("Since deal (%)")
        ax.set_title("Deal size vs since-deal return")
        ax.legend(frameon=False)
        _cleanup_ax(ax)
        fig.text(0.01, 0.005, f"n={len(pts)} events · source: NSE deals + yfinance",
                 fontsize=8, color="#444")
        fig.tight_layout(rect=(0, 0.03, 1, 1))
        fig.savefig(out_dir / "chart_b_value_vs_since.png", facecolor="#111a2b", bbox_inches="tight")
        plt.close(fig)
        made.append("chart_b_value_vs_since.png")
    except Exception as exc:  # noqa: BLE001
        print(f"  [warn] chart b failed: {exc}", file=sys.stderr)

    # (c) vol_z vs since_deal %
    try:
        pts = [e for e in events if e["since_deal"] is not None
               and e["vol_z_20"] is not None]
        fig, ax = plt.subplots(figsize=(10, 6), dpi=130)
        for cohort, color in (("institutional_buy", "#2563EB"),
                              ("institutional_sell", "#DC2626")):
            xs = [e["vol_z_20"] for e in pts if e["cohort"] == cohort]
            ys = [e["since_deal"] for e in pts if e["cohort"] == cohort]
            ax.scatter(xs, ys, s=34, alpha=0.7, color=color, label=cohort)
        ax.axhline(0, color="#555", linewidth=0.9)
        ax.axvline(0, color="#555", linewidth=0.9)
        ax.set_xlabel("Deal-day volume z-score (vs prior 20 sessions)")
        ax.set_ylabel("Since deal (%)")
        ax.set_title("Volume surprise vs since-deal return")
        ax.legend(frameon=False)
        _cleanup_ax(ax)
        fig.text(0.01, 0.005, f"n={len(pts)} events · source: NSE deals + yfinance",
                 fontsize=8, color="#444")
        fig.tight_layout(rect=(0, 0.03, 1, 1))
        fig.savefig(out_dir / "chart_c_volz_vs_since.png", facecolor="#111a2b", bbox_inches="tight")
        plt.close(fig)
        made.append("chart_c_volz_vs_since.png")
    except Exception as exc:  # noqa: BLE001
        print(f"  [warn] chart c failed: {exc}", file=sys.stderr)

    # (d) mean cumulative path: BUY vs SELL vs NIFTY
    try:
        xlabels = ["deal", "+1", "+2", "+5", "latest"]
        keys = [None, "fwd_1", "fwd_2", "fwd_5", "since_deal"]
        fig, ax = plt.subplots(figsize=(10, 6), dpi=130)
        for cohort, color in (("institutional_buy", "#2563EB"),
                              ("institutional_sell", "#DC2626")):
            evs = [e for e in events if e["cohort"] == cohort]
            ys = []
            for k in keys:
                if k is None:
                    ys.append(0.0 if evs else None)
                else:
                    ys.append(_mean([e[k] for e in evs]))
            ax.plot(xlabels, ys, marker="o", color=color,
                    label=f"{cohort} (n={len(evs)})")
        nys = []
        for k in keys:
            if k is None:
                nys.append(0.0 if nifty else None)
            else:
                nys.append(_mean([e["nifty_" + k.split("_")[1]] if k != "since_deal"
                                  else e["nifty_since"] for e in events]))
        ax.plot(xlabels, nys, marker="s", color="#111827", linestyle="--",
                label="NIFTY (same windows)")
        ax.axhline(0, color="#555", linewidth=0.9)
        ax.set_ylabel("Mean cumulative return (%)")
        ax.set_title("Mean cumulative path — BUY vs SELL cohorts vs NIFTY")
        ax.legend(frameon=False)
        _cleanup_ax(ax)
        fig.text(0.01, 0.005,
                 f"n={len(events)} events · NIFTY windows aligned per event",
                 fontsize=8, color="#444")
        fig.tight_layout(rect=(0, 0.03, 1, 1))
        fig.savefig(out_dir / "chart_d_mean_path.png", facecolor="#111a2b", bbox_inches="tight")
        plt.close(fig)
        made.append("chart_d_mean_path.png")
    except Exception as exc:  # noqa: BLE001
        print(f"  [warn] chart d failed: {exc}", file=sys.stderr)

    # (e) per-client mean since_deal — top 15 by n (deduped client stock-days)
    try:
        ranked = [c for c in clients if c["side"] == "BUY" and c.get("mean_since") is not None]
        ranked = sorted(ranked, key=lambda c: c["n_stock_days"], reverse=True)[:15]
        if ranked:
            fig, ax = plt.subplots(figsize=(11, 8), dpi=130)
            labels = [f"{c['client'][:32]} (n={c['n_stock_days']})" for c in ranked][::-1]
            vals = [c["mean_since"] for c in ranked][::-1]
            colors = ["#16A34A" if v >= 0 else "#DC2626" for v in vals]
            ax.barh(labels, vals, color=colors, alpha=0.85)
            ax.axvline(0, color="#555", linewidth=0.9)
            ax.set_xlabel("Mean since-deal return (%)")
            ax.set_title("Per-client mean since-deal — top 15 BUY clients by stock-days")
            _cleanup_ax(ax)
            fig.text(0.01, 0.005,
                     f"n={len(ranked)} clients · de-duplicated client stock-days",
                     fontsize=8, color="#444")
            fig.tight_layout(rect=(0, 0.02, 1, 1))
            fig.savefig(out_dir / "chart_e_client_since.png",
                        facecolor="#111a2b", bbox_inches="tight")
            plt.close(fig)
            made.append("chart_e_client_since.png")
    except Exception as exc:  # noqa: BLE001
        print(f"  [warn] chart e failed: {exc}", file=sys.stderr)

    # (f) pre-deal vs post-deal scatter (already moved? -> chase flow?)
    try:
        pts = [e for e in stock_days
               if e.get("pre_5") is not None and e.get("since_deal") is not None]
        fig, ax = plt.subplots(figsize=(10, 6), dpi=130)
        for cohort, color in (("institutional_buy", "#2563EB"),
                              ("institutional_sell", "#DC2626")):
            xs = [e["pre_5"] for e in pts if e["cohort"] == cohort]
            ys = [e["since_deal"] for e in pts if e["cohort"] == cohort]
            ax.scatter(xs, ys, s=34, alpha=0.7, color=color, label=cohort)
        ax.axhline(0, color="#555", linewidth=0.9)
        ax.axvline(0, color="#555", linewidth=0.9)
        ax.set_xlabel("Pre-deal return, −5 sessions → deal close (%)")
        ax.set_ylabel("Since-deal return (%)")
        ax.set_title("Pre-deal move vs since-deal return (cause vs chase)")
        ax.legend(frameon=False)
        _cleanup_ax(ax)
        fig.text(0.01, 0.005,
                 f"n={len(pts)} stock-days · source: NSE deals + yfinance",
                 fontsize=8, color="#444")
        fig.tight_layout(rect=(0, 0.03, 1, 1))
        fig.savefig(out_dir / "chart_f_pre_vs_post.png",
                    facecolor="#111a2b", bbox_inches="tight")
        plt.close(fig)
        made.append("chart_f_pre_vs_post.png")
    except Exception as exc:  # noqa: BLE001
        print(f"  [warn] chart f failed: {exc}", file=sys.stderr)

    # (g) deal cohorts vs control at +1/+2/+5
    try:
        horizons = [("+1", "fwd_1"), ("+2", "fwd_2"), ("+5", "fwd_5")]
        series_defs = [
            ("institutional_buy", [e for e in stock_days if e["cohort"] == "institutional_buy"], "#2563EB"),
            ("institutional_sell", [e for e in stock_days if e["cohort"] == "institutional_sell"], "#DC2626"),
            ("control (vol spike)", control_events, "#F59E0B"),
        ]
        fig, ax = plt.subplots(figsize=(10, 6), dpi=130)
        x = range(len(horizons))
        width = 0.26
        for j, (label, evs, color) in enumerate(series_defs):
            ys = [_mean([e.get(k) for e in evs]) for _h, k in horizons]
            offset = (j - 1) * width
            ax.bar([i + offset for i in x], [y or 0.0 for y in ys], width=width,
                   color=color, alpha=0.85, label=f"{label} (n={len(evs)})")
        ax.axhline(0, color="#555", linewidth=0.9)
        ax.set_xticks(list(x))
        ax.set_xticklabels([h for h, _k in horizons])
        ax.set_ylabel("Mean forward return (%)")
        ax.set_title("Deal cohorts vs volume-spike control — +1/+2/+5 sessions")
        ax.legend(frameon=False)
        _cleanup_ax(ax)
        fig.text(0.01, 0.005,
                 f"stock-day de-duped; control n={len(control_events)}",
                 fontsize=8, color="#444")
        fig.tight_layout(rect=(0, 0.03, 1, 1))
        fig.savefig(out_dir / "chart_g_deal_vs_control.png",
                    facecolor="#111a2b", bbox_inches="tight")
        plt.close(fig)
        made.append("chart_g_deal_vs_control.png")
    except Exception as exc:  # noqa: BLE001
        print(f"  [warn] chart g failed: {exc}", file=sys.stderr)

    return made


# ---------------------------------------------------------------------------
# rendering
# ---------------------------------------------------------------------------
def _cell_stat(value, n, kind="mean"):
    if n is None or n < 20:
        return "insufficient sample (n<20)"
    if kind == "pct":
        return "–" if value is None else f"{value:+.2f}%"
    if kind == "num":
        return "–" if value is None else f"{value:.2f}"
    return "–" if value is None else f"{value:+.2f}%"


def _cohort_summary_table(aggs: list[dict]) -> list[str]:
    """Markdown table over a set of aggregate rows (n-gated means)."""
    lines = [
        "| Scope | n | +1 mean | +2 mean | +5 mean | since mean | since median "
        "| since %pos | NIFTY since | since excess | net +1 | mean vol_z |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    by_scope: dict = {}
    for row in aggs:
        by_scope.setdefault((row["scope_type"], row["scope"]), {})[row["horizon"]] = row
    for (stype, scope), hrs in by_scope.items():
        g = hrs.get("since", {})
        n = g.get("scope_n", g.get("n", 0))

        def c(h, key, kind="mean"):
            r = hrs.get(h, {})
            return _cell_stat(r.get(key), r.get("n"),
                              "num" if key == "mean_vol_z" else kind)

        pctpos = "–" if g.get("pct_positive") is None else f"{g['pct_positive']:.1f}%"
        lines.append(f"| {scope} | {n} | {c('+1','mean_pct')} | {c('+2','mean_pct')} | "
                     f"{c('+5','mean_pct')} | {c('since','mean_pct')} | "
                     f"{c('since','median_pct')} | {pctpos} | "
                     f"{c('since','nifty_mean_pct')} | {c('since','excess_mean_pct')} | "
                     f"{c('+1','mean_net_pct')} | {c('since','mean_vol_z')} |")
    return lines


def _mean_horizon(evs: list[dict], key: str, gate: int = 20):
    vals = [e.get(key) for e in evs if e.get(key) is not None]
    if len(vals) < gate:
        return None, len(vals)
    return _mean(vals), len(vals)


def _pre_post_table(stock_days: list[dict]) -> list[str]:
    lines = [
        "| Cohort | n | pre −5 | pre −10 | +1 | +2 | +5 | since |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for cohort in ("institutional_buy", "institutional_sell"):
        evs = [e for e in stock_days if e["cohort"] == cohort]
        cells = []
        for key in ("pre_5", "pre_10", "fwd_1", "fwd_2", "fwd_5", "since_deal"):
            m, n = _mean_horizon(evs, key)
            cells.append(_cell_stat(m, n))
        lines.append(f"| {cohort} | {len(evs)} | " + " | ".join(cells) + " |")
    return lines


def _deal_vs_control_table(stock_days: list[dict],
                           control_events: list[dict]) -> list[str]:
    lines = [
        "| Cohort | n | +1 mean | +2 mean | +5 mean | n(+1) | n(+2) | n(+5) |",
        "|---|---|---|---|---|---|---|---|",
    ]
    cohorts = [
        ("BUY (stock-day)", [e for e in stock_days if e["cohort"] == "institutional_buy"]),
        ("SELL (stock-day)", [e for e in stock_days if e["cohort"] == "institutional_sell"]),
        ("control (vol spike)", control_events),
    ]
    for label, evs in cohorts:
        cells = []
        ns = []
        for key in ("fwd_1", "fwd_2", "fwd_5"):
            m, n = _mean_horizon(evs, key)
            cells.append(_cell_stat(m, n))
            ns.append(str(n))
        lines.append(f"| {label} | {len(evs)} | " + " | ".join(cells) + " | "
                     + " | ".join(ns) + " |")
    return lines


def _costs_table(stock_days: list[dict]) -> list[str]:
    lines = [
        "| Cohort (stock-day) | n | +1 gross | +1 net | +2 gross | +2 net "
        "| +5 gross | +5 net |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for cohort in ("institutional_buy", "institutional_sell"):
        evs = [e for e in stock_days if e["cohort"] == cohort]
        cells = []
        for gross, net in (("fwd_1", "net_1"), ("fwd_2", "net_2"), ("fwd_5", "net_5")):
            gm, gn = _mean_horizon(evs, gross)
            nm, _nn = _mean_horizon(evs, net)
            cells.append(_cell_stat(gm, gn))
            cells.append(_cell_stat(nm, gn))
        lines.append(f"| {cohort} | {len(evs)} | " + " | ".join(cells) + " |")
    return lines



def render_markdown(ctx: dict) -> str:
    events = ctx["events"]
    aggs = ctx["aggregates"]
    lines: list[str] = []
    a = lines.append

    a(f"# NSE Bulk/Block Deals — forward-move EDA ({ctx['anchor']})")
    a("")
    a(f"*Generated {ctx['generated_at']} IST · window **{ctx['first_day']} → "
      f"{ctx['anchor']}** ({ctx['n_sessions']} sessions) · institutional "
      f"threshold **₹{ctx['min_cr']:g} Cr**.*")
    a("")
    a("**This is a descriptive study of what already happened, not investment "
      "advice and not evidence of a tradable edge.**")
    a("")

    # headline
    a("## Headline")
    a("")
    a(f"- Deals fetched: **{ctx['deal_stats']['deduped_rows']}** deduped "
      f"(from {ctx['deal_stats']['raw_rows']} raw rows; archive caps at "
      f"~{ctx['deal_stats']['archive_cap']} rows/day → **partial coverage**).")
    a(f"- Events evaluated: **{len(events)}** "
      f"(BUY {sum(1 for e in events if e['cohort']=='institutional_buy')} · "
      f"SELL {sum(1 for e in events if e['cohort']=='institutional_sell')}).")
    a(f"- Unique symbols: **{ctx['n_symbols']}** · unresolved by yfinance: "
      f"**{ctx['n_unresolved']}**.")
    a(f"- Last available price session: **{ctx['last_bar']}**"
      + (" (latest session close is an *intraday proxy* — daily bar not settled)."
         if ctx["used_proxy"] else "."))
    a("")
    buy = [e for e in events if e["cohort"] == "institutional_buy"]
    if buy:
        best = max(buy, key=lambda e: e["since_deal"] if e["since_deal"] is not None else -1e9)
        worst = min(buy, key=lambda e: e["since_deal"] if e["since_deal"] is not None else 1e9)
        a(f"- Best BUY since deal: **{best['symbol']}** {_pct(best['since_deal'])} "
          f"(entry {best['entry_date']}) · worst: **{worst['symbol']}** "
          f"{_pct(worst['since_deal'])}.")
        a("")

    # method
    a("## Method")
    a("")
    a("1. **Deals** — NSE archive API, **day by day** (`from=D&to=D`), both "
      "`bulk_deals` and `block_deals`, for the last N weekdays. The latest "
      "session is topped up with the full `snapshot-capital-market-largedeal` "
      "list and `archives.nseindia.com/.../bulk.csv`.")
    a("2. **Normalize / dedupe** — one record per "
      "`(deal_date, symbol, client, side, qty, watp)` so a trade appearing in "
      "both the bulk and block feeds is counted once. `value_cr = qty × watp / 1e7`.")
    a("3. **Classify** — `india_board/scripts/bulk_deals.py::classify_client` "
      "(mutual_fund / insurance / pms / aif / fpi / trust / corporate / "
      "individual / unknown) and `_instrument_type` (equity / invit / etf).")
    a("4. **Prices** — `yfinance` daily bars for `<SYMBOL>.NS`; entry = **close "
      "on the deal date** (if the deal date has no bar, the next session is "
      "used and flagged). Benchmark = `^NSEI` over the *same* windows.")
    a(f"5. **Cohorts** — institutional BUY ≥ ₹{ctx['min_cr']:g} Cr; large BUY "
      f"≥ ₹50 Cr (subset); institutional SELL ≥ ₹{ctx['min_cr']:g} Cr "
      "(contrast). Only **equity** instruments (InvIT/ETF excluded).")
    a("")
    a("### Data caveats (read before citing any number)")
    a("")
    a(f"- **Archive cap:** the NSE archive endpoint returns at most ~70 rows "
      f"per day, so the deal list is a **partial** view; the latest day is "
      f"partially corrected by the snapshot/CSV supplement.")
    a("- **Deal date ≠ price-impact start:** disclosures are end-of-day and "
      "may lag the trade; the deal price (`watp`) can differ from the close.")
    a("- **Volumes/values are as disclosed** by NSE; no adjustment is applied.")
    a("- **Survivorship / listing:** newly listed or thinly traded names may "
      "lack 30 usable rows and are excluded (see `unresolved.csv`).")
    if ctx["used_proxy"]:
        a(f"- **Current session close is a proxy:** the {ctx['anchor']} daily "
          "bar's `Close` was not yet settled in yfinance, so the **last "
          "intraday 5-minute close** of that session is used and marked "
          "`intraday_proxy`. It can differ slightly from the official close.")
    a("- **No advice / no edge claim.** Small samples dominate; every statistic "
      "prints its `n`.")

    # cohort summary
    a("")
    a("## Cohort & value-bucket aggregates")
    a("")
    a("Means/medians/excess with `n<20` are shown as "
      "**insufficient sample (n<20)**. Returns are in %; `excess` is the "
      "paired event return minus the NIFTY return over the *same* window.")
    a("")
    a("| Scope | n | +1 mean | +2 mean | +5 mean | since mean | since median "
      "| since %pos | NIFTY since | since excess | mean vol_z |")
    a("|---|---|---|---|---|---|---|---|---|---|---|")
    by_scope: dict[str, dict] = {}
    for row in aggs:
        by_scope.setdefault((row["scope_type"], row["scope"]), {})[row["horizon"]] = row
    for (stype, scope), hrs in by_scope.items():
        g = hrs.get("since", {})
        n = g.get("scope_n", g.get("n", 0))

        def c(h, key):
            r = hrs.get(h, {})
            return _cell_stat(r.get(key), r.get("n"),
                              "num" if key == "mean_vol_z" else "mean")

        pctpos = "–" if g.get("pct_positive") is None else f"{g['pct_positive']:.1f}%"
        a(f"| {scope} | {n} | {c('+1','mean_pct')} | {c('+2','mean_pct')} | "
          f"{c('+5','mean_pct')} | {c('since','mean_pct')} | "
          f"{c('since','median_pct')} | {pctpos} | "
          f"{c('since','nifty_mean_pct')} | {c('since','excess_mean_pct')} | "
          f"{c('since','mean_vol_z')} |")
    a("")
    a("Horizon-level `n` (events with that many forward sessions elapsed):")
    a("")
    a("| Scope | n(since) | n(+1) | n(+2) | n(+5) | scope n |")
    a("|---|---|---|---|---|---|")
    for (stype, scope), hrs in by_scope.items():
        a(f"| {scope} | {hrs.get('since',{}).get('n','–')} | "
          f"{hrs.get('+1',{}).get('n','–')} | {hrs.get('+2',{}).get('n','–')} | "
          f"{hrs.get('+5',{}).get('n','–')} | "
          f"{hrs.get('since',{}).get('scope_n','–')} |")

    # ---- stock-day dedupe (clustering removed) ----
    sd_meta = ctx.get("stock_day_meta") or {}
    a("")
    a("## Stock-day de-duplication (clustering removed)")
    a("")
    a("Each client is its own event above, so one stock-day with several buyers "
      "counts several times. Below, all events collapse to **one observation per "
      "`(symbol, deal_date, cohort)`** — `n_clients` and `stock_day_value_cr` are "
      "recorded, and the **largest** client is kept for attribution. This is the "
      "honest number.")
    a("")
    a(f"- Raw deal events: **{sd_meta.get('n_raw_events','–')}** → "
      f"de-duplicated stock-days: **{sd_meta.get('n_stock_days','–')}** "
      f"(largest same-day cluster: **{sd_meta.get('max_clients_one_stock_day','–')}** clients).")
    a("")
    a(*_cohort_summary_table(ctx.get("stock_day_aggregates", [])))

    # ---- per-client leaderboard ----
    a("")
    a("## Per-client leaderboard")
    a("")
    a(f"De-duplicated to one observation per `(client, symbol, deal_date)`. "
      f"Clients are **ranked only with n≥{CLIENT_MIN_N}** stock-days; smaller "
      "samples are listed as anecdotes. Value-weighted `since` weights by ₹ Cr. "
      "Full list in `CLIENTS.md` / `clients.csv`.")
    a("")
    _client_header = ("| Client | Activity | n | ₹ Cr | mean since | median since "
                      "| +1 | +2 | +5 | %pos | value-wtd since |")
    _client_sep = "|---|---|---|---|---|---|---|---|---|---|---|"

    def _client_md(c):
        pos = "–" if c["pct_positive"] is None else f"{c['pct_positive']:.1f}%"
        return (f"| {c['client'][:34]} | {c['activity']} | {c['n_stock_days']} | "
                f"{_num_fmt(c['total_value_cr'])} | {_pct(c['mean_since'])} | "
                f"{_pct(c['median_since'])} | {_pct(c['mean_1'])} | "
                f"{_pct(c['mean_2'])} | {_pct(c['mean_5'])} | {pos} | "
                f"{_pct(c['value_weighted_since'])} |")

    clients = ctx.get("clients") or []
    for side, title in (("BUY", "BUY clients (a good buy = positive forward return)"),
                        ("SELL", "SELL clients (a good sell = negative forward return)")):
        rows = [c for c in clients if c["side"] == side and c["ranked"]
                and c["mean_since"] is not None]
        anec = [c for c in clients if c["side"] == side and not c["ranked"]]
        a(f"**{title}**")
        a("")
        if rows:
            a(_client_header)
            a(_client_sep)
            for c in rows:
                a(_client_md(c))
        else:
            a(f"_No {side} client reaches n≥{CLIENT_MIN_N} stock-days._")
        a("")
        a(f"*Anecdotes (n<{CLIENT_MIN_N}) in `CLIENTS.md` — {len(anec)} {side} "
          "client(s).*")
        a("")

    # ---- active vs passive ----
    a("")
    a("## Active vs passive institutions")
    a("")
    a("Index / ETF / benchmark-mandate clients (VANGUARD, INDEX, ETF, ISHARES, "
      "NIFTY, SENSEX, MSCI, BLACKROCK INDEX) are mechanical rebalances with no "
      "stock-specific conviction; they are split out from discretionary buying.")
    a("")
    a(*_cohort_summary_table([r for r in ctx.get("stock_day_aggregates", [])
                              if r.get("scope_type") == "activity"]))

    # ---- pre-deal vs post-deal ----
    a("")
    a("## Pre-deal vs post-deal (was it already moving?)")
    a("")
    a("Pre-deal returns run from −5 / −10 sessions **to** the deal close. If the "
      "pre-deal move is large, the deal is chase-flow (the price already moved), "
      "not a fresh catalyst.")
    a("")
    a(*_pre_post_table(ctx.get("stock_days", [])))

    # ---- costs ----
    a("")
    a("## Costs — follower gross vs net")
    a("")
    a(f"A follower buys the deal close and exits at +1/+2/+5; costs apply "
      f"`backtest/costs.py:calculate_trading_costs()` at {DEFAULT_QTY} shares. "
      "Net = gross minus the round-trip cost as a fraction of entry notional.")
    a("")
    a(*_costs_table(ctx.get("stock_days", [])))

    # ---- control cohort (decisive test) ----
    a("")
    a("## Deal cohorts vs volume-spike control (decisive test)")
    a("")
    ctl = ctx.get("control_meta") or {}
    a(f"Control = same symbol universe and period, sessions with volume "
      f"z-score ≥ {ctl.get('threshold_z','–')} and **no** institutional deal, "
      f"seeded RNG ({ctl.get('seed','–')}). Candidates found: "
      f"**{ctl.get('candidates','–')}**; sampled: **{ctl.get('sampled','–')}** "
      f"(cap {ctl.get('cap','–')}). If the deal cohorts do not beat this, the "
      "deal layer adds nothing over a plain volume spike.")
    a("")
    a(*_deal_vs_control_table(ctx.get("stock_days", []),
                              ctx.get("control_events", [])))
    a("")
    a(*_cohort_summary_table(ctx.get("control_aggregates", [])))

    # top events
    a("")
    a("## Top events by deal value")
    a("")
    a("| Date | Symbol | Client | Type | Side | ₹ Cr | Entry | Since | +1 | +2 "
      "| +5 | vol_z |")
    a("|---|---|---|---|---|---|---|---|---|---|---|---|")
    ordered = sorted(events, key=lambda e: (e["value_cr"] or 0), reverse=True)
    top_n = int(ctx.get("top_n", 30))
    for e in ordered[:top_n]:
        a(f"| {e['deal_date']} | {e['symbol']} | {e['client'][:26]} | "
          f"{e['client_type']} | {e['side']} | {_num_fmt(e['value_cr'])} | "
          f"{e['entry_date']} | {_pct(e['since_deal'])} | {_pct(e['fwd_1'])} | "
          f"{_pct(e['fwd_2'])} | {_pct(e['fwd_5'])} | "
          f"{_num_fmt(e['vol_z_20'])} |")
    a("")
    a(f"*Showing top {min(top_n, len(ordered))} of {len(events)} events — full "
      "list in `events.csv`.*")

    # what's proven vs suggestive
    a("")
    a("## Proven vs suggestive")
    a("")
    a("**Proven (mechanical facts from this run):**")
    a("- Which clients/symbols were disclosed, on which dates, and at what "
      "value/qty/price (partial coverage: archive cap).")
    a("- Realised close-to-close moves since each entry, with explicit `n`.")
    a("- Excess return vs NIFTY over each event's own window.")
    a("")
    a("**Suggestive only (do not over-read):**")
    a("- Cross-sectional patterns by client type / value bucket / volume "
      "z-score — confounded by market beta, sector moves, and sample size.")
    a("- Any single-name result; events are not independent (same symbol can "
      "appear multiple times).")
    a("- Causality: the deal did not necessarily cause the move.")

    # biggest excluded names
    unresolved = [u for u in ctx.get("unresolved", []) if u.get("max_value_cr")]
    unresolved.sort(key=lambda u: u["max_value_cr"], reverse=True)
    if unresolved:
        a("")
        a("### Largest symbols excluded (unresolved by yfinance)")
        a("")
        a("| Symbol | Max deal ₹ Cr | Why |")
        a("|---|---|---|")
        for u in unresolved[:8]:
            a(f"| {u['symbol']} | {_num_fmt(u['max_value_cr'])} | "
              f"{str(u['reason'])[:70]} |")

    # limitations
    a("")
    a("## Limitations")
    a("")
    a("- Archive API caps at ~70 rows/day → the deal universe is incomplete.")
    a("- Prices are `yfinance` close-based; a deal's `watp` may differ from the "
      "close used as entry.")
    a(f"- {ctx['n_unresolved']} symbol(s) unresolved / <30 usable rows "
      "(see `unresolved.csv`). yfinance tickers are **not** substituted: if "
      "`<NSE_SYMBOL>.NS` is wrong or thinly traded, the event is dropped.")
    a("- Deal date is the *disclosure* date, which can trail the actual trade.")
    a("- No transaction-cost, liquidity, or borrow assumptions are modelled.")

    # re-run
    a("")
    a("## Re-run")
    a("")
    a("```bash")
    a("cd /home/mysyntax/Documents/Alphashri/stock-screener-ui")
    a(f"source .venv/bin/activate")
    a(f"python india_board/scripts/bulk_deal_eda.py --days {ctx['days']} "
      f"--min-cr {ctx['min_cr']:g} --out {ctx['out_rel']}")
    a("```")
    a("")
    a(f"*Files: `EDA.md`, `eda_report.html`, `events.csv`, `aggregates.csv`, "
      f"`unresolved.csv`, and "
      f"{len(ctx['charts'])} chart PNG(s).*")
    a("")
    return "\n".join(lines)


def render_clients_md(ctx: dict) -> str:
    """Standalone per-client leaderboard (BUY + SELL), ranked and anecdotes."""
    clients = ctx.get("clients") or []
    lines: list[str] = []
    a = lines.append
    a(f"# Per-client bulk/block deal performance — {ctx['first_day']} → {ctx['anchor']}")
    a("")
    a(f"*Generated {ctx['generated_at']} IST · institutional threshold "
      f"₹{ctx['min_cr']:g} Cr · de-duplicated to one observation per "
      f"(client, symbol, deal_date).*")
    a("")
    a("**Descriptive study of past disclosures — not investment advice.** A good "
      "BUY client has a positive forward return; a good SELL client has a "
      "negative one. Clients are ranked only at "
      f"n≥{CLIENT_MIN_N} stock-days.")
    a("")

    header = ("| Client | Type | Activity | n | ₹ Cr | mean since | median since "
              "| +1 | +2 | +5 | %pos | value-wtd since |")
    sep = "|---|---|---|---|---|---|---|---|---|---|---|---|"

    def _row(c):
        pos = "–" if c["pct_positive"] is None else f"{c['pct_positive']:.1f}%"
        return (f"| {c['client'][:40]} | {c['client_type']} | {c['activity']} | "
                f"{c['n_stock_days']} | {_num_fmt(c['total_value_cr'])} | "
                f"{_pct(c['mean_since'])} | {_pct(c['median_since'])} | "
                f"{_pct(c['mean_1'])} | {_pct(c['mean_2'])} | {_pct(c['mean_5'])} | "
                f"{pos} | {_pct(c['value_weighted_since'])} |")

    for side, note in (
        ("BUY", "Sorted by n, then mean since-deal. A good buy = positive."),
        ("SELL", "Sorted by n, then mean since-deal. A good sell = negative."),
    ):
        a(f"## {side} clients (n≥{CLIENT_MIN_N})")
        a("")
        a(note)
        a("")
        ranked = [c for c in clients if c["side"] == side and c["ranked"]]
        if ranked:
            a(header)
            a(sep)
            for c in ranked:
                a(_row(c))
        else:
            a(f"_No {side} client reaches n≥{CLIENT_MIN_N}._")
        a("")
        anec = [c for c in clients if c["side"] == side and not c["ranked"]]
        a(f"## {side} clients — anecdotes (n<{CLIENT_MIN_N})")
        a("")
        if anec:
            a(header)
            a(sep)
            for c in anec:
                a(_row(c))
        else:
            a("_None._")
        a("")
    a("## Limitations")
    a("")
    a("- Corporate identities change (mergers/renames) and NSE client strings are "
      "free text; the same economic buyer may appear under several names.")
    a("- n≥3 stock-days is still a small sample; a 3-name result is noise-prone.")
    a("- Returns are close-to-close on yfinance data; the deal `watp` may differ.")
    a("- Index/ETF and other passive mandates are flagged but may be mis-typed.")
    a("")
    return "\n".join(lines)


_HTML_CSS = """
body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
margin:0;background:#0b1220;color:#e2e8f0;line-height:1.5}
.wrap{max-width:1100px;margin:0 auto;padding:32px 24px 64px}
h1{font-size:26px;margin:0 0 4px;color:#f1f5f9} h2{font-size:19px;margin:32px 0 8px;
border-bottom:1px solid #24324a;padding-bottom:6px;color:#f1f5f9}
.meta{color:#94a3b8;font-size:13px;margin-bottom:20px}
.disc{background:#241a0c;border:1px solid #7c4a1e;color:#fbbf24;padding:10px 14px;
border-radius:8px;font-size:13px;margin:16px 0}
.caveat{background:#2a1414;border:1px solid #7f1d1d;color:#fca5a5;padding:10px 14px;
border-radius:8px;font-size:13px;margin:12px 0}
table{border-collapse:collapse;width:100%;font-size:12.5px;background:#111a2b;
margin:8px 0 4px;color:#e2e8f0} th,td{border:1px solid #24324a;padding:5px 8px;text-align:left}
th{background:#1a2537;font-weight:600;color:#cbd5e1} td.num,th.num{text-align:right}
code{background:#1a2537;padding:1px 5px;border-radius:4px;font-size:12px;color:#93c5fd}
pre{background:#050a14;color:#cbd5e1;padding:14px;border-radius:8px;overflow-x:auto;
font-size:12.5px;border:1px solid #1e293b}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}
.card{background:#111a2b;border:1px solid #24324a;border-radius:10px;padding:12px 16px;
min-width:150px} .card .k{font-size:11px;color:#94a3b8;text-transform:uppercase;
letter-spacing:.04em} .card .v{font-size:20px;font-weight:700;margin-top:2px;color:#f8fafc}
.chart{background:#111a2b;border:1px solid #24324a;border-radius:10px;padding:10px;
margin:12px 0} .chart img{max-width:100%;display:block;border-radius:6px} .chart .cap{font-size:12px;
color:#94a3b8;margin-top:6px}
.pos{color:#22c55e}.neg{color:#ef4444}
a{color:#60a5fa}
"""


def _cls(v):
    if v is None:
        return ""
    return "pos" if v >= 0 else "neg"


def _esc(s) -> str:
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _md_table_to_html(lines: list[str]) -> str:
    """Convert the simple pipe tables produced above into an HTML table."""
    out = ["<table>"]
    for i, ln in enumerate(lines):
        if not ln.strip().startswith("|"):
            continue
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        if cells and all(set(c) <= set("-: ") for c in cells):
            continue  # markdown separator row
        tag = "th" if i == 0 else "td"
        out.append("<tr>" + "".join(f"<{tag}>{_esc(c)}</{tag}>" for c in cells) + "</tr>")
    out.append("</table>")
    return "".join(out)



def _agg_table_html(aggs: list[dict]) -> str:
    """HTML cohort table over a set of aggregate rows (mirrors the markdown)."""
    parts = ["<table><tr><th>Scope</th><th class='num'>n</th>"
             "<th class='num'>+1 mean</th><th class='num'>+2 mean</th>"
             "<th class='num'>+5 mean</th><th class='num'>since mean</th>"
             "<th class='num'>since median</th><th class='num'>since %pos</th>"
             "<th class='num'>NIFTY since</th><th class='num'>since excess</th>"
             "<th class='num'>net +1</th><th class='num'>mean vol_z</th></tr>"]
    by_scope: dict = {}
    for row in aggs:
        by_scope.setdefault((row["scope_type"], row["scope"]), {})[row["horizon"]] = row
    for (_stype, scope), hrs in by_scope.items():
        g = hrs.get("since", {})
        n = g.get("scope_n", g.get("n", 0))

        def cell(h, key):
            r = hrs.get(h, {})
            v = r.get(key)
            nn = r.get("n")
            if nn is None or nn < 20:
                return "<td class='num'>insufficient sample (n&lt;20)</td>"
            if v is None:
                return "<td class='num'>–</td>"
            cls = _cls(v) if key.endswith("pct") else ""
            txt = f"{v:.2f}" if key == "mean_vol_z" else f"{v:+.2f}%"
            return f"<td class='num {cls}'>{txt}</td>"

        pctpos = "–" if g.get("pct_positive") is None else f"{g['pct_positive']:.1f}%"
        parts.append(f"<tr><td>{scope}</td><td class='num'>{n}</td>"
                     + cell("+1", "mean_pct") + cell("+2", "mean_pct")
                     + cell("+5", "mean_pct") + cell("since", "mean_pct")
                     + cell("since", "median_pct")
                     + f"<td class='num'>{pctpos}</td>"
                     + cell("since", "nifty_mean_pct")
                     + cell("since", "excess_mean_pct")
                     + cell("+1", "mean_net_pct")
                     + cell("since", "mean_vol_z") + "</tr>")
    parts.append("</table>")
    return "".join(parts)


def render_html(ctx: dict) -> str:
    events = ctx["events"]
    aggs = ctx["aggregates"]
    esc = lambda s: (str(s).replace("&", "&amp;").replace("<", "&lt;")
                     .replace(">", "&gt;"))
    p = []
    p.append("<!doctype html><html><head><meta charset='utf-8'>")
    p.append("<meta name='viewport' content='width=device-width,initial-scale=1'>")
    p.append("<title>NSE Bulk Deals — forward-move EDA</title>")
    p.append(f"<style>{_HTML_CSS}</style></head><body><div class='wrap'>")
    p.append(f"<h1>NSE Bulk/Block Deals — forward-move EDA</h1>")
    p.append(f"<div class='meta'>Window <b>{ctx['first_day']} → {ctx['anchor']}</b> "
             f"({ctx['n_sessions']} sessions) · institutional threshold "
             f"<b>₹{ctx['min_cr']:g} Cr</b> · generated {esc(ctx['generated_at'])} IST</div>")
    p.append("<div class='disc'><b>Descriptive study of the past — not "
             "investment advice, not evidence of a tradable edge.</b> Retail "
             "decisions should not be based on this.</div>")

    buy = [e for e in events if e["cohort"] == "institutional_buy"]
    p.append("<div class='cards'>")
    for k, v in (("Deduped deals", ctx["deal_stats"]["deduped_rows"]),
                 ("Events evaluated", len(events)),
                 ("Institutional BUY", len(buy)),
                 ("Unresolved symbols", ctx["n_unresolved"]),
                 ("Last price session", ctx["last_bar"])):
        p.append(f"<div class='card'><div class='k'>{esc(k)}</div>"
                 f"<div class='v'>{esc(v)}</div></div>")
    p.append("</div>")

    p.append("<h2>Method</h2>")
    p.append("<ol>"
             "<li>NSE archive API fetched <b>day by day</b> for bulk + block deals; "
             "latest session topped up with the snapshot API and archives CSV.</li>"
             "<li>Dedupe on <code>(date, symbol, client, side, qty, watp)</code>; "
             "<code>value_cr = qty×watp/1e7</code>.</li>"
             "<li>Classification reuses <code>bulk_deals.classify_client</code>; "
             "only equity instruments.</li>"
             "<li>Prices from <b>yfinance</b> daily bars; entry = close on the deal "
             "date (else next session, flagged); benchmark <code>^NSEI</code> over "
             "the same window.</li></ol>")
    p.append("<div class='caveat'><b>Caveats:</b> archive caps at ~70 rows/day "
             "(partial coverage); deal date ≠ price-impact start; volumes/values as "
             "disclosed; " + (f"the {ctx['anchor']} close is an intraday proxy "
             "(daily bar unsettled); " if ctx["used_proxy"] else "")
             + "means with n&lt;20 are flagged as insufficient.</div>")

    p.append("<h2>Cohort &amp; value-bucket aggregates</h2>")
    p.append("<table><tr><th>Scope</th><th class='num'>n</th>"
             "<th class='num'>+1 mean</th><th class='num'>+2 mean</th>"
             "<th class='num'>+5 mean</th><th class='num'>since mean</th>"
             "<th class='num'>since median</th><th class='num'>since %pos</th>"
             "<th class='num'>NIFTY since</th><th class='num'>since excess</th>"
             "<th class='num'>mean vol_z</th></tr>")
    by_scope: dict = {}
    for row in aggs:
        by_scope.setdefault((row["scope_type"], row["scope"]), {})[row["horizon"]] = row
    for (stype, scope), hrs in by_scope.items():
        g = hrs.get("since", {})
        n = g.get("scope_n", g.get("n", 0))

        def cell(h, key):
            r = hrs.get(h, {})
            v = r.get(key)
            nn = r.get("n")
            if nn is None or nn < 20:
                return "<td class='num'>insufficient sample (n&lt;20)</td>"
            if v is None:
                return "<td class='num'>–</td>"
            cls = _cls(v) if key.endswith("pct") else ""
            txt = f"{v:.2f}" if key == "mean_vol_z" else f"{v:+.2f}%"
            return f"<td class='num {cls}'>{txt}</td>"

        pctpos = "–" if g.get("pct_positive") is None else f"{g['pct_positive']:.1f}%"
        p.append(f"<tr><td>{esc(scope)}</td><td class='num'>{n}</td>"
                 + cell("+1", "mean_pct") + cell("+2", "mean_pct")
                 + cell("+5", "mean_pct") + cell("since", "mean_pct")
                 + cell("since", "median_pct")
                 + f"<td class='num'>{pctpos}</td>"
                 + cell("since", "nifty_mean_pct")
                 + cell("since", "excess_mean_pct")
                 + cell("since", "mean_vol_z") + "</tr>")
    p.append("</table>")

    # ---- stock-day dedupe ----
    sd_meta = ctx.get("stock_day_meta") or {}
    p.append("<h2>Stock-day de-duplication (clustering removed)</h2>")
    p.append("<p>Each client is its own event above, so one stock-day with several "
             "buyers counts several times. Below, events collapse to one observation "
             "per <code>(symbol, deal_date, cohort)</code> — the largest client is kept "
             "for attribution and <code>n_clients</code> / <code>stock_day_value_cr</code> "
             "are recorded. This is the honest number.</p>")
    p.append(f"<div class='meta'>Raw events {sd_meta.get('n_raw_events','–')} → "
             f"stock-days {sd_meta.get('n_stock_days','–')} (largest same-day cluster "
             f"{sd_meta.get('max_clients_one_stock_day','–')} clients).</div>")
    p.append(_agg_table_html(ctx.get("stock_day_aggregates", [])))

    # ---- per-client leaderboard ----
    p.append("<h2>Per-client leaderboard</h2>")
    p.append(f"<p>De-duplicated to one observation per (client, symbol, deal_date). "
             f"Ranked only at n≥{CLIENT_MIN_N}; smaller samples are anecdotes. "
             f"Full list in <code>CLIENTS.md</code> / <code>clients.csv</code>.</p>")
    cl_header = ["| Client | Activity | n | ₹ Cr | mean since | median since | +1 | +2 "
                 "| +5 | %pos | value-wtd since |",
                 "|---|---|---|---|---|---|---|---|---|---|---|"]
    clients = ctx.get("clients") or []
    for side in ("BUY", "SELL"):
        ranked = [c for c in clients if c["side"] == side and c["ranked"]
                  and c["mean_since"] is not None]
        anec = [c for c in clients if c["side"] == side and not c["ranked"]]
        p.append(f"<h3>{side} clients (n≥{CLIENT_MIN_N})</h3>")
        if ranked:
            body = list(cl_header)
            for c in ranked:
                pos = "–" if c["pct_positive"] is None else f"{c['pct_positive']:.1f}%"
                body.append(
                    f"| {c['client'][:40]} | {c['activity']} | {c['n_stock_days']} | "
                    f"{_num_fmt(c['total_value_cr'])} | {_pct(c['mean_since'])} | "
                    f"{_pct(c['median_since'])} | {_pct(c['mean_1'])} | "
                    f"{_pct(c['mean_2'])} | {_pct(c['mean_5'])} | {pos} | "
                    f"{_pct(c['value_weighted_since'])} |")
            p.append(_md_table_to_html(body))
        else:
            p.append(f"<p><i>No {side} client reaches n≥{CLIENT_MIN_N}.</i></p>")
        p.append(f"<p><i>{len(anec)} {side} client(s) with n&lt;{CLIENT_MIN_N} "
                 f"listed in <code>CLIENTS.md</code>.</i></p>")

    # ---- active vs passive ----
    p.append("<h2>Active vs passive institutions</h2>")
    p.append("<p>Index / ETF / benchmark-mandate clients are mechanical rebalances "
             "with no stock-specific conviction, split out from discretionary buying.</p>")
    p.append(_agg_table_html([r for r in ctx.get("stock_day_aggregates", [])
                              if r.get("scope_type") == "activity"]))

    # ---- pre vs post ----
    p.append("<h2>Pre-deal vs post-deal (was it already moving?)</h2>")
    p.append("<p>Pre-deal returns run from −5 / −10 sessions to the deal close. A "
             "large pre-deal move means the deal is chase-flow, not a fresh catalyst.</p>")
    p.append(_md_table_to_html(_pre_post_table(ctx.get("stock_days", []))))

    # ---- costs ----
    p.append("<h2>Costs — follower gross vs net</h2>")
    p.append(f"<p>Buy the deal close, exit at +1/+2/+5; costs apply "
             f"<code>backtest/costs.py:calculate_trading_costs()</code> at "
             f"{DEFAULT_QTY} shares.</p>")
    p.append(_md_table_to_html(_costs_table(ctx.get("stock_days", []))))

    # ---- control cohort ----
    ctl = ctx.get("control_meta") or {}
    p.append("<h2>Deal cohorts vs volume-spike control (decisive test)</h2>")
    p.append(f"<p>Same symbol universe and period, sessions with volume z-score ≥ "
             f"{ctl.get('threshold_z','–')} and no institutional deal, seeded RNG "
             f"({ctl.get('seed','–')}). Candidates {ctl.get('candidates','–')}; sampled "
             f"{ctl.get('sampled','–')} (cap {ctl.get('cap','–')}). If the deal cohorts "
             f"do not beat this, the deal layer adds nothing over a plain volume spike.</p>")
    p.append(_md_table_to_html(_deal_vs_control_table(
        ctx.get("stock_days", []), ctx.get("control_events", []))))
    p.append(_agg_table_html(ctx.get("control_aggregates", [])))

    p.append("<h2>Top events by deal value</h2>")
    p.append("<table><tr><th>Date</th><th>Symbol</th><th>Client</th><th>Type</th>"
             "<th>Side</th><th class='num'>₹ Cr</th><th>Entry</th>"
             "<th class='num'>Since</th><th class='num'>+1</th>"
             "<th class='num'>+2</th><th class='num'>+5</th>"
             "<th class='num'>vol_z</th></tr>")
    ordered = sorted(events, key=lambda e: (e["value_cr"] or 0), reverse=True)
    top_n = int(ctx.get("top_n", 30))
    def _pc(v):
        return f"<td class='num {_cls(v)}'>{'–' if v is None else f'{v:+.2f}%'}</td>"

    for e in ordered[:top_n]:
        vz = "–" if e["vol_z_20"] is None else f"{e['vol_z_20']:.2f}"
        vcr = "–" if e["value_cr"] is None else f"{e['value_cr']:.2f}"
        p.append(f"<tr><td>{esc(e['deal_date'])}</td><td>{esc(e['symbol'])}</td>"
                 f"<td>{esc(e['client'][:30])}</td><td>{esc(e['client_type'])}</td>"
                 f"<td>{esc(e['side'])}</td>"
                 f"<td class='num'>{vcr}</td>"
                 f"<td>{esc(e['entry_date'])}</td>"
                 + _pc(e["since_deal"]) + _pc(e["fwd_1"]) + _pc(e["fwd_2"])
                 + _pc(e["fwd_5"])
                 + f"<td class='num'>{vz}</td></tr>")
    p.append("</table>")

    if ctx["charts"]:
        p.append("<h2>Charts</h2>")
        capts = {
            "chart_a_since_by_symbol.png": "Since-deal % by symbol (top 25 by value).",
            "chart_b_value_vs_since.png": "Deal value vs since-deal %.",
            "chart_c_volz_vs_since.png": "Volume z-score vs since-deal %.",
            "chart_d_mean_path.png": "Mean cumulative path: BUY vs SELL vs NIFTY.",
            "chart_e_client_since.png": "Per-client mean since-deal (top 15 BUY clients by n).",
            "chart_f_pre_vs_post.png": "Pre-deal (−5) move vs since-deal return.",
            "chart_g_deal_vs_control.png": "Deal cohorts vs volume-spike control at +1/+2/+5.",
        }
        for c in ctx["charts"]:
            p.append(f"<div class='chart'><img src='{esc(c)}' alt='{esc(c)}'>"
                     f"<div class='cap'>{esc(capts.get(c, c))}</div></div>")

    p.append("<h2>Proven vs suggestive</h2>")
    p.append("<p><b>Proven:</b> disclosed deals, values, dates; realised "
             "close-to-close moves since entry; excess vs NIFTY. "
             "<b>Suggestive only:</b> cross-sectional patterns by client type / "
             "value bucket / volume z-score — confounded by beta, sector moves, "
             "and small samples; events are not independent.</p>")

    unresolved = [u for u in ctx.get("unresolved", []) if u.get("max_value_cr")]
    unresolved.sort(key=lambda u: u["max_value_cr"], reverse=True)
    if unresolved:
        p.append("<h2>Largest symbols excluded (unresolved by yfinance)</h2>")
        p.append("<table><tr><th>Symbol</th><th class='num'>Max deal ₹ Cr</th>"
                 "<th>Why</th></tr>")
        for u in unresolved[:8]:
            p.append(f"<tr><td>{esc(u['symbol'])}</td>"
                     f"<td class='num'>{u['max_value_cr']:.2f}</td>"
                     f"<td>{esc(str(u['reason'])[:90])}</td></tr>")
        p.append("</table>")

    p.append("<h2>Re-run</h2>")
    p.append("<pre>cd /home/mysyntax/Documents/Alphashri/stock-screener-ui\n"
             "source .venv/bin/activate\n"
             f"python india_board/scripts/bulk_deal_eda.py --days {ctx['days']} "
             f"--min-cr {ctx['min_cr']:g} --out {esc(ctx['out_rel'])}</pre>")
    p.append("</div></body></html>")
    return "\n".join(p)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="NSE bulk/block deals forward-move EDA")
    parser.add_argument("--days", type=int, default=10,
                        help="number of trading sessions to scan (default 10)")
    parser.add_argument("--min-cr", type=float, default=20.0,
                        help="institutional value threshold in ₹ Cr (default 20)")
    parser.add_argument("--offline", action="store_true",
                        help="reuse cached deals + candles (no network)")
    parser.add_argument("--out", default="reports/bulk_deals_eda",
                        help="output directory")
    parser.add_argument("--end", default=None,
                        help="anchor date YYYY-MM-DD (default: latest published session)")
    parser.add_argument("--top-n", type=int, default=30,
                        help="rows in the top-events table")
    args = parser.parse_args(argv)

    out_dir = Path(args.out)
    if not out_dir.is_absolute():
        out_dir = REPO_ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    anchor = _parse_iso(args.end) if args.end else default_anchor()
    days = trading_days(anchor, max(1, args.days))
    first_day = days[0]

    # 1) deals
    deals, deal_stats = collect_deals(days, offline=args.offline)
    _json_dump(DEALS_CACHE, {"days": [d.isoformat() for d in days],
                             "stats": deal_stats, "deals": deals})
    print(f"[deals] raw={deal_stats['raw_rows']} "
          f"deduped={deal_stats['deduped_rows']} over {len(days)} sessions")

    symbols = sorted({d["symbol"] for d in deals})
    event_symbols = sorted({
        d["symbol"] for d in deals
        if d["instrument_type"] == "equity"
        and d["side"] in ("BUY", "SELL")
        and d["client_type"] in INSTITUTIONAL_TYPES
        and (d["value_cr"] or 0) >= args.min_cr
    })
    print(f"[universe] {len(symbols)} deal symbols → {len(event_symbols)} "
          f"with institutional events ≥ ₹{args.min_cr:g} Cr")
    start = first_day - timedelta(days=120)
    series_by_symbol, status, price_meta = load_prices(
        event_symbols, start, anchor + timedelta(days=2), offline=args.offline)
    nifty = _load_benchmark(args.offline)
    if not nifty:
        print("  [warn] no NIFTY benchmark data; excess returns will be blank",
              file=sys.stderr)

    # 2) events
    events: list[dict] = []
    unresolved: list[dict] = []
    event_skip: dict[str, list[str]] = {}
    for sym in event_symbols:
        st = status.get(sym, {})
        if not st.get("ok"):
            unresolved.append({
                "symbol": sym,
                "reason": st.get("reason", "no price history"),
                "usable_rows": st.get("usable_rows"),
                "last_bar": st.get("last_bar"),
                "max_value_cr": _r2(max((d["value_cr"] for d in deals
                                         if d["symbol"] == sym), default=None)),
                "deal_dates": ";".join(sorted({d["deal_date"] for d in deals
                                               if d["symbol"] == sym})),
            })
    for d in deals:
        if d["instrument_type"] != "equity":
            continue
        if d["side"] not in ("BUY", "SELL"):
            continue
        if d["client_type"] not in INSTITUTIONAL_TYPES:
            continue
        if (d["value_cr"] or 0) < args.min_cr:
            continue
        if not status.get(d["symbol"], {}).get("ok"):
            continue
        ev, skip = compute_event(d, series_by_symbol.get(d["symbol"], {}),
                                 nifty, min_cr=args.min_cr)
        if ev is None:
            event_skip.setdefault(d["symbol"], []).append(skip)
            continue
        events.append({k: ev.get(k) for k in EVENT_FIELDS})
    for sym, reasons in event_skip.items():
        unresolved.append({
            "symbol": sym,
            "reason": "; ".join(sorted(set(r for r in reasons if r))),
            "usable_rows": status.get(sym, {}).get("usable_rows"),
            "last_bar": status.get(sym, {}).get("last_bar"),
            "max_value_cr": _r2(max((d["value_cr"] for d in deals
                                     if d["symbol"] == sym), default=None)),
            "deal_dates": ";".join(sorted({d["deal_date"] for d in deals
                                           if d["symbol"] == sym})),
        })

    # last bar across all series + proxy usage
    all_last = [max(s) for s in series_by_symbol.values() if s]
    last_bar = max(all_last) if all_last else "–"
    used_proxy = any(v.get("source") == "intraday_proxy"
                     for s in series_by_symbol.values() for v in s.values())

    # 3) raw + stock-day (clustering-removed) views
    aggregates = compute_aggregates(events, view="raw")
    stock_days, stock_day_meta = build_stock_days(events)
    stock_day_aggregates = compute_aggregates(stock_days, view="stock_day")

    # 4) per-client leaderboard (BUY + SELL)
    clients = (client_leaderboard(events, side="BUY")
               + client_leaderboard(events, side="SELL"))

    # 5) control cohort: volume spikes with no institutional deal
    deal_stock_days = {(e["symbol"], e["deal_date"]) for e in events}
    control_events, control_meta = build_control_events(
        event_symbols, series_by_symbol, status, nifty,
        first_day=first_day.isoformat(), anchor=anchor.isoformat(),
        deal_stock_days=deal_stock_days)
    control_aggregates = compute_control_aggregates(control_events)
    print(f"[control] candidates={control_meta['candidates']} "
          f"sampled={control_meta['sampled']} (z≥{control_meta['threshold_z']})")

    charts = make_charts(events, nifty, out_dir, stock_days=stock_days,
                         control_events=control_events, clients=clients)

    # 6) write outputs
    _write_csv(out_dir / "events.csv", events, EVENT_FIELDS)
    _write_csv(out_dir / "stock_day_events.csv", stock_days, STOCK_DAY_FIELDS)
    _write_csv(out_dir / "aggregates.csv", aggregates,
               ["view", "scope_type", "scope", "scope_n", "horizon", "n",
                "mean_pct", "median_pct", "pct_positive", "nifty_mean_pct",
                "excess_mean_pct", "mean_net_pct", "mean_vol_z",
                "insufficient_sample"])
    _write_csv(out_dir / "control_aggregates.csv", control_aggregates,
               ["view", "scope_type", "scope", "scope_n", "horizon", "n",
                "mean_pct", "median_pct", "pct_positive", "nifty_mean_pct",
                "excess_mean_pct", "mean_net_pct", "mean_vol_z",
                "insufficient_sample"])
    _write_csv(out_dir / "clients.csv", clients, CLIENT_FIELDS)
    _write_csv(out_dir / "controls.csv", control_events,
               ["cohort", "deal_date", "symbol", "vol_z_20", "pre_5", "pre_10",
                "fwd_1", "fwd_2", "fwd_5", "since_deal",
                "excess_1", "excess_2", "excess_5", "excess_since"])
    _write_csv(out_dir / "unresolved.csv", unresolved,
               ["symbol", "reason", "usable_rows", "last_bar", "max_value_cr",
                "deal_dates"])

    ctx = {
        "events": events,
        "aggregates": aggregates,
        "stock_days": stock_days,
        "stock_day_meta": stock_day_meta,
        "stock_day_aggregates": stock_day_aggregates,
        "clients": clients,
        "control_events": control_events,
        "control_meta": control_meta,
        "control_aggregates": control_aggregates,
        "deal_stats": deal_stats,
        "anchor": anchor.isoformat(),
        "first_day": first_day.isoformat(),
        "n_sessions": len(days),
        "days": args.days,
        "min_cr": args.min_cr,
        "n_symbols": len(event_symbols),
        "n_deal_symbols": len(symbols),
        "n_unresolved": len(unresolved),
        "unresolved": unresolved,
        "last_bar": last_bar,
        "used_proxy": used_proxy,
        "charts": charts,
        "generated_at": _ist_now().strftime("%Y-%m-%d %H:%M"),
        "out_rel": str(out_dir.relative_to(REPO_ROOT))
        if str(out_dir).startswith(str(REPO_ROOT)) else str(out_dir),
        "top_n": args.top_n,
    }
    (out_dir / "EDA.md").write_text(render_markdown(ctx), encoding="utf-8")
    (out_dir / "eda_report.html").write_text(render_html(ctx), encoding="utf-8")
    (out_dir / "CLIENTS.md").write_text(render_clients_md(ctx), encoding="utf-8")

    print(f"[out] {out_dir}")
    print(f"      events={len(events)} stock_days={len(stock_days)} "
          f"aggregates={len(aggregates)} clients={len(clients)} "
          f"control={len(control_events)} unresolved={len(unresolved)} "
          f"charts={len(charts)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
