"""Nifty OI-burst detection and mechanical option signal.

Server-side twin of ``src/pages/report/niftyOiBursts.ts`` — the tape's
``call_doi``/``put_doi`` are cumulative from the day's first recorded row, so a
burst is the FIRST DIFFERENCE between consecutive minutes, not the headline
number.

Having this on the backend means bursts survive with the stored tape: the
history is recomputable for any recorded day even when no browser was open.

Rules (kept identical to the TS implementation):
  - baseline = median of the previous ``window`` per-side |delta| values,
    floored at ``min_abs`` so a near-zero median on a quiet tape cannot
    inflate every later move;
  - score = |delta| / baseline;
  - severity: >= 8 critical, >= 5 alert, >= 3 watch;
  - requires ``warmup`` prior minutes and |delta| >= ``min_abs``.

This is a heuristic, not advice, and it never places orders.
"""

from __future__ import annotations

import statistics
from typing import Any, Iterable, Optional

# ------------------------------------------------------------------ constants

OI_BURST_WINDOW = 10
OI_BURST_MIN_ABS = 2_000
OI_BURST_WARMUP = 3
OI_BURST_TIERS = {"watch": 3.0, "alert": 5.0, "critical": 8.0}

OI_SIGNAL_RISK_BUDGET = 5_000.0
OI_SIGNAL_SL_PCT = 25.0
OI_SIGNAL_TP_PCT = 50.0
OI_SIGNAL_MIN_PREMIUM = 10.0
NIFTY_LOT_SIZE = 75

#: Headlines within ±this many minutes of a burst are attached as candidates.
NEWS_WINDOW_MIN = 10.0


