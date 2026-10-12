#!/usr/bin/env python3
"""Forward-return scorer for persisted alerts.

For each alert that has a directional `side` (bullish => +1, bearish => -1) this
resolves what price actually did afterwards, at several horizons:

    5m / 15m / 60m   intraday, measured from the first 1-minute bar close at or
                     after the alert's `created_at`
    eod              close of the regular-session bar (16:00 ET) on the alert's
                     session
    1d               close of the *next* session (from /ohlc/1d)

Exit bar selection
------------------
For every horizon we take the bar whose timestamp is **closest** to
`entry_ts + horizon` within `_EXIT_TOL_MIN` minutes, searching on BOTH sides of
the target. We do not take "the last bar inside a tolerance window" (which
silently stretched a 5m horizon into 10m). If no bar lies within tolerance the
horizon stays unresolved. The ticker-own baseline uses the same closest-bar
rule, so it measures the same window length.

Baseline / excess precedence
----------------------------
`ret` is the move in the alert's predicted direction. `excess = ret -
baseline_ret`, where `baseline_ret` is the direction-signed benchmark move over
the *same* window, chosen in this order:

    1. SPY (market-relative): `dir * spy_move(entry -> exit)`, used whenever SPY
       1m bars cover the window (SPY bars are fetched once per run and reused).
    2. the ticker's own unconditional mean move over the same horizon, signed by
       `dir`, used only when it has >= `_BASELINE_MIN` samples.
    3. neither -> `baseline_ret = None, excess = None`.

Prices are cached in `edge_store` (`bars`) and the scored results are written to
`edge_store.outcomes`. Fetching is bounded (`--max-fetches`, default 60 per run)
and throttled per ticker to protect the 40k/day UW quota.

Design notes / caveats
----------------------
* `dir` is only ever +1/-1; ambiguous alerts (dark-pool `side="ext"`, OI rows
  with no side, empty sides) are skipped forever rather than guessed.
* Because the bar cache is rolling, ticker baselines can shift slightly as more
  bars are cached.
* Timezone: UW returns UTC; session boundaries are computed in America/New_York
  (`market_status.ET`). There is no `config.IST` inside this standalone module —
  the US market runs on ET.
* Figures are gross of commissions/slippage.

CLI:
    python scripts/edge_resolver.py --once [--limit N] [--max-fetches N] [--days N]
    python scripts/edge_resolver.py --reset          # delete outcomes, re-resolve
"""
from __future__ import annotations

import argparse
import bisect
import json
import sqlite3
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import edge_store  # noqa: E402
import market_status  # noqa: E402
from uw_client import UWClient  # noqa: E402

ET = market_status.ET
UTC = timezone.utc

HORIZONS = ("5m", "15m", "60m", "eod", "1d")
HORIZON_MIN = {"5m": 5, "15m": 15, "60m": 60}

_SPY = "SPY"                 # market benchmark
_SESSION_CLOSE = (16, 0)     # 16:00 ET
_BASELINE_MIN = 20           # samples required before a ticker baseline is emitted
_FETCH_TTL = 120             # seconds: don't refetch a ticker's 1m bars faster than this
_DAILY_FETCH_TTL = 21600     # 6h: daily bars only change once per session
_EXIT_TOL_MIN = 5            # +/- minutes allowed when snapping to the exit bar

_state = {"resolving": False, "last_run": None, "last_counts": None}
_state_lock = threading.Lock()
_last_fetch: dict = {}


def state() -> dict:
    with _state_lock:
        return dict(_state)


