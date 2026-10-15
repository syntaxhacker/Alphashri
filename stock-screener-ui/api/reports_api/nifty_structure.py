"""Structural shifts in the Nifty option tape.

The report page already shows *levels* (walls, max pain, PCR) and *per-minute*
numbers. What it never said, and what actually explains a move like
2026-10-14's 159-point drop, is that the **structure changed**:

  * the 22,700 put wall was destroyed (12.27M -> 7.91M) while calls stacked
    above it (10.30M -> 12.24M) — i.e. 22,700 flipped from support to
    resistance, and the spot sitting on it had nowhere to go but down
  * max pain walked 22,700 -> 22,600, so the option market's gravity moved
  * put volume ran 5.7x normal while it happened

This module turns those into explicit, timestamped events instead of leaving
them to be eyeballed across four table columns.

Pure functions over tape rows — no network, no I/O, never raises.
"""

from __future__ import annotations

import statistics
from typing import Any, Optional

#: A minute is a volume spike at this multiple of the trailing median.
VOLUME_SPIKE_MULT = 3.0
#: A wall or max-pain level must move at least this far to be "a shift".
LEVEL_MOVE_PTS = 50.0
#: PCR moves at least this much => a positioning regime change.
PCR_MOVE = 0.15
#: Trailing window (rows) for the volume median.
VOLUME_WINDOW = 20
#: FLOW comparisons (volume) break across a recorder gap: a 12-minute outage
#: read as one minute produced bogus CRITICAL bursts on 2026-10-14.
MAX_GAP_FLOW_MIN = 3
#: STOCK comparisons (walls, max pain, PCR, levels) survive a gap — OI and price
#: levels are states, not rates. The 22,700 support->resistance flip happened
#: entirely across the outage and must not be dropped with it.
MAX_GAP_STOCK_MIN = 30


def _f(value: Any, default: Optional[float] = None) -> Optional[float]:
    try:
        if value is None:
            return default
        out = float(value)
        return out if out == out else default  # NaN guard
    except (TypeError, ValueError):
        return default


def _minute_key(row: dict) -> str:
    t = str((row or {}).get("t") or "")
    return t[:16]


