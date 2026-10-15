#!/usr/bin/env python3
"""Forward-return evaluator + feature-ablation harness (roadmap F12 / W1d).

Turns the append-only signal archive (``signal_log.py``) into falsifiable
evidence: for each logged signal it fetches forward candles, computes realized
R multiples / MAE / MFE / hit-rate, and ablates every numeric feature into
quantile buckets so we can see *which* features carry the edge (e.g. P1 with vs
without the ``spread_bp < 20`` filter).

Candle contract (Fyers ``/data/history``): each row is a list::

    [epoch_seconds, open, high, low, close, volume(, oi)]

Positions of interest: ``row[0]`` epoch, ``row[2]`` high, ``row[3]`` low,
``row[4]`` close. Extra trailing fields (OI) are ignored.

Conventions:

* ``forward_return`` / ``eod_return`` / MAE / MFE are all **long-oriented price
  percentages** (``(px - entry_ref) / entry_ref * 100``). Sign handling for a
  CE/PE or LONG/SHORT leg is the caller's job via :func:`signed_return` (and is
  applied inside :func:`score_signal` for the realized metric).
* ``forward_return`` treats ``candles[0]`` as the entry candle; callers must
  pass the window *from the signal's entry* onward (``score_signal`` does this
  by trimming on the signal ``ts``).
* MAE is negative (worst adverse move), MFE is positive (best favourable move).
* Stop/target touches walk candles **chronologically**; if a single candle
  straddles both levels, the stop is assumed to trigger first (conservative).

No network here. ``evaluate_from_disk`` takes an injectable ``history_fn`` and
only lazily imports ``fyers_data.get_history`` when none is supplied.
"""
from __future__ import annotations

import math
import statistics
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

_REPO_ROOT = str(Path(__file__).resolve().parent.parent.parent)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from india_board.scripts import signal_log  # noqa: E402

IST = ZoneInfo("Asia/Kolkata")

#: Forward-return horizons (minutes) scored by default.
DEFAULT_MINUTES = (15, 30, 60)
#: Minimum signals before a feature ablation / bucket is reported (else None).
DEFAULT_MIN_SAMPLE = 20
#: Quantile groups per feature ablation.
DEFAULT_N_GROUPS = 4

#: Index tickers -> Fyers symbols. Stocks fall back to ``NSE:{T}-EQ``.
INDEX_MAP = {
    "NIFTY": "NSE:NIFTY50-INDEX",
    "BANKNIFTY": "NSE:NIFTYBANK-INDEX",
    "FINNIFTY": "NSE:FINNIFTY-INDEX",
    "MIDCPNIFTY": "NSE:MIDCPNIFTY-INDEX",
    "NIFTYNXT50": "NSE:NIFTYNXT50-INDEX",
    "SENSEX": "BSE:SENSEX-INDEX",
    "BANKEX": "BSE:BANKEX-INDEX",
}

_LONG_SIDES = {"LONG", "CE", "CALL", "BULL", "BULLISH"}
_SHORT_SIDES = {"SHORT", "PE", "PUT", "BEAR", "BEARISH"}

__all__ = [
    "DEFAULT_MINUTES",
    "DEFAULT_MIN_SAMPLE",
    "DEFAULT_N_GROUPS",
    "INDEX_MAP",
    "signed_return",
    "side_sign",
    "forward_return",
    "eod_return",
    "max_adverse_excursion",
    "max_favourable_excursion",
    "score_signal",
    "evaluate",
    "evaluate_from_disk",
    "render_report",
]


# ---------------------------------------------------------------------------
# numeric / candle helpers
# ---------------------------------------------------------------------------


def _f(value, default=None):
    """Finite float or ``default`` (guards None/NaN/Inf/bad types)."""
    try:
        if value is None:
            return default
        x = float(value)
        if math.isnan(x) or math.isinf(x):
            return default
        return x
    except (TypeError, ValueError):
        return default


def _is_candles(candles) -> bool:
    return isinstance(candles, (list, tuple)) and len(candles) > 0


def _row_epoch(row) -> float | None:
    if not isinstance(row, (list, tuple)) or len(row) < 5:
        return None
    return _f(row[0])


def _row_close(row) -> float | None:
    if not isinstance(row, (list, tuple)) or len(row) < 5:
        return None
    return _f(row[4])


def _entry_epoch(signal: dict) -> float | None:
    raw = signal.get("ts")
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw))
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=IST)
    else:
        dt = dt.astimezone(IST)
    return dt.timestamp()