# ------------------------------------------------------------------ helpers
def _f(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


def _parse_ts(s) -> datetime | None:
    if not s:
        return None
    try:
        t = str(s).strip()
        if t.endswith("Z"):
            t = t[:-1] + "+00:00"
        dt = datetime.fromisoformat(t)
        return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    except (ValueError, TypeError):
        return None


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def direction(side) -> int:
    s = str(side or "").strip().lower()
    if s in ("bullish", "buy", "call"):
        return 1
    if s in ("bearish", "sell", "put"):
        return -1
    return 0


def _is_daily_ts(ts: str) -> bool:
    return str(ts or "").endswith("T00:00:00Z")


def _session_date(dt: datetime) -> str:
    return dt.astimezone(ET).date().isoformat()


def _session_close_utc(dt: datetime) -> datetime:
    """16:00 ET on `dt`'s session date, as an aware UTC datetime."""
    local = dt.astimezone(ET)
    close = local.replace(hour=_SESSION_CLOSE[0], minute=_SESSION_CLOSE[1], second=0, microsecond=0)
    return close.astimezone(UTC)


def _series(bars) -> list:
    """Sorted `[(dt, bar), ...]`, dropping rows with an unparseable timestamp."""
    out = []
    for b in bars or []:
        dt = _parse_ts(b.get("ts"))
        if dt is not None:
            out.append((dt, b))
    out.sort(key=lambda x: x[0])
    return out


def _closest_bar(series: list, target_dt: datetime | None, tol_min: int = _EXIT_TOL_MIN):
    """Bar whose timestamp is closest to `target_dt`, within +/- `tol_min` minutes.

    Searches both sides of the target (adjacent entries in a sorted series are
    enough). Returns None when nothing is inside tolerance, so the caller leaves
    the horizon unresolved rather than silently widening the window.
    """
    if not series or target_dt is None:
        return None
    times = [t for t, _ in series]
    i = bisect.bisect_left(times, target_dt)
    best = None
    best_d = None
    for j in (i - 1, i):
        if 0 <= j < len(series):
            t, b = series[j]
            d = abs((t - target_dt).total_seconds())
            if d <= tol_min * 60 and (best_d is None or d < best_d):
                best_d, best = d, b
    return best


def _first_at_or_after(series: list, adt: datetime | None):
    if not series or adt is None:
        return None
    times = [t for t, _ in series]
    i = bisect.bisect_left(times, adt)
    return series[i] if i < len(series) else None


def _elapsed(alert_dt: datetime, horizon: str, now: datetime) -> bool:
    if horizon in HORIZON_MIN:
        return now >= alert_dt + timedelta(minutes=HORIZON_MIN[horizon] + 1)
    if horizon == "eod":
        return now >= _session_close_utc(alert_dt)
    if horizon == "1d":
        # next session close is at least ~1 day away
        return now >= _session_close_utc(alert_dt) + timedelta(days=1)
    return False


def _targets_for(dt: datetime, pend: list) -> tuple:
    """Coverage targets `(intraday_targets, daily_targets)` for pending horizons.

    Intraday targets must span `HORIZON_MIN[h] + tolerance` so the closest-bar
    exit picker actually has bars to choose from (a hardcoded 10-minute window
    left 60m/eod unresolved).
    """
    intraday: list = []
    daily: list = []
    for h in pend:
        if h == "1d":
            intraday.append((dt, dt + timedelta(minutes=_EXIT_TOL_MIN)))
            # daily bars are keyed at the session's midnight; covered once a bar
            # at/after the alert timestamp exists (i.e. next session)
            daily.append((dt, dt))
        elif h == "eod":
            intraday.append((dt, _session_close_utc(dt) + timedelta(minutes=_EXIT_TOL_MIN)))
        else:
            intraday.append((dt, dt + timedelta(minutes=HORIZON_MIN[h] + _EXIT_TOL_MIN)))
    return intraday, daily


# ------------------------------------------------------------------- loading
def _load_alerts(limit: int, days: int) -> list:
    """Recent alerts from `data/alerts.db`, newest first. Never raises."""
    try:
        import alert_store  # noqa: PLC0415

        db = alert_store.db_path()
    except Exception:  # noqa: BLE001
        return []
    since = (datetime.now(UTC) - timedelta(days=max(1, int(days)))).isoformat(timespec="seconds")
    sql = (
        "SELECT id, kind, ticker, asset_class, sweep, side, premium, event_ts "
        "FROM alerts WHERE event_ts >= ? "
        "AND side IN ('bullish','bearish','buy','sell') "
        "ORDER BY event_ts DESC LIMIT ?"
    )
    try:
        uri = f"file:{db}?mode=ro"
        conn = sqlite3.connect(uri, uri=True, timeout=5)
    except Exception:  # noqa: BLE001
        try:
            conn = sqlite3.connect(str(db), timeout=5)
        except Exception:  # noqa: BLE001
            return []
    try:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql, (since, max(1, int(limit)))).fetchall()
        return [dict(r) for r in rows]
    except Exception:  # noqa: BLE001
        return []
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass


