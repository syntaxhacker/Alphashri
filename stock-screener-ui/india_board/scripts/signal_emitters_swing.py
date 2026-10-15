#!/usr/bin/env python3
"""Swing / positional playbook signal emitters for the India board (W3b).

Implements the *slow* half of the playbook set described in
``india_board/docs/EDGE_ROADMAP.md`` §5:

* **P5** — rollover positional (F8): rollover% in the top decile while the
  futures basis is rising and the next-expiry book builds at the same strike.
* **P6** — VRP premium sale (F7 + F5): ``EXPENSIVE`` variance risk premium with
  a rich 25Δ risk reversal and no known event inside the horizon.
* **P7** — sector rotation swing (F9): sector strength in the top decile with
  market/hand breadth confirming.

Design
------
* :func:`p5_rollover`, :func:`p6_vrp_premium` and :func:`p7_sector_rotation`
  are **pure detectors**: they accept already-fetched data and return signal
  records (built through :func:`signal_log.make_signal`) or ``None`` /
  ``[]``. They never touch the network.
* :func:`run_once` wires the detectors to the data layer, but every external
  call (``rollover_fn`` / ``greeks_fn`` / ``chains`` / ``scan``) is injectable
  so tests and the eval harness never hit Fyers.
* Signals are logged with :func:`signal_log.log_signal` under
  ``source="rollover" | "greeks" | "scan"`` (roadmap F12).
* A low-frequency daemon (:func:`ensure_started`) evaluates the detectors once
  per ``SWING_EMITTER_INTERVAL_SEC`` (default 1800s) during Mon-Fri 09:15-15:30
  IST. Live Fyers usage is capped (see :data:`MAX_CHAIN_CALLS`) and sequential.
* An in-process ledger dedupes by ``(playbook, ticker_or_sector, side, day)``
  and re-emits only when the underlying metric moves more than 20% versus the
  last emit (recorded as ``features.reemit_of``).

This module owns no credentials, never prints a token, and never edits another
module's state. It intentionally does **not** import ``signal_emitters.py``
(the P1-P4 sibling owned by another agent) — the two are independent.
"""
from __future__ import annotations

import json
import math
import os
import pathlib
import sys
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

# Sibling modules live next to this file. Resolve both the package import
# (``india_board.scripts.signal_emitters_swing``) and the flat import
# (``india_board/scripts`` on ``sys.path``) so the manual smoke command in the
# task brief imports cleanly.
try:  # pragma: no cover - exercised implicitly by both import styles
    from . import rollover_data, signal_log
except ImportError:  # pragma: no cover
    import rollover_data  # type: ignore
    import signal_log  # type: ignore

IST = ZoneInfo("Asia/Kolkata")

# ---------------------------------------------------------------------------
# Tunables / contract constants
# ---------------------------------------------------------------------------

#: Default rollover-percentile gate for P5 (top decile ≈ >= 0.60 of OI rolled).
DEFAULT_PCT_PCTL = 0.60
#: A 25Δ risk reversal is "rich" once its absolute value reaches 1 vol point
#: (IV inputs are decimals here, so 0.01 == 1 percentage point).
SKEW_RICH_MIN = 0.01
#: P6 blocks when a known event falls inside this many calendar days.
EVENT_HORIZON_DAYS = 3
#: P5 stop sizing: ``max(0.5 * |basis|, 0.4% of spot)``.
P5_RISK_BASIS_FRAC = 0.5
P5_RISK_SPOT_FRAC = 0.004
#: P5 target = entry ± ``P5_TARGET_R_MULT`` × risk.
P5_TARGET_R_MULT = 2.0