def _window(candles, entry_epoch: float | None) -> list:
    """Candles at/after ``entry_epoch`` (all candles when unknown)."""
    if not _is_candles(candles):
        return []
    if entry_epoch is None:
        return list(candles)
    out = []
    for row in candles:
        ts = _row_epoch(row)
        if ts is not None and ts >= entry_epoch:
            out.append(row)
    return out


def side_sign(side: str | None) -> int:
    """``-1`` for SHORT/PE/call-less legs, else ``+1`` (LONG/CE/NA)."""
    s = str(side or "").upper()
    return -1 if s in _SHORT_SIDES else 1


def signed_return(side: str | None, pct: float | None) -> float | None:
    """Sign-adjust a long-oriented percentage for a CE/LONG (+) or PE/SHORT (-)."""
    p = _f(pct)
    if p is None:
        return None
    return p * side_sign(side)


# ---------------------------------------------------------------------------
# forward metrics
# ---------------------------------------------------------------------------


def forward_return(entry_ref, candles, minutes) -> float | None:
    """Percent move from ``entry_ref`` to the first candle >= entry + ``minutes``.

    ``candles[0]`` is taken as the entry candle. Returns ``None`` when the
    entry ref is missing/zero, candles are empty, or the window is too short.
    """
    entry = _f(entry_ref)
    horizon = _f(minutes)
    if entry in (None, 0.0) or horizon is None or horizon < 0 or not _is_candles(candles):
        return None
    base = _row_epoch(candles[0])
    if base is None:
        return None
    target = base + horizon * 60.0
    for row in candles:
        ts = _row_epoch(row)
        if ts is None:
            continue
        if ts >= target:
            close = _row_close(row)
            if close is None:
                return None
            return (close - entry) / entry * 100.0
    return None


def eod_return(entry_ref, candles) -> float | None:
    """Percent move from ``entry_ref`` to the last candle's close."""
    entry = _f(entry_ref)
    if entry in (None, 0.0) or not _is_candles(candles):
        return None
    close = _row_close(candles[-1])
    if close is None:
        return None
    return (close - entry) / entry * 100.0


def max_favourable_excursion(entry_ref, candles) -> float | None:
    """Best favourable move in % (``(max high - entry) / entry * 100``)."""
    entry = _f(entry_ref)
    if entry in (None, 0.0) or not _is_candles(candles):
        return None
    highs = [_f(row[2]) for row in candles if _row_epoch(row) is not None]
    highs = [h for h in highs if h is not None]
    if not highs:
        return None
    return (max(highs) - entry) / entry * 100.0


def max_adverse_excursion(entry_ref, candles) -> float | None:
    """Worst adverse move in % (``(min low - entry) / entry * 100``, negative)."""
    entry = _f(entry_ref)
    if entry in (None, 0.0) or not _is_candles(candles):
        return None
    lows = [_f(row[3]) for row in candles if _row_epoch(row) is not None]
    lows = [l for l in lows if l is not None]
    if not lows:
        return None
    return (min(lows) - entry) / entry * 100.0


# ---------------------------------------------------------------------------
# scoring
# ---------------------------------------------------------------------------


def _infer_sign(signal: dict, entry: float | None) -> int:
    """Direction for touch/R maths; infers from the stop when side is ``NA``."""
    s = str(signal.get("side") or "").upper()
    if s in _SHORT_SIDES:
        return -1
    if s in _LONG_SIDES:
        return 1
    stop = _f(signal.get("stop_ref"))
    target = _f(signal.get("target_ref"))
    if stop is not None and entry not in (None, 0.0):
        return -1 if stop > entry else 1
    if target is not None and entry not in (None, 0.0):
        return 1 if target > entry else -1
    return 1


