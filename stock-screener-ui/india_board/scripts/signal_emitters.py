#!/usr/bin/env python3
"""Intraday playbook signal emitters P1-P4 for the India board (roadmap W3a).

Pure, testable detectors that turn persisted 2-minute OI snapshots
(``india_board/data/oi_flow/{TICKER}/{YYYY-MM-DD}.jsonl``) into validated
records in the append-only signal archive (``signal_log.py``, roadmap F12).

Playbooks (see ``docs/EDGE_ROADMAP.md`` section 5):

* **P1** ``p1_burst``          OI-burst continuation — positional writing **and**
  price acceptance beyond a pre-existing wall.
* **P2** ``p2_absorption``     Absorption fade — a strike near spot takes a
  ``sigma_mult``-sigma OI build while spot barely moves.
* **P3** ``p3_wall_migration`` Wall migration — the max-OI strike per side moves,
  or the current wall takes a ``k_sigma``-sigma OI jump.
* **P4** ``p4_expiry_pin``     Expiry pin — last 90 minutes of the expiry
  session, spot within 0.3% of max pain, optional gamma-flip confirmation.

Design rules:

* **No detector ever raises.** Every public function is wrapped and degrades to
  ``None`` / ``[]``. A bad snapshot must never break a live scan or the loop.
* Detectors build records through :func:`signal_log.make_signal` — never
  hand-built dicts — and the caller logs them through :func:`signal_log.log_signal`.
* **Dedupe/cooldown**: an in-process ledger keyed by
  ``(playbook, ticker, side, strike, ts floored to 30 min)`` means the same
  signal is never emitted twice. Snapshots whose latest line is not on the
  requested session day are skipped.
* Read-only: this module never touches credentials and never polls Fyers in the
  detector path. :func:`ensure_started` runs a daemon cycle during market hours
  that reads **persisted snapshots only** and optionally enriches a hard-capped
  number of index chains for spot/spread/GEX.
"""
from __future__ import annotations

import json
import math
import os
import pathlib
import statistics
import sys
import threading
import time
from datetime import date, datetime, timedelta, time as dtime
from pathlib import Path
from zoneinfo import ZoneInfo

_SCRIPTS_DIR = str(Path(__file__).resolve().parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
_REPO_ROOT = str(Path(__file__).resolve().parent.parent.parent)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

try:  # imported as a package submodule (india_board.scripts.signal_emitters)
    from india_board.scripts import signal_log  # type: ignore
except ImportError:  # imported top-level (india_board/scripts on sys.path)
    import signal_log  # type: ignore

IST = ZoneInfo("Asia/Kolkata")

ROOT = Path(__file__).resolve().parent.parent
#: Persisted 2-minute OI snapshots (``{TICKER}/{date}.jsonl``).
OI_FLOW_DIR = ROOT / "data" / "oi_flow"
#: Signal archive root (``None`` -> ``signal_log.DATA_DIR``). Monkeypatchable.
_SIGNAL_ROOT: Path | None = None

#: Indices worth one get_chain enrichment per cycle (walls + spread + GEX).
_INDEX_TICKERS = frozenset({"NIFTY", "BANKNIFTY"})

# --- P1/P3 risk defaults (roadmap section 5) -------------------------------
SPREAD_LIMIT_BP = 20.0
STOP_ATR_MULT = 0.35
#: When ATR is unavailable: stop = wall +/- 0.35% of spot.
STOP_PCT_FALLBACK = 0.0035
TARGET_RISK_MULT = 1.5

# --- P2/P4 constants -------------------------------------------------------
#: "just beyond the absorbed strike" buffer (0.2%).
STRIKE_BUFFER_PCT = 0.002
#: P4 window starts at 14:00 IST (last 90 minutes of the 09:15-15:30 session).
P4_WINDOW = dtime(14, 0)
P4_NEAR_PCT = 0.3
P4_STOP_PCT = 0.004

_EPS = 1e-12
#: Minimum lookback deltas before a sigma is considered meaningful.
_MIN_LOOKBACK = 2
#: P3 uses the roadmap F3 "20-snapshot sigma" window for the wall jump test.
_P3_LOOKBACK = 20

# --- Scheduler defaults ----------------------------------------------------
_DEFAULT_INTERVAL = 120
_SCHED_TICK = 10
#: Hard cap on Fyers calls per cycle (indices only, ~1 call each).
_MAX_ENRICH_CALLS = 5

_STARTED = False
_LAST_CYCLE_TS = 0.0
#: In-process cooldown ledger: keys are ``_dedupe_key`` tuples.
_LEDGER: set = set()
_LEDGER_LOCK = threading.Lock()

__all__ = [
    "OI_FLOW_DIR",
    "SPREAD_LIMIT_BP",
    "EMITTER_INTERVAL_SEC",
    "p1_burst",
    "p2_absorption",
    "p3_wall_migration",
    "p4_expiry_pin",
    "load_snapshots",
    "universe",
    "run_once",
    "ensure_started",
    "reset_ledger",
]


# ---------------------------------------------------------------------------
# small numeric helpers
# ---------------------------------------------------------------------------


def _f(v):
    """Finite float or ``None`` (NaN/Inf/bad input -> None)."""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(x) or math.isinf(x):
        return None
    return x


def _first_num(*vals):
    for v in vals:
        x = _f(v)
        if x is not None:
            return x
    return None


def _ticker(t) -> str:
    return str(t or "").upper().strip()


def _ist(now=None) -> datetime:
    if now is None:
        return datetime.now(IST)
    if isinstance(now, datetime):
        cur = now
    else:
        try:
            cur = datetime.fromisoformat(str(now))
        except (TypeError, ValueError):
            return datetime.now(IST)
    if cur.tzinfo is None:
        return cur.replace(tzinfo=IST)
    return cur.astimezone(IST)


def _day_str(day=None) -> str:
    if day is None:
        return datetime.now(IST).date().isoformat()
    if isinstance(day, datetime):
        return day.astimezone(IST).date().isoformat()
    if isinstance(day, date):
        return day.isoformat()
    return str(day)[:10]


def _parse_ts(value):
    try:
        dt = datetime.fromisoformat(str(value or ""))
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=IST)
    return dt.astimezone(IST)