# -------------------------------------------------------------------- fetch
def _norm_1m(ticker: str, data) -> list:
    out = []
    for x in data or []:
        if not isinstance(x, dict):
            continue
        ts = _parse_ts(x.get("start_time"))
        if ts is None:
            continue
        out.append(
            {
                "ticker": ticker,
                "ts": _iso(ts),
                "o": x.get("open"),
                "h": x.get("high"),
                "l": x.get("low"),
                "c": x.get("close"),
                "v": x.get("volume"),
            }
        )
    return out


def _norm_1d(ticker: str, data) -> list:
    out = []
    for x in data or []:
        if not isinstance(x, dict):
            continue
        d = x.get("date")
        if not d:
            continue
        out.append(
            {
                "ticker": ticker,
                "ts": f"{d}T00:00:00Z",
                "o": x.get("open"),
                "h": x.get("high"),
                "l": x.get("low"),
                "c": x.get("close"),
                "v": x.get("volume"),
            }
        )
    return out


def _fetch(client, ticker: str, kind: str) -> int:
    """Fetch and cache 1m/1d bars. Returns rows written (0 on failure)."""
    try:
        path = f"/api/stock/{ticker}/ohlc/{'1m' if kind == '1m' else '1d'}"
        r = client.get(path, timeout=30)
        if r.status_code != 200:
            return 0
        payload = r.json()
        data = payload.get("data") if isinstance(payload, dict) else payload
        rows = _norm_1m(ticker, data) if kind == "1m" else _norm_1d(ticker, data)
        return edge_store.put_bars(rows)
    except Exception:  # noqa: BLE001
        return 0


def _coverage(span: dict | None, targets: list) -> str:
    """Decide whether cached bars suffice: `ok` | `fetch` | `stale`."""
    if not span:
        return "fetch"
    mn, mx = _parse_ts(span.get("min")), _parse_ts(span.get("max"))
    if mn is None or mx is None:
        return "fetch"
    need_new = False
    possible = False
    for lo, hi in targets:
        if lo is None or hi is None:
            continue
        if hi < mn:
            continue  # window entirely older than the cache — unrecoverable
        if lo > mx or hi > mx:
            need_new = True  # we are missing the tail of the window
        else:
            possible = True
    if need_new:
        return "fetch"
    return "ok" if possible else "stale"


def _throttled(ticker: str, kind: str, now_mono: float) -> bool:
    ttl = _DAILY_FETCH_TTL if kind == "1d" else _FETCH_TTL
    return (now_mono - _last_fetch.get(f"{ticker}:{kind}", 0.0)) < ttl