def score_signal(signal: dict, candles, *, minutes=DEFAULT_MINUTES) -> dict:
    """Score one signal against its (full-day) candle series.

    Returns a flat dict with forward returns at each ``minutes`` horizon
    (``fwd_<m>``), ``fwd_eod``, ``mae`` / ``mfe``, the first-touched outcome
    (``target`` / ``stop`` / ``timeout``), ``exit_ref``, the realized
    ``r_multiple`` and the sign-adjusted ``realized_pct``.
    """
    entry = _f(signal.get("entry_ref"))
    stop = _f(signal.get("stop_ref"))
    target = _f(signal.get("target_ref"))
    sign = _infer_sign(signal, entry)

    window = _window(candles, _entry_epoch(signal))

    result: dict = {
        "signal_id": signal.get("signal_id"),
        "playbook": signal.get("playbook"),
        "ticker": str(signal.get("ticker") or "").upper(),
        "side": signal.get("side"),
        "features": signal.get("features") if isinstance(signal.get("features"), dict) else {},
        "entry_ref": entry,
        "stop_ref": stop,
        "target_ref": target,
        "entry_ts": signal.get("ts"),
        "n_candles": len(window),
        "exit_ref": None,
        "outcome": None,
        "r_multiple": None,
        "realized_pct": None,
    }
    for m in minutes:
        result[f"fwd_{int(m)}"] = forward_return(entry, window, m)
    result["fwd_eod"] = eod_return(entry, window)
    result["mae"] = max_adverse_excursion(entry, window)
    result["mfe"] = max_favourable_excursion(entry, window)

    if not window or entry in (None, 0.0):
        return result

    outcome = "timeout"
    exit_ref = None
    for row in window:
        high = _f(row[2])
        low = _f(row[3])
        stop_hit = target_hit = False
        if sign > 0:
            stop_hit = stop is not None and low is not None and low <= stop
            target_hit = target is not None and high is not None and high >= target
        else:
            stop_hit = stop is not None and high is not None and high >= stop
            target_hit = target is not None and low is not None and low <= target
        if stop_hit:  # conservative: stop wins when both straddle a candle
            outcome, exit_ref = "stop", stop
            break
        if target_hit:
            outcome, exit_ref = "target", target
            break

    if exit_ref is None:
        exit_ref = _row_close(window[-1])

    result["outcome"] = outcome
    result["exit_ref"] = exit_ref
    if exit_ref is not None and entry not in (None, 0.0) and stop is not None:
        risk = abs(entry - stop)
        if risk > 0:
            result["r_multiple"] = sign * (exit_ref - entry) / risk
    if exit_ref is not None and entry not in (None, 0.0):
        result["realized_pct"] = sign * (exit_ref - entry) / entry * 100.0
    return result


# ---------------------------------------------------------------------------
# aggregation + feature ablation
# ---------------------------------------------------------------------------


def _median(values):
    return statistics.median(values) if values else None


def _mean(values):
    return statistics.fmean(values) if values else None


def _aggregate(scores: list[dict]) -> dict:
    """Aggregate one bucket of scored signals into the contract metrics."""
    rs = [s["r_multiple"] for s in scores if s.get("r_multiple") is not None]
    maes = [s["mae"] for s in scores if s.get("mae") is not None]
    mfes = [s["mfe"] for s in scores if s.get("mfe") is not None]
    rps = [s["realized_pct"] for s in scores if s.get("realized_pct") is not None]
    n = len(scores)
    return {
        "n": n,
        "n_scored": len(rs),
        "hit_rate": (sum(1 for r in rs if r > 0) / len(rs)) if rs else None,
        "avg_R": _mean(rs),
        # Expectancy = mean sign-adjusted realized % per signal (distinct from
        # avg_R which is in R units). Same convention as the ablation buckets.
        "expectancy": _mean(rps),
        "median_R": _median(rs),
        "mae_p50": _median(maes),
        "mfe_p50": _median(mfes),
        "target_rate": (sum(1 for s in scores if s.get("outcome") == "target") / n) if n else None,
        "stop_rate": (sum(1 for s in scores if s.get("outcome") == "stop") / n) if n else None,
    }


def _numeric_feature(value):
    """Finite float for a feature value, else ``None`` (bools excluded)."""
    if isinstance(value, bool):
        return None
    return _f(value)