def _minute_gap(a: str, b: str) -> Optional[int]:
    """Signed minutes from timestamp ``a`` to ``b`` (both ``...HH:MM[:SS]``)."""
    from datetime import datetime

    try:
        return int((datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds() // 60)
    except (ValueError, TypeError):
        return None


def _minutes_between(a: dict, b: dict) -> Optional[int]:
    from datetime import datetime

    try:
        return int((datetime.fromisoformat(str(b.get("t"))) -
                    datetime.fromisoformat(str(a.get("t")))).total_seconds() // 60)
    except (ValueError, TypeError):
        return None


def _top_wall(row: dict, side: str) -> tuple[Optional[float], float]:
    """``(strike, oi)`` of the biggest wall on ``side`` for this row."""
    walls = (row or {}).get("walls") or {}
    entries = walls.get(side) or []
    best: tuple[Optional[float], float] = (None, 0.0)
    for entry in entries:
        strike = _f((entry or {}).get("strike"))
        oi = _f((entry or {}).get("oi"), 0.0) or 0.0
        if strike is not None and oi > best[1]:
            best = (strike, oi)
    return best


def _strike_oi(row: dict, strike: float, leg: str) -> Optional[float]:
    """Per-strike OI for a leg from ``strikes_top`` (ATM +/-3)."""
    for entry in (row or {}).get("strikes_top") or []:
        if _f((entry or {}).get("strike")) == strike:
            return _f((entry or {}).get(f"{leg}_oi"))
    return None


def _severity(magnitude: float, watch: float, alert: float) -> str:
    if magnitude >= alert:
        return "critical"
    if magnitude >= watch:
        return "alert"
    return "watch"


def detect_structure_shifts(
    rows: list[dict],
    *,
    volume_spike_mult: float = VOLUME_SPIKE_MULT,
    level_move_pts: float = LEVEL_MOVE_PTS,
    pcr_move: float = PCR_MOVE,
    volume_window: int = VOLUME_WINDOW,
    max_gap_flow_min: int = MAX_GAP_FLOW_MIN,
    max_gap_stock_min: int = MAX_GAP_STOCK_MIN,
) -> list[dict]:
    """Chronological structural events derived from the day's tape.

    Detects: wall flips (support -> resistance), wall migration, max-pain
    drift, PCR regime change, volume spikes, and the spot losing a wall.

    Gap handling is deliberately split: stock comparisons (walls, max pain, PCR,
    levels) are allowed across a recorder outage because they describe a state,
    while flow comparisons (volume) are not, because a gap turns 12 minutes of
    traded volume into a fake 12x spike.
    """
    clean = [r for r in (rows or []) if isinstance(r, dict) and _minute_key(r)]
    try:
        from api.reports_api.nifty import drop_implausible_spots
        clean = drop_implausible_spots(clean)
    except Exception:
        pass
    if len(clean) < 2:
        return []

    events: list[dict] = []
    # A level can legitimately flip more than once a day, so suppression is
    # time-windowed per (kind, level) rather than once-per-day: the 22,700
    # support->resistance flip was being swallowed because a flip at that same
    # level had already fired earlier in the session.
    last_emit: dict[tuple, str] = {}
    dedupe_minutes = 45
    ce_vol_hist: list[float] = []
    pe_vol_hist: list[float] = []
    prev: Optional[dict] = None
    prev_ce_vol: Optional[float] = None
    prev_pe_vol: Optional[float] = None
    # Last PCR accepted as real, so one bad snapshot never becomes the base for
    # the next comparison. Seeded from the FIRST row: initialising it inside the
    # loop let a corrupt second row define the baseline.
    baseline_pcr: Optional[float] = _f(clean[0].get("pcr_oi")) if clean else None

    def emit(t: str, kind: str, detail: str, *, side: Optional[str] = None,
             level: Optional[float] = None, magnitude: float = 0.0,
             sev: str = "watch", dedupe: Optional[tuple] = None,
             extra: Optional[dict] = None) -> None:
        key = dedupe or (kind, level)
        prev_t = last_emit.get(key)
        if prev_t is not None and _minute_gap(prev_t, t) is not None \
                and abs(_minute_gap(prev_t, t) or 0) < dedupe_minutes:
            return
        last_emit[key] = t
        event = {"t": t, "kind": kind, "detail": detail, "severity": sev,
                 "magnitude": round(magnitude, 2)}
        if side:
            event["side"] = side
        if level is not None:
            event["level"] = level
        if extra:
            event.update(extra)
        events.append(event)

    for idx, row in enumerate(clean):
        ce_vol = _f(row.get("ce_vol"))
        pe_vol = _f(row.get("pe_vol"))
        # Next row within a flow-comparable gap, used to reject bad snapshots.
        nxt = clean[idx + 1] if idx + 1 < len(clean) else None
        if nxt is not None:
            n_gap = _minutes_between(row, nxt)
            if n_gap is None or not (0 < n_gap <= max_gap_flow_min):
                nxt = None

        def reverted(key: str, before: Optional[float], now: Optional[float]) -> bool:
            """True when ``nxt`` snaps the metric back towards ``before``.

            Catches a single corrupt snapshot: on 2026-10-14 the post-outage row
            carried PCR 1.75 between 1.13 and 0.94, which is a bad read, not a
            positioning regime change.
            """
            if nxt is None or now is None or before is None:
                return False
            after = _f(nxt.get(key))
            if after is None:
                return False
            return abs(after - before) < abs(now - before) * 0.5

        if prev is not None:
            gap = _minutes_between(prev, row)
            comparable = gap is not None and 0 < gap <= max_gap_stock_min
            flow_ok = comparable and gap <= max_gap_flow_min

            if comparable:
                minute = _minute_key(row)

                # ---- volume spikes (per side, vs trailing median) ----
                for side, now_vol, before, hist in (
                    ("call", ce_vol, prev_ce_vol, ce_vol_hist),
                    ("put", pe_vol, prev_pe_vol, pe_vol_hist),
                ):
                    if not flow_ok or now_vol is None or before is None or len(hist) < 5:
                        continue
                    delta = now_vol - before
                    baseline = statistics.median(hist[-volume_window:])
                    if baseline > 0 and delta >= volume_spike_mult * baseline:
                        mult = delta / baseline
                        emit(minute, "volume_spike",
                             f"{side.upper()} volume {mult:.1f}x normal "
                             f"({delta / 1e6:.1f}M vs {baseline / 1e6:.1f}M)",
                             side=side, magnitude=mult,
                             sev=_severity(mult, volume_spike_mult, 6.0),
                             dedupe=("volume_spike", side, minute[:13]))

                # ---- max-pain drift ----
                mp_prev = _f(prev.get("max_pain"))
                mp_now = _f(row.get("max_pain"))
                if (mp_prev and mp_now and abs(mp_now - mp_prev) >= level_move_pts
                        and not reverted("max_pain", mp_prev, mp_now)):
                    down = mp_now < mp_prev
                    emit(minute, "max_pain_drift",
                         f"max pain {'down' if down else 'up'} "
                         f"{mp_prev:,.0f} -> {mp_now:,.0f}",
                         level=mp_now, magnitude=abs(mp_now - mp_prev),
                         sev="alert" if abs(mp_now - mp_prev) >= 100 else "watch",
                         dedupe=("max_pain_drift", int(mp_now)))

                # ---- walls: migration + flip ----
                prev_cw, prev_cw_oi = _top_wall(prev, "calls")
                prev_pw, prev_pw_oi = _top_wall(prev, "puts")
                cw, cw_oi = _top_wall(row, "calls")
                pw, pw_oi = _top_wall(row, "puts")
                spot = _f(row.get("spot"))
                prev_spot = _f(prev.get("spot"))

                # A strike that was the put wall is now the call wall: the
                # support it provided has become resistance.
                if prev_pw and cw and prev_pw == cw:
                    emit(minute, "wall_flip",
                         f"{prev_pw:,.0f} support became resistance "
                         f"(put wall {prev_pw_oi / 1e6:.1f}M -> call wall {cw_oi / 1e6:.1f}M)",
                         side="call", level=prev_pw, magnitude=prev_pw_oi / 1e6,
                         sev="critical",
                         dedupe=("wall_flip", prev_pw))
                if prev_cw and pw and prev_cw == pw:
                    emit(minute, "wall_flip",
                         f"{prev_cw:,.0f} resistance became support",
                         side="put", level=prev_cw, magnitude=pw_oi / 1e6,
                         sev="critical",
                         dedupe=("wall_flip", prev_cw, "up"))

                if prev_cw and cw and prev_cw != cw and abs(cw - prev_cw) >= level_move_pts:
                    emit(minute, "wall_move",
                         f"call wall {prev_cw:,.0f} -> {cw:,.0f}",
                         side="call", level=cw, magnitude=abs(cw - prev_cw),
                         sev="watch", dedupe=("wall_move", "call", cw))
                if prev_pw and pw and prev_pw != pw and abs(pw - prev_pw) >= level_move_pts:
                    emit(minute, "wall_move",
                         f"put wall {prev_pw:,.0f} -> {pw:,.0f} "
                         f"(new floor {pw_oi / 1e6:.1f}M)",
                         side="put", level=pw, magnitude=abs(pw - prev_pw),
                         sev="watch", dedupe=("wall_move", "put", pw))

                # ---- spot losing / reclaiming the put wall ----
                if prev_pw and spot and prev_spot:
                    if prev_spot >= prev_pw > spot:
                        loss = prev_pw - spot
                        emit(minute, "level_break",
                             f"spot lost {prev_pw:,.0f} put-wall support "
                             f"(now {spot:,.1f})",
                             side="call", level=prev_pw, magnitude=loss,
                             sev=_severity(loss, 25.0, 75.0),
                             dedupe=("level_break", "down", prev_pw))
                    elif prev_spot < prev_pw <= spot:
                        gain = spot - prev_pw
                        emit(minute, "level_break",
                             f"spot reclaimed {prev_pw:,.0f} (now {spot:,.1f})",
                             side="put", level=prev_pw, magnitude=gain,
                             sev=_severity(gain, 25.0, 75.0),
                             dedupe=("level_break", "up", prev_pw))

                # ---- PCR regime change ----
                p_now = _f(row.get("pcr_oi"))
                if p_now:
                    if baseline_pcr is not None and abs(p_now - baseline_pcr) >= pcr_move:
                        if reverted("pcr_oi", baseline_pcr, p_now):
                            pass  # corrupt snapshot: hold the previous baseline
                        else:
                            emit(minute, "pcr_shift",
                                 f"PCR(OI) {baseline_pcr:.2f} -> {p_now:.2f} "
                                 f"({'call' if p_now < baseline_pcr else 'put'} writers gaining)",
                                 magnitude=abs(p_now - baseline_pcr),
                                 sev=_severity(abs(p_now - baseline_pcr), pcr_move, 0.30),
                                 dedupe=("pcr_shift", round(p_now, 1)))
                            baseline_pcr = p_now
                    else:
                        baseline_pcr = p_now

        if ce_vol is not None:
            ce_vol_hist.append(ce_vol)
        if pe_vol is not None:
            pe_vol_hist.append(pe_vol)
        prev_ce_vol, prev_pe_vol = ce_vol, pe_vol
        prev = row

    events.sort(key=lambda e: (e["t"], e["kind"]))
    return events