# ------------------------------------------------------------------ scoring
def _baseline(ticker: str, horizon: str, intraday: list, daily: list, cache: dict):
    """Ticker's own unconditional mean move over `horizon` (raw %, unsigned).

    Uses the same closest-bar rule as `_score` so the baseline window length
    matches the scored window. Returns None with < `_BASELINE_MIN` samples.
    """
    key = (ticker, horizon)
    if key in cache:
        return cache[key]
    vals: list = []
    try:
        if horizon in HORIZON_MIN:
            step = HORIZON_MIN[horizon]
            sessions: dict = {}
            for b in intraday:
                dt = _parse_ts(b["ts"])
                c = _f(b.get("c"))
                if dt is None or c is None:
                    continue
                sessions.setdefault(_session_date(dt), []).append(b)
            for bars in sessions.values():
                series = _series(bars)
                for t0, b0 in series:
                    c0 = _f(b0.get("c"))
                    if not c0:
                        continue
                    eb = _closest_bar(series, t0 + timedelta(minutes=step), _EXIT_TOL_MIN)
                    if eb is None:
                        continue
                    edt = _parse_ts(eb["ts"])
                    ec = _f(eb.get("c"))
                    if edt is None or ec is None or edt <= t0:
                        continue
                    vals.append((ec / c0 - 1.0) * 100.0)
        elif horizon == "eod":
            sessions = {}
            for b in intraday:
                dt = _parse_ts(b["ts"])
                c = _f(b.get("c"))
                if dt is None or c is None:
                    continue
                local = dt.astimezone(ET)
                if local.hour < _SESSION_CLOSE[0] or (local.hour == _SESSION_CLOSE[0] and local.minute == 0):
                    sessions.setdefault(local.date().isoformat(), []).append(b)
            for bars in sessions.values():
                if len(bars) < 2:
                    continue
                series = _series(bars)
                close_dt = _session_close_utc(series[-1][0])
                ebar = _closest_bar(series, close_dt, _EXIT_TOL_MIN)
                last = _f(ebar.get("c")) if ebar else None
                if not last:
                    continue
                for t0, b0 in series:
                    c0 = _f(b0.get("c"))
                    if c0 and t0 < close_dt:
                        vals.append((last / c0 - 1.0) * 100.0)
        elif horizon == "1d":
            closes = [_f(b.get("c")) for b in daily if _f(b.get("c"))]
            for a, b in zip(closes, closes[1:]):
                if a:
                    vals.append((b / a - 1.0) * 100.0)
    except Exception:  # noqa: BLE001
        vals = []
    result = round(sum(vals) / len(vals), 4) if len(vals) >= _BASELINE_MIN else None
    cache[key] = result
    return result


def _daily_map(daily: list) -> dict:
    """`{YYYY-MM-DD: close}` for daily bars."""
    out = {}
    for b in daily or []:
        ts = str(b.get("ts") or "")
        if not _is_daily_ts(ts):
            continue
        c = _f(b.get("c"))
        if c is not None:
            out[ts[:10]] = c
    return out


def _spy_move(dir_: int, entry_dt: datetime, exit_bar: dict, spy_intra: list, spy_daily: list):
    """Direction-signed SPY move (%) over the alert's exact entry->exit window.

    Returns None when SPY bars don't cover both ends.
    """
    try:
        sseries = _series(spy_intra)
        se = _closest_bar(sseries, entry_dt, _EXIT_TOL_MIN)
        if se is None:
            return None
        sepx = _f(se.get("c"))
        if not sepx:
            return None
        if _is_daily_ts(exit_bar.get("ts")):
            cc = _daily_map(spy_daily).get(str(exit_bar.get("ts"))[:10])
            if not cc:
                return None
            raw = cc / sepx - 1.0
        else:
            sx = _closest_bar(sseries, _parse_ts(exit_bar["ts"]), _EXIT_TOL_MIN)
            if sx is None:
                return None
            sxpx = _f(sx.get("c"))
            if not sxpx:
                return None
            raw = sxpx / sepx - 1.0
        return dir_ * raw * 100.0
    except Exception:  # noqa: BLE001
        return None