def _feature_ablation(
    scores: list[dict],
    min_sample: int = DEFAULT_MIN_SAMPLE,
    n_groups: int = DEFAULT_N_GROUPS,
) -> dict:
    """Split signals into equal-count quantile groups per numeric feature.

    For every numeric feature key present in ``features`` the scored signals
    are sorted by that value and cut into ``n_groups`` roughly-equal buckets;
    each bucket reports its range, ``n`` and expectancy. A feature with fewer
    than ``min_sample`` valued signals is reported as ``None``; a bucket with
    fewer than ``min_sample`` signals reports ``None`` metrics (but its ``n``).
    """
    keys: set[str] = set()
    for s in scores:
        feats = s.get("features")
        if isinstance(feats, dict):
            for key, value in feats.items():
                if _numeric_feature(value) is not None:
                    keys.add(str(key))

    out: dict = {}
    groups = max(1, int(n_groups))
    for key in sorted(keys):
        pairs: list[tuple[float, dict]] = []
        for s in scores:
            feats = s.get("features") if isinstance(s.get("features"), dict) else {}
            value = _numeric_feature(feats.get(key))
            if value is not None:
                pairs.append((value, s))
        if len(pairs) < min_sample:
            out[key] = None
            continue
        pairs.sort(key=lambda t: t[0])
        n = len(pairs)
        buckets = []
        for i in range(groups):
            chunk = pairs[i * n // groups: (i + 1) * n // groups]
            if not chunk:
                continue
            agg = _aggregate([p[1] for p in chunk])
            enough = len(chunk) >= min_sample
            buckets.append({
                "n": len(chunk),
                "lo": chunk[0][0],
                "hi": chunk[-1][0],
                "expectancy": agg["expectancy"] if enough else None,
                "avg_R": agg["avg_R"] if enough else None,
                "hit_rate": agg["hit_rate"] if enough else None,
            })
        out[key] = {
            "feature": key,
            "n": n,
            "n_groups": groups,
            "min_sample": min_sample,
            "buckets": buckets,
        }
    return out


def _summarize(
    scores: list[dict],
    minutes,
    min_sample: int,
    n_groups: int,
) -> dict:
    by_playbook: dict[str, list[dict]] = {}
    for s in scores:
        by_playbook.setdefault(str(s.get("playbook") or "NA"), []).append(s)

    return {
        "n": len(scores),
        "minutes": [int(m) for m in minutes],
        "playbooks": {pb: _aggregate(ss) for pb, ss in sorted(by_playbook.items())},
        "overall": _aggregate(scores),
        "ablation": _feature_ablation(scores, min_sample=min_sample, n_groups=n_groups),
    }


def evaluate(
    signals: list[dict],
    candles_by_ticker: dict,
    *,
    minutes=DEFAULT_MINUTES,
    min_sample: int = DEFAULT_MIN_SAMPLE,
    n_groups: int = DEFAULT_N_GROUPS,
) -> dict:
    """Score ``signals`` against candles keyed by ticker and aggregate.

    Output::

        {
          "n": <scored signals>,
          "minutes": [15, 30, 60],
          "playbooks": {"P1": {n, hit_rate, avg_R, expectancy, median_R,
                                mae_p50, mfe_p50, ...}, ...},
          "overall": {<same shape>},
          "ablation": {"spread_bp": {n, buckets: [...]} | None, ...},
        }
    """
    candles_by_ticker = candles_by_ticker or {}
    scores = []
    for signal in signals or []:
        ticker = str(signal.get("ticker") or "").upper()
        candles = candles_by_ticker.get(ticker)
        scores.append(score_signal(signal, candles or [], minutes=minutes))
    return _summarize(scores, minutes, min_sample, n_groups)


# ---------------------------------------------------------------------------
# disk-driven evaluation
# ---------------------------------------------------------------------------


def _norm_dates(dates) -> list[str]:
    if dates is None:
        return []
    if isinstance(dates, (str, bytes)) or not hasattr(dates, "__iter__"):
        dates = [dates]
    out = []
    for d in dates:
        if isinstance(d, datetime):
            d = d.date()
        if not isinstance(d, str):
            d = d.isoformat() if hasattr(d, "isoformat") else str(d)
        out.append(str(d)[:10])
    return out


def _signal_day(signal: dict) -> str | None:
    raw = signal.get("ts")
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw))
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=IST)
    else:
        dt = dt.astimezone(IST)
    return dt.date().isoformat()


def symbol_for(ticker: str) -> str:
    """Fyers symbol for a ticker (indices via ``INDEX_MAP``, stocks ``-EQ``)."""
    t = str(ticker or "").upper().strip()
    return INDEX_MAP.get(t, f"NSE:{t}-EQ")


def evaluate_from_disk(
    dates,
    *,
    resolution: str = "5",
    root=None,
    history_fn=None,
    minutes=DEFAULT_MINUTES,
    min_sample: int = DEFAULT_MIN_SAMPLE,
    n_groups: int = DEFAULT_N_GROUPS,
) -> dict:
    """Read logged signals for ``dates``, fetch candles, then :func:`evaluate`.

    ``history_fn(symbol, resolution, range_from, range_to)`` is injectable; the
    default lazily imports ``fyers_data.get_history``. Candles are cached per
    ``(ticker, date)`` so repeated signals fetch once. A failing/empty ticker is
    skipped and counted under ``"skipped"`` — never raised.
    """
    day_list = _norm_dates(dates)
    signals: list[dict] = []
    for day in day_list:
        signals.extend(signal_log.read_signals(day, root=root))

    if history_fn is None:
        try:  # lazy: avoid import cost / network at module import time
            from india_board.scripts import fyers_data

            history_fn = getattr(fyers_data, "get_history", None)
        except Exception as exc:  # noqa: BLE001
            history_fn = None
            print(f"[eval] fyers_data unavailable: {type(exc).__name__}", flush=True)

    if history_fn is None:
        # No history source (e.g. W1a not landed yet): report every signal as
        # skipped instead of raising or silently scoring nothing.
        result = _summarize([], minutes, min_sample, n_groups)
        result.update(skipped=len(signals), dates=day_list, resolution=str(resolution))
        return result

    cache: dict[tuple[str, str], list] = {}
    scores: list[dict] = []
    skipped = 0
    for signal in signals:
        ticker = str(signal.get("ticker") or "").upper()
        day = _signal_day(signal) or (day_list[0] if day_list else "")
        key = (ticker, day)
        if key not in cache:
            try:
                rows = history_fn(symbol_for(ticker), resolution, day, day)
                cache[key] = list(rows) if rows else []
            except Exception as exc:  # noqa: BLE001
                cache[key] = []
                print(
                    f"[eval] history failed for {ticker} {day}: {type(exc).__name__}"[:160],
                    flush=True,
                )
        candles = cache[key]
        if not candles:
            skipped += 1
            continue
        scores.append(score_signal(signal, candles, minutes=minutes))

    result = _summarize(scores, minutes, min_sample, n_groups)
    result["skipped"] = skipped
    result["dates"] = day_list
    result["resolution"] = str(resolution)
    return result


