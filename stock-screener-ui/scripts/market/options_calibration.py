"""Read-only validation harness for IV / probability analytics.

The sibling ``option_chain_snapshots`` append-log is the only data source: one
row per (underlying, expiry, strike, side, minute). This script derives the
per-session ATM IV series, its rank/percentile, a 20-day realised-vol comparison,
a forward-cone coverage/PIT check and a per-expiry term snapshot — all with
plain SELECTs, never a write and never a running server / broker call.

Usage (project venv)::

    .venv/bin/python scripts/market/options_calibration.py \
        --underlying NIFTY --days 90 --horizon 1

Outputs are printed to stdout. Missing table, empty history, missing IVs,
duplicate minutes and non-trading days are all handled without raising; an
insufficient history (<20 sessions) still prints whatever exists and exits 0.

Conventions
-----------
* Session dates are IST (``config.IST``); the resident ``session_date`` column
  is preferred, falling back to the IST calendar date of ``ts``.
* Realised vol is annualised with 252 trading days.
* The forward cone uses the front ("next") expiry's ATM IV for that session,
  scaled by ``sqrt(horizon / 252)``; ``+/-1 sigma`` is the 68% band and
  ``+/-1.96 sigma`` the 95% band.
"""
from __future__ import annotations

import argparse
import importlib.util
import math
import statistics
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Optional

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.options_conventions import IV_MAX  # noqa: E402

try:  # IST is the canonical app timezone; a fixed fallback keeps the script standalone.
    import config

    IST = config.IST
except Exception:  # pragma: no cover - only when config.py is unavailable
    from datetime import timezone, timedelta as _td

    IST = timezone(_td(hours=5, minutes=30))

MIN_SESSIONS = 20
TRADING_DAYS = 252
# IV_MAX is imported from api.options_conventions (shared with options_analytics_probe):
# ignore implausible IV quotes above 60 vol points.
PIT_BINS = 10



def finite(value: Any) -> Optional[float]:
    """Finite float or None (NaN/inf/None must never pass as a real number)."""
    try:
        out = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def session_date_of(row: dict) -> Optional[str]:
    """IST session date string from the resident column, else from ts."""
    stored = row.get("session_date")
    if isinstance(stored, str) and len(stored) == 10:
        return stored
    ts = row.get("ts")
    if isinstance(ts, datetime):
        if ts.tzinfo is not None:
            return ts.astimezone(IST).date().isoformat()
        return ts.date().isoformat()
    if isinstance(ts, str):
        try:
            parsed = datetime.fromisoformat(ts)
            if parsed.tzinfo is not None:
                parsed = parsed.astimezone(IST)
            return parsed.date().isoformat()
        except ValueError:
            return None
    return None


def _sort_key_ts(row: dict) -> tuple:
    ts = row.get("ts")
    if isinstance(ts, datetime):
        return (ts.replace(tzinfo=None),)
    if isinstance(ts, str):
        return (ts,)
    return ("",)


def latest_chain(legs: Iterable[dict]) -> dict[tuple[float, str], dict]:
    """Deduplicate minute duplicates: keep the newest row per (strike, side).

    The snapshot log has one row per minute, so a session has many observations
    of the same strike. Only the last observation of each leg represents the
    session's chain; older ones are stale, not extra liquidity.
    """
    newest: dict[tuple[float, str], dict] = {}
    for row in legs:
        strike = finite(row.get("strike"))
        side = str(row.get("side") or "").upper()
        if strike is None or side not in ("CE", "PE"):
            continue
        key = (strike, side)
        prev = newest.get(key)
        if prev is None or _sort_key_ts(row) >= _sort_key_ts(prev):
            newest[key] = row
    return newest