def _score(alert: dict, horizon: str, dir_: int, intraday: list, daily: list,
           baseline_cache: dict, now: datetime, spy_intra: list, spy_daily: list):
    iseries = _series(intraday)
    entry_pair = _first_at_or_after(iseries, alert_dt(alert))
    if entry_pair is None:
        return None
    entry_dt, entry = entry_pair
    entry_px = _f(entry.get("c"))
    if not entry_px:
        return None

    exit_bar = None
    if horizon in HORIZON_MIN:
        target = entry_dt + timedelta(minutes=HORIZON_MIN[horizon])
        exit_bar = _closest_bar(iseries, target, _EXIT_TOL_MIN)
    elif horizon == "eod":
        sess = _session_date(entry_dt)
        sbar = [b for b in intraday if _session_date(_parse_ts(b["ts"]) or entry_dt) == sess]
        exit_bar = _closest_bar(_series(sbar), _session_close_utc(entry_dt), _EXIT_TOL_MIN)
    elif horizon == "1d":
        sess = _session_date(entry_dt)
        for b in daily:
            if str(b.get("ts", ""))[:10] > sess:
                exit_bar = b
                break
    else:
        return None

    if exit_bar is None:
        return None
    exit_dt = _parse_ts(exit_bar["ts"])
    exit_px = _f(exit_bar.get("c"))
    if exit_px is None or exit_dt is None:
        return None
    if exit_dt <= entry_dt:
        return None  # no forward movement (e.g. afterhours alert vs 16:00 close)

    ret = dir_ * (exit_px / entry_px - 1.0) * 100.0

    # MFE/MAE: confined to the scored window, never the whole cached history.
    if horizon == "1d":
        exit_date = str(exit_bar.get("ts"))[:10]
        ex_bars = [b for b in daily if sess < str(b.get("ts"))[:10] <= exit_date]
        if not ex_bars:
            ex_bars = [exit_bar]
    else:
        ex_bars = [b for dt, b in iseries if entry_dt < dt <= exit_dt]
        if not ex_bars:
            ex_bars = [exit_bar]
    highs = [h for h in (_f(b.get("h")) for b in ex_bars) if h is not None]
    lows = [l for l in (_f(b.get("l")) for b in ex_bars) if l is not None]
    if dir_ > 0:
        mfe = (max(highs) / entry_px - 1.0) * 100.0 if highs else ret
        mae = (min(lows) / entry_px - 1.0) * 100.0 if lows else ret
    else:
        mfe = (1.0 - min(lows) / entry_px) * 100.0 if lows else ret
        mae = (1.0 - max(highs) / entry_px) * 100.0 if highs else ret

    # Benchmark precedence: SPY (market-relative) -> ticker's own mean -> None.
    base = _spy_move(dir_, entry_dt, exit_bar, spy_intra, spy_daily)
    if base is None:
        raw = _baseline(str(alert.get("ticker") or "").upper(), horizon, intraday, daily, baseline_cache)
        if raw is not None:
            base = dir_ * raw
    excess = (ret - base) if base is not None else None

    return {
        "alert_id": str(alert.get("id")),
        "horizon": horizon,
        "entry_ts": _iso(entry_dt),
        "entry_px": round(entry_px, 6),
        "exit_ts": _iso(exit_dt),
        "exit_px": round(exit_px, 6),
        "ret": round(ret, 4),
        "mfe": round(mfe, 4),
        "mae": round(mae, 4),
        "dir": dir_,
        "baseline_ret": round(base, 4) if base is not None else None,
        "excess": round(excess, 4) if excess is not None else None,
        "resolved_at": now.isoformat(timespec="seconds"),
    }


def alert_dt(alert: dict) -> datetime:
    dt = _parse_ts(alert.get("event_ts")) or _parse_ts(alert.get("created_at"))
    return dt or datetime.now(UTC)