# ---------------------------------------------------------------------------
# reporting
# ---------------------------------------------------------------------------


def _fmt(value) -> str:
    if value is None:
        return "-"
    if isinstance(value, float):
        return f"{value:.3f}"
    return str(value)


def render_report(result: dict) -> str:
    """Markdown table summary of :func:`evaluate` / :func:`evaluate_from_disk`."""
    lines: list[str] = ["# Signal evaluation", ""]
    header = f"signals scored: {result.get('n')} | horizons (min): {result.get('minutes')}"
    if result.get("skipped") is not None:
        header += f" | skipped: {result.get('skipped')}"
    if result.get("dates"):
        header += f" | dates: {','.join(result['dates'])}"
    lines.append(header)
    lines.append("")

    lines.append("## Per playbook")
    lines.append("")
    lines.append("| playbook | n | hit_rate | avg_R | expectancy | median_R | mae_p50 | mfe_p50 |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for playbook, agg in (result.get("playbooks") or {}).items():
        lines.append(
            "| {pb} | {n} | {hr} | {ar} | {ex} | {mr} | {mae} | {mfe} |".format(
                pb=playbook,
                n=agg.get("n"),
                hr=_fmt(agg.get("hit_rate")),
                ar=_fmt(agg.get("avg_R")),
                ex=_fmt(agg.get("expectancy")),
                mr=_fmt(agg.get("median_R")),
                mae=_fmt(agg.get("mae_p50")),
                mfe=_fmt(agg.get("mfe_p50")),
            )
        )
    if result.get("overall") is not None:
        agg = result["overall"]
        lines.append(
            "| ALL | {n} | {hr} | {ar} | {ex} | {mr} | {mae} | {mfe} |".format(
                n=agg.get("n"),
                hr=_fmt(agg.get("hit_rate")),
                ar=_fmt(agg.get("avg_R")),
                ex=_fmt(agg.get("expectancy")),
                mr=_fmt(agg.get("median_R")),
                mae=_fmt(agg.get("mae_p50")),
                mfe=_fmt(agg.get("mfe_p50")),
            )
        )
    lines.append("")

    lines.append("## Feature ablation (quantile buckets, low -> high)")
    lines.append("")
    ablations = result.get("ablation") or {}
    if not ablations:
        lines.append("_no numeric features_")
    for feature, abl in ablations.items():
        if abl is None:
            lines.append(f"- **{feature}**: insufficient sample (None)")
            continue
        lines.append(f"**{feature}** (n={abl.get('n')}, groups={abl.get('n_groups')})")
        lines.append("")
        lines.append("| bucket | n | lo | hi | expectancy | avg_R | hit_rate |")
        lines.append("|---|---|---|---|---|---|---|")
        for idx, bucket in enumerate(abl.get("buckets") or []):
            lines.append(
                "| {i} | {n} | {lo} | {hi} | {ex} | {ar} | {hr} |".format(
                    i=idx,
                    n=bucket.get("n"),
                    lo=_fmt(bucket.get("lo")),
                    hi=_fmt(bucket.get("hi")),
                    ex=_fmt(bucket.get("expectancy")),
                    ar=_fmt(bucket.get("avg_R")),
                    hr=_fmt(bucket.get("hit_rate")),
                )
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


if __name__ == "__main__":  # pragma: no cover - manual CLI convenience
    import json

    days = sys.argv[1:] or [datetime.now(IST).date().isoformat()]
    print(render_report(evaluate_from_disk(days)))
