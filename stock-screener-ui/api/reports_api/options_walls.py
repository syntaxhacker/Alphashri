"""Wall erosion + 0-DTE pin state for any underlying.

Reads the same recorded tape the history endpoints use:

  experiments/data/options_tape/{SYM}/{date}.jsonl   (SENSEX / RELIANCE)
  experiments/data/nifty_tape/{date}.jsonl          (NIFTY)

and returns a backend-computed state the UI only renders:

  QUIET / WATCH / PIN_RISK / BREAK / FADE / WALL_WATCH

The state is deliberately conservative:

- **expiry-gated**: PIN_RISK/BREAK only on DTE 0 or 1. Non-expiry days are
  WALL_WATCH — the walls still erode, but the violent gamma/pin is a
  0-1 DTE phenomenon (verified on 2026-10-29: SENSEX 0-DTE vs NIFTY 5-DTE
  vs RELIANCE 25-DTE).
- **wall-erosion discriminated**: 14:04 touched 74,000 but the 74,000 call
  wall had only eroded -7.6% (below 10%) and the touch faded; 14:25:48 broke
  with -13.9%. Pin distance alone is NOT the trigger (14:04 was closer to
  max pain than 14:25).
- **freshness-aware**: a tape gap or frozen spot cannot manufacture a break.
- **latch/cooldown**: the break repeats every minute after 14:25; the UI gets
  one alert per wall until the state fades.

No writes, no network, no background task.
"""

from __future__ import annotations

from datetime import datetime, timedelta
import statistics
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

import config
from api.reports_api.options_history import (
    DATA_ROOT,
    TAPE_DIR,
    _read_jsonl,
    _safe_float,
    _symbol,
    _today,
    _validate_date,
)

router = APIRouter(prefix="/api/reports/options", tags=["options-walls"])

NIFTY_TAPE_DIR = "nifty_tape"
DEFAULT_WINDOW_MIN = 60
DEFAULT_TOP = 3
#: Spot must be within this fraction of max pain / the tracked wall.
NEAR_PCT = 0.0025
#: Call-wall OI erosion required for a break.
EROSION_MIN = 0.10
#: Put-OI build required at the tracked wall / max pain.
PUT_BUILD_MIN = 0.15
#: Max-pain drift required (one strike is usually 50-100 pts).
DRIFT_MIN = 0.0
#: A tape older than this is stale (no fresh break).
STALE_SEC = 180
#: A row gap larger than this is a gap, not a signal.
GAP_SEC = 120
#: The UI must not re-alert the same wall inside this window.
COOLDOWN_MIN = 15
#: Strike rows in the expanded wall map (keeps the payload and the chart legible).
MAP_MAX_STRIKES = 14


def _tape_path(symbol: str, date_str: str):
    if symbol == "NIFTY":
        return DATA_ROOT / NIFTY_TAPE_DIR / f"{date_str}.jsonl"
    return DATA_ROOT / TAPE_DIR / symbol / f"{date_str}.jsonl"


def _epoch(value: Any) -> float:
    try:
        return datetime.fromisoformat(str(value)).timestamp()
    except Exception:
        return 0.0


def _nearest(rows: list[dict], target: float) -> dict:
    return min(rows, key=lambda r: abs(_epoch(r.get("t")) - target))


def _chain(row: dict) -> dict:
    return row.get("chain") or {}


def _oi(chain: dict, strike: float, side: str) -> float:
    cell = (chain or {}).get(str(int(strike))) or [None] * 6
    return _safe_float(cell[2] if side == "call" else cell[3])


def _ltp(chain: dict, strike: float, side: str) -> Optional[float]:
    cell = (chain or {}).get(str(int(strike))) or [None] * 6
    value = cell[0] if side == "call" else cell[1]
    return _safe_float(value) if value is not None else None


def _top(chain: dict, side: str, n: int) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for key, cell in (chain or {}).items():
        try:
            strike = float(key)
        except (TypeError, ValueError):
            continue
        if len(cell) < 6:
            continue
        oi = _safe_float(cell[2] if side == "call" else cell[3])
        if oi > 0:
            out.append((oi, strike))
    out.sort(reverse=True)
    return out[:n]


def _wall(chain: dict, base_chain: dict, open_chain: dict, side: str,
          strike: Optional[float], spot: float) -> dict:
    """One wall's current OI, session-open OI, new OI and premium."""
    now_oi = _oi(chain, strike, side) if strike else 0.0
    open_oi = _oi(open_chain, strike, side) if strike else 0.0
    return {
        "strike": strike,
        "oi": now_oi,
        "oi_open": open_oi,
        "new_oi": round(now_oi - open_oi, 2) if strike else 0.0,
        "new_oi_pct": _pct_change(now_oi, open_oi),
        "ltp": _ltp(chain, strike, side) if strike else None,
        "distance_pts": round(strike - spot, 2) if strike else None,
        "distance_pct": round((strike - spot) / spot * 100, 3) if strike and spot else None,
    }