#: Hard ceiling on *live* Fyers chain calls per :func:`run_once` run.
MAX_CHAIN_CALLS = 12
#: Conservative estimate of chain calls per ticker on the default (live) path:
#: rollover needs list_expiries + 2 chains, basis needs the futures/gex chain,
#: greeks needs a greeks chain. Cached repeats are cheaper.
_CALLS_PER_TICKER = 6
#: Live tickers wrapped per cycle (sequential) so a run stays under the budget.
MAX_LIVE_TICKERS = max(1, MAX_CHAIN_CALLS // _CALLS_PER_TICKER)

#: Default scheduler interval in seconds (``SWING_EMITTER_INTERVAL_SEC``).
_DEFAULT_INTERVAL = 1800
_SCHED_TICK = 30
#: Environment variables accepted for the sector-map JSON override.
SECTOR_MAP_ENVS = ("INDIA_BOARD_SECTOR_MAP", "SWING_SECTOR_MAP")
#: Re-emit when the tracked metric moves more than this fraction.
REEMIT_CHANGE_THRESHOLD = 0.20

_STARTED = False
_LAST_RUN_TS = 0.0
#: Rotating cursor so the (budget-capped) live path covers every ticker.
_TICKER_CURSOR = 0
#: In-process dedupe ledger, keyed by ``(playbook, ticker, side, bucket)``.
_LEDGER: dict = {}
_LEDGER_LOCK = threading.Lock()

__all__ = [
    "DEFAULT_PCT_PCTL",
    "SKEW_RICH_MIN",
    "EVENT_HORIZON_DAYS",
    "MAX_CHAIN_CALLS",
    "BUILTIN_SECTOR_MAP",
    "load_sector_map",
    "p5_rollover",
    "p6_vrp_premium",
    "p7_sector_rotation",
    "build_sector_rows",
    "apply_dedupe",
    "reset_ledger",
    "run_once",
    "ensure_started",
]


# ---------------------------------------------------------------------------
# small coercion helpers
# ---------------------------------------------------------------------------


def _num(value, default=None):
    """Finite float or ``default`` (``None`` / NaN / Inf map to ``default``)."""
    try:
        if value is None:
            return default
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if math.isfinite(out) else default


def _uptick(value) -> str:
    """Normalised ticker/sector label (upper, trimmed)."""
    return str(value or "").upper().strip()


def _now(now=None) -> datetime:
    """Coerce ``now`` (datetime / epoch / None) to an IST-aware datetime."""
    if isinstance(now, datetime):
        return now.replace(tzinfo=IST) if now.tzinfo is None else now.astimezone(IST)
    if isinstance(now, date):
        return datetime(now.year, now.month, now.day, tzinfo=IST)
    if isinstance(now, (int, float)):
        return datetime.fromtimestamp(float(now), tz=IST)
    return datetime.now(IST)


def _parse_date(value) -> date | None:
    """Parse a ``date`` / ``datetime`` / ISO string / epoch to a ``date``."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(IST).date() if value.tzinfo else value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=IST).date()
        except (ValueError, OSError, OverflowError):
            return None
    s = str(value).strip()
    if not s:
        return None
    if s[:10].count("-") == 2:
        try:
            return date.fromisoformat(s[:10])
        except ValueError:
            pass
    if s.isdigit():
        try:
            return datetime.fromtimestamp(int(s), tz=IST).date()
        except (ValueError, OSError, OverflowError):
            return None
    for fmt in ("%d-%m-%Y", "%d-%b-%Y", "%Y%m%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _metric_changed(prev, cur, threshold: float = REEMIT_CHANGE_THRESHOLD) -> bool:
    """True when ``cur`` differs from ``prev`` by more than ``threshold``.

    Both ``None`` → unchanged; one side missing → changed; ``prev == 0`` →
    any non-zero ``cur`` counts as changed (no division by zero).
    """
    if prev is None and cur is None:
        return False
    if prev is None or cur is None:
        return True
    if prev == 0:
        return abs(cur) > 0
    try:
        return abs(float(cur) - float(prev)) / abs(float(prev)) > float(threshold)
    except (TypeError, ValueError, ZeroDivisionError):
        return True


# ---------------------------------------------------------------------------
# P5 — rollover positional
# ---------------------------------------------------------------------------


def _prev_basis(ticker: str, current_ts) -> float | None:
    """Basis from the most recent persisted capture **before** ``current_ts``.

    Reads :func:`rollover_data.history` (disk only, no network). Returns
    ``None`` when there is nothing to compare against.
    """
    try:
        records = rollover_data.history(ticker)
    except Exception:  # noqa: BLE001 — history is best-effort
        return None
    prev = None
    for rec in records:
        if not isinstance(rec, dict):
            continue
        ts = str(rec.get("ts") or "")
        if current_ts and ts and ts >= str(current_ts):
            continue
        val = _num(((rec.get("basis") or {}).get("near") or {}).get("basis"))
        if val is not None:
            prev = val
    return prev


def _next_oi_build(rollover: dict, side: str, next_chain) -> tuple[float | None, float | None]:
    """``(build, strike)`` for the next-expiry book on ``side`` at the same strike.

    Preference order:

    1. ``rollover['strikes']`` per-strike next-vs-near side OI shift (the union
       computed by :func:`rollover_data.rollover`);
    2. otherwise the largest next-expiry side OI in an injected ``next_chain``
       (a positive-build proxy — near OI is unavailable there).
    """
    prefix = "call" if side == "CE" else "put"
    rows = rollover.get("strikes") if isinstance(rollover, dict) else None
    best = None
    best_strike = None
    if isinstance(rows, list) and rows:
        for row in rows:
            if not isinstance(row, dict):
                continue
            nxt = _num(row.get(f"next_{prefix}_oi"))
            near = _num(row.get(f"near_{prefix}_oi"))
            if nxt is None:
                continue
            shift = nxt - (near or 0.0)
            if best is None or shift > best:
                best = shift
                best_strike = _num(row.get("strike"))
    if best is None and isinstance(next_chain, dict):
        oi_key = f"{'ce' if side == 'CE' else 'pe'}_oi"
        for row in next_chain.get("strikes") or []:
            if not isinstance(row, dict):
                continue
            oi = _num(row.get(oi_key))
            if oi is None:
                continue
            if best is None or oi > best:
                best = oi
                best_strike = _num(row.get("strike"))
    return best, best_strike


def _basis_side(basis: dict) -> str:
    """Direction implied by the front basis (positive → CE, negative → PE)."""
    near = basis.get("near") if isinstance(basis, dict) else None
    b = _num((near or {}).get("basis")) if isinstance(near, dict) else None
    if b is None:
        b = _num(basis.get("basis")) if isinstance(basis, dict) else None
    return "PE" if (b is not None and b < 0) else "CE"


def p5_rollover(rollover, basis, *, next_chain=None, pct_pctl=None) -> dict | None:
    """P5 rollover-positional detector (pure).

    Fires when all of the following hold:

    * the total rollover percent is at/above ``pct_pctl`` (default
      :data:`DEFAULT_PCT_PCTL`, i.e. the top decile);
    * the front basis is **rising** versus the previous persisted capture
      (``basis['basis_prev']`` when the caller already resolved it, else
      :func:`rollover_data.history`);
    * when ``next_chain`` is supplied, the next-expiry book builds at the same
      strike (positive side OI shift).

    ``side`` is the side carrying the higher rollover split (fallback: the
    direction implied by the basis). Levels:

    * ``entry_ref`` — front futures price, else spot;
    * ``stop_ref`` — ``entry_ref ∓ max(0.5×|basis|, 0.4%×spot)``;
    * ``target_ref`` — ``entry_ref ± 2×risk``.

    ``features.stop_basis`` is the basis level implied by ``stop_ref`` (basis
    moving against the position by ``risk``), and ``features.basis_prev`` the
    prior capture's basis.
    """
    rollover = rollover if isinstance(rollover, dict) else {}
    basis = basis if isinstance(basis, dict) else {}
    if rollover.get("unavailable") or basis.get("unavailable"):
        return None

    ticker = _uptick(rollover.get("ticker") or basis.get("ticker"))
    if not ticker:
        return None

    pctl = _num(pct_pctl)
    if pctl is None:
        pctl = DEFAULT_PCT_PCTL
    roll_pct = _num(rollover.get("rollover_pct"))
    if roll_pct is None or roll_pct < pctl:
        return None

    # --- basis rising vs the previous capture -----------------------------
    near = basis.get("near") if isinstance(basis.get("near"), dict) else {}
    basis_now = _num(near.get("basis"))
    if basis_now is None:
        basis_now = _num(basis.get("basis"))
    basis_prev = _num(basis.get("basis_prev"))
    if basis_prev is None:
        basis_prev = _prev_basis(ticker, basis.get("ts"))
    if basis_now is None or basis_prev is None or basis_now <= basis_prev:
        return None

    # --- side selection ---------------------------------------------------
    call_pct = _num(rollover.get("rollover_pct_call"))
    put_pct = _num(rollover.get("rollover_pct_put"))
    if call_pct is not None and put_pct is not None and call_pct != put_pct:
        side = "CE" if call_pct > put_pct else "PE"
    elif call_pct is not None and put_pct is None:
        side = "CE"
    elif put_pct is not None and call_pct is None:
        side = "PE"
    else:
        side = _basis_side(basis)

    # --- next-expiry OI build (gate only when a next_chain is supplied) ---
    build, build_strike = _next_oi_build(rollover, side, next_chain)
    if next_chain is not None and not (build is not None and build > 0):
        return None

    # --- levels -----------------------------------------------------------
    entry_ref = _num(near.get("price"))
    if entry_ref is None:
        entry_ref = _num(basis.get("spot")) or _num(rollover.get("spot"))
    if entry_ref is None:
        return None
    spot = _num(basis.get("spot")) or _num(rollover.get("spot")) or entry_ref
    risk = max(P5_RISK_BASIS_FRAC * abs(basis_now), P5_RISK_SPOT_FRAC * spot)
    if side == "CE":
        stop_ref = entry_ref - risk
        target_ref = entry_ref + P5_TARGET_R_MULT * risk
        stop_basis = basis_now - risk
    else:
        stop_ref = entry_ref + risk
        target_ref = entry_ref - P5_TARGET_R_MULT * risk
        stop_basis = basis_now + risk

    features = {
        "rollover_pct": roll_pct,
        "rollover_pct_call": call_pct,
        "rollover_pct_put": put_pct,
        "basis": basis_now,
        "basis_prev": basis_prev,
        "annualized_basis": _num(near.get("annualized_basis")),
        "dte_near": rollover.get("near_dte"),
        "dte_next": rollover.get("next_dte"),
        "next_oi_build": build,
        "next_oi_build_strike": build_strike,
        "stop_basis": stop_basis,
        "risk": risk,
        "pct_pctl": pctl,
    }
    return signal_log.make_signal(
        "P5",
        ticker,
        side=side,
        features=features,
        entry_ref=entry_ref,
        stop_ref=stop_ref,
        target_ref=target_ref,
        expiry=rollover.get("next_expiry"),
        source="rollover",
        notes=(
            f"rollover {roll_pct:.2f} >= {pctl:.2f}; basis {basis_now:.2f} "
            f"(prev {basis_prev:.2f}); next OI build {build}"
        )[:200],
    )


# ---------------------------------------------------------------------------
# P6 — VRP premium sale
# ---------------------------------------------------------------------------


def _event_dates(event_days) -> set[date]:
    """Normalise an injected event collection to a set of dates.

    Accepts a list of ISO strings / ``date`` / ``datetime`` / epochs, or a
    mapping (both keys and values are considered).
    """
    items = []
    if isinstance(event_days, dict):
        items.extend(event_days.keys())
        items.extend(event_days.values())
    elif isinstance(event_days, (list, tuple, set)):
        items.extend(event_days)
    elif event_days is not None and not isinstance(event_days, (date, datetime)):
        items.append(event_days)
    out: set[date] = set()
    for item in items:
        parsed = _parse_date(item)
        if parsed is not None:
            out.add(parsed)
    return out


def _ref_date(iv_metrics: dict, vrp: dict) -> date:
    """Reference date for the event check (payload ``as_of`` else IST today)."""
    for src in (iv_metrics, vrp):
        if isinstance(src, dict):
            parsed = _parse_date(src.get("as_of"))
            if parsed is not None:
                return parsed
    return datetime.now(IST).date()


def _event_check(event_days, ref: date) -> str:
    """``"unknown"`` (no events supplied) / ``"clear"`` / ``"event_near"``."""
    if event_days is None:
        return "unknown"
    horizon = EVENT_HORIZON_DAYS
    for ev in _event_dates(event_days):
        delta = (ev - ref).days
        if 0 <= delta <= horizon:
            return "event_near"
    return "clear"


def p6_vrp_premium(iv_metrics, vrp, *, skew_rich=True, event_days=None) -> dict | None:
    """P6 VRP premium-sale detector (pure).

    Fires when the VRP verdict is ``EXPENSIVE`` **and** the 25Δ risk reversal is
    rich for the side being sold **and** no known event sits inside the horizon.

    Skew rule (documented): ``risk_reversal = 25ΔP IV − 25ΔC IV`` (as produced by
    ``greeks_data.iv_metrics``). Premium sellers want a rich wing, so a
    magnitude of at least :data:`SKEW_RICH_MIN` (1 vol point) is treated as
    rich. When the risk reversal is unavailable the injected ``skew_rich`` flag
    alone decides — so the eval harness can ablate the skew gate. Passing
    ``skew_rich=False`` always suppresses the signal.

    Event rule: ``event_days`` is an injected collection of known event dates.
    When omitted the signal still fires and records
    ``features.event_check="unknown"`` for later ablation.

    Levels are expressed in **IV points** (percentage points, e.g. ``18.5``),
    not underlying price, because the tradeable leg selection is out of scope:

    * ``entry_ref`` = modelled credit received in IV points (``vrp_pct``);
    * ``target_ref`` = 50% of the credit (profit-take);
    * ``stop_ref`` = 2× the credit (defined-risk max loss, i.e. 2× debit).

    ``side`` is ``"NA"`` (the structure is non-directional).
    """
    iv_metrics = iv_metrics if isinstance(iv_metrics, dict) else {}
    vrp = vrp if isinstance(vrp, dict) else {}

    verdict = str(vrp.get("verdict") or "UNKNOWN").upper()
    if verdict != "EXPENSIVE":
        return None

    rr = _num(iv_metrics.get("risk_reversal"))
    rich = bool(skew_rich) and (rr is None or abs(rr) >= SKEW_RICH_MIN)
    if not rich:
        return None

    ref = _ref_date(iv_metrics, vrp)
    ev = _event_check(event_days, ref)
    if ev == "event_near":
        return None

    ticker = _uptick(
        iv_metrics.get("ticker") or iv_metrics.get("underlying") or vrp.get("ticker")
    ) or "NIFTY"

    atm_iv = _num(iv_metrics.get("atm_iv"))
    hv20 = _num(vrp.get("hv20"))
    vrp_dec = _num(vrp.get("vrp"))
    vrp_pct = _num(vrp.get("vrp_pct"))
    if vrp_pct is None and atm_iv is not None and hv20 is not None:
        vrp_pct = (atm_iv - hv20) * 100.0

    credit = vrp_pct if (vrp_pct is not None and vrp_pct > 0) else None
    entry_ref = credit
    target_ref = (credit * 0.5) if credit is not None else None
    stop_ref = (credit * 2.0) if credit is not None else None

    iv_rank = iv_metrics.get("iv_rank")
    if iv_rank is None:
        iv_rank = vrp.get("iv_rank")

    features = {
        "atm_iv": atm_iv,
        "hv20": hv20,
        "vrp": vrp_dec,
        "vrp_pct": vrp_pct,
        "risk_reversal": rr,
        "butterfly": _num(iv_metrics.get("butterfly")),
        "iv_rank": iv_rank,
        "verdict": verdict,
        "skew_rich": bool(rich),
        "event_check": ev,
        "iv_points_convention": "entry=credit, target=0.5x credit, stop=2x credit",
    }
    return signal_log.make_signal(
        "P6",
        ticker,
        side="NA",
        features=features,
        entry_ref=entry_ref,
        stop_ref=stop_ref,
        target_ref=target_ref,
        source="greeks",
        notes=(
            f"VRP {verdict}; rr={rr}; skew_rich={bool(rich)}; event={ev}"
        )[:200],
    )


# ---------------------------------------------------------------------------
# P7 — sector rotation swing + sector map + aggregation
# ---------------------------------------------------------------------------

#: Built-in ``{TICKER: SECTOR}`` fallback for the ~most liquid NSE F&O names.
#: The long-term source is the main app's ``/api/sector?market=india`` endpoint;
#: this static map only exists so the detector works offline and before that
#: endpoint is wired into the board. Override it with a JSON file via the
#: ``INDIA_BOARD_SECTOR_MAP`` (or ``SWING_SECTOR_MAP``) env var, or pass an
#: explicit ``sector_map`` to :func:`build_sector_rows`.
BUILTIN_SECTOR_MAP: dict[str, str] = {
    # Banks
    "HDFCBANK": "BANKS", "ICICIBANK": "BANKS", "SBIN": "BANKS",
    "KOTAKBANK": "BANKS", "AXISBANK": "BANKS", "INDUSINDBK": "BANKS",
    "BANDHANBNK": "BANKS", "FEDERALBNK": "BANKS", "IDFCFIRSTB": "BANKS",
    "PNB": "BANKS", "BANKBARODA": "BANKS", "AUBANK": "BANKS",
    "RBLBANK": "BANKS", "CANBK": "BANKS", "IDFC": "BANKS",
    # NBFC / financials / capital markets
    "BAJFINANCE": "NBFC", "BAJAJFINSV": "NBFC", "SBICARD": "NBFC",
    "CHOLAFIN": "NBFC", "SHRIRAMFIN": "NBFC", "MUTHOOTFIN": "NBFC",
    "JIOFIN": "NBFC", "PFC": "NBFC", "RECLTD": "NBFC", "IRFC": "NBFC",
    "HDFCAMC": "CAPITAL_MARKETS", "ANGELONE": "CAPITAL_MARKETS",
    "BSE": "CAPITAL_MARKETS", "MCX": "CAPITAL_MARKETS", "CDSL": "CAPITAL_MARKETS",
    "IEX": "CAPITAL_MARKETS",
    "SBILIFE": "INSURANCE", "HDFCLIFE": "INSURANCE", "ICICIGI": "INSURANCE",
    "ICICIPRULI": "INSURANCE", "LICI": "INSURANCE",
    "PAYTM": "FINTECH", "POLICYBZR": "FINTECH",
    # IT
    "TCS": "IT", "INFY": "IT", "WIPRO": "IT", "HCLTECH": "IT",
    "TECHM": "IT", "LTIM": "IT", "PERSISTENT": "IT", "COFORGE": "IT",
    "MPHASIS": "IT", "OFSS": "IT",
    # Auto
    "MARUTI": "AUTO", "TATAMOTORS": "AUTO", "TMPV": "AUTO", "M&M": "AUTO",
    "BAJAJ-AUTO": "AUTO", "HEROMOTOCO": "AUTO", "EICHERMOT": "AUTO",
    "TVSMOTOR": "AUTO", "ASHOKLEY": "AUTO", "BHARATFORG": "AUTO",
    "MOTHERSON": "AUTO", "BOSCHLTD": "AUTO",
    # Energy / oil & gas / power / mining
    "RELIANCE": "ENERGY", "ONGC": "ENERGY", "IOC": "ENERGY", "BPCL": "ENERGY",
    "HPCL": "ENERGY", "GAIL": "ENERGY", "PETRONET": "ENERGY", "OIL": "ENERGY",
    "COALINDIA": "MINING",
    "NTPC": "POWER", "POWERGRID": "POWER", "TATAPOWER": "POWER",
    "ADANIPOWER": "POWER", "ADANIGREEN": "POWER", "ADANIENSOL": "POWER",
    "JSWENERGY": "POWER", "NHPC": "POWER", "SJVN": "POWER",
    # Metals
    "TATASTEEL": "METALS", "JSWSTEEL": "METALS", "HINDALCO": "METALS",
    "VEDL": "METALS", "JINDALSTEL": "METALS", "SAIL": "METALS",
    "NMDC": "METALS", "NATIONALUM": "METALS", "HINDZINC": "METALS",
    "HINDCOPPER": "METALS",
    # Cement / building materials
    "ULTRACEMCO": "CEMENT", "GRASIM": "CEMENT", "AMBUJACEM": "CEMENT",
    "SHREECEM": "CEMENT", "ACC": "CEMENT", "DALBHARAT": "CEMENT",
    "JKCEMENT": "CEMENT", "RAMCOCEM": "CEMENT",
    "ASTRAL": "BUILDING_MATERIALS", "SUPREMEIND": "BUILDING_MATERIALS",
    # Pharma / healthcare
    "SUNPHARMA": "PHARMA", "CIPLA": "PHARMA", "DRREDDY": "PHARMA",
    "DIVISLAB": "PHARMA", "LUPIN": "PHARMA", "AUROPHARMA": "PHARMA",
    "ALKEM": "PHARMA", "TORNTPHARM": "PHARMA", "ZYDUSLIFE": "PHARMA",
    "BIOCON": "PHARMA", "GLENMARK": "PHARMA", "IPCALAB": "PHARMA",
    "APOLLOHOSP": "HEALTHCARE", "MAXHEALTH": "HEALTHCARE", "FORTIS": "HEALTHCARE",
    # FMCG / consumer
    "HINDUNILVR": "FMCG", "ITC": "FMCG", "NESTLEIND": "FMCG",
    "BRITANNIA": "FMCG", "DABUR": "FMCG", "MARICO": "FMCG",
    "GODREJCP": "FMCG", "COLPAL": "FMCG", "TATACONSUM": "FMCG",
    "UBL": "FMCG", "VBL": "FMCG",
    "TITAN": "CONSUMER_DURABLES", "HAVELLS": "CONSUMER_DURABLES",
    "DIXON": "CONSUMER_DURABLES", "VOLTAS": "CONSUMER_DURABLES",
    "POLYCAB": "CONSUMER_DURABLES",
    # Infra / capital goods / defence
    "LT": "INFRA", "RVNL": "INFRA", "IRCON": "INFRA", "NBCC": "INFRA",
    "GMRINFRA": "INFRA",
    "SIEMENS": "CAPITAL_GOODS", "ABB": "CAPITAL_GOODS", "BHEL": "CAPITAL_GOODS",
    "CUMMINSIND": "CAPITAL_GOODS",
    "BEL": "DEFENCE", "HAL": "DEFENCE", "BDL": "DEFENCE",
    # Telecom / realty / chemicals / retail / internet
    "BHARTIARTL": "TELECOM", "IDEA": "TELECOM", "INDUSTOWER": "TELECOM",
    "DLF": "REALTY", "GODREJPROP": "REALTY", "OBEROIRLTY": "REALTY",
    "PRESTIGE": "REALTY", "PHOENIXLTD": "REALTY",
    "PIDILITIND": "CHEMICALS", "SRF": "CHEMICALS", "UPL": "CHEMICALS",
    "PIIND": "CHEMICALS", "DEEPAKNTR": "CHEMICALS", "AARTIIND": "CHEMICALS",
    "TATACHEM": "CHEMICALS", "NAVINFLUOR": "CHEMICALS", "ATUL": "CHEMICALS",
    "PAGEIND": "TEXTILES", "ABFRL": "RETAIL", "DMART": "RETAIL",
    "TRENT": "RETAIL", "NYKAA": "RETAIL", "ETERNAL": "INTERNET",
    "NAUKRI": "INTERNET",
    "INDIGO": "AVIATION", "IRCTC": "TRAVEL", "ADANIPORTS": "PORTS",
    "ADANIENT": "CONGLOMERATE",
}


def _parse_sector_map(data) -> dict:
    """Normalise a JSON-loaded sector map into ``{TICKER: SECTOR}``.

    Accepts ``{TICKER: SECTOR}`` directly, ``{"map": {...}}`` /
    ``{"tickers": {...}}``, or an inverted ``{"sectors": {SECTOR: [names]}}``.
    """
    if not isinstance(data, dict):
        return {}
    raw = data
    for key in ("map", "tickers", "symbols"):
        if isinstance(data.get(key), dict):
            raw = data[key]
            break
    # Inverted form: {"sectors": {"BANKS": ["HDFCBANK", ...]}}
    sectors = data.get("sectors")
    if isinstance(sectors, dict):
        out: dict[str, str] = {}
        for sector, names in sectors.items():
            sec = _uptick(sector)
            if isinstance(names, (list, tuple, set)):
                for name in names:
                    t = _uptick(name)
                    if t and sec:
                        out[t] = sec
        if out:
            return out
    out = {}
    for ticker, sector in raw.items():
        t, s = _uptick(ticker), _uptick(sector)
        if t and s and isinstance(sector, (str, int)):
            out[t] = s
    return out


def load_sector_map(path=None) -> dict:
    """Return the ``{TICKER: SECTOR}`` map (JSON override, else built-in).

    Never hits the network. Resolution order:

    1. explicit ``path`` argument;
    2. ``INDIA_BOARD_SECTOR_MAP`` / ``SWING_SECTOR_MAP`` env var (a JSON file);
    3. :data:`BUILTIN_SECTOR_MAP`.

    A missing/corrupt override logs briefly and falls back to the built-in map.
    """
    candidate = path
    if candidate is None:
        for env_name in SECTOR_MAP_ENVS:
            candidate = os.environ.get(env_name)
            if candidate:
                break
    if candidate:
        try:
            data = json.loads(Path(candidate).read_text(encoding="utf-8"))
            parsed = _parse_sector_map(data)
            if parsed:
                return parsed
            print(f"[swing-emitters] sector map {candidate} had no usable entries",
                  flush=True)
        except Exception as exc:  # noqa: BLE001 — fall back, never raise
            print(f"[swing-emitters] sector map load failed: "
                  f"{type(exc).__name__}", flush=True)
    return dict(BUILTIN_SECTOR_MAP)


def _sector_strength(row: dict) -> float | None:
    """Strength metric for a sector row (explicit ``strength`` → ``chg_pct``)."""
    s = _num(row.get("strength"))
    if s is not None:
        return s
    chg = _num(row.get("chg_pct"))
    if chg is not None:
        return chg
    adv = _num(row.get("advancers"), 0.0) or 0.0
    dec = _num(row.get("decliners"), 0.0) or 0.0
    if adv + dec > 0:
        return (adv - dec) / (adv + dec) * 100.0
    return None


def _percentile(values: list[float], pct: float) -> float | None:
    """Nearest-rank percentile over finite values."""
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    n = len(vals)
    if n == 1:
        return vals[0]
    k = max(0, min(n - 1, math.ceil(pct / 100.0 * n) - 1))
    return vals[k]


def p7_sector_rotation(sector_rows, breadth, *, top_decile=None) -> list[dict]:
    """P7 sector-rotation detector (pure).

    Fires a ``LONG`` signal for every sector whose strength metric is in the
    top decile **and** whose breadth confirms:

    * market breadth (``breadth['pct_advancing']``) must not be negative when
      available (``None``/unavailable is allowed);
    * a sector carrying ``advancers``/``decliners`` must be net advancing.

    ``top_decile`` is an absolute strength threshold when supplied; otherwise
    the 90th percentile of the strengths seen is used. ``entry_ref`` is the
    sector's leader ``chg_pct`` when present (else ``None`` — the signal is
    still useful for measurement). ``side`` is always ``"LONG"``.
    """
    rows = [r for r in (sector_rows or []) if isinstance(r, dict)]
    if not rows:
        return []

    strengths = [_sector_strength(r) for r in rows]
    finite = [s for s in strengths if s is not None]
    if top_decile is None:
        threshold = _percentile(finite, 90.0) if len(finite) >= 2 else (
            finite[0] if finite else None
        )
    else:
        threshold = _num(top_decile)

    b = breadth if isinstance(breadth, dict) else {}
    pct_adv = _num(b.get("pct_advancing"))
    b_adv = _num(b.get("advancers"))
    b_dec = _num(b.get("decliners"))
    breadth_ok = pct_adv is None or pct_adv >= 50.0

    out: list[dict] = []
    for row, strength in zip(rows, strengths):
        if strength is None or strength <= 0:
            continue
        if threshold is not None and strength < threshold:
            continue
        if not breadth_ok:
            continue
        adv = _num(row.get("advancers"))
        dec = _num(row.get("decliners"))
        if adv is not None and dec is not None and adv < dec:
            continue
        sector = str(row.get("sector") or "").strip()
        if not sector:
            continue
        n_names = _num(row.get("n_names"))
        if n_names is None:
            n_names = _num(row.get("count"))
        if n_names is None and (adv is not None or dec is not None):
            n_names = (adv or 0.0) + (dec or 0.0)
        entry_ref = _num(row.get("top_chg"))
        features = {
            "sector": _uptick(sector),
            "strength": strength,
            "pct_advancing": pct_adv,
            "breadth_adv": b_adv,
            "breadth_dec": b_dec,
            "n_names": int(n_names) if n_names else None,
            "top_name": _uptick(row.get("top_name")) or None,
        }
        out.append(
            signal_log.make_signal(
                "P7",
                sector,
                side="LONG",
                features=features,
                entry_ref=entry_ref,
                source="scan",
                notes=f"sector rotation LONG; strength={strength:.2f}",
            )
        )

    out.sort(key=lambda r: _num((r.get("features") or {}).get("strength"), 0.0),
             reverse=True)
    return out


def build_sector_rows(scan_payload, *, sector_map=None) -> list[dict]:
    """Aggregate a scan payload into the ``sector_rows`` shape P7 consumes.

    Groups ``sections.rows`` (``ticker`` / ``chg_pct``) by sector and folds the
    ``sections.tape`` rows in as ΔOI/Δvol proxies (``oi_change`` → ``delta_oi``,
    ``volume`` → ``delta_vol``). Pure and testable; unknown tickers are skipped
    and tape rows only contribute to sectors already defined by a scan row.

    Each output row::

        {sector, chg_pct, strength, advancers, decliners, n_names,
         delta_oi, delta_vol, top_chg, top_name}
    """
    sm = sector_map if isinstance(sector_map, dict) and sector_map else load_sector_map()
    sections = (scan_payload or {}).get("sections") or {}
    rows = [r for r in (sections.get("rows") or []) if isinstance(r, dict)]
    tape = ((sections.get("tape") or {}).get("rows") or []) if isinstance(sections, dict) else []

    agg: dict[str, dict] = {}
    for row in rows:
        ticker = _uptick(row.get("ticker"))
        sector = sm.get(ticker)
        if not sector:
            continue
        acc = agg.setdefault(
            sector,
            {"chgs": [], "adv": 0, "dec": 0, "n": 0,
             "delta_oi": 0.0, "delta_vol": 0.0, "top_chg": None, "top_name": None},
        )
        acc["n"] += 1
        chg = _num(row.get("chg_pct"))
        if chg is not None:
            acc["chgs"].append(chg)
            if chg > 0:
                acc["adv"] += 1
            elif chg < 0:
                acc["dec"] += 1
            if acc["top_chg"] is None or chg > acc["top_chg"]:
                acc["top_chg"] = chg
                acc["top_name"] = ticker

    for item in tape:
        if not isinstance(item, dict):
            continue
        sector = sm.get(_uptick(item.get("ticker")))
        if not sector or sector not in agg:
            continue
        agg[sector]["delta_vol"] += _num(item.get("volume"), 0.0) or 0.0
        agg[sector]["delta_oi"] += _num(item.get("oi_change"), 0.0) or 0.0

    out: list[dict] = []
    for sector, acc in agg.items():
        chgs = acc["chgs"]
        mean = (sum(chgs) / len(chgs)) if chgs else None
        out.append(
            {
                "sector": sector,
                "chg_pct": mean,
                "strength": mean,
                "advancers": acc["adv"],
                "decliners": acc["dec"],
                "n_names": acc["n"],
                "delta_oi": acc["delta_oi"],
                "delta_vol": acc["delta_vol"],
                "top_chg": acc["top_chg"],
                "top_name": acc["top_name"],
            }
        )
    out.sort(
        key=lambda r: (
            r["strength"] is None,
            -(r["strength"] if r["strength"] is not None else 0.0),
        )
    )
    return out


# ---------------------------------------------------------------------------
# Dedupe ledger
# ---------------------------------------------------------------------------


def _bucket(now=None) -> str:
    """IST calendar-day dedupe bucket."""
    return _now(now).date().isoformat()


def _ledger_metric(record: dict):
    """The metric tracked for re-emit decisions, by playbook."""
    if not isinstance(record, dict):
        return None
    features = record.get("features") or {}
    playbook = str(record.get("playbook") or "").upper()
    if playbook == "P5":
        return _num(features.get("rollover_pct"))
    if playbook == "P6":
        return _num(features.get("vrp_pct"))
    if playbook == "P7":
        return _num(features.get("strength"))
    return None


def reset_ledger() -> None:
    """Clear the in-process dedupe ledger (used by tests)."""
    with _LEDGER_LOCK:
        _LEDGER.clear()


def apply_dedupe(record, *, now=None, metric=None,
                 change_threshold: float = REEMIT_CHANGE_THRESHOLD):
    """Dedupe ``record``; return it (possibly annotated) or ``None`` to skip.

    Keyed by ``(playbook, ticker_or_sector, side, day)``. The first emit of a
    key each day passes. A repeat passes only when the tracked metric moves by
    more than ``change_threshold`` (default 20%) versus the last emit, in which
    case ``features.reemit_of`` records the previous ``signal_id``.
    """
    if not isinstance(record, dict):
        return None
    key = (
        str(record.get("playbook") or "").upper(),
        _uptick(record.get("ticker")),
        _uptick(record.get("side")),
        _bucket(now),
    )
    m = _ledger_metric(record) if metric is None else metric
    with _LEDGER_LOCK:
        prev = _LEDGER.get(key)
        if prev is None:
            _LEDGER[key] = {"metric": m, "signal_id": record.get("signal_id")}
            return record
        if not _metric_changed(prev.get("metric"), m, change_threshold):
            return None
        features = record.setdefault("features", {})
        features["reemit_of"] = prev.get("signal_id")
        _LEDGER[key] = {"metric": m, "signal_id": record.get("signal_id")}
        return record


# ---------------------------------------------------------------------------
# run_once — detector orchestration (all external calls injectable)
# ---------------------------------------------------------------------------


def _default_tickers() -> list[str]:
    """Indices + the 20 liquid names from ``fyers_data.UNIVERSE``."""
    try:  # noqa: PLC0415
        import fyers_data  # type: ignore

        return [str(t) for t in fyers_data.UNIVERSE]
    except Exception:  # noqa: BLE001
        return ["NIFTY", "BANKNIFTY"]


def _default_rollover_fn(ticker: str) -> dict:
    """Live wrapper returning ``{"rollover": ..., "basis": ...}``."""
    return {
        "rollover": rollover_data.rollover_series(ticker),
        "basis": rollover_data.basis_snapshot(ticker),
    }


def _hv20(ticker: str) -> float | None:
    """Annualised 20-day close-to-close realised vol (decimal), best-effort."""
    try:  # noqa: PLC0415
        import fyers_data  # type: ignore

        end = datetime.now(IST).date()
        start = end - timedelta(days=45)
        candles = fyers_data.get_history(
            ticker, "D", start.isoformat(), end.isoformat()
        )
    except Exception:  # noqa: BLE001
        return None
    closes = [
        _num(c[4])
        for c in (candles or [])
        if isinstance(c, (list, tuple)) and len(c) >= 5
    ]
    closes = [c for c in closes if c and c > 0]
    if len(closes) < 21:
        return None
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
    rets = rets[-20:]
    if len(rets) < 2:
        return None
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var) * math.sqrt(252.0)


def _default_greeks_fn(ticker: str) -> dict:
    """Live wrapper returning a ``greeks_data.summarize`` bundle."""
    try:  # noqa: PLC0415
        import fyers_data  # type: ignore
        import greeks_data  # type: ignore
    except ImportError:  # pragma: no cover
        return {}
    chain = fyers_data.get_chain(ticker, greeks=True)
    return greeks_data.summarize(ticker, chain, hv20=_hv20(ticker))


def _call_rollover(fn, ticker: str):
    """Normalise ``rollover_fn`` output to ``(rollover, basis)`` or ``None``."""
    try:
        res = fn(ticker)
    except Exception:  # noqa: BLE001 — one bad ticker never aborts a cycle
        return None
    if res is None:
        return None
    if isinstance(res, dict):
        if "rollover" in res or "basis" in res:
            roll, basis = res.get("rollover"), res.get("basis")
            if roll is None and basis is None:
                return None
            return (roll if isinstance(roll, dict) else {},
                    basis if isinstance(basis, dict) else {})
        return (res, {})
    if isinstance(res, (list, tuple)) and len(res) >= 2:
        a, b = res[0], res[1]
        return (a if isinstance(a, dict) else {}, b if isinstance(b, dict) else {})
    return None


def _call_greeks(fn, ticker: str):
    """Normalise ``greeks_fn`` output to ``(iv_metrics, vrp)`` or ``None``."""
    try:
        res = fn(ticker)
    except Exception:  # noqa: BLE001
        return None
    if res is None:
        return None
    if isinstance(res, dict):
        if "iv_metrics" in res:
            iv = res.get("iv_metrics") or {}
            v = res.get("vrp") or {}
            return (_attach_ticker(iv, ticker, res), v if isinstance(v, dict) else {})
        iv = res.get("iv")
        v = res.get("vrp")
        if isinstance(iv, dict) or isinstance(v, dict):
            iv = iv if isinstance(iv, dict) else {}
            v = v if isinstance(v, dict) else {}
            return (_attach_ticker(iv, ticker, res), v)
        # A single merged dict (iv metrics + vrp keys).
        return (_attach_ticker(res, ticker, res), res)
    if isinstance(res, (list, tuple)) and len(res) >= 2:
        a, b = res[0], res[1]
        return (a if isinstance(a, dict) else {}, b if isinstance(b, dict) else {})
    return None


def _attach_ticker(iv: dict, ticker: str, bundle: dict) -> dict:
    """Copy ``iv`` and guarantee a ticker for the P6 record."""
    out = dict(iv) if isinstance(iv, dict) else {}
    if not (out.get("ticker") or out.get("underlying")):
        out["ticker"] = (bundle or {}).get("ticker") or ticker
    rank = (bundle or {}).get("iv_rank")
    if rank is not None and out.get("iv_rank") is None:
        out["iv_rank"] = rank
    return out


def _chain_lookup(chains):
    """Return ``fn(ticker) -> chain|None`` from an injected ``chains`` source."""
    if chains is None:
        return lambda _t: None
    if callable(chains):
        return chains
    if isinstance(chains, dict):
        return lambda t: chains.get(t)
    return lambda _t: None


def _default_scan():
    """Live scan payload (served from cache; never blocks for minutes)."""
    try:  # noqa: PLC0415
        import scan_data  # type: ignore

        return scan_data.build_scan()
    except Exception:  # noqa: BLE001
        return None


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


def run_once(tickers=None, *, chains=None, rollover_fn=None, greeks_fn=None,
             scan=None, now=None) -> dict:
    """Evaluate P5/P6 (per ticker) and P7 (per sector) once; log what fires.

    Injectability contract:

    * ``rollover_fn(ticker)`` → ``{"rollover": ..., "basis": ...}`` (or a
      ``(rollover, basis)`` pair). Defaults to the live ``rollover_data`` path.
    * ``greeks_fn(ticker)`` → a ``greeks_data.summarize`` bundle (or an
      ``(iv_metrics, vrp)`` pair). Defaults to the live chain+history path.
    * ``chains`` → mapping (or callable) of ticker → next-expiry chain, used
      for the P5 same-strike OI-build gate.
    * ``scan`` → a pre-built scan payload for P7. Defaults to
      ``scan_data.build_scan()``.

    Live Fyers usage is sequential and budget-capped (:data:`MAX_CHAIN_CALLS`);
    when any default function is used the ticker list is rotated and trimmed to
    :data:`MAX_LIVE_TICKERS`. Returns counts plus the emitted records.
    """
    cur = _now(now)
    tickers = [
        _uptick(t)
        for t in (tickers if tickers is not None else _default_tickers())
    ]
    tickers = [t for t in tickers if t]

    using_default = rollover_fn is None or greeks_fn is None
    if using_default:
        global _TICKER_CURSOR
        if tickers:
            full = len(tickers)
            start = _TICKER_CURSOR % full
            work = (tickers[start:] + tickers[:start])[:MAX_LIVE_TICKERS]
            _TICKER_CURSOR = (start + len(work)) % full
            tickers = work

    roll_fn = rollover_fn or _default_rollover_fn
    greek_fn = greeks_fn or _default_greeks_fn
    chain_fn = _chain_lookup(chains)

    counts = {"P5": 0, "P6": 0, "P7": 0}
    skipped = 0
    emitted: list[dict] = []

    def _emit(record):
        nonlocal skipped
        if record is None:
            return
        kept = apply_dedupe(record, now=cur)
        if kept is None:
            skipped += 1
            return
        if signal_log.log_signal(kept, root=_pytest_signal_root()):
            emitted.append(kept)

    for ticker in tickers:
        # --- P5 -----------------------------------------------------------
        pair = _call_rollover(roll_fn, ticker)
        if pair is not None:
            roll, basis = pair
            try:
                rec = p5_rollover(roll, basis, next_chain=chain_fn(ticker))
            except Exception:  # noqa: BLE001 — detector bug never kills a cycle
                rec = None
            if rec is not None:
                counts["P5"] += 1
            _emit(rec)

        # --- P6 -----------------------------------------------------------
        greek = _call_greeks(greek_fn, ticker)
        if greek is not None:
            iv_metrics, vrp = greek
            try:
                rec = p6_vrp_premium(iv_metrics, vrp)
            except Exception:  # noqa: BLE001
                rec = None
            if rec is not None:
                counts["P6"] += 1
            _emit(rec)

    # --- P7 ---------------------------------------------------------------
    payload = scan if scan is not None else _default_scan()
    if payload:
        section = payload.get("sections") or {}
        sector_rows = build_sector_rows(payload)
        breadth = section.get("breadth") or {}
        for rec in p7_sector_rotation(sector_rows, breadth):
            counts["P7"] += 1
            _emit(rec)

    print(
        f"[swing-emitters] cycle: P5={counts['P5']} "
        f"P6={counts['P6']} P7={counts['P7']}",
        flush=True,
    )
    return {
        "ts": cur.isoformat(),
        "P5": counts["P5"],
        "P6": counts["P6"],
        "P7": counts["P7"],
        "emitted": len(emitted),
        "skipped": skipped,
        "signals": emitted,
    }


# ---------------------------------------------------------------------------
# Scheduler — low frequency, market-hours only
# ---------------------------------------------------------------------------


def _env_interval() -> float:
    """Scheduler interval (seconds), honouring ``SWING_EMITTER_INTERVAL_SEC``."""
    try:
        return float(os.environ.get("SWING_EMITTER_INTERVAL_SEC", _DEFAULT_INTERVAL))
    except (TypeError, ValueError):
        return float(_DEFAULT_INTERVAL)


#: Interval snapshot at import (the loop re-reads the env each cycle).
SWING_EMITTER_INTERVAL_SEC = _env_interval()


def _is_market_open(now=None) -> bool:
    """True during Mon-Fri 09:15-15:30 IST."""
    cur = _now(now)
    if cur.weekday() >= 5:
        return False
    mins = cur.hour * 60 + cur.minute
    return 9 * 60 + 15 <= mins <= 15 * 60 + 30


def _run_due(now=None) -> bool:
    """Run one cycle when market-open and the interval has elapsed."""
    global _LAST_RUN_TS
    cur = _now(now)
    if not _is_market_open(cur):
        return False
    interval = _env_interval()
    if _LAST_RUN_TS > 0 and (cur.timestamp() - _LAST_RUN_TS) < interval:
        return False
    try:
        run_once(now=cur)
    except Exception as exc:  # noqa: BLE001 — never kill the loop
        print(f"[swing-emitters] cycle error: {type(exc).__name__}: {exc}"[:160],
              flush=True)
        _LAST_RUN_TS = cur.timestamp()
        return False
    _LAST_RUN_TS = cur.timestamp()
    return True


def _loop() -> None:
    print(f"[swing-emitters] scheduler started "
          f"(interval {_env_interval():.0f}s, tick {_SCHED_TICK}s)", flush=True)
    while True:
        try:
            _run_due()
        except Exception as exc:  # noqa: BLE001
            print(f"[swing-emitters] scheduler error: "
                  f"{type(exc).__name__}: {exc}"[:160], flush=True)
        time.sleep(_SCHED_TICK)


def ensure_started() -> None:
    """Start the swing-emitter scheduler once (idempotent, daemon thread)."""
    global _STARTED
    if _STARTED:
        return
    _STARTED = True
    threading.Thread(target=_loop, name="swing-emitters", daemon=True).start()


if __name__ == "__main__":  # pragma: no cover — manual smoke only
    if len(sys.argv) > 1 and sys.argv[1] == "--once":
        print(json.dumps(run_once(), indent=2, default=str)[:4000])
    else:
        print("usage: signal_emitters_swing.py --once  (network-free otherwise)")