# --------------------------------------------------------------- main entry
def resolve_pending(limit: int = 800, max_bars_fetches: int = 60, days: int = 10) -> dict:
    """Resolve every pending alert/horizon we can right now. Never raises."""
    with _state_lock:
        _state["resolving"] = True
    counts = {"scanned": 0, "candidates": 0, "resolved": 0, "skipped": 0,
              "fetches": 0, "pending": 0}
    now = datetime.now(UTC)
    try:
        edge_store.init()
        resolved = edge_store.get_resolved_ids()
        alerts = _load_alerts(limit, days)
        counts["scanned"] = len(alerts)

        # directional alerts only, and only those with an unresolved, elapsed horizon
        cands = []
        for a in alerts:
            d = direction(a.get("side"))
            if d == 0:
                counts["skipped"] += 1
                continue
            dt = alert_dt(a)
            pend = [h for h in HORIZONS if (str(a.get("id")), h) not in resolved and _elapsed(dt, h, now)]
            if not pend:
                continue
            cands.append((a, d, dt, pend))
        counts["candidates"] = len(cands)

        # which tickers need which bar kind, with coverage targets. SPY is added
        # once so the market-relative baseline can reuse a single fetch per run.
        need_1m: dict = {}
        need_1d: dict = {}
        for a, _d, dt, pend in cands:
            t = str(a.get("ticker") or "").upper()
            m1, d1 = _targets_for(dt, pend)
            if t:
                need_1m.setdefault(t, []).extend(m1)
                need_1d.setdefault(t, []).extend(d1)
            need_1m.setdefault(_SPY, []).extend(m1)
            need_1d.setdefault(_SPY, []).extend(d1)

        client = None
        try:
            client = UWClient()
        except Exception:  # noqa: BLE001
            client = None

        now_mono = time.monotonic()

        def _ensure(kind: str, targets: dict):
            nonlocal client
            for t, tgts in targets.items():
                if counts["fetches"] >= max_bars_fetches or client is None:
                    return
                span = edge_store.bars_span(t, daily=(kind == "1d"))
                cov = _coverage(span, tgts)
                if cov != "fetch" or _throttled(t, kind, now_mono):
                    continue
                _last_fetch[f"{t}:{kind}"] = now_mono
                if _fetch(client, t, kind):
                    counts["fetches"] += 1

        _ensure("1m", need_1m)
        _ensure("1d", need_1d)

        # load cached bars once per ticker (SPY included for the benchmark)
        bar_cache: dict = {}
        daily_cache: dict = {}
        baseline_cache: dict = {}

        def _load(t: str):
            if t not in bar_cache:
                all_bars = edge_store.get_bars(t)
                bar_cache[t] = [b for b in all_bars if not _is_daily_ts(b["ts"])]
                daily_cache[t] = [b for b in all_bars if _is_daily_ts(b["ts"])]

        _load(_SPY)
        rows = []
        for a, d, dt, pend in cands:
            t = str(a.get("ticker") or "").upper()
            if not t:
                continue
            _load(t)
            for h in pend:
                try:
                    out = _score(
                        a, h, d, bar_cache[t], daily_cache[t], baseline_cache, now,
                        bar_cache[_SPY], daily_cache[_SPY],
                    )
                except Exception:  # noqa: BLE001
                    out = None
                if out is None:
                    counts["pending"] += 1
                    continue
                rows.append(out)
                resolved.add((str(a.get("id")), h))
        if rows:
            counts["resolved"] = edge_store.upsert_outcomes(rows)
    except Exception as exc:  # noqa: BLE001
        counts["error"] = repr(exc)[:200]
    finally:
        with _state_lock:
            _state["resolving"] = False
            _state["last_run"] = datetime.now(UTC).isoformat(timespec="seconds")
            _state["last_counts"] = dict(counts)
    return counts


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="resolve pending now and exit")
    ap.add_argument("--reset", action="store_true",
                    help="delete all scored outcomes first, then re-resolve from cached bars")
    ap.add_argument("--limit", type=int, default=800, help="max alerts scanned per run")
    ap.add_argument("--max-fetches", type=int, default=60, help="max UW bar fetches per run")
    ap.add_argument("--days", type=int, default=10, help="only scan alerts from the last N days")
    args = ap.parse_args()
    cleared = 0
    if args.reset:
        edge_store.init()
        cleared = edge_store.clear_outcomes()
    counts = resolve_pending(limit=args.limit, max_bars_fetches=args.max_fetches, days=args.days)
    if cleared:
        counts["cleared"] = cleared
    print(json.dumps({"counts": counts, "db": str(edge_store.db_path())}, indent=2))


if __name__ == "__main__":
    main()