def _pct_change(now: float, prev: float) -> Optional[float]:
    if not prev:
        return None
    return round((now - prev) / prev, 4)


def _vol(chain: dict, strike: float, side: str) -> Optional[float]:
    """Side volume from the chain cell: index 4 = CE, 5 = PE."""
    cell = (chain or {}).get(str(int(strike))) or [None] * 6
    value = cell[4] if side == "call" else cell[5]
    return _safe_float(value) if value is not None else None


def _prior_row(rows: list[dict], index: int, minutes: int) -> Optional[dict]:
    """Latest row at least ``minutes`` before rows[index] (rows sorted by t)."""
    target = _epoch(rows[index].get("t")) - minutes * 60
    for j in range(index - 1, -1, -1):
        if _epoch(rows[j].get("t")) <= target:
            return rows[j]
    return None


def _vol_delta(rows: list[dict], index: int, side: str, strike: float,
               minutes: int) -> Optional[float]:
    """Volume delta over the last ``minutes``; volume is cumulative per day."""
    prior = _prior_row(rows, index, minutes)
    if prior is None:
        return None
    now_v = _vol(_chain(rows[index]), strike, side)
    then_v = _vol(_chain(prior), strike, side)
    if now_v is None or then_v is None:
        return None
    return max(0.0, now_v - then_v)


def _median(values: list[float]) -> Optional[float]:
    if not values:
        return None
    return statistics.median(values)


def _clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


def _scan_events(
    rows: list[dict], window_min: int, expiry_day: bool
) -> list[dict]:
    """First touch / break transitions across the recorded window.

    The final state is a snapshot; the expanded view needs the *sequence*
    (14:04 touch that faded, 14:25 break that held). Only transitions are
    emitted, so a break that repeats every minute is one event.
    """
    events: list[dict] = []
    prev_kind: Optional[str] = None
    for idx in range(1, len(rows)):
        row = rows[idx]
        t = _epoch(row.get("t"))
        if not t:
            continue
        base = _nearest(rows[: idx + 1], t - window_min * 60)
        chain = _chain(row)
        base_chain = _chain(base)
        top = _top(base_chain, "call", 1)
        if not top:
            continue
        strike = top[0][1]
        call_now = _oi(chain, strike, "call")
        call_30m = _oi(base_chain, strike, "call")
        put_now = _oi(chain, strike, "put")
        put_30m = _oi(base_chain, strike, "put")
        erosion = _pct_change(call_now, call_30m)
        put_build = _pct_change(put_now, put_30m)
        spot = _safe_float(row.get("spot"))
        max_pain = _safe_float(row.get("max_pain"))
        drift = round(max_pain - _safe_float(base.get("max_pain")), 2)
        near = bool(
            spot
            and (
                abs(spot - max_pain) <= NEAR_PCT * spot
                or abs(spot - strike) <= NEAR_PCT * spot
            )
        )
        cross = bool(
            spot > strike and _safe_float(base.get("spot")) <= strike
        )
        erosion_ok = erosion is not None and erosion <= -EROSION_MIN
        put_ok = put_build is not None and put_build >= PUT_BUILD_MIN
        brk = bool(
            expiry_day
            and near
            and cross
            and erosion_ok
            and put_ok
            and drift > DRIFT_MIN
        )
        kind = "BREAK" if brk else ("TOUCH" if near else None)
        if kind and kind != prev_kind:
            events.append({
                "at": row.get("t"),
                "kind": kind,
                "wall": strike,
                "spot": spot,
                "erosion_30m": erosion,
                "put_build_30m": put_build,
                "max_pain_drift": drift,
                "max_pain": max_pain,
            })
        prev_kind = kind
    return events[-20:]


def _nearest_strike(chain: dict, spot: float) -> Optional[float]:
    best: Optional[float] = None
    best_dist = float("inf")
    for key in (chain or {}):
        try:
            strike = float(key)
        except (TypeError, ValueError):
            continue
        distance = abs(strike - spot)
        if distance < best_dist:
            best, best_dist = strike, distance
    return best