def _f(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if out == out else default  # NaN guard


def severity_for_score(score: float) -> str:
    if score >= OI_BURST_TIERS["critical"]:
        return "critical"
    if score >= OI_BURST_TIERS["alert"]:
        return "alert"
    if score >= OI_BURST_TIERS["watch"]:
        return "watch"
    return "info"


def minute_doi_series(rows: Iterable[dict]) -> list[dict]:
    """Chronological per-minute OI deltas.

    Duplicate timestamps keep the LAST occurrence (the recorder feed is
    ascending, so that is the most recent write). The first row is the
    baseline, not a delta.
    """
    by_t: dict[str, dict] = {}
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        t = r.get("t")
        if isinstance(t, str) and t:
            by_t[t] = r
    ordered = [by_t[k] for k in sorted(by_t)]

    out: list[dict] = []
    for prev, cur in zip(ordered, ordered[1:]):
        out.append({
            "t": cur["t"],
            "dCall": _f(cur.get("call_doi")) - _f(prev.get("call_doi")),
            "dPut": _f(cur.get("put_doi")) - _f(prev.get("put_doi")),
            "callDoi": _f(cur.get("call_doi")),
            "putDoi": _f(cur.get("put_doi")),
            "spot": _f(cur.get("spot")),
            "callTick": _f(cur.get("call_tick")),
            "putTick": _f(cur.get("put_tick")),
        })
    return out


def detect_oi_bursts(
    rows: list[dict],
    window: int = OI_BURST_WINDOW,
    min_abs: float = OI_BURST_MIN_ABS,
    warmup: int = OI_BURST_WARMUP,
) -> list[dict[str, Any]]:
    """Bursts across the tape, one entry per (minute, side), chronological."""
    history: dict[str, list[float]] = {"call": [], "put": []}
    out: list[dict[str, Any]] = []

    for m in minute_doi_series(rows):
        sides = (
            ("call", m["dCall"], m["callDoi"], m["callTick"]),
            ("put", m["dPut"], m["putDoi"], m["putTick"]),
        )
        for side, delta, cum, tick in sides:
            magnitude = abs(delta)
            hist = history[side]
            if len(hist) >= warmup:
                baseline = max(float(min_abs), statistics.median(hist[-window:]))
                score = magnitude / baseline if baseline > 0 else 0.0
                if magnitude >= min_abs and score >= OI_BURST_TIERS["watch"]:
                    out.append({
                        "id": f"{m['t']}-{side}",
                        "side": side,
                        "t": m["t"],
                        "delta": delta,
                        "baseline": baseline,
                        "score": round(score, 6),
                        "severity": severity_for_score(score),
                        "cumDoi": cum,
                        "spot": m["spot"],
                        "tickVol": tick,
                    })
            hist.append(magnitude)

    return out


def _round2(v: float) -> float:
    return round(v, 2)


# -------------------------------------------------------------------- news


def _parse_ts(value: Any) -> Optional[float]:
    """Epoch seconds from an ISO string / datetime / epoch-ms number. None on fail."""
    from datetime import datetime, timezone

    if value is None:
        return None
    if isinstance(value, (int, float)):
        v = float(value)
        # Heuristic: ms vs s.
        return v / 1000.0 if v > 1e11 else v
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
        dt = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    return None


#: Words that make a headline plausibly market-moving for an index burst.
NEWS_KEYWORDS = (
    "sitharaman", "finance minister", "finance ministry", "ltcg", "stt",
    "sebi", "rbi", "gst", "budget", "nifty", "sensex", "fii", "dii",
    "repo", "inflation", "tariff", "crude", "fed", "earnings", "results",
)


def attach_news(
    bursts: list[dict[str, Any]],
    articles: list[dict[str, Any]],
    window_min: float = 10.0,
) -> list[dict[str, Any]]:
    """Attach headlines near each burst, in place, and return `bursts`.

    A headline qualifies when its publish time is within ±``window_min`` of the
    burst. Keyword-relevant headlines inside the window are kept first; if none
    match a keyword, the nearest headline in the window is still attached (an
    unexplained burst is more useful with a candidate catalyst than without).

    Pure: no DB, no network. `articles` items need `heading` plus one of
    `published_at` / `published_time` / `ts`.
    """
    if not bursts:
        return bursts
    if not articles:
        for b in bursts:
            b.setdefault("news", [])
        return bursts

    prepared: list[dict[str, Any]] = []
    for a in articles:
        ts = _parse_ts(a.get("published_at", a.get("published_time", a.get("ts"))))
        heading = a.get("heading") or a.get("headline") or a.get("title")
        if ts is None or not heading:
            continue
        prepared.append({
            "heading": str(heading),
            "link": a.get("article_link") or a.get("url") or a.get("link") or "",
            "source": a.get("source") or "",
            "ts": ts,
            "relevant": any(k in str(heading).lower() for k in NEWS_KEYWORDS),
        })

    window = window_min * 60.0
    for b in bursts:
        bts = _parse_ts(b.get("t"))
        if bts is None:
            b["news"] = []
            continue
        near = [a for a in prepared if abs(a["ts"] - bts) <= window]
        near.sort(key=lambda a: (not a["relevant"], abs(a["ts"] - bts)))
        b["news"] = [
            {
                "heading": a["heading"],
                "link": a["link"],
                "source": a["source"],
                "minutes_away": round((a["ts"] - bts) / 60.0, 1),
            }
            for a in near[:3]
        ]
    return bursts


def derive_oi_signal(
    burst: dict[str, Any],
    strikes: Optional[list[dict]],
    spot: float,
    risk_budget: float = OI_SIGNAL_RISK_BUDGET,
    sl_pct: float = OI_SIGNAL_SL_PCT,
    tp_pct: float = OI_SIGNAL_TP_PCT,
    min_premium: float = OI_SIGNAL_MIN_PREMIUM,
) -> Optional[dict[str, Any]]:
    """Mechanical option suggestion for a burst (heuristic, not advice).

    Direction follows the OI move, not just the side:
      call build  → ceiling  → buy PE     call unwind → covering → buy CE
      put  build  → floor    → buy CE     put  unwind → support  → buy PE
    """
    if not strikes or not spot:
        return None

    call = burst.get("side") == "call"
    building = _f(burst.get("delta")) > 0
    leg = "PE" if call == building else "CE"

    candidates = []
    for s in strikes:
        side = s.get("ce" if leg == "CE" else "pe") or {}
        ltp = _f(side.get("ltp"))
        strike = _f(s.get("strike"))
        if strike and ltp >= min_premium:
            candidates.append((abs(strike - spot), strike, ltp))
    if not candidates:
        return None

    candidates.sort(key=lambda c: c[0])
    _, strike, entry = candidates[0]
    entry = _round2(entry)
    sl = _round2(entry * (1 - sl_pct / 100.0))
    target = _round2(entry * (1 + tp_pct / 100.0))
    risk_per_unit = max(0.05, entry - sl)
    units = int(risk_budget // risk_per_unit)
    lots = units // NIFTY_LOT_SIZE
    qty = lots * NIFTY_LOT_SIZE

    if call:
        basis = ("call OI build — writers adding ceiling → fade with puts"
                 if building else
                 "call OI unwind — writers covering → upside fuel → buy calls")
    else:
        basis = ("put OI build — writers adding floor → fade with calls"
                 if building else
                 "put OI unwind — support removed → downside fuel → buy puts")

    return {"leg": leg, "strike": strike, "entry": entry, "sl": sl,
            "target": target, "qty": qty, "lots": lots, "basis": basis}