def interp(points: list[tuple[float, float]], target: float) -> Optional[float]:
    """Linear interpolation (clamped at the edges) of IV across strikes."""
    pts = sorted((x, y) for x, y in points if finite(x) is not None and finite(y) is not None)
    if not pts:
        return None
    if target <= pts[0][0]:
        return pts[0][1]
    if target >= pts[-1][0]:
        return pts[-1][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= target <= x1 and x1 != x0:
            return y0 + (target - x0) / (x1 - x0) * (y1 - y0)
    return pts[-1][1]


def atm_iv(legs: Iterable[dict], spot: float) -> Optional[float]:
    """Nearest-strike interpolated ATM IV from a deduplicated chain.

    CE and PE IVs at the same strike are averaged; implausible / missing IVs
    are dropped rather than treated as zero.
    """
    chain = latest_chain(legs)
    by_strike: dict[float, list[float]] = {}
    for (strike, _side), row in chain.items():
        iv = finite(row.get("iv"))
        if iv is None or not (0 < iv <= IV_MAX):
            continue
        by_strike.setdefault(strike, []).append(iv)
    points = [(strike, sum(ivs) / len(ivs)) for strike, ivs in by_strike.items()]
    if not points or not (finite(spot) and spot > 0):
        return None
    return interp(points, spot)


def build_session_series(rows: Iterable[dict]) -> list[dict]:
    """One entry per IST session: spot, front expiry, DTE and ATM IV.

    The front expiry is the nearest listed expiry at or after the session date.
    Non-trading days simply have no rows and never appear in the output.
    """
    by_session: dict[str, list[dict]] = {}
    for row in rows:
        session = session_date_of(row)
        if session:
            by_session.setdefault(session, []).append(row)

    series: list[dict] = []
    for session in sorted(by_session):
        day_rows = by_session[session]
        session_day = date.fromisoformat(session)

        spot = None
        for row in sorted(day_rows, key=_sort_key_ts, reverse=True):
            candidate = finite(row.get("spot"))
            if candidate is not None and candidate > 0:
                spot = candidate
                break

        expiries: dict[str, list[dict]] = {}
        for row in day_rows:
            expiry = row.get("expiry")
            if isinstance(expiry, str) and expiry:
                expiries.setdefault(expiry, []).append(row)

        def expiry_sort_key(exp: str) -> tuple[int, str]:
            try:
                return (date.fromisoformat(exp).toordinal(), exp)
            except ValueError:
                return (10**9, exp)

        front = min(expiries, key=expiry_sort_key) if expiries else None
        front_iv = atm_iv(expiries[front], spot) if (front and spot) else None
        try:
            dte = (date.fromisoformat(front) - session_day).days if front else None
        except ValueError:
            dte = None

        series.append({
            "date": session,
            "spot": spot,
            "front_expiry": front,
            "dte": dte,
            "atm_iv": front_iv,
        })
    return series


def iv_rank_percentile(series: list[dict]) -> dict:
    ivs = [s["atm_iv"] for s in series if s["atm_iv"] is not None]
    if not ivs:
        return {"n": 0, "min": None, "max": None, "latest": None,
                "rank": None, "rank_pct": None, "percentile": None}
    low, high, latest = min(ivs), max(ivs), ivs[-1]
    rank = (latest - low) / (high - low) if high > low else 0.0
    percentile = 100.0 * sum(1.0 for iv in ivs if iv <= latest) / len(ivs)
    return {"n": len(ivs), "min": low, "max": high, "latest": latest,
            "rank": rank, "rank_pct": rank * 100.0, "percentile": percentile}


def realised_vol(series: list[dict], window: int = 20) -> Optional[float]:
    spots = [s["spot"] for s in series if s["spot"] is not None and s["spot"] > 0]
    if len(spots) < window + 1:
        return None
    closes = spots[-(window + 1):]
    returns = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
    if len(returns) < 2:
        return None
    return statistics.stdev(returns) * math.sqrt(TRADING_DAYS) * 100.0


def _norm_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def cone_coverage(series: list[dict], horizon: int) -> dict:
    """Forward ``horizon``-session cone coverage + a 10-bin PIT histogram."""
    pit_bins = [0] * PIT_BINS
    covered68 = covered95 = tested = 0
    z_values: list[float] = []
    for i in range(len(series) - horizon):
        spot, iv = series[i]["spot"], series[i]["atm_iv"]
        future = series[i + horizon]["spot"]
        if not (spot and iv and future) or spot <= 0 or iv <= 0 or future <= 0:
            continue
        sigma = spot * (iv / 100.0) * math.sqrt(horizon / TRADING_DAYS)
        if sigma <= 0:
            continue
        move = future - spot
        covered68 += int(abs(move) <= sigma)
        covered95 += int(abs(move) <= 1.96 * sigma)
        z = move / sigma
        z_values.append(z)
        pit = _norm_cdf(z)
        bucket = min(PIT_BINS - 1, max(0, int(pit * PIT_BINS)))
        pit_bins[bucket] += 1
        tested += 1
    return {
        "n": tested,
        "coverage68": 100.0 * covered68 / tested if tested else None,
        "coverage95": 100.0 * covered95 / tested if tested else None,
        "pit": pit_bins,
        "mean_z": statistics.fmean(z_values) if z_values else None,
    }


def term_snapshot(rows: Iterable[dict], as_of: Optional[str]) -> list[dict]:
    if not as_of:
        return []
    by_expiry: dict[str, list[dict]] = {}
    spot = None
    for row in rows:
        if session_date_of(row) != as_of:
            continue
        expiry = row.get("expiry")
        candidate = finite(row.get("spot"))
        if candidate is not None and candidate > 0:
            spot = candidate
        if isinstance(expiry, str) and expiry:
            by_expiry.setdefault(expiry, []).append(row)
    out: list[dict] = []
    for expiry, legs in by_expiry.items():
        try:
            dte = (date.fromisoformat(expiry) - date.fromisoformat(as_of)).days
        except ValueError:
            dte = None
        out.append({"expiry": expiry, "dte": dte, "atm_iv": atm_iv(legs, spot) if spot else None})
    out.sort(key=lambda x: (x["dte"] is None, x["dte"] if x["dte"] is not None else 0))
    return out



_SQL = (
    "SELECT ts, underlying, expiry, strike, side, iv, spot, session_date "
    "FROM option_chain_snapshots WHERE underlying = :underlying"
)


def _row_to_dict(row: Any) -> dict:
    mapping = getattr(row, "_mapping", None)
    data = dict(mapping) if mapping is not None else dict(row)
    return data


def load_snapshots(source: Any, underlying: str, since: Optional[str] = None) -> tuple[list[dict], Optional[str]]:
    """Fetch snapshot legs. Returns ``(rows, error)``; never raises on a bad table.

    ``source`` may be a SQLAlchemy Session (ORM path, model imported when
    available) or a Connection (raw SQL by table name). ``since`` is an
    ISO session date used to limit the window.
    """
    from sqlalchemy import text

    error: Optional[str] = None
    try:
        if hasattr(source, "query"):
            try:
                from db.models.option_snapshot import OptionChainSnapshot as Model
            except Exception:
                Model = None
            if Model is not None:
                query = source.query(Model).filter(Model.underlying == underlying)
                if since:
                    query = query.filter(Model.session_date >= since)
                return ([_row_to_dict({
                    "ts": r.ts, "expiry": r.expiry, "strike": r.strike,
                    "side": r.side, "iv": r.iv, "spot": r.spot,
                    "session_date": r.session_date,
                }) for r in query.all()], None)
        sql = _SQL + (" AND session_date >= :since" if since else "")
        params = {"underlying": underlying}
        if since:
            params["since"] = since
        return ([_row_to_dict(r) for r in source.execute(text(sql), params)], None)
    except Exception as exc:  # SQLAlchemyError / DBAPI errors: surface, don't crash
        message = str(exc)
        lowered = message.lower()
        if "no such table" in lowered or "does not exist" in lowered or "undefinedtable" in lowered:
            error = "table_missing"
        else:
            error = message
        return ([], error)


def open_session(db_url: Optional[str] = None) -> tuple[Any, Any]:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    url = db_url
    if not url:
        try:
            from db.database import SQLALCHEMY_DATABASE_URL as url  # type: ignore
        except Exception:
            import config as _cfg

            url = _cfg.DATABASE_URL
    engine = create_engine(url)
    return sessionmaker(bind=engine)(), engine



def build_report(rows: list[dict], underlying: str, days: int, horizon: int) -> dict:
    series = build_session_series(rows)
    rank = iv_rank_percentile(series)
    hv = realised_vol(series)
    ratio = (rank["latest"] / hv) if (hv and rank["latest"] is not None and hv > 0) else None
    return {
        "underlying": underlying,
        "days": days,
        "horizon": horizon,
        "sessions": len(series),
        "series": series,
        "rank": rank,
        "hv20": hv,
        "iv_hv_ratio": ratio,
        "cone": cone_coverage(series, horizon),
        "term": term_snapshot(rows, series[-1]["date"] if series else None),
    }


def _fmt(value: Any, digits: int = 2, suffix: str = "") -> str:
    return "n/a" if value is None else f"{float(value):.{digits}f}{suffix}"


def render_report(report: dict) -> None:
    print(f"\n=== {report['underlying']} IV calibration "
          f"(window {report['days']}d, horizon {report['horizon']}d) ===")
    series = report["series"]
    if not series:
        print("  no sessions with usable snapshots")
        return
    if report["sessions"] < MIN_SESSIONS:
        print(f"  insufficient history ({report['sessions']}/{MIN_SESSIONS})")

    print("  -- ATM IV series (IST session, front expiry) --")
    for s in series:
        print(f"     {s['date']}  expiry={s['front_expiry'] or 'n/a':<10} "
              f"dte={_fmt(s['dte'], 0):>4}  spot={_fmt(s['spot'])}  "
              f"ATM IV={_fmt(s['atm_iv'], 2, '%')}")
    print(f"  sessions: {report['sessions']}")

    rank = report["rank"]
    print("  -- IV rank / percentile --")
    print(f"     n={rank['n']}  min={_fmt(rank['min'], 2, '%')}  "
          f"max={_fmt(rank['max'], 2, '%')}  latest={_fmt(rank['latest'], 2, '%')}  "
          f"rank={_fmt(rank['rank_pct'], 1, '%')}  percentile={_fmt(rank['percentile'], 1)}")

    print("  -- Realised vs implied --")
    print(f"     HV20={_fmt(report['hv20'], 2, '%')}  "
          f"IV/HV={_fmt(report['iv_hv_ratio'], 3)}")

    cone = report["cone"]
    bins = " ".join(str(b) for b in cone["pit"])
    print("  -- Cone coverage / PIT --")
    print(f"     n={cone['n']}  inside 68%={_fmt(cone['coverage68'], 1, '%')}  "
          f"inside 95%={_fmt(cone['coverage95'], 1, '%')}  "
          f"mean z={_fmt(cone['mean_z'], 3)}")
    print(f"     PIT bins (10, ascending): [{bins}]")

    term = report["term"]
    print("  -- Term snapshot (latest session, ATM IV by DTE) --")
    if term:
        for t in term:
            print(f"     {t['expiry']}  dte={_fmt(t['dte'], 0):>4}  "
                  f"ATM IV={_fmt(t['atm_iv'], 2, '%')}")
    else:
        print("     (not enough expiries on the latest session)")



def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate IV/probability analytics from option_chain_snapshots (read-only).",
        epilog=("Example: .venv/bin/python scripts/market/options_calibration.py "
                "--underlying NIFTY --days 90 --horizon 1\n"
                "Exit 0 = report emitted (including empty / insufficient history)."),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--underlying", default="NIFTY", help="underlying symbol (default: NIFTY)")
    parser.add_argument("--days", type=int, default=90, help="lookback window in calendar days (default: 90)")
    parser.add_argument("--horizon", type=int, default=1, help="forward cone horizon in sessions (default: 1)")
    parser.add_argument("--db-url", default=None, help="override SQLAlchemy DATABASE_URL")
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.horizon < 1 or args.days < 1:
        print("ERROR: --days and --horizon must be >= 1", file=sys.stderr)
        return 1

    since = (datetime.now(IST).date() - timedelta(days=max(args.days, 0))).isoformat()
    session, engine = open_session(args.db_url)
    try:
        rows, error = load_snapshots(session, args.underlying.upper(), since=since)
    finally:
        session.close()
        engine.dispose()

    if error:
        label = "no option_chain_snapshots table yet (sibling migration pending)" \
            if error == "table_missing" else f"database read failed: {error}"
        print(f"WARNING: {label}; emitting empty report.")
    if not rows:
        print(f"No snapshots for {args.underlying.upper()} since {since}; emitting empty report.")

    report = build_report(rows, args.underlying.upper(), args.days, args.horizon)
    render_report(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