def _parse_expiry(value):
    """Parse a Fyers expiry date (``DD-MM-YYYY`` or ``YYYY-MM-DD``) or epoch."""
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            return datetime.fromtimestamp(int(value), tz=IST).date()
        except (OverflowError, OSError, ValueError):
            return None
    s = str(value).strip()
    for fmt in ("%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[: len(fmt) + 4], fmt).date()
        except (ValueError, TypeError):
            continue
    try:
        return date.fromisoformat(s[:10])
    except (TypeError, ValueError):
        return None


def _sigma(values):
    """Population sigma of a value list, or ``None`` when not computable."""
    vals = [_f(v) for v in (values or [])]
    vals = [v for v in vals if v is not None]
    if len(vals) < _MIN_LOOKBACK:
        return None
    try:
        return statistics.pstdev(vals)
    except (statistics.StatisticsError, TypeError, ValueError):
        return None


def _mean(values):
    vals = [_f(v) for v in (values or [])]
    vals = [v for v in vals if v is not None]
    return (sum(vals) / len(vals)) if vals else None


# ---------------------------------------------------------------------------
# snapshot access (never raises; a missing key is ``None``, never 0)
# ---------------------------------------------------------------------------


def _valid_snaps(snapshots) -> list:
    out = []
    for s in snapshots or []:
        if isinstance(s, dict) and s.get("ts") and isinstance(s.get("strikes"), list):
            out.append(s)
    out.sort(key=lambda s: str(s.get("ts") or ""))
    return out


def _snap_strikes(snap) -> list:
    if not isinstance(snap, dict):
        return []
    rows = snap.get("strikes")
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def _snap_spot(snap):
    return _f(snap.get("spot")) if isinstance(snap, dict) else None


def _snap_expiry_str(snap):
    if not isinstance(snap, dict):
        return None
    for key in ("expiry", "expiries"):
        v = snap.get(key)
        if isinstance(v, list) and v:
            v = v[0]
        if v:
            return str(v)
    return None


def _row_for_strike(snap, strike):
    target = _f(strike)
    if target is None:
        return None
    for r in _snap_strikes(snap):
        k = _f(r.get("strike"))
        if k is not None and abs(k - target) < 1e-6:
            return r
    return None


def _oi_at(snap, strike, side):
    row = _row_for_strike(snap, strike)
    if row is None:
        return None
    return _f(row.get(f"{side.lower()}_oi"))


def _oi_series(snaps, strike, side) -> list:
    out = []
    for s in snaps:
        v = _oi_at(s, strike, side)
        if v is not None:
            out.append(v)
    return out


def _side_oi(snap, prefix):
    """Total OI for a side across all strikes, or ``None`` when no strikes."""
    strikes = _snap_strikes(snap)
    if not strikes:
        return None
    total = 0.0
    for r in strikes:
        total += _f(r.get(f"{prefix}_oi")) or 0.0
    return total


def _side_vol(snap, prefix):
    """Total traded volume for a side, or ``None`` when no strike carries it."""
    found = False
    total = 0.0
    for r in _snap_strikes(snap):
        v = _f(r.get(f"{prefix}_vol"))
        if v is None:
            continue
        found = True
        total += v
    return total if found else None


def _series_deltas(series) -> list:
    out = []
    for a, b in zip(series, series[1:]):
        d = _f(b) - _f(a)
        if d is not None:
            out.append(d)
    return out


def _wall_strike(snap, side) -> float | None:
    """Max-OI strike for a side (ties go to the lower strike)."""
    key = f"{side.lower()}_oi"
    best = None
    best_oi = None
    for r in _snap_strikes(snap):
        k = _f(r.get("strike"))
        oi = _f(r.get(key))
        if k is None or oi is None or k <= 0:
            continue
        if best_oi is None or oi > best_oi or (oi == best_oi and k < best):
            best, best_oi = k, oi
    return best


def _extreme_wall(snap, side, *, above=None) -> float | None:
    """Max-OI strike for a side, optionally restricted to spot."""
    key = f"{side.lower()}_oi"
    best = None
    best_oi = None
    for r in _snap_strikes(snap):
        k = _f(r.get("strike"))
        oi = _f(r.get(key))
        if k is None or oi is None or k <= 0:
            continue
        if above is not None and not (k > above if side == "CE" else k < above):
            continue
        if best_oi is None or oi > best_oi:
            best, best_oi = k, oi
    return best


def _distance_bp(spot, wall, side) -> float | None:
    spot, wall = _f(spot), _f(wall)
    if spot is None or not wall:
        return None
    return ((spot - wall) if side == "CE" else (wall - spot)) / wall * 1e4


def _spot_delta_norm(snaps):
    if len(snaps) < 2:
        return None
    a, b = _snap_spot(snaps[-2]), _snap_spot(snaps[-1])
    if a is None or b is None or a == 0:
        return None
    return (b - a) / a


# ---------------------------------------------------------------------------
# chain access (only used when an enriched chain is supplied)
# ---------------------------------------------------------------------------


def _chain_spot(chain):
    return _f(chain.get("spot")) if isinstance(chain, dict) else None


def _chain_vol_map(chain) -> dict:
    out = {}
    if not isinstance(chain, dict):
        return out
    for r in chain.get("strikes") or []:
        if not isinstance(r, dict):
            continue
        k = _f(r.get("strike"))
        if k is None:
            continue
        out[k] = {"ce_vol": _f(r.get("ce_vol")), "pe_vol": _f(r.get("pe_vol"))}
    return out


def _sum_chain_vol(vol_map, prefix):
    found = False
    total = 0.0
    for leg in (vol_map or {}).values():
        v = _f(leg.get(f"{prefix}_vol"))
        if v is None:
            continue
        found = True
        total += v
    return total if found else None


def _chain_strikes(chain) -> list:
    if not isinstance(chain, dict):
        return []
    rows = chain.get("strikes")
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def _chain_expiry(chain):
    if not isinstance(chain, dict):
        return None
    v = chain.get("expiry")
    if isinstance(v, list):
        v = v[0] if v else None
    if not v:
        expiries = chain.get("expiries") or []
        v = expiries[0] if expiries else None
    return str(v) if v else None


def _chain_expiry_date(chain):
    return _parse_expiry(_chain_expiry(chain))


def _chain_spread_bp(chain):
    """ATM bid/ask spread in bp, or ``None`` when the chain has no quotes."""
    try:
        spot = _chain_spot(chain)
        rows = [r for r in _chain_strikes(chain) if _f(r.get("strike")) is not None]
        if spot is None or not rows:
            return None
        atm = min(rows, key=lambda r: abs(_f(r.get("strike")) - spot))
        for side in ("ce", "pe"):
            bid, ask = _f(atm.get(f"{side}_bid")), _f(atm.get(f"{side}_ask"))
            if bid is not None and ask is not None:
                mid = (bid + ask) / 2.0
                if mid > 0:
                    return (ask - bid) / mid * 1e4
        return None
    except Exception:  # noqa: BLE001
        return None


def _max_pain_from_strikes(strikes):
    """Max-pain strike (same formula as ``fyers_data.compute_levels``)."""
    valid = [r for r in (strikes or []) if _f(r.get("strike")) is not None]
    if not valid:
        return None
    best = None
    best_total = None
    for cand in valid:
        s = _f(cand.get("strike"))
        total = 0.0
        for row in valid:
            k = _f(row.get("strike"))
            total += max(0.0, s - k) * (_f(row.get("ce_oi")) or 0.0)
            total += max(0.0, k - s) * (_f(row.get("pe_oi")) or 0.0)
        if best_total is None or total < best_total:
            best, best_total = s, total
    return best


def _side_change(prev, cur, side, vol_map=None) -> dict:
    """Aggregate per-side writing delta between two snapshots (never raises)."""
    prefix = side.lower()
    oi_p, oi_c = _side_oi(prev, prefix), _side_oi(cur, prefix)
    d_oi = None if (oi_p is None or oi_c is None) else oi_c - oi_p

    v_p, v_c = _side_vol(prev, prefix), _side_vol(cur, prefix)
    if v_c is None and vol_map:
        v_c = _sum_chain_vol(vol_map, prefix)
    d_vol = None
    volume_ok = None
    if v_p is not None and v_c is not None:
        d_vol = v_c - v_p
        volume_ok = d_vol > 0
    ratio = None
    if d_oi is not None and d_vol not in (None, 0) and d_vol > 0:
        ratio = d_oi / d_vol
    return {"d_oi": d_oi, "d_vol": d_vol, "volume_ok": volume_ok, "oi_vol_ratio": ratio}


def _strike_vol_delta(prev, cur, strike, side):
    """Δvolume at one strike, or ``None`` when either snapshot lacks volume."""
    a = _row_for_strike(prev, strike)
    b = _row_for_strike(cur, strike)
    if a is None or b is None:
        return None
    va = _f(a.get(f"{side.lower()}_vol"))
    vb = _f(b.get(f"{side.lower()}_vol"))
    if va is None or vb is None:
        return None
    return vb - va


def _break_stop(side, wall, spot, atr):
    """``(stop_ref, basis)`` for P1/P3 breakouts."""
    a = _f(atr)
    if a is not None and a > 0:
        offset, basis = STOP_ATR_MULT * a, "atr"
    else:
        offset, basis = STOP_PCT_FALLBACK * spot, "pct_fallback"
    stop = (wall - offset) if side == "CE" else (wall + offset)
    return stop, basis


def _risk_target(side, spot, stop, snapshot=None):
    """Next wall on the trade side, else ``entry +/- 1.5 x risk``."""
    risk = abs(spot - stop)
    if snapshot is not None:
        nxt = _extreme_wall(snapshot, side, above=spot)
        if nxt is not None and ((side == "CE" and nxt > spot) or (side == "PE" and nxt < spot)):
            return nxt, "next_wall"
    if side == "CE":
        return spot + TARGET_RISK_MULT * risk, "risk_multiple"
    return spot - TARGET_RISK_MULT * risk, "risk_multiple"


def _record(playbook, ticker, side, features, **kwargs):
    """Build a validated record via ``signal_log.make_signal``; None on error."""
    try:
        return signal_log.make_signal(
            playbook, ticker, side=side, features=features, **kwargs
        )
    except Exception:  # noqa: BLE001 - detection must never raise
        return None


# ---------------------------------------------------------------------------
# P1 — OI-burst continuation
# ---------------------------------------------------------------------------


def p1_burst(
    ticker,
    snapshots,
    *,
    chain=None,
    prev_state=None,
    spread_bp=None,
    wall=None,
    atr=None,
):
    """Positional writing + acceptance beyond the pre-existing wall.

    Returns a P1 record, or ``None``. Never raises.
    """
    try:
        t = _ticker(ticker)
        snaps = _valid_snaps(snapshots)
        if not t or len(snaps) < 2:
            return None

        cur = snaps[-1]
        prev = prev_state if _valid_snaps([prev_state]) else snaps[-2]
        spot = _first_num(_snap_spot(cur), _snap_spot(prev), _chain_spot(chain))
        if spot is None:
            return None

        if spread_bp is not None:
            spread_ok = (_f(spread_bp) or float("inf")) < SPREAD_LIMIT_BP
            if not spread_ok:
                return None
        else:
            spread_ok = None

        vol_map = _chain_vol_map(chain)
        side = wall_strike = None
        change = None

        wall_override = _f(wall)
        if wall_override is not None:
            cand = "CE" if spot > wall_override else "PE" if spot < wall_override else None
            if cand is None:
                return None
            ch = _side_change(prev, cur, cand, vol_map)
            if ch["d_oi"] is None or ch["d_oi"] <= 0:
                return None
            if ch["d_vol"] is not None and ch["d_vol"] <= 0:
                return None
            side, wall_strike, change = cand, wall_override, ch
        else:
            cands = []
            for s in ("CE", "PE"):
                w = _wall_strike(prev, s)
                if w is None:
                    continue
                if s == "CE" and not (spot > w):
                    continue
                if s == "PE" and not (spot < w):
                    continue
                ch = _side_change(prev, cur, s, vol_map)
                if ch["d_oi"] is None or ch["d_oi"] <= 0:
                    continue
                if ch["d_vol"] is not None and ch["d_vol"] <= 0:
                    continue
                cands.append((_distance_bp(spot, w, s) or 0.0, s, w, ch))
            if not cands:
                return None
            cands.sort(key=lambda x: x[0], reverse=True)
            distance_bp, side, wall_strike, change = cands[0]

        delta_oi = change["d_oi"]
        delta_vol = change["d_vol"]
        stop_ref, stop_basis = _break_stop(side, wall_strike, spot, atr)
        target_ref, target_basis = _risk_target(side, spot, stop_ref, cur)
        features = {
            "delta_oi": delta_oi,
            "delta_vol": delta_vol,
            "oi_vol_ratio": change["oi_vol_ratio"],
            "volume_ok": change["volume_ok"],
            "wall_strike": wall_strike,
            "spot": spot,
            "distance_bp": _distance_bp(spot, wall_strike, side),
            "spread_bp": _f(spread_bp),
            "spread_ok": spread_ok,
            "atr": _f(atr),
            "stop_basis": stop_basis,
            "target_basis": target_basis,
        }
        return _record(
            "P1",
            t,
            side,
            features,
            entry_ref=spot,
            stop_ref=stop_ref,
            target_ref=target_ref,
            strike=wall_strike,
            expiry=_chain_expiry(chain),
            spread_bp=_f(spread_bp),
            source="oi_flow",
            notes=f"OI burst {side} beyond wall {wall_strike} (spot {spot})",
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[emitters] p1 {ticker}: {type(exc).__name__}"[:120], flush=True)
        return None


# ---------------------------------------------------------------------------
# P2 — absorption fade
# ---------------------------------------------------------------------------


def _near_strikes(snap, spot, near_pct):
    out = []
    for r in _snap_strikes(snap):
        k = _f(r.get("strike"))
        if k is None or not spot:
            continue
        if abs(k - spot) / spot * 100.0 <= near_pct:
            out.append(k)
    return out


def p2_absorption(ticker, snapshots, *, sigma_mult=2.0, near_pct=0.5):
    """Strikes near spot absorbing a ``sigma_mult``-sigma OI build.

    Returns a list of P2 records. Never raises.
    """
    try:
        t = _ticker(ticker)
        snaps = _valid_snaps(snapshots)
        if not t or len(snaps) < 3:
            return []
        cur = snaps[-1]
        spot = _first_num(_snap_spot(cur), _snap_spot(snaps[-2]))
        if spot is None:
            return []
        d_spot_norm = _spot_delta_norm(snaps)
        out = []
        for strike in sorted(set(_near_strikes(cur, spot, near_pct))):
            for side in ("CE", "PE"):
                series = _oi_series(snaps, strike, side)
                if len(series) < 3:
                    continue
                deltas = _series_deltas(series)
                if len(deltas) < 2:
                    continue
                latest = deltas[-1]
                if latest <= 0:  # absorption = writers building, not unwinding
                    continue
                sigma = _sigma(deltas[:-1])
                if sigma is None or sigma <= _EPS:
                    continue
                z = abs(latest) / sigma
                if z < float(sigma_mult):
                    continue
                mean_oi = _mean(series)
                d_oi_norm = (latest / mean_oi) if mean_oi else None
                if d_oi_norm is None:
                    score = None
                else:
                    score = abs(d_oi_norm) / max(abs(d_spot_norm or 0.0), _EPS)

                stop_ref = strike * (
                    (1 + STRIKE_BUFFER_PCT) if side == "CE" else (1 - STRIKE_BUFFER_PCT)
                )
                opp = _extreme_wall(cur, "PE" if side == "CE" else "CE", above=spot)
                if opp is not None:
                    target_ref = opp
                elif side == "CE":
                    target_ref = spot - TARGET_RISK_MULT * abs(spot - stop_ref)
                else:
                    target_ref = spot + TARGET_RISK_MULT * abs(spot - stop_ref)

                features = {
                    "absorption_score": score,
                    "zscore": z,
                    "sigma": sigma,
                    "delta_oi": latest,
                    "strike": strike,
                    "side": side,
                    "spot": spot,
                    "distance_pct": (strike - spot) / spot * 100.0,
                    "lookback_n": len(deltas) - 1,
                    "opposite_wall": opp,
                    "sigma_mult": float(sigma_mult),
                    "near_pct": float(near_pct),
                }
                rec = _record(
                    "P2",
                    t,
                    side,
                    features,
                    entry_ref=spot,
                    stop_ref=stop_ref,
                    target_ref=target_ref,
                    strike=strike,
                    source="oi_flow",
                    notes=f"absorption {side} {strike} z={z:.1f}",
                )
                if rec:
                    out.append(rec)
        return out
    except Exception as exc:  # noqa: BLE001
        print(f"[emitters] p2 {ticker}: {type(exc).__name__}"[:120], flush=True)
        return []


# ---------------------------------------------------------------------------
# P3 — wall migration
# ---------------------------------------------------------------------------


def p3_wall_migration(ticker, snapshots, *, k_sigma=2.0):
    """Wall strike migration, or a ``k_sigma``-sigma OI jump at the wall.

    Returns a list of P3 records (one per side). Never raises.
    """
    try:
        t = _ticker(ticker)
        snaps = _valid_snaps(snapshots)
        if not t or len(snaps) < 2:
            return []
        cur, prev = snaps[-1], snaps[-2]
        spot = _snap_spot(cur)
        out = []
        for side in ("CE", "PE"):
            cur_wall = _wall_strike(cur, side)
            if cur_wall is None:
                continue
            prev_wall = _wall_strike(prev, side)
            deltas = _series_deltas(_oi_series(snaps, cur_wall, side))
            latest = deltas[-1] if deltas else None
            sigma = _sigma(deltas[:-1][-_P3_LOOKBACK:]) if len(deltas) >= 2 else None

            event = None
            delta_oi = None
            if prev_wall is not None and cur_wall != prev_wall:
                event = "migration"
                oi_prev_dest = _oi_at(prev, cur_wall, side)
                oi_cur_dest = _oi_at(cur, cur_wall, side)
                if oi_prev_dest is not None and oi_cur_dest is not None:
                    delta_oi = oi_cur_dest - oi_prev_dest
                else:
                    delta_oi = oi_cur_dest if oi_cur_dest is not None else latest
            elif sigma is not None and sigma > _EPS and latest is not None:
                if abs(latest) > float(k_sigma) * sigma:
                    event = "oi_spike"
                    delta_oi = latest
            if event is None:
                continue

            vol_delta = _strike_vol_delta(prev, cur, cur_wall, side)
            volume_confirm = None if vol_delta is None else (vol_delta > 0)
            if spot is not None:
                stop_ref, stop_basis = _break_stop(side, cur_wall, spot, None)
                target_ref, target_basis = _risk_target(side, spot, stop_ref, cur)
            else:
                stop_ref = target_ref = None
                stop_basis = target_basis = None

            features = {
                "from_strike": prev_wall,
                "to_strike": cur_wall,
                "side": side,
                "delta_oi": delta_oi,
                "sigma": sigma,
                "volume_confirm": volume_confirm,
                "vol_delta": vol_delta,
                "event": event,
                "spot": spot,
                "distance_bp": _distance_bp(spot, cur_wall, side) if spot is not None else None,
                "k_sigma": float(k_sigma),
                "stop_basis": stop_basis,
                "target_basis": target_basis,
            }
            rec = _record(
                "P3",
                t,
                side,
                features,
                entry_ref=spot,
                stop_ref=stop_ref,
                target_ref=target_ref,
                strike=cur_wall,
                source="oi_flow",
                notes=f"wall {event} {side} {prev_wall}->{cur_wall}",
            )
            if rec:
                out.append(rec)
        return out
    except Exception as exc:  # noqa: BLE001
        print(f"[emitters] p3 {ticker}: {type(exc).__name__}"[:120], flush=True)
        return []


# ---------------------------------------------------------------------------
# P4 — expiry pin
# ---------------------------------------------------------------------------


def p4_expiry_pin(ticker, snapshots, *, chain=None, gex=None, now=None):
    """Expiry-day pin fade toward max pain in the last 90 minutes.

    Returns a P4 record, or ``None``. Never raises.
    """
    try:
        t = _ticker(ticker)
        if not t:
            return None
        cur_dt = _ist(now)
        if cur_dt.time() < P4_WINDOW:
            return None

        expiry_date = _chain_expiry_date(chain)
        if expiry_date is None or cur_dt.date() != expiry_date:
            return None

        snaps = _valid_snaps(snapshots)
        cur = snaps[-1] if snaps else None
        strikes = _snap_strikes(cur) or _chain_strikes(chain)
        if not strikes:
            return None
        spot = _first_num(_snap_spot(cur), _chain_spot(chain))
        if spot is None:
            return None
        max_pain = _max_pain_from_strikes(strikes)
        if not max_pain:
            return None
        distance_pct = abs(spot - max_pain) / max_pain * 100.0
        if distance_pct > P4_NEAR_PCT:
            return None

        gamma_flip = None
        if gex is not None:
            gamma_flip = _f(gex.get("gamma_flip")) if isinstance(gex, dict) else None
            if gamma_flip is None:
                return None
            if max_pain < spot and not (gamma_flip > spot):
                return None
            if max_pain > spot and not (gamma_flip < spot):
                return None

        if max_pain < spot:
            side = "PE"
        elif max_pain > spot:
            side = "CE"
        else:
            side = "NA"
        stop_ref = spot * (1 + P4_STOP_PCT) if side == "PE" else spot * (1 - P4_STOP_PCT)
        dte = (expiry_date - cur_dt.date()).days
        features = {
            "spot": spot,
            "max_pain": max_pain,
            "distance_pct": distance_pct,
            "gamma_flip": gamma_flip,
            "dte": dte,
            "expiry": _chain_expiry(chain),
            "window_from": P4_WINDOW.strftime("%H:%M"),
            "near_pct": P4_NEAR_PCT,
        }
        return _record(
            "P4",
            t,
            side,
            features,
            entry_ref=spot,
            stop_ref=stop_ref,
            target_ref=max_pain,
            strike=max_pain,
            expiry=expiry_date.strftime("%d-%m-%Y"),
            spread_bp=_chain_spread_bp(chain),
            source="oi_flow",
            notes=f"expiry pin spot {spot} -> max pain {max_pain} ({distance_pct:.2f}%)",
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[emitters] p4 {ticker}: {type(exc).__name__}"[:120], flush=True)
        return None


# ---------------------------------------------------------------------------
# snapshot loading (persisted JSONL only — no network)
# ---------------------------------------------------------------------------


def load_snapshots(ticker, day=None, *, root=None) -> list:
    """Load one ticker's snapshots for a day, sorted by ``ts``.

    Missing files yield ``[]``; malformed lines are skipped; old lines without
    ``spot`` are kept and read as ``spot: None``. Never raises.
    """
    try:
        t = _ticker(ticker)
        if not t:
            return []
        dstr = _day_str(day)
        base = Path(root) if root is not None else OI_FLOW_DIR
        path = base / t / f"{dstr}.jsonl"
        if not path.is_file():
            return []
        out = []
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if not isinstance(obj, dict):
                    continue
                if not obj.get("ts") or not obj.get("ticker"):
                    continue
                if not isinstance(obj.get("strikes"), list):
                    continue
                out.append(obj)
        out.sort(key=lambda s: str(s.get("ts") or ""))
        return out
    except Exception:  # noqa: BLE001
        return []


def universe(root=None) -> list:
    """Tickers with a persisted snapshot directory (sorted, never raises)."""
    base = Path(root) if root is not None else OI_FLOW_DIR
    try:
        if not base.is_dir():
            return []
        return sorted(p.name for p in base.iterdir() if p.is_dir())
    except OSError:
        return []


# ---------------------------------------------------------------------------
# dedupe / cooldown ledger
# ---------------------------------------------------------------------------


def _bucket(ts_iso, minutes=30) -> str:
    dt = _parse_ts(ts_iso) or datetime.now(IST)
    floored = dt.replace(second=0, microsecond=0)
    floored -= timedelta(minutes=floored.minute % int(minutes))
    return floored.strftime("%Y-%m-%dT%H:%M")


def _dedupe_key(record) -> tuple:
    strike = _f(record.get("strike"))
    return (
        str(record.get("playbook")),
        str(record.get("ticker")),
        str(record.get("side")),
        strike,
        _bucket(record.get("ts")),
    )


def reset_ledger() -> None:
    """Clear the in-process cooldown ledger (tests / manual runs)."""
    with _LEDGER_LOCK:
        _LEDGER.clear()


def _emit(record, *, session_day=None) -> bool:
    """Log one record once per dedupe key; never raises."""
    try:
        if not isinstance(record, dict):
            return False
        if session_day is not None:
            ts = _parse_ts(record.get("ts"))
            if ts is not None and ts.date().isoformat() != str(session_day)[:10]:
                return False
        key = _dedupe_key(record)
        with _LEDGER_LOCK:
            if key in _LEDGER:
                return False
            _LEDGER.add(key)
        sid = signal_log.log_signal(record, root=_SIGNAL_ROOT)
        if not sid:
            with _LEDGER_LOCK:
                _LEDGER.discard(key)
            return False
        return True
    except Exception:  # noqa: BLE001
        return False


# ---------------------------------------------------------------------------
# evaluation cycle
# ---------------------------------------------------------------------------


def _is_session_day(day_str: str) -> bool:
    try:
        return date.fromisoformat(str(day_str)[:10]).weekday() < 5
    except (TypeError, ValueError):
        return False


def _latest_snap_day(snaps):
    if not snaps:
        return None
    ts = _parse_ts(snaps[-1].get("ts"))
    return ts.date().isoformat() if ts else None


def _enrich_index(ticker) -> tuple:
    """One capped ``get_chain`` for an index: (chain, spread_bp, gex, calls)."""
    try:
        import fyers_data  # noqa: PLC0415 - lazy so tests never touch the network

        chain = fyers_data.get_chain(ticker)
        spread_bp = _chain_spread_bp(chain)
        try:
            gex = fyers_data.compute_gex(chain)
        except Exception:  # noqa: BLE001
            gex = None
        return chain, spread_bp, gex, 1
    except Exception as exc:  # noqa: BLE001
        print(f"[emitters] enrich {ticker}: {type(exc).__name__}"[:120], flush=True)
        return None, None, None, 0


def _pytest_signal_root():
    """Temp signal root while running under pytest.

    Test fixtures must never be able to append into the live archive
    (``india_board/data/signals``) — a fixture-driven record would poison the
    EV evaluation with numbers that never came from the market. A test that has
    already redirected ``signal_log.DATA_DIR`` keeps its own root.
    """
    if not os.environ.get("PYTEST_CURRENT_TEST"):
        return None
    import signal_log  # noqa: PLC0415
    import tempfile  # noqa: PLC0415

    live = pathlib.Path(__file__).resolve().parent.parent / "data" / "signals"
    configured = getattr(signal_log, "DATA_DIR", None)
    try:
        if configured is not None and pathlib.Path(configured).resolve() != live.resolve():
            return None  # already redirected by the test — respect it
    except OSError:  # pragma: no cover
        pass
    return pathlib.Path(tempfile.gettempdir()) / "india_board_test_signals"


def run_once(
    tickers=None,
    *,
    now=None,
    day=None,
    enrich=False,
    signal_root=None,
    oi_root=None,
) -> dict:
    """Evaluate the universe immediately and return ``{"P1".."P4"}`` counts.

    Reads only persisted snapshots. ``enrich`` (off by default, so tests and
    manual runs never spend API calls) may fetch at most
    :data:`_MAX_ENRICH_CALLS` index chains for spot/spread/GEX. Never raises.
    """
    counts = {"P1": 0, "P2": 0, "P3": 0, "P4": 0}
    try:
        global _SIGNAL_ROOT
        if signal_root is not None:
            _SIGNAL_ROOT = Path(signal_root)
        else:
            safe_root = _pytest_signal_root()
            if safe_root is not None:
                _SIGNAL_ROOT = safe_root
        cur = _ist(now)
        day_str = _day_str(day if day is not None else cur.date())
        if not _is_session_day(day_str):
            print(f"[emitters] cycle skipped: {day_str} is not a session day", flush=True)
            return counts

        work = tickers if tickers is not None else universe(oi_root)
        work = [_ticker(t) for t in work if _ticker(t)]
        budget = _MAX_ENRICH_CALLS

        for t in work:
            try:
                snaps = load_snapshots(t, day=day_str, root=oi_root)
                if not snaps:
                    continue
                if _latest_snap_day(snaps) != day_str:
                    continue  # stale data is outside today's session

                chain = spread_bp = gex = None
                if enrich and budget > 0 and t in _INDEX_TICKERS:
                    chain, spread_bp, gex, calls = _enrich_index(t)
                    budget -= calls

                records = []
                r1 = p1_burst(t, snaps, chain=chain, spread_bp=spread_bp)
                if r1:
                    records.append(r1)
                records.extend(p2_absorption(t, snaps))
                records.extend(p3_wall_migration(t, snaps))
                r4 = p4_expiry_pin(t, snaps, chain=chain, gex=gex, now=cur)
                if r4:
                    records.append(r4)

                for rec in records:
                    # Stamp the cycle time (not wall-clock) so emissions for a
                    # requested session are deterministic and the day check holds.
                    if isinstance(rec, dict):
                        rec["ts"] = cur.isoformat()
                    if _emit(rec, session_day=day_str):
                        pb = rec.get("playbook")
                        if pb in counts:
                            counts[pb] += 1
            except Exception as exc:  # noqa: BLE001 - one ticker never aborts
                print(f"[emitters] {t}: {type(exc).__name__}: {exc}"[:160], flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"[emitters] cycle failed: {type(exc).__name__}: {exc}"[:160], flush=True)
    print(
        f"[emitters] cycle: P1={counts['P1']} P2={counts['P2']} "
        f"P3={counts['P3']} P4={counts['P4']}",
        flush=True,
    )
    return counts


# ---------------------------------------------------------------------------
# scheduler
# ---------------------------------------------------------------------------


def _env_interval() -> float:
    try:
        return float(os.environ.get("EMITTER_INTERVAL_SEC", _DEFAULT_INTERVAL))
    except (TypeError, ValueError):
        return float(_DEFAULT_INTERVAL)


#: Proactive emitter interval (seconds); ``EMITTER_INTERVAL_SEC`` overrides.
EMITTER_INTERVAL_SEC = _env_interval()


def _is_market_open(now=None) -> bool:
    """True during Mon-Fri 09:15-15:30 IST."""
    cur = _ist(now)
    if cur.weekday() >= 5:
        return False
    mins = cur.hour * 60 + cur.minute
    return 9 * 60 + 15 <= mins <= 15 * 60 + 30


def _run_due_cycle(now=None) -> bool:
    """Run one evaluation cycle if due; never raises."""
    global _LAST_CYCLE_TS
    cur = _ist(now)
    if not _is_market_open(cur):
        return False
    interval = _env_interval()
    if _LAST_CYCLE_TS > 0 and (cur.timestamp() - _LAST_CYCLE_TS) < interval:
        return False
    try:
        run_once(now=cur, enrich=True)
    except Exception as exc:  # noqa: BLE001
        print(f"[emitters] scheduled cycle failed: {type(exc).__name__}"[:120], flush=True)
    _LAST_CYCLE_TS = cur.timestamp()
    return True


def _loop() -> None:
    print(
        f"[emitters] scheduler started (interval {_env_interval():.0f}s, "
        f"tick {_SCHED_TICK}s)",
        flush=True,
    )
    while True:
        try:
            _run_due_cycle()
        except Exception as exc:  # noqa: BLE001 - never kill the loop
            print(f"[emitters] scheduler error: {type(exc).__name__}: {exc}"[:160], flush=True)
        time.sleep(_SCHED_TICK)


def ensure_started() -> None:
    """Start the emitter scheduler once (daemon thread, idempotent)."""
    global _STARTED
    if _STARTED:
        return
    _STARTED = True
    threading.Thread(target=_loop, name="signal-emitters", daemon=True).start()


if __name__ == "__main__":  # pragma: no cover - manual smoke, no server
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    print(json.dumps(run_once(tickers=args or None, enrich=True), indent=2))