def _material_nearest(
    chain: dict, spot: float, side: str, top_n: int
) -> Optional[float]:
    """Nearest material wall on the spot's side.

    Primary: among the top-N walls by OI, the closest strike above spot (call)
    / below spot (put). Fallback: the closest strike whose OI is at least 25%
    of the top wall's OI, on the spot's side. Returns None when none
    qualifies (keeps noisy far-OTM strikes out of the nearest-wall slot).
    """
    if not spot:
        return None
    top = _top(chain, side, top_n)
    if not top:
        return None
    top_oi = top[0][0]
    floor = 0.25 * top_oi
    # All strikes in the chain with material OI (>= 25% of the top wall).
    material = [
        s for oi, s in _top(chain, side, max(len(chain), 1)) if oi >= floor
    ]
    if side == "call":
        primary = [s for _, s in top if s > spot]
        if primary:
            return min(primary)
        candidates = [s for s in material if s > spot]
        return min(candidates) if candidates else None
    primary = [s for _, s in top if s < spot]
    if primary:
        return max(primary)
    candidates = [s for s in material if s < spot]
    return max(candidates) if candidates else None


def _build_wall_map(
    rows: list[dict],
    window_min: int,
    call_strike: Optional[float],
    put_strike: Optional[float],
    max_pain: float,
    atm: float,
    spot: float,
    top_n: int,
    open_chain: dict,
) -> Optional[dict]:
    """Strike x time OI-change grid for the expanded view.

    The expanded view is a history, not another snapshot table: each cell is
    the OI change for one strike at one minute, relative to the first minute in
    the window.  That makes an eroding call wall a red trail and a building put
    wall a green trail, with the spot/max-pain/flip paths over the top.

    Strikes are the union of the top walls at the start and end of the window,
    plus the tracked walls / max pain / ATM / nearest-to-spot.  The cap keeps
    the matrix readable; the tracked levels are never dropped.
    """
    if not rows:
        return None
    # A real time axis: one column per minute, not one column per tape row.
    # The 14:44->14:54 recording gap is therefore visible as a flat segment
    # instead of being silently compressed, and a 1-row tape still renders a
    # 60-minute context window.
    try:
        last_dt = datetime.fromisoformat(str(rows[-1].get("t")))
    except (TypeError, ValueError):
        return None
    end_minute = last_dt.replace(second=0, microsecond=0)
    start_minute = end_minute - timedelta(minutes=window_min - 1)
    minutes = [start_minute + timedelta(minutes=index) for index in range(window_min)]
    sample_rows: list[dict] = []
    pointer = 0
    for minute in minutes:
        minute_end = (minute + timedelta(seconds=59.999)).timestamp()
        while (
            pointer + 1 < len(rows)
            and _epoch(rows[pointer + 1].get("t")) <= minute_end
        ):
            pointer += 1
        sample_rows.append(rows[pointer])
    times = [minute.isoformat() for minute in minutes]
    first_chain = _chain(sample_rows[0])
    last_chain = _chain(sample_rows[-1])

    required = {
        strike for strike in (call_strike, put_strike, max_pain, atm) if strike
    }
    nearest = _nearest_strike(last_chain, spot)
    if nearest:
        required.add(nearest)

    selected = set(required)
    for chain in (first_chain, last_chain):
        for side in ("call", "put"):
            selected.update(strike for _, strike in _top(chain, side, max(4, top_n)))

    if len(selected) > MAP_MAX_STRIKES:
        optional = selected - required

        def strength(strike: float) -> float:
            return max(
                _oi(last_chain, strike, "call"),
                _oi(last_chain, strike, "put"),
            )

        keep = sorted(optional, key=strength, reverse=True)[
            : max(0, MAP_MAX_STRIKES - len(required))
        ]
        selected = required | set(keep)

    strikes = sorted(selected, reverse=True)
    base_chain = _chain(sample_rows[0])
    call_delta: list[list[Optional[float]]] = []
    put_delta: list[list[Optional[float]]] = []
    call_delta_open: list[list[Optional[float]]] = []
    put_delta_open: list[list[Optional[float]]] = []
    call_oi_grid: list[list[float]] = []
    put_oi_grid: list[list[float]] = []
    call_now: list[float] = []
    put_now: list[float] = []
    call_open: list[float] = []
    put_open: list[float] = []

    for strike in strikes:
        base_call = _oi(base_chain, strike, "call")
        base_put = _oi(base_chain, strike, "put")
        open_call = _oi(open_chain, strike, "call")
        open_put = _oi(open_chain, strike, "put")
        call_row: list[Optional[float]] = []
        put_row: list[Optional[float]] = []
        call_open_row: list[Optional[float]] = []
        put_open_row: list[Optional[float]] = []
        call_oi_row: list[float] = []
        put_oi_row: list[float] = []
        for row in sample_rows:
            chain = _chain(row)
            call_oi = _oi(chain, strike, "call")
            put_oi = _oi(chain, strike, "put")
            call_row.append(_pct_change(call_oi, base_call) if base_call else None)
            put_row.append(_pct_change(put_oi, base_put) if base_put else None)
            call_open_row.append(_pct_change(call_oi, open_call) if open_call else None)
            put_open_row.append(_pct_change(put_oi, open_put) if open_put else None)
            call_oi_row.append(call_oi)
            put_oi_row.append(put_oi)
        call_delta.append(call_row)
        put_delta.append(put_row)
        call_delta_open.append(call_open_row)
        put_delta_open.append(put_open_row)
        call_oi_grid.append(call_oi_row)
        put_oi_grid.append(put_oi_row)
        call_now.append(_oi(last_chain, strike, "call"))
        put_now.append(_oi(last_chain, strike, "put"))
        call_open.append(open_call)
        put_open.append(open_put)

    max_pain_values = [_safe_float(row.get("max_pain")) for row in sample_rows]
    top_call: list[Optional[float]] = []
    top_put: list[Optional[float]] = []
    for row in sample_rows:
        chain = _chain(row)
        calls = _top(chain, "call", 1)
        puts = _top(chain, "put", 1)
        top_call.append(calls[0][1] if calls else None)
        top_put.append(puts[0][1] if puts else None)
    gaps = sorted(abs(strikes[index] - strikes[index + 1]) for index in range(len(strikes) - 1))
    half_step = (gaps[len(gaps) // 2] if gaps else 0.0) / 2

    return {
        "strikes": strikes,
        "times": times,
        "call_delta": call_delta,
        "put_delta": put_delta,
        "call_delta_open": call_delta_open,
        "put_delta_open": put_delta_open,
        "call_oi": call_oi_grid,
        "put_oi": put_oi_grid,
        "call_now": call_now,
        "put_now": put_now,
        "call_open": call_open,
        "put_open": put_open,
        "top_call": top_call,
        "top_put": top_put,
        "spot": [_safe_float(row.get("spot")) for row in sample_rows],
        "max_pain": max_pain_values,
        "flip": [row.get("flip") for row in sample_rows],
        # The pin zone is max pain ± half a strike gap.  Backend-owned so the
        # map never has to guess the instrument's strike spacing.
        "pin_band": {
            "low": [value - half_step for value in max_pain_values],
            "high": [value + half_step for value in max_pain_values],
        },
    }


def compute_wall_state(
    rows: list[dict],
    *,
    symbol: str,
    date_str: str,
    expiry: Optional[str] = None,
    now: Optional[datetime] = None,
    window_min: int = DEFAULT_WINDOW_MIN,
    top_n: int = DEFAULT_TOP,
    include_map: bool = True,
) -> dict:
    """Pure: compute the wall/pin state from raw tape rows."""
    rows = sorted((r for r in rows if r and r.get("t")), key=lambda r: str(r["t"]))
    if not rows:
        raise HTTPException(status_code=404, detail={
            "is_trading_day": False,
            "date": date_str,
            "message": f"no {symbol} tape for {date_str}",
        })

    last = rows[-1]
    last_t = str(last.get("t"))
    last_epoch = _epoch(last_t)
    spot = _safe_float(last.get("spot"))
    max_pain = _safe_float(last.get("max_pain"))
    atm = _safe_float(last.get("atm_strike"))
    net_gex = last.get("net_gex")
    flip = last.get("flip")
    gex_degraded = bool(last.get("gex_degraded"))
    # Spot below the flip is the short-gamma side (trend/vol expansion); above
    # it is long gamma (mean reversion / pin).  Null flip means unknown.
    regime: Optional[str] = None
    if spot and flip is not None:
        regime = "SHORT" if spot < flip else "LONG"
    chain = _chain(last)

    # Nearest wall strikes: material walls first (top-N by OI on the spot's
    # side), falling back to strikes with OI >= 25% of the top wall. Always
    # shown in calls/puts (even outside top-N by OI) and exposed at payload
    # level as nearest_call / nearest_put.
    nearest_call_strike = _material_nearest(chain, spot, "call", top_n)
    nearest_put_strike = _material_nearest(chain, spot, "put", top_n)

    exp = str(expiry or last.get("expiry") or "")
    dte: Optional[int] = None
    if exp:
        try:
            dte = (datetime.strptime(exp, "%Y-%m-%d").date()
                   - datetime.strptime(date_str, "%Y-%m-%d").date()).days
        except ValueError:
            dte = None
    expiry_day = dte is not None and 0 <= dte <= 1

    base = _nearest(rows, last_epoch - window_min * 60)
    base5 = _nearest(rows, last_epoch - 5 * 60)
    base15 = _nearest(rows, last_epoch - 15 * 60)
    base30 = _nearest(rows, last_epoch - 30 * 60)
    base60 = _nearest(rows, last_epoch - 60 * 60)
    base_chain = _chain(base)
    base5_chain = _chain(base5)
    base15_chain = _chain(base15)
    base30_chain = _chain(base30)
    base60_chain = _chain(base60)
    last_index = len(rows) - 1
    spot_5 = _safe_float(base5.get("spot")) if base5 else None
    spot_drift = (spot - spot_5) if (spot and spot_5 is not None) else None
    # Session-open OI: the "old" book before today's new participants.
    open_chain = _chain(rows[0])

    # The wall being defended is the top wall at the start of the window
    # (74,000 at 13:55), not the current top (which can migrate to 74,200).
    tracked_call = _top(base_chain, "call", 1)
    tracked_put = _top(base_chain, "put", 1)
    call_strike = tracked_call[0][1] if tracked_call else None
    put_strike = tracked_put[0][1] if tracked_put else None
    if call_strike is None:
        current_call = _top(chain, "call", 1)
        call_strike = current_call[0][1] if current_call else None
    if put_strike is None:
        current_put = _top(chain, "put", 1)
        put_strike = current_put[0][1] if current_put else None

    call_oi = _oi(chain, call_strike, "call") if call_strike else 0.0
    call_oi_5m = _oi(base5_chain, call_strike, "call") if call_strike else 0.0
    call_oi_window = _oi(base_chain, call_strike, "call") if call_strike else 0.0
    put_oi = _oi(chain, call_strike, "put") if call_strike else 0.0
    put_oi_window = _oi(base_chain, call_strike, "put") if call_strike else 0.0

    call_erosion_5m = _pct_change(call_oi, call_oi_5m)
    call_erosion_window = _pct_change(call_oi, call_oi_window)
    put_build_window = _pct_change(put_oi, put_oi_window)
    mp_drift = round(max_pain - _safe_float(base.get("max_pain")), 2)
    pin_pts = round(spot - max_pain, 2) if spot else 0.0
    pin_pct = round(pin_pts / spot * 100, 3) if spot else 0.0
    base_spot = _safe_float(base.get("spot"))

    near = bool(
        spot and (
            abs(pin_pts) <= NEAR_PCT * spot
            or (call_strike and abs(spot - call_strike) <= NEAR_PCT * spot)
        )
    )
    cross = bool(call_strike and spot > call_strike and base_spot <= call_strike)
    erosion_ok = (
        call_erosion_window is not None and call_erosion_window <= -EROSION_MIN
    )
    put_ok = (
        put_build_window is not None and put_build_window >= PUT_BUILD_MIN
    )
    drift_ok = mp_drift > DRIFT_MIN
    brk = bool(expiry_day and near and cross and erosion_ok and put_ok and drift_ok)

    # --- freshness ---------------------------------------------------------
    try:
        now_dt = now or datetime.now(config.IST)
        age_sec = max(0.0, now_dt.timestamp() - last_epoch)
    except Exception:
        age_sec = 0.0
    gaps: list[dict] = []
    for prev, cur in zip(rows, rows[1:]):
        delta = _epoch(cur.get("t")) - _epoch(prev.get("t"))
        if delta > GAP_SEC:
            gaps.append({
                "from": prev.get("t"),
                "to": cur.get("t"),
                "seconds": round(delta, 1),
            })
    # Only the LAST interval matters for staleness: a historical 14:44-14:54
    # gap must not mark the fresh 15:29 tape as stale (the gap stays in
    # ``gaps`` for the UI, but the data since then is fresh).
    last_interval = (_epoch(rows[-1].get("t")) - _epoch(rows[-2].get("t"))
                     if len(rows) > 1 else 0.0)
    stale = age_sec > STALE_SEC or last_interval > GAP_SEC

    events = _scan_events(rows, window_min, expiry_day)

    # --- state -------------------------------------------------------------
    reasons: list[str] = []
    if dte is not None:
        reasons.append(f"{dte}-DTE")
    if call_strike:
        reasons.append(f"call wall {call_strike:,.0f}")
    if put_strike:
        reasons.append(f"put wall {put_strike:,.0f}")
    if call_erosion_window is not None:
        reasons.append(
            f"call wall {call_erosion_window * 100:+.1f}% / {window_min}m"
        )
    if put_build_window is not None:
        reasons.append(f"put build {put_build_window * 100:+.1f}%")
    if mp_drift:
        reasons.append(f"max pain {mp_drift:+.0f}")
    if flip is not None:
        reasons.append(f"GEX flip {flip:,.0f}")

    if stale:
        state = "QUIET"
    elif not expiry_day:
        state = "WALL_WATCH"
    elif brk:
        state = "BREAK"
    elif near and (erosion_ok or put_ok or drift_ok):
        state = "PIN_RISK"
    elif near:
        state = "WATCH"
    elif base_spot > (call_strike or 0) and spot < (call_strike or 0):
        state = "FADE"
    else:
        state = "QUIET"

    # The 14:04 fakeout is WATCH, not PIN_RISK: the wall was still defended.
    if state == "PIN_RISK" and not erosion_ok:
        state = "WATCH"

    alert = None
    alert_eligible = bool(brk and not stale)
    if brk:
        # Latch to the FIRST break of the current run so the UI gets one alert
        # per wall (the break repeats every minute; re-alerting on each tick
        # would spam and reset the dismiss state).
        last_break = next(
            (event for event in reversed(events) if event.get("kind") == "BREAK"),
            None,
        )
        source = last_break or {
            "wall": call_strike,
            "spot": spot,
            "erosion_30m": call_erosion_window,
            "put_build_30m": put_build_window,
            "max_pain_drift": mp_drift,
            "max_pain": max_pain,
            "at": last_t,
        }
        alert = {
            "symbol": symbol,
            "wall": source.get("wall"),
            "spot": source.get("spot"),
            "erosion_30m": source.get("erosion_30m"),
            "put_build_30m": source.get("put_build_30m"),
            "max_pain_drift": source.get("max_pain_drift"),
            "max_pain": source.get("max_pain"),
            "at": source.get("at"),
            "cooldown_min": COOLDOWN_MIN,
            "reasons": reasons,
        }

    # --- one-line story for the map header / READ panel -------------------
    read_parts: list[str] = []
    if call_strike:
        if call_erosion_window is not None:
            read_parts.append(
                f"call wall {call_strike:,.0f} {call_erosion_window * 100:+.1f}% / {window_min}m"
            )
        else:
            read_parts.append(f"call wall {call_strike:,.0f}")
    if put_strike:
        if put_build_window is not None:
            read_parts.append(f"put {put_strike:,.0f} {put_build_window * 100:+.1f}%")
        else:
            read_parts.append(f"put {put_strike:,.0f}")
    if max_pain:
        read_parts.append(f"max pain {max_pain:,.0f} ({mp_drift:+.0f})")
    if spot:
        read_parts.append(f"spot {spot:,.2f}")
    if flip is not None and regime:
        side = "below" if regime == "SHORT" else "above"
        read_parts.append(f"{side} flip {float(flip):,.0f} → {regime} Γ")
    if alert and alert.get("wall") is not None:
        read_parts.append(
            f"broke {float(alert['wall']):,.0f} at {str(alert.get('at'))[11:19]}"
        )
    read = " · ".join(read_parts)

    # --- all walls (current top N, plus the nearest wall) -----------------
    def _flow_label(oi_5m: Optional[float], prem_5m: Optional[float]) -> str:
        """5-min OI sign + premium sign -> flow classification."""
        oi_down = oi_5m is not None and oi_5m < 0
        oi_up = oi_5m is not None and oi_5m > 0
        prem_up = prem_5m is not None and prem_5m > 0.005
        prem_down = prem_5m is not None and prem_5m < -0.005
        if oi_down and prem_up:
            return "WRITERS_COVERING"
        if oi_down and prem_down:
            return "LONG_UNWIND"
        if oi_up and prem_up:
            return "LONG_BUILD"
        if oi_up and prem_down:
            return "WRITERS_ADDING"
        return "UNKNOWN"

    def _status_label(side: str, strike: float,
                      erosion_30m: Optional[float]) -> str:
        if side == "call":
            breached = strike is not None and bool(spot) and spot > strike
        else:
            breached = strike is not None and bool(spot) and spot < strike
        if breached:
            return "BREACHED"
        if erosion_30m is not None and erosion_30m <= -0.02:
            return "ERODING"
        if erosion_30m is not None and erosion_30m >= 0.02:
            return "BUILDING"
        return "STABLE"

    def _vol_mult(side: str, strike: float,
                  vol_5: Optional[float]) -> Optional[float]:
        """vol_5m vs the median 5-min volume delta over the last window_min rows."""
        if vol_5 is None:
            return None
        window = rows[-window_min:] if window_min < len(rows) else rows
        deltas: list[float] = []
        for offset in range(len(window)):
            index = len(rows) - len(window) + offset
            delta = _vol_delta(rows, index, side, strike, 5)
            if delta is not None:
                deltas.append(delta)
        med = _median(deltas)
        if not med:
            return None
        return vol_5 / med

    def _row_dict(side: str, strike: float) -> dict:
        now_oi = _oi(chain, strike, side)
        five = _oi(base5_chain, strike, side)
        fifteen = _oi(base15_chain, strike, side)
        thirty = _oi(base30_chain, strike, side)
        sixty = _oi(base60_chain, strike, side)
        open_oi = _oi(open_chain, strike, side)
        now_ltp = _ltp(chain, strike, side)
        ltp_5 = _ltp(base5_chain, strike, side)

        erosion_5m = _pct_change(now_oi, five)
        erosion_15m = _pct_change(now_oi, fifteen)
        erosion_30m = _pct_change(now_oi, thirty)
        erosion_60m = _pct_change(now_oi, sixty)
        erosion_rate_30m = (
            round(erosion_30m / 30.0, 6) if erosion_30m is not None else None
        )

        prem_chg_5m: Optional[float] = None
        if now_ltp is not None:
            prem_chg_5m = _pct_change(now_ltp, ltp_5)

        vol_5 = _vol_delta(rows, last_index, side, strike, 5)
        vol_30 = _vol_delta(rows, last_index, side, strike, 30)
        vol_mult = _vol_mult(side, strike, vol_5)

        flow = _flow_label(erosion_5m, prem_chg_5m)
        status = _status_label(side, strike, erosion_30m)

        distance_pts = round(strike - spot, 2) if spot else None
        distance_pct = (
            round((strike - spot) / spot * 100, 3) if spot else None
        )

        e = erosion_30m if erosion_30m is not None else 0.0
        erosion_part = round(_clamp(-e / 0.03, 0.0, 1.0) * 35)
        vm = vol_mult if vol_mult is not None else 1.0
        volume_part = round(_clamp((vm - 1.0) / 1.5, 0.0, 1.0) * 20)
        proximity_part = 0
        if spot and distance_pts is not None:
            proximity_part = round(
                _clamp(1.0 - abs(distance_pts) / (spot * 0.003), 0.0, 1.0) * 25
            )
        gamma_part = 10 if regime == "SHORT" else 0
        flow_part = 10 if flow in ("WRITERS_COVERING", "LONG_UNWIND") else 0
        fuel_parts = {
            "erosion": int(erosion_part),
            "volume": int(volume_part),
            "proximity": int(proximity_part),
            "gamma": int(gamma_part),
            "flow": int(flow_part),
        }
        fuel_score = min(100, max(0, int(round(sum(fuel_parts.values())))))

        ttb: Optional[float] = None
        if distance_pts is not None and spot_drift is not None:
            toward = (
                (side == "call" and strike > spot)
                or (side == "put" and strike < spot)
            )
            if toward:
                velocity = abs(spot_drift) / 5.0
                if velocity > 0:
                    ttb = abs(distance_pts) / velocity
        if ttb is not None:
            ttb = round(min(ttb, 120.0), 2)

        return {
            "strike": strike,
            "oi": now_oi,
            "oi_open": open_oi,
            "new_oi": round(now_oi - open_oi, 2),
            "new_oi_pct": _pct_change(now_oi, open_oi),
            "ltp": now_ltp,
            "erosion_5m": erosion_5m,
            "erosion_15m": erosion_15m,
            "erosion_30m": erosion_30m,
            "erosion_60m": erosion_60m,
            "erosion_rate_30m": erosion_rate_30m,
            "vol_5m": vol_5,
            "vol_30m": vol_30,
            "vol_mult": vol_mult,
            "prem_chg_5m": prem_chg_5m,
            "flow": flow,
            "status": status,
            "fuel_score": fuel_score,
            "fuel_parts": fuel_parts,
            "time_to_break_min": ttb,
            "oi_history": [_oi(_chain(r), strike, side) for r in rows[-30:]],
            "distance_pts": distance_pts,
            "distance_pct": distance_pct,
            "tracked": bool(call_strike == strike if side == "call"
                            else put_strike == strike),
            "nearest": bool(
                (side == "call" and strike == nearest_call_strike)
                or (side == "put" and strike == nearest_put_strike)
            ),
        }

    def _rows_for(side: str) -> list[dict]:
        out: list[dict] = []
        seen: set[float] = set()
        for _oi_now, strike in _top(chain, side, top_n):
            out.append(_row_dict(side, strike))
            seen.add(strike)
        # The nearest wall is always shown, even outside the top-N by OI.
        nearest_strike = (
            nearest_call_strike if side == "call" else nearest_put_strike
        )
        if nearest_strike is not None and nearest_strike not in seen:
            out.append(_row_dict(side, nearest_strike))
        return out

    calls = _rows_for("call")
    puts = _rows_for("put")

    nearest_call = next((row for row in calls if row.get("nearest")), None)
    nearest_put = next((row for row in puts if row.get("nearest")), None)

    # Tracked-wall erosion on the true 30m / 5m bases (the MiniHistory label
    # says 30m, so it must be 30m, not the state window).
    tracked_call_erosion_30m = (
        _pct_change(call_oi, _oi(base30_chain, call_strike, "call"))
        if call_strike else None
    )
    tracked_put_build_30m = (
        _pct_change(put_oi, _oi(base30_chain, call_strike, "put"))
        if call_strike else None
    )

    # --- history for the expanded matrix ----------------------------------
    history: list[dict] = []
    for row in rows[-window_min:]:
        row_chain = _chain(row)
        history.append({
            "t": row.get("t"),
            "spot": _safe_float(row.get("spot")),
            "max_pain": _safe_float(row.get("max_pain")),
            "call_oi": _oi(row_chain, call_strike, "call") if call_strike else None,
            "put_oi": _oi(row_chain, call_strike, "put") if call_strike else None,
            "net_gex": row.get("net_gex"),
            "flip": row.get("flip"),
        })

    wall_map = (
        _build_wall_map(
            rows,
            window_min,
            call_strike,
            put_strike,
            max_pain,
            atm,
            spot,
            top_n,
            open_chain,
        )
        if include_map
        else None
    )

    return {
        "symbol": symbol,
        "date": date_str,
        "expiry": exp or None,
        "dte": dte,
        "spot": spot,
        "max_pain": max_pain,
        "max_pain_drift": mp_drift,
        "atm": atm,
        "net_gex": net_gex,
        "flip": flip,
        "regime": regime,
        "read": read,
        "gex_degraded": gex_degraded,
        "pin_distance_pts": pin_pts,
        "pin_distance_pct": pin_pct,
        "state": state,
        "expiry_day": expiry_day,
        "alert_eligible": alert_eligible,
        "alert": alert,
        "reasons": reasons,
        "call_wall": _wall(chain, base_chain, open_chain, "call", call_strike, spot),
        "put_wall": _wall(chain, base_chain, open_chain, "put", put_strike, spot),
        "tracked_call_erosion_30m": tracked_call_erosion_30m,
        "tracked_call_erosion_5m": call_erosion_5m,
        "tracked_put_build_30m": tracked_put_build_30m,
        "near": near,
        "cross": cross,
        "calls": calls,
        "puts": puts,
        "nearest_call": nearest_call,
        "nearest_put": nearest_put,
        "events": events,
        "history": history,
        "wall_map": wall_map,
        "freshness": {
            "last_t": last_t,
            "age_sec": round(age_sec, 1),
            "stale": stale,
            "rows": len(rows),
            "gaps": gaps[-5:],
        },
        "window_min": window_min,
        "top": top_n,
    }


@router.get("/{underlying}/walls")
def get_options_walls(
    underlying: str,
    date: Optional[str] = Query(default=None, description="YYYY-MM-DD (default: today IST)"),
    expiry: Optional[str] = Query(default=None, description="expiry override"),
    at: Optional[str] = Query(default=None, description="replay cutoff: HH:MM or ISO timestamp"),
    window_min: int = Query(default=DEFAULT_WINDOW_MIN, ge=5, le=240),
    top: int = Query(default=DEFAULT_TOP, ge=1, le=10),
    map: bool = Query(default=False, description="include the strike x time wall map"),
) -> dict[str, Any]:
    """Backend-computed wall erosion / pin state for one underlying."""
    symbol = _symbol(underlying)
    date_str = _validate_date(date or _today())
    path = _tape_path(symbol, date_str)
    rows = _read_jsonl(path)
    if at:
        cutoff = str(at).strip()
        if "T" not in cutoff and ":" in cutoff:
            # HH:MM / HH:MM:SS cutoffs are inclusive of that whole minute /
            # second; comparing the full timestamp against "09:16" would
            # exclude 09:16:00.291937 and hide the first replay frame.
            width = 5 if len(cutoff) <= 5 else 8
            rows = [
                row for row in rows
                if str(row.get("t", ""))[11:19][:width] <= cutoff
            ]
        else:
            rows = [row for row in rows if str(row.get("t", "")) <= cutoff]
    if not rows:
        raise HTTPException(status_code=404, detail={
            "is_trading_day": False,
            "date": date_str,
            "at": at,
            "message": f"no {symbol} tape for {date_str}" + (f" up to {at}" if at else ""),
        })
    # Historical/EOD data must be evaluated as of its own last tick, not the
    # wall clock (otherwise every closed-market request looks stale and the
    # state collapses to QUIET). Live requests keep the real clock.
    now = datetime.now(config.IST)
    try:
        from trading.utils import is_derivatives_open

        last_dt = datetime.fromisoformat(str(rows[-1].get("t")))
        if last_dt.date() != now.date() or not is_derivatives_open():
            now = last_dt + timedelta(minutes=1)
    except Exception:
        pass
    return compute_wall_state(
        rows,
        symbol=symbol,
        date_str=date_str,
        expiry=expiry,
        now=now,
        window_min=window_min,
        top_n=top,
        include_map=map,
    )
