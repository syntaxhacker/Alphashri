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
# NIFTY contract lot size. Corrected 75 -> 65 after 23 consecutive real exchange
# prints (a Dhan time & sales capture) were every one an exact multiple of 65 —
# GCD of all 23 sizes == 65, and the same user's 1-lot position showed qty 65.
# With 75 the suggested qty was not a tradeable size at all.
NIFTY_LOT_SIZE = 65

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


#: A burst is by definition a ONE-minute OI move, so only strictly adjacent
#: minutes qualify. Anything further apart is not a burst we can judge: on
#: 2026-10-14 a 12-minute recorder outage produced index "bursts" scoring 1037
#: and 1324, and even a 2-minute span scored 1141. Those are the gap, not the
#: market. We would rather report no burst than a fabricated one.
MAX_BURST_GAP_MIN = 1


def _ordered_rows(rows: Iterable[dict]) -> list[dict]:
    """Tape rows deduped by timestamp, chronological."""
    by_t: dict[str, dict] = {}
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        t = r.get("t")
        if isinstance(t, str) and t:
            by_t[t] = r
    return [by_t[k] for k in sorted(by_t)]


def _gap_minutes(a: dict, b: dict) -> Optional[int]:
    from datetime import datetime

    try:
        return int((datetime.fromisoformat(str(b.get("t"))) -
                    datetime.fromisoformat(str(a.get("t")))).total_seconds() // 60)
    except (ValueError, TypeError):
        return None


def _is_contiguous(a: dict, b: dict, max_gap: int = MAX_BURST_GAP_MIN) -> bool:
    """True when ``b`` is a real next-minute row after ``a``.

    Guards every detector that differences two rows: a recorder gap turns the
    whole missing span into one enormous "one-minute" delta, which then scores
    as a CRITICAL burst even though nothing happened in a minute.
    """
    gap = _gap_minutes(a, b)
    return gap is not None and 0 < gap <= max_gap


def minute_doi_series(rows: Iterable[dict]) -> list[dict]:
    """Chronological per-minute OI deltas.

    Duplicate timestamps keep the LAST occurrence (the recorder feed is
    ascending, so that is the most recent write). The first row is the
    baseline, not a delta.
    """
    ordered = _ordered_rows(rows)

    out: list[dict] = []
    for prev, cur in zip(ordered, ordered[1:]):
        out.append({
            "t": cur["t"],
            "gapMinutes": _gap_minutes(prev, cur),
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
        # A gap is not a burst: the delta spans minutes we never recorded.
        if (m.get("gapMinutes") or 1) > MAX_BURST_GAP_MIN:
            continue
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


#: EMA span (minutes) used to define the session trend for the alignment gate.
TREND_EMA_SPAN = 20


def session_trend(rows: list[dict], at_time: Any = None) -> Optional[str]:
    """``"up"``/``"down"`` from spot vs its EMA over the tape, or ``None``.

    A burst is only actionable *with* the trend: on 2026-10-13 every
    trend-aligned plan worked (10/12, avg +81.7 pts) while every counter-trend
    one failed (1/9, avg −94.4 pts). `at_time` picks the EMA up to that minute;
    without it the EMA at the last row is used.
    """
    spots: list[float] = []
    for r in rows or []:
        t = r.get("t")
        s = _f(r.get("spot"))
        if not s:
            continue
        spots.append(s)
        if at_time is not None and t == at_time:
            break
    if len(spots) < 2:
        return None

    alpha = 2.0 / (TREND_EMA_SPAN + 1.0)
    ema = spots[0]
    for s in spots[1:]:
        ema = alpha * s + (1 - alpha) * ema
    last = spots[-1]
    if last > ema:
        return "up"
    if last < ema:
        return "down"
    return None


# ------------------------------------------------------------- squeezes

#: |OI unwind| needed for a wall break to count as a squeeze (contracts).
SQUEEZE_MIN_UNWIND = 2_000_000.0
SQUEEZE_TIERS = {"watch": 2_000_000.0, "alert": 4_000_000.0, "critical": 8_000_000.0}


def severity_for_unwind(unwind: float) -> str:
    if unwind >= SQUEEZE_TIERS["critical"]:
        return "critical"
    if unwind >= SQUEEZE_TIERS["alert"]:
        return "alert"
    if unwind >= SQUEEZE_TIERS["watch"]:
        return "watch"
    return "info"


def _top_wall(row: dict, side: str) -> Optional[float]:
    """Highest-OI strike on `side` ("calls"/"puts") for one tape row."""
    walls = row.get("walls") or {}
    if not isinstance(walls, dict):
        return None
    best = None
    best_oi = -1.0
    for w in (walls.get(side) or []):
        if not isinstance(w, dict):
            continue
        oi = _f(w.get("oi"))
        strike = _f(w.get("strike"))
        if strike and oi > best_oi:
            best_oi, best = oi, strike
    return best


def detect_squeezes(
    rows: list[dict],
    min_unwind: float = SQUEEZE_MIN_UNWIND,
    window_min: int = 2,
) -> list[dict[str, Any]]:
    """Short-covering squeezes: spot breaks a wall while that side unwinds.

    This is the shape of 2026-10-13's money move — spot crossed the call wall
    at 14:21 while 16.5M call contracts were bought back at 14:20. A burst says
    "writers moved"; a squeeze says "writers are being run over", which is a
    momentum trade (buy the broken side), not a fade.

      call squeeze: spot crosses ABOVE the top call wall + call OI unwinds
      put  squeeze: spot crosses BELOW the top put wall  + put OI unwinds

    The unwind and the cross do NOT have to land on the same minute (they were
    a minute apart in the real case), so the strongest unwind within
    +/-``window_min`` of the cross is what qualifies — emitted AT the cross.
    """
    by_t: dict[str, dict] = {}
    for r in rows or []:
        t = r.get("t")
        if isinstance(t, str) and t:
            by_t[t] = r
    ordered = [by_t[k] for k in sorted(by_t)]

    def delta_at(i: int, key: str) -> float:
        """First difference of `key` at index i (i >= 1)."""
        return _f(ordered[i].get(key)) - _f(ordered[i - 1].get(key))

    out: list[dict[str, Any]] = []
    for i in range(1, len(ordered)):
        prev, cur = ordered[i - 1], ordered[i]
        if not _is_contiguous(prev, cur):
            continue
        spot_now = _f(cur.get("spot"))
        spot_prev = _f(prev.get("spot"))

        for side, walls_key, doi_key, tick_key in (
            ("call", "calls", "call_doi", "call_tick"),
            ("put", "puts", "put_doi", "put_tick"),
        ):
            wall = _top_wall(cur, walls_key)
            if wall is None:
                wall = _top_wall(prev, walls_key)
            if not wall:
                continue

            broke = (spot_prev <= wall < spot_now) if side == "call" else (spot_now < wall <= spot_prev)
            if not broke:
                continue

            # Strongest unwind for this side inside the +/- window.
            best = 0.0
            best_t = None
            lo = max(1, i - window_min)
            hi = min(len(ordered), i + window_min + 1)
            for j in range(lo, hi):
                d = delta_at(j, doi_key)
                if d < best:
                    best, best_t = d, ordered[j].get("t")

            unwind = abs(best)
            if unwind < min_unwind:
                continue

            out.append({
                "id": f"{cur['t']}-squeeze-{side}",
                "type": "squeeze",
                "side": side,
                "t": cur["t"],
                "delta": best,
                "unwind_t": best_t,
                "baseline": min_unwind,
                "score": round(unwind / min_unwind, 3),
                "severity": severity_for_unwind(unwind),
                "cumDoi": _f(cur.get(doi_key)),
                "spot": spot_now,
                "tickVol": _f(cur.get(tick_key)),
                "wall": wall,
            })
    return out


# -------------------------------------------------------- per-strike bursts

#: A single strike must move at least this much OI to be worth an alert —
#: higher than the index threshold because one strike is a much sharper event.
# Was 1_000_000 — an impossible bar. Measured over 1507 genuine 1-minute
# per-strike deltas on 2026-10-14: p50 21K, p90 98K, p99 265K, and the DAY'S
# MAXIMUM was 757K. A 1M floor could therefore never fire (0 detections, ever).
# 300K sits at ~p99.3 and yields ~11 strike-level alerts a day.
STRIKE_BURST_MIN_ABS = 300_000.0
#: Per-strike alerts are stricter than index ones (score >= alert tier).
STRIKE_BURST_MIN_SCORE = 4.0


def detect_strike_bursts(
    rows: list[dict],
    min_abs: float = STRIKE_BURST_MIN_ABS,
    window: int = 10,
    warmup: int = 3,
) -> list[dict[str, Any]]:
    """Single-strike OI explosions — names the exact strike and leg.

    Index totals dilute a strike: 16M contracts at one strike is invisible
    against a 300M total. Every series is (strike, leg), so the alert can say
    "22,750 CE +6.2M" instead of only "call OI burst". Needs the tape's
    ``strikes_top`` field, so it is a no-op on tapes recorded before it.
    """
    by_t: dict[str, dict] = {}
    for r in rows or []:
        t = r.get("t")
        if isinstance(t, str) and t:
            by_t[t] = r
    ordered = [by_t[k] for k in sorted(by_t)]

    def oi_map(row: dict) -> dict[tuple[float, str], float]:
        out: dict[tuple[float, str], float] = {}
        for s in (row.get("strikes_top") or []):
            if not isinstance(s, dict):
                continue
            strike = _f(s.get("strike"))
            if not strike:
                continue
            out[(strike, "ce")] = _f(s.get("ce_oi"))
            out[(strike, "pe")] = _f(s.get("pe_oi"))
        return out

    history: dict[tuple[float, str], list[float]] = {}
    out: list[dict[str, Any]] = []

    for i in range(1, len(ordered)):
        if not _is_contiguous(ordered[i - 1], ordered[i]):
            continue
        prev_oi = oi_map(ordered[i - 1])
        cur_row = ordered[i]
        cur_oi = oi_map(cur_row)
        if not prev_oi or not cur_oi:
            continue

        for key, cur in cur_oi.items():
            if key not in prev_oi:
                continue
            strike, leg = key
            d = cur - prev_oi[key]
            magnitude = abs(d)
            hist = history.setdefault(key, [])
            if len(hist) >= warmup:
                baseline = max(min_abs / 3.0, statistics.median(hist[-window:]))
                score = magnitude / baseline if baseline > 0 else 0.0
                if magnitude >= min_abs and score >= STRIKE_BURST_MIN_SCORE:
                    out.append({
                        "id": f"{cur_row['t']}-strike-{strike:.0f}-{leg}",
                        "type": "strike",
                        "side": "call" if leg == "ce" else "put",
                        "leg": leg.upper(),
                        "strike": strike,
                        "t": cur_row["t"],
                        "delta": d,
                        "baseline": baseline,
                        "score": round(score, 3),
                        "severity": severity_for_score(score),
                        "cumDoi": _f(cur_row.get(f"{'call' if leg == 'ce' else 'put'}_doi")),
                        "spot": _f(cur_row.get("spot")),
                        "tickVol": 0.0,
                    })
            hist.append(magnitude)
    return out


# ------------------------------------------------------- premium velocity

#: ATM premium % move over the window that counts as a tradeable impulse.
PREMIUM_MOVE_MIN_PCT = 15.0
PREMIUM_MOVE_WINDOW_MIN = 3


def detect_premium_moves(
    rows: list[dict],
    min_pct: float = PREMIUM_MOVE_MIN_PCT,
    window_min: int = PREMIUM_MOVE_WINDOW_MIN,
) -> list[dict[str, Any]]:
    """ATM premium velocity — OI says writers moved, premium says it's tradeable.

    Needs the tape's ``atm_ce_ltp``/``atm_pe_ltp`` (recorded from 2026-10-14 on).

    Correctness guard: when spot drifts, the ATM strike rolls, so consecutive
    ``atm_*_ltp`` values can refer to DIFFERENT strikes and produce a fake
    "premium spike". A move only counts when ``atm_strike`` is unchanged across
    the whole window.
    """
    by_t: dict[str, dict] = {}
    for r in rows or []:
        t = r.get("t")
        if isinstance(t, str) and t:
            by_t[t] = r
    ordered = [by_t[k] for k in sorted(by_t)]

    out: list[dict[str, Any]] = []
    step = max(1, int(window_min))
    for i in range(step, len(ordered)):
        cur = ordered[i]
        ref = ordered[i - step]

        # Same ATM strike required — otherwise this is a strike roll, not a move.
        if _f(cur.get("atm_strike")) != _f(ref.get("atm_strike")):
            continue

        for leg, key, side in (("CE", "atm_ce_ltp", "call"), ("PE", "atm_pe_ltp", "put")):
            a = _f(ref.get(key))
            b = _f(cur.get(key))
            if a <= 0 or b <= 0:
                continue
            pct = (b - a) / a * 100.0
            if abs(pct) < min_pct:
                continue
            out.append({
                "id": f"{cur['t']}-premium-{leg}",
                "type": "premium",
                "side": side,
                "leg": leg,
                "strike": _f(cur.get("atm_strike")),
                "t": cur["t"],
                "delta": round(b - a, 2),
                "baseline": a,
                "score": round(abs(pct), 3),
                "severity": ("critical" if abs(pct) >= min_pct * 2.5
                             else "alert" if abs(pct) >= min_pct * 1.6
                             else "watch"),
                "pct": round(pct, 2),
                "cumDoi": _f(cur.get(f"{side}_doi")),
                "spot": _f(cur.get("spot")),
                "tickVol": _f(cur.get(f"{side}_tick")),
            })
    return out


# ----------------------------------------------------------- coiling (pre-move)

#: Spot range over the window, as % of spot, that counts as "tight".
COIL_MAX_RANGE_PCT = 0.08
#: Minimum range that still counts — a flat 0.000% range is a stale chain
#: (the tape repeats the last spot after feeds stop), not a coiled spring.
COIL_MIN_RANGE_PCT = 0.005
#: How close (as % of spot) spot must sit to a wall to count as pressing it.
COIL_WALL_PROXIMITY_PCT = 0.12


def detect_coiling(
    rows: list[dict],
    window_min: int = 10,
    max_range_pct: float = COIL_MAX_RANGE_PCT,
    wall_proximity_pct: float = COIL_WALL_PROXIMITY_PCT,
) -> list[dict[str, Any]]:
    """Pre-move heads-up: a tight range pressed against a wall.

    Every other trigger here is confirmation (it fires after the move). This is
    the only anticipatory one: an unusually tight window while spot sits on a
    wall is a coiled spring. Severity stays low (watch) because it is a
    heads-up, not a signal.

    Fires on **onset only** — a coil that persists for 10 minutes is one event,
    not ten — and ignores a dead-flat 0.000% range, which is a stale chain.
    """
    by_t: dict[str, dict] = {}
    for r in rows or []:
        t = r.get("t")
        if isinstance(t, str) and t:
            by_t[t] = r
    ordered = [by_t[k] for k in sorted(by_t)]
    if len(ordered) < window_min + 1:
        return []

    def qualifies(i: int) -> list[tuple[str, float, float, float]]:
        """(side, wall, range_pct, dist_pct) for every wall this minute presses."""
        window = ordered[i - window_min:i + 1]
        spots = [s for s in (_f(r.get("spot")) for r in window) if s > 0]
        if len(spots) < window_min:
            return []
        spot = spots[-1]
        if spot <= 0:
            return []
        hi, lo = max(spots), min(spots)
        range_pct = (hi - lo) / spot * 100.0
        if range_pct > max_range_pct or range_pct < COIL_MIN_RANGE_PCT:
            return []
        hits = []
        for side, walls_key in (("call", "calls"), ("put", "puts")):
            wall = _top_wall(ordered[i], walls_key)
            if not wall:
                continue
            dist_pct = abs(wall - spot) / spot * 100.0
            if dist_pct <= wall_proximity_pct:
                hits.append((side, wall, range_pct, dist_pct))
        return hits

    out: list[dict[str, Any]] = []
    for i in range(window_min, len(ordered)):
        current = qualifies(i)
        if not current:
            continue
        previous = qualifies(i - 1) if i - 1 >= window_min else []
        prev_sides = {p[0] for p in previous}
        for side, wall, range_pct, dist_pct in current:
            if side in prev_sides:
                continue  # onset only — this coil was already reported
            out.append({
                "id": f"{ordered[i]['t']}-coil-{side}",
                "type": "coil",
                "side": side,
                "t": ordered[i]["t"],
                "delta": 0.0,
                "baseline": 0.0,
                "score": round(range_pct, 4),
                "severity": "watch",
                "wall": wall,
                "range_pct": round(range_pct, 4),
                "dist_pct": round(dist_pct, 4),
                "cumDoi": _f(ordered[i].get(f"{side}_doi")),
                "spot": _f(ordered[i].get("spot")),
                "tickVol": 0.0,
            })
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
    trend: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """Mechanical option suggestion for a burst (heuristic, not advice).

    Direction follows the OI move, not just the side:
      call build  → ceiling  → buy PE     call unwind → covering → buy CE
      put  build  → floor    → buy CE     put  unwind → support  → buy PE

    `trend` ("up"/"down") gates the plan: a leg that disagrees with the session
    trend gets NO plan (returns None) — counter-trend plans were the entire loss
    side on 2026-10-13 (1/9) and again on 2026-10-15 (resolved 0.32 vs 0.80 aligned).
    """
    if not strikes or not spot:
        return None

    call = burst.get("side") == "call"
    building = _f(burst.get("delta")) > 0
    is_squeeze = burst.get("type") == "squeeze"
    # A burst is a FADE (writers moved). A squeeze is MOMENTUM: the broken side
    # is being run over, so buy the break.
    if burst.get("type") == "coil":
        # A coil is a heads-up, not a trade — no plan.
        return None
    if is_squeeze or burst.get("type") == "premium":
        # Both are momentum: buy the side that moved.
        leg = str(burst.get("leg") or ("CE" if call else "PE")).upper()
        leg = "CE" if leg == "CE" else "PE"
    else:
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

    # A per-strike burst names its own strike — use it instead of nearest-to-spot.
    want_strike = _f(burst.get("strike"))
    exact = [c for c in candidates if want_strike and c[1] == want_strike]
    if exact:
        _, strike, entry = exact[0]
    else:
        candidates.sort(key=lambda c: c[0])
        _, strike, entry = candidates[0]
    entry = _round2(entry)
    sl = _round2(entry * (1 - sl_pct / 100.0))
    target = _round2(entry * (1 + tp_pct / 100.0))
    risk_per_unit = max(0.05, entry - sl)
    units = int(risk_budget // risk_per_unit)
    lots = units // NIFTY_LOT_SIZE
    qty = lots * NIFTY_LOT_SIZE

    if burst.get("type") == "premium":
        basis = (f"ATM premium impulse {burst.get('pct', 0):+.2f}% "
                 f"({leg} {burst.get('strike', 0):,.0f})")
    elif is_squeeze:
        wall = burst.get("wall")
        wall_txt = f"{wall:,.0f}" if isinstance(wall, (int, float)) else "?"
        basis = (f"short-covering squeeze — {burst.get('side')} wall {wall_txt} "
                 f"broken while that side unwound {abs(_f(burst.get('delta'))):,.0f}")
    elif call:
        basis = ("call OI build — writers adding ceiling → fade with puts"
                 if building else
                 "call OI unwind — writers covering → upside fuel → buy calls")
    else:
        basis = ("put OI build — writers adding floor → fade with calls"
                 if building else
                 "put OI unwind — support removed → downside fuel → buy puts")

    # Trend gate: a counter-trend plan is the wrong side of the tape — emit
    # nothing instead of a plan that says "skip". A squeeze is with the break
    # by construction, so it is always aligned.
    aligned: Optional[bool] = None
    if is_squeeze or burst.get("type") == "premium":
        aligned = True
    elif trend in ("up", "down"):
        aligned = (leg == "CE" and trend == "up") or (leg == "PE" and trend == "down")
        if not aligned:
            return None

    return {"leg": leg, "strike": strike, "entry": entry, "sl": sl,
            "target": target, "qty": qty, "lots": lots, "basis": basis,
            "trend": trend, "aligned": aligned}
