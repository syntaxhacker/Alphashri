"""Nifty options report backend.

Endpoints (all under the shared ``/api/reports`` prefix):
  - ``GET  /api/reports/nifty/live?expiry=YYYY-MM-DD`` — on-demand report built
    from the live Upstox option chain (5s in-memory TTL).
  - ``GET  /api/reports/nifty?date=YYYY-MM-DD`` — serve a saved snapshot from
    ``experiments/data/nifty_reports/{date}.json`` (404 envelope when missing).
  - ``POST /api/reports/nifty/snapshot`` — build a snapshot (same computation
    as live, plus timeline skeleton / snapshot_at / source) and persist it.
  - ``GET  /api/reports/nifty/replay?date=YYYY-MM-DD[&t=ISO]`` — per-minute
    FULL report snapshots recorded by the background tape tick into
    ``experiments/data/nifty_snapshots/{date}.jsonl`` (replay source).

Upstox access goes through :mod:`api.options` helpers, imported lazily inside
the handlers so this module stays import-light (and cycle-free).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Mapping, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import config
from api.auth import get_current_user
from api.reports_api._dates import validate_date
from api.reports_api._numeric import safe_float as _safe_float, safe_int as _safe_int
from api.reports_api._time import today_str as _today_str
from api.reports_api.desk_trades import router as desk_trades_router
from api.reports_api.nifty_intel import router as nifty_intel_router
from api.reports_api.nifty_fuel import basis_text, fuel_state, structure_evidence, setup_for_burst
from api.reports_api.nifty_bursts import (
    NEWS_WINDOW_MIN,
    OI_BURST_MIN_ABS,
    OI_BURST_WINDOW,
    attach_news,
    coalesce_bursts,
    derive_oi_signal,
    detect_coiling,
    detect_oi_bursts,
    detect_premium_moves,
    detect_squeezes,
    detect_strike_bursts,
    session_trend,
)
from api.reports_api.nifty_positioning import compute_positioning

router = APIRouter(prefix="/api/reports", tags=["reports-nifty"])
router.include_router(desk_trades_router)
router.include_router(nifty_intel_router)

#: The recorder's failures are logged, not swallowed: the API log is the only
#: place a dead/half-dead tape shows up (2026-10-22: a 401 took the tape blind
#: for ten minutes and nothing said why).
logger = logging.getLogger(__name__)

# stock-screener-ui/api/reports_api/nifty.py -> parents[2] == stock-screener-ui
SNAPSHOT_DIR = Path(__file__).resolve().parent.parent.parent / "experiments" / "data" / "nifty_reports"

#: ``read_snapshot`` parse cache keyed by path, validated on (mtime_ns, size):
#: ``GET /nifty`` polls every 1-2s while the snapshot is rewritten every 20s.
_SNAPSHOT_READ_CACHE: dict[str, tuple[int, int, dict]] = {}
#: ``_with_delta_flip`` projection cache, same key. Re-deriving positioning/gex
#: on every 1-2s poll was pure recomputation of a file that changes every 20s.
_DERIVED_SNAPSHOT_CACHE: dict[str, tuple[int, int, dict]] = {}

_LIVE_TTL = 5
_live_cache: dict[str, dict] = {}
_sensex_cache: dict[str, dict] = {}
#: yfinance 15m candles change at most once per 15-min bar, so a 5s report TTL
#: must NOT refetch Yahoo every 5s (slow + rate-limited). 60s is plenty.
_CANDLES_TTL = 60
_candles_cache: dict[str, dict] = {}

_TOP_WALLS = 3
#: An actionable wall is within this many points of spot; beyond it the strike
#: is book structure, not an intraday level.
WALL_NEAR_DIST_PTS = 300.0

#: Reuse the 10s chain poller's frame instead of issuing a second REST chain
#: call when the frame is at most this old. The poller writes every 10s, so a
#: healthy frame is 0-12s old; 30s tolerates one dropped fetch without letting a
#: dead poller serve a stale ladder.
CHAIN10S_REUSE_MAX_AGE_SEC = float(
    os.getenv("NIFTY_CHAIN_REUSE_MAX_AGE_SEC", "30"))
#: Wall-clock interval for the background snapshot rebuild. The build is cheap
#: when it reuses the chain10s frame, so 20s keeps ``snapshot_at`` well inside
#: the 35s target (the old fixed 60s sleep + a ~50s REST chain = ~110s cadence).
SNAPSHOT_REFRESH_SEC = float(os.getenv("NIFTY_SNAPSHOT_REFRESH_SEC", "20"))


# ---------------------------------------------------------------------------
# Pure helpers (unit-testable, no I/O)
# ---------------------------------------------------------------------------

def has_usable_chain(rows: Optional[list[dict]]) -> bool:
    """True when ``rows`` describe a real chain (strikes + non-zero OI).

    An empty ``strikes`` list or an all-zero-OI chain is a failed/empty
    upstream fetch, never a market state. Persisting it writes a report whose
    ``gex.net_total`` is 0 / ``regime`` is "flat" / ``max_pain`` is 0, which
    then gets differenced against real rows by the burst detectors and looks
    like a huge one-minute OI collapse. Both the live path and the recorder
    gate on this.
    """
    if not rows:
        return False
    total_oi = 0
    for r in rows:
        if not isinstance(r, dict):
            continue
        total_oi += _safe_int((r.get("ce") or {}).get("oi"))
        total_oi += _safe_int((r.get("pe") or {}).get("oi"))
        if total_oi:
            return True
    return False


#: NSE Closing Auction Session (since 3 Aug 2026): continuous F&O-stock
#: trading ends at 15:15 IST, the index print is frozen 15:15–15:35 (no
#: continuous matching), the official close is the CAS print (~15:35), and
#: the spot stays fixed through the 15:40 F&O close.
CAS_START_MIN = 15 * 60 + 15
CAS_END_MIN = 15 * 60 + 35  # cash CAS ends 15:35 IST (after which spot is frozen); derivatives continue until 15:40
SPOT_FROZEN_END_MIN = 15 * 60 + 40


def is_cas_window(now: Optional[datetime] = None) -> bool:
    """True when ``now`` (IST) falls in the 15:15–15:35 CAS freeze window.

    Naive datetimes are assumed IST; aware ones are converted. Never raises.
    """
    try:
        ts = now or datetime.now(config.IST)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=config.IST)
        else:
            ts = ts.astimezone(config.IST)
        mins = ts.hour * 60 + ts.minute
        return CAS_START_MIN <= mins < CAS_END_MIN
    except Exception:
        return False


def get_sentiment(price_change: float, oi_change: int) -> dict:
    """Map price/OI changes to a buildup label (delegates to api.options)."""
    from api.options import get_option_sentiment
    return get_option_sentiment(price_change, oi_change)


def compute_pcr(pe_total: float, ce_total: float) -> Optional[float]:
    """Put-call ratio; ``None`` when there is no call base to divide by.

    A zero call base is not a PCR of 0.00 — it is an unknown ratio, and
    printing 0.00 made the tape look like a pure put book.
    """
    if not ce_total:
        return None
    return round(pe_total / ce_total, 2)


def compute_max_pain(strikes: list[dict]) -> float:
    """Max-pain strike over rows of ``{strike, ce_oi, pe_oi}``.

    Total writer payout if the underlying expired at each candidate strike;
    the minimum-payout strike wins. Ties resolve to the lowest strike.

    The computation runs over the WHOLE chain passed in — the caller decides
    the scope and reports it (``max_pain_scope_pts``). Truncating the chain
    to a ±window around spot moved the level to a strike that is not the
    chain's pain point, so the scope is now explicit instead of implied.
    """
    if not strikes:
        return 0.0
    if not any(_safe_int(r.get("ce_oi")) + _safe_int(r.get("pe_oi"))
               for r in strikes):
        # No open interest anywhere: there is no pain level to report. Returning
        # the lowest strike here would look like a real (and wildly wrong) level.
        return 0.0
    ordered = sorted(strikes, key=lambda r: r["strike"])
    best_strike = ordered[0]["strike"]
    min_loss = float("inf")
    for cand in ordered:
        t = cand["strike"]
        loss = 0.0
        for row in ordered:
            s = row["strike"]
            if t > s:
                loss += (t - s) * row.get("ce_oi", 0)
            elif t < s:
                loss += (s - t) * row.get("pe_oi", 0)
        if loss < min_loss:
            min_loss = loss
            best_strike = t
    return best_strike


def build_leg(market_data: dict, greeks: Optional[dict] = None,
              instrument_key: Optional[str] = None) -> dict:
    """Flatten one side's Upstox leg into the report shape — **everything**.

    Upstox serves, per leg: ``market_data`` (ltp, close, oi, prev_oi, volume,
    bid/ask + quantities, total buy/sell qty, last trade) and ``option_greeks``
    (delta, gamma, theta, vega, iv, rho). This keeps **all** of it so the
    snapshot log is a complete record and theta/vega are available later
    (previously only gamma/delta/iv survived).
    """
    md = market_data or {}
    ltp = _safe_float(md.get("ltp"))
    close_price = _safe_float(md.get("close_price", ltp))
    oi = _safe_int(md.get("oi"))
    prev_oi = _safe_int(md.get("prev_oi"))
    volume = _safe_int(md.get("volume"))
    oi_change = oi - prev_oi
    price_change = round(ltp - close_price, 2)
    g = greeks if greeks is not None else (md.get("option_greeks") or {})

    def _opt_float(key):
        v = (md or {}).get(key)
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    def _greek(key):
        v = (g or {}).get(key)
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    return {
        "instrument_key": instrument_key,
        "ltp": ltp,
        "close_price": close_price,
        "oi": oi,
        "prev_oi": prev_oi,
        "oi_change": oi_change,
        "volume": volume,
        "price_change": price_change,
        "sentiment": get_sentiment(price_change, oi_change),
        # --- greeks: ALL of them ---
        "gamma": _safe_float((g or {}).get("gamma")),
        "delta": _greek("delta"),
        "theta": _greek("theta"),
        "vega": _greek("vega"),
        "rho": _greek("rho"),
        "iv": _greek("iv"),
        "pop": _greek("pop"),        # probability of profit (Upstox option_greeks)
        # --- order-book / flow fields Upstox provides ---
        "bid_price": _opt_float("bid_price"),
        "ask_price": _opt_float("ask_price"),
        "bid_qty": _safe_int(md.get("bid_qty")),
        "ask_qty": _safe_int(md.get("ask_qty")),
        "buy_qty": _safe_int(md.get("total_buy_quantity")),
        "sell_qty": _safe_int(md.get("total_sell_quantity")),
        "last_trade_price": _opt_float("last_trade_price"),
        "last_trade_qty": _safe_int(md.get("last_trade_qty")),
    }


def parse_chain_payload(payload: dict) -> tuple[str, float, list[dict]]:
    """Parse a raw Upstox ``/option/chain`` payload into (expiry, spot, rows)."""
    items = payload.get("data", []) or []
    expiry = items[0].get("expiry", "") if items else ""
    spot = _safe_float(payload.get("underlying_spot_price")) or (
        _safe_float(items[0].get("underlying_spot_price")) if items else 0.0
    )
    rows = []
    for item in items:
        strike = _safe_float(item.get("strike_price"))
        call_opts = item.get("call_options") or {}
        put_opts = item.get("put_options") or {}
        call_md = call_opts.get("market_data", {})
        put_md = put_opts.get("market_data", {})
        call_greeks = call_opts.get("option_greeks") or {}
        put_greeks = put_opts.get("option_greeks") or {}
        rows.append({"strike": strike,
                     "ce": build_leg(call_md, call_greeks,
                                     call_opts.get("instrument_key")),
                     "pe": build_leg(put_md, put_greeks,
                                     put_opts.get("instrument_key"))})
    rows.sort(key=lambda r: r["strike"])
    return expiry, spot, rows


def top_walls(rows: list[dict], side: str, n: int = _TOP_WALLS,
              spot: Optional[float] = None,
              max_dist: Optional[float] = None) -> list[dict]:
    """Top-``n`` strikes by OI for side ``'ce'`` / ``'pe'``.

    With ``spot``/``max_dist`` the ranking is limited to strikes within
    ``max_dist`` points of spot — a far wall is book structure, not an
    intraday level. Every entry carries its distance from spot.
    """
    pool = rows
    if spot and max_dist:
        pool = [r for r in rows if abs(float(r.get("strike", 0)) - float(spot)) <= float(max_dist)]
    ranked = sorted(pool, key=lambda r: r.get(side, {}).get("oi", 0), reverse=True)
    out = []
    for r in ranked[:n]:
        oi = r[side]["oi"]
        entry = {"strike": r["strike"], "oi": oi}
        if spot:
            entry["distance"] = round(float(r["strike"]) - float(spot), 2)
        out.append(entry)
    return out


def near_walls(rows: list[dict], side: str, n: int = _TOP_WALLS,
               spot: Optional[float] = None,
               max_dist: Optional[float] = WALL_NEAR_DIST_PTS) -> list[dict]:
    """Heaviest OI near spot (falls back to the unrestricted ranking)."""
    if not spot:
        return top_walls(rows, side, n)
    near = top_walls(rows, side, n, spot=spot, max_dist=max_dist)
    return near or top_walls(rows, side, n, spot=spot)


def _top_wall_strike(walls: Any, side: str) -> Optional[float]:
    """Top strike from a ``walls`` / ``walls_near`` block (``calls``/``puts``).

    Returns ``None`` for a missing/empty block so the tape records an explicit
    ``null`` instead of a fake 0 strike.
    """
    try:
        entries = (walls or {}).get(side) or []
        if entries and isinstance(entries[0], dict):
            strike = _safe_float(entries[0].get("strike"))
            return strike or None
    except Exception:
        pass
    return None


def _fetch_nifty_candles(date_str: str, walkback_days: int = 0) -> list[dict]:
    """15m Nifty candles for ``date_str`` via yfinance (^NSEI).

    Upstox intraday endpoints return no rows for the NSE index, so the
    report chart uses yfinance. Never raises — returns [] on any failure.
    With ``walkback_days`` > 0, retries previous calendar days so a
    pre-market/holiday session still charts the latest trading day.
    """
    try:
        import yfinance as yf
    except ImportError:
        return []
    try:
        from datetime import timedelta
        day = datetime.strptime(date_str, "%Y-%m-%d")
        for back in range(walkback_days + 1):
            target = (day - timedelta(days=back)).strftime("%Y-%m-%d")
            nxt = (day - timedelta(days=back - 1)).strftime("%Y-%m-%d")
            df = yf.download("^NSEI", start=target, end=nxt,
                             interval="15m", progress=False, auto_adjust=False)
            if df is None or len(df) == 0:
                continue
            # Flatten MultiIndex columns (^NSEI single ticker)
            if hasattr(df.columns, "droplevel"):
                try:
                    df.columns = df.columns.droplevel(1)
                except (ValueError, IndexError):
                    pass
            out = []
            for ts, row in df.iterrows():
                out.append({
                    "time": ts.isoformat(),
                    "open": round(float(row["Open"]), 2),
                    "high": round(float(row["High"]), 2),
                    "low": round(float(row["Low"]), 2),
                    "close": round(float(row["Close"]), 2),
                    "volume": int(row.get("Volume", 0) or 0),
                })
            if out:
                return out
        return []
    except Exception:
        return []


def _fetch_nifty_candles_cached(date_str: str, walkback_days: int = 0) -> list[dict]:
    """``_fetch_nifty_candles`` behind a short TTL.

    The report TTL is 5s but the 15-minute candles only change once per bar,
    so without this Yahoo would be hit every 5s per report refresh.
    """
    key = f"{date_str}:{walkback_days}"
    now = time.time()
    hit = _candles_cache.get(key)
    if hit and now - hit["ts"] < _CANDLES_TTL:
        return hit["data"]
    data = _fetch_nifty_candles(date_str, walkback_days)
    _candles_cache[key] = {"ts": now, "data": data}
    return data


#: Largest distance (as a share of spot) at which a cumulative-gamma zero
#: crossing is accepted as the flip level. The cumulative sum starts at ~0 at
#: the deepest listed strike, so the first strike cluster that carries any real
#: exposure can "cross" without describing a tradeable pivot — on 2026-10-21
#: that artefact sat at 21,550, 1,402 pts below a 22,952 spot. A crossing
#: outside this band is not reported at all.
GEX_FLIP_MAX_DIST_PCT = 0.05

#: Minimum |net_gex| for a strike to be reported as a support/resistance/fuel
#: level, as a share of the profile's largest |net_gex|. Far-OTM wings carry
#: greeks that round to a few paise of Cr (e.g. +0.07 at 21,000 under a 22,962
#: spot) — large enough to win "largest positive below spot" but meaningless as
#: a level. Below this share the side reports ``None`` and the UI renders ``—``.
GEX_LEVEL_MIN_SHARE = 0.10

#: Largest distance (as a share of spot) at which a support/resistance/fuel
#: level is accepted. A wing 5%+ away cannot be the level that pins or fuels
#: the current move, even when its gamma is real.
GEX_LEVEL_MAX_DIST_PCT = 0.05


def _gex_level(entry: dict, side: str) -> dict:
    """Spot-relative level row: strike, net gamma, and which side of spot."""
    return {"strike": entry["strike"], "net_gex": entry["net_gex"], "side": side}


def compute_gex(rows: list[dict], spot: float, lot_size: int = 65) -> dict:
    """Simplified dealer gamma exposure (GEX) per strike, in Cr per point.

    Formula (per strike)::

        call_gex = gamma_ce * oi_ce * spot / 1e7   (positive)
        put_gex  = -(gamma_pe * oi_pe * spot / 1e7) (negative)
        net_gex  = call_gex + put_gex

    ``lot_size`` is accepted for backwards compatibility but **not applied**:
    Upstox reports option OI in units (shares), so multiplying by the lot again
    inflated every Cr figure 65×. Evidence: the same chain's ``walls`` block
    carries OI of ~10-15M units at the ATM strikes (13,599,300 at 23,000 CE on
    2026-10-21) — 209k contracts at lot 65, a plausible Nifty ATM OI. At 13.6M
    *contracts* the single strike would represent 884M shares, larger than the
    entire index's notional. The delta-positioning block next to it
    (``nifty_positioning.py``) dropped the same multiplier.

    Convention: customer long puts leave dealers short gamma, so the put
    leg is expressed NEGATIVE and ``net_gex`` is the signed sum. ``net_total``
    is the sum of ``net_gex`` across strikes (the whole book — *not* the
    exposure at spot). ``regime`` is the sign of the cumulative net gamma **up
    to spot**, i.e. the same side of the flip that spot trades on: ``"long"``
    when that cumulative is positive (dampens moves / pins spot), ``"short"``
    when negative (amplifies moves), and ``"flat"`` when ``|cum_at_spot| < 1.0``.
    Deriving it from ``net_total`` used to label a spot *below* the flip as
    "long gamma", contradicting the flip level shown beside it.

    ``top_positive`` (top-2 by net_gex) / ``top_negative`` (bottom-2) are the
    raw global extrema, kept for backwards compatibility. The actionable text
    lives in ``levels``, which is **spot-relative**:

    * ``support`` — largest positive net gamma **at/below** spot (pin magnet
      that gets bought)
    * ``resistance`` — largest positive net gamma **at/above** spot (pin magnet
      that gets sold into)
    * ``fuel_down`` — most negative net gamma **at/below** spot (below-spot
      acceleration; never a support level)
    * ``fuel_up`` — most negative net gamma **at/above** spot (upside squeeze
      fuel; never a resistance level)

    Each level is ``{strike, net_gex, side}`` with ``side`` ``"above"`` /
    ``"below"``, or ``None`` when no strike on that side qualifies. A strike
    must clear ``GEX_LEVEL_MIN_SHARE`` of the profile's peak |net_gex| and sit
    within ``GEX_LEVEL_MAX_DIST_PCT`` of spot; otherwise it is a wing artefact
    (the 2026-10-21 +0.07 at 21,000) and the level is ``None``.

    ``zero_cross`` is the **sustained negative → positive** zero crossing of the
    ascending cumulative net_gex, closest to spot and no further than
    ``GEX_FLIP_MAX_DIST_PCT``; otherwise ``None``. A positive → negative cross
    is a put wall, not a flip, and a leading-wing artefact outside the band is
    discarded. A crossing that disagrees with the cumulative sign at spot is
    also dropped, so the flip and ``regime`` can never contradict each other.
    Pure function, no network. All floats rounded to 2 decimals.

    Degraded mode: when the chain is usable (non-empty, non-zero OI) but
    Upstox returned no gamma for any leg, a gamma-weighted sum is identically
    zero and the report would claim ``net_total: 0 / regime: "flat"`` for a
    perfectly good chain. In that case the per-strike OI itself is used as the
    signed exposure proxy (calls positive, puts negative), which preserves the
    sign convention and the shape while keeping the block meaningful.

    The proxy is scaled like the real thing — ``OI × spot / 1e7``, i.e. the
    same Cr conversion with the (missing) gamma factor dropped — so the two
    live on one axis instead of the proxy being raw unit counts next to Cr
    figures. Because it is still a proxy, the block is flagged
    ``degraded: true`` and the callers must not present it as a gamma
    profile: the tape row therefore records ``net_gex`` / ``flip`` as ``None``
    for a degraded block instead of writing a fabricated flip into the day's
    log.
    """
    spot_f = _safe_float(spot)
    # A zero spot makes every gamma term zero, which would report "flat" for a
    # live chain. Fall back to the median strike as the scale reference.
    strikes = sorted(_safe_float((r or {}).get("strike")) for r in (rows or []))
    strikes = [s for s in strikes if s > 0]
    if spot_f <= 0 and strikes:
        spot_f = strikes[len(strikes) // 2]
    has_gamma = any(
        _safe_float(((r or {}).get("ce") or {}).get("gamma"))
        or _safe_float(((r or {}).get("pe") or {}).get("gamma"))
        for r in (rows or [])
    )
    per = []
    for r in rows or []:
        ce = r.get("ce", {}) or {}
        pe = r.get("pe", {}) or {}
        g_ce = _safe_float(ce.get("gamma"))
        g_pe = _safe_float(pe.get("gamma"))
        oi_ce = _safe_int(ce.get("oi"))
        oi_pe = _safe_int(pe.get("oi"))
        if has_gamma:
            call_gex = round(g_ce * oi_ce * spot_f / 1e7, 2)
            put_gex = round(-g_pe * oi_pe * spot_f / 1e7, 2)
        else:
            # No greeks anywhere: OI is the only exposure signal available.
            # Scaled like the real GEX (gamma dropped, same Cr conversion).
            call_gex = round(oi_ce * spot_f / 1e7, 2)
            put_gex = round(-oi_pe * spot_f / 1e7, 2)
        net_gex = round(call_gex + put_gex, 2)
        per.append({"strike": r.get("strike", 0.0), "call_gex": call_gex,
                    "put_gex": put_gex, "net_gex": net_gex})
    per.sort(key=lambda e: e["strike"])
    net_total = round(sum(e["net_gex"] for e in per), 2)
    by_desc = sorted(per, key=lambda e: e["net_gex"], reverse=True)
    by_asc = sorted(per, key=lambda e: e["net_gex"])
    top_positive = [{"strike": e["strike"], "net_gex": e["net_gex"]} for e in by_desc[:2]]
    top_negative = [{"strike": e["strike"], "net_gex": e["net_gex"]} for e in by_asc[:2]]
    # Spot-relative levels. A positive-gamma strike is a pin magnet on whichever
    # side it sits; a negative-gamma strike is acceleration/fuel, never support
    # or resistance. Naming a strike by its sign alone (old ``top_positive`` /
    # ``top_negative``) put 23,200 "support" above a 22,952 spot on 2026-10-21.
    #
    # Significance + distance gates: the largest |net_gex| in the book sets the
    # scale; a wing that carries <10% of it (or sits >5% from spot) is noise,
    # not a level. Without the magnitude gate, a +0.07 Cr strike 1,963 pts below
    # spot won "largest positive below spot" and rendered as "γ support 21,000".
    peak_abs = max((abs(e["net_gex"]) for e in per), default=0.0)
    min_abs = peak_abs * GEX_LEVEL_MIN_SHARE
    max_dist = spot_f * GEX_LEVEL_MAX_DIST_PCT if spot_f > 0 else 0.0
    near = [e for e in per if max_dist <= 0 or abs(e["strike"] - spot_f) <= max_dist]
    below = [e for e in near if e["strike"] <= spot_f]
    above = [e for e in near if e["strike"] >= spot_f]

    def _pick(entries: list[dict], sign: int) -> Optional[dict]:
        pool = [e for e in entries
                if e["net_gex"] * sign > 0 and abs(e["net_gex"]) >= min_abs]
        if not pool:
            return None
        if sign > 0:
            return max(pool, key=lambda e: e["net_gex"])
        return min(pool, key=lambda e: e["net_gex"])

    support = _pick(below, 1)
    resistance = _pick(above, 1)
    fuel_down = _pick(below, -1)
    fuel_up = _pick(above, -1)
    levels = {
        "support": _gex_level(support, "below") if support else None,
        "resistance": _gex_level(resistance, "above") if resistance else None,
        "fuel_down": _gex_level(fuel_down, "below") if fuel_down else None,
        "fuel_up": _gex_level(fuel_up, "above") if fuel_up else None,
    }

    # Gamma flip: the sustained negative → positive crossing closest to spot.
    # Only a negative → positive cross is a flip (below it the book is put
    # heavy, above it calls dominate); a positive → negative cross is a put
    # wall. A crossing further than GEX_FLIP_MAX_DIST_PCT from spot is a wing
    # artefact, not a level, so it is dropped rather than reported.
    # A DEGRADED block (no gamma anywhere) has no gamma flip at all: the
    # crossing would be an OI artefact, so none is reported.
    crossings: list[float] = []
    cum = 0.0
    cum_at_spot = 0.0
    prev = None
    for e in per:
        cum = round(cum + e["net_gex"], 2)
        if e["strike"] <= spot_f:
            cum_at_spot = cum
        if prev is not None and prev < 0 <= cum:
            crossings.append(e["strike"])
        prev = cum
    zero_cross = None
    if crossings and cum >= 0 and has_gamma:
        max_flip_dist = spot_f * GEX_FLIP_MAX_DIST_PCT
        candidates = [s for s in crossings if abs(s - spot_f) <= max_flip_dist]
        if candidates:
            zero_cross = min(candidates, key=lambda s: abs(s - spot_f))

    # Regime = cumulative sign at spot (the side of the flip spot trades on),
    # never ``net_total``: a book can be net long overall while spot sits below
    # the flip (short gamma there), which made the panel self-contradictory.
    # Drop a flip that disagrees with that sign so the two can never conflict.
    if zero_cross is not None:
        if spot_f < zero_cross and cum_at_spot >= 0:
            zero_cross = None
        elif spot_f > zero_cross and cum_at_spot < 0:
            zero_cross = None
    if abs(cum_at_spot) < 1.0:
        regime = "flat"
    elif cum_at_spot > 0:
        regime = "long"
    else:
        regime = "short"
    return {
        "strikes": per,
        "net_total": net_total,
        "regime": regime,
        "top_positive": top_positive,
        "top_negative": top_negative,
        "levels": levels,
        "zero_cross": zero_cross,
        # True when no leg carried gamma and the profile is an OI proxy.
        "degraded": not has_gamma,
    }


def market_block() -> dict:
    """Session gate for the UI: is the exchange open right now, and for which day.

    The report keeps working after hours (the chain returns the last close), so
    the UI needs an explicit signal to stop polling and stop labelling a stale
    snapshot as "live". Uses derivatives-open (09:15‑15:40) so that the report
    stays live through the F&O closing auction.
    """
    from trading.utils import is_derivatives_open
    now = datetime.now(config.IST)
    try:
        is_open = bool(is_derivatives_open())
    except Exception:
        is_open = False
    return {
        "is_open": is_open,
        "session_date": now.strftime("%Y-%m-%d"),
        "as_of": now.isoformat(),
    }


# ---------------------------------------------------------------------------
# Previous-session pivot levels (classic)
# ---------------------------------------------------------------------------

#: NSE index instrument key for Nifty 50 daily candles (pivot source), same
#: form as ``NIFTY_KEY`` / ``VIX_KEY`` in :mod:`api.reports_api.nifty_verdicts`.
NIFTY_PIVOT_KEY = "NSE_INDEX|Nifty 50"
#: Calendar days to look back for the previous completed session's candle.
_PIVOT_LOOKBACK_DAYS = 15

#: One fetch per process day: the previous session's HLC only changes at the
#: day boundary, so the pivot block is memoised like nifty_verdicts' baseline
#: instead of being refetched on every 5s report rebuild.
_PIVOTS_CACHE: dict = {"date": None, "value": None}


def compute_pivots_from_candles(candles: Optional[list], today: str) -> Optional[dict]:
    """Pure: classic pivot levels from raw Upstox daily candle rows.

    Rows are ``[timestamp, open, high, low, close, volume, oi]`` and come
    newest-first, so the previous completed session is ``candles[1]`` — but the
    selection picks the newest row whose date is strictly less than ``today``
    to be resilient to ordering quirks. Returns the report ``pivots`` envelope
    (``type`` + ``pp/r1/r2/r3/s1/s2/s3`` + ``prev`` HLC) or ``None`` when no
    usable prior session exists. Never raises.
    """
    try:
        datetime.strptime(today, "%Y-%m-%d")  # an invalid reference date
        rows = [r for r in (candles or [])
                if isinstance(r, (list, tuple)) and len(r) >= 5
                and str(r[0])[:10] < today]
        if not rows:
            return None
        prev = max(rows, key=lambda r: str(r[0])[:10])
        high, low, close = float(prev[2]), float(prev[3]), float(prev[4])
        if not (high and low and close):
            return None
        from trading.pivot_utils import calculate_pivot_points
        pp = calculate_pivot_points(high, low, close, "classic")
        return {
            "type": "classic",
            "pp": round(pp.pp, 2),
            "r1": round(pp.r1, 2),
            "r2": round(pp.r2, 2),
            "r3": round(pp.r3, 2),
            "s1": round(pp.s1, 2),
            "s2": round(pp.s2, 2),
            "s3": round(pp.s3, 2),
            "prev": {
                "date": str(prev[0])[:10],
                "high": round(high, 2),
                "low": round(low, 2),
                "close": round(close, 2),
            },
        }
    except Exception:
        return None


def _extract_daily_candles(payload: Any) -> list:
    """``data.candles`` list from an Upstox historical-candle payload."""
    try:
        candles = ((payload or {}).get("data") or {}).get("candles") or []
        return candles if isinstance(candles, list) else []
    except Exception:
        return []


def compute_reference(tape_rows: Optional[list[dict]],
                      rows: Optional[list[dict]]) -> Optional[dict]:
    """Fixed-strike ATM reference for the premium-vs-spot read.

    The panel's rolling ATM leg re-anchors to the nearest strike every minute,
    so it looks flat even when a *fixed* strike gains — on 2026-10-16 the 23,150
    PE went 108 → 134 as spot fell 48 pts, while the rolling ATM read −2. This
    pins the day's FIRST ATM strike and reports its open premium (from the
    tape's first row) against its current premium (from the chain), so the
    directional move is visible instead of self-cancelling. Never raises.
    """
    try:
        first = next((r for r in (tape_rows or [])
                      if _safe_float(r.get("atm_strike")) > 0), None)
        if not first:
            return None
        strike = _safe_float(first.get("atm_strike"))
        ce_open = _safe_float(first.get("atm_ce_ltp")) or None
        pe_open = _safe_float(first.get("atm_pe_ltp")) or None
        row = next((r for r in (rows or [])
                    if _safe_float(r.get("strike")) == strike), None)
        if row is None:
            return None
        ce = _safe_float((row.get("ce") or {}).get("ltp")) or None
        pe = _safe_float((row.get("pe") or {}).get("ltp")) or None
        return {
            "strike": strike,
            "ce_open": ce_open, "pe_open": pe_open,
            "ce_ltp": ce, "pe_ltp": pe,
            "ce_change": round(ce - ce_open, 2) if (ce is not None and ce_open) else None,
            "pe_change": round(pe - pe_open, 2) if (pe is not None and pe_open) else None,
            "since": first.get("t"),
        }
    except Exception:
        return None


async def _fetch_pivots(today: str) -> Optional[dict]:
    """Previous-session pivots from the Upstox daily-candle endpoint.

    Same shape as ``nifty_verdicts._fetch_vix_prev_close``: daily candles come
    newest-first and the v2 endpoint has several interval spellings (``day`` is
    canonical; ``days/1`` and ``day/1`` both 404 with UDAPI100060). Tries each
    until one yields a usable prior session.
    """
    from api.options import fetch_upstox
    import urllib.parse
    enc = urllib.parse.quote(NIFTY_PIVOT_KEY, safe="")
    try:
        ref = datetime.strptime(today, "%Y-%m-%d")
    except ValueError:
        return None
    from_date = (ref - timedelta(days=_PIVOT_LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    for interval in ("day", "days/1", "day/1"):
        try:
            payload = await fetch_upstox(
                f"/historical-candle/{enc}/{interval}/{today}/{from_date}")
        except Exception:
            continue
        value = compute_pivots_from_candles(_extract_daily_candles(payload), today)
        if value is not None:
            return value
    return None


async def get_pivots_block(today: Optional[str] = None) -> Optional[dict]:
    """Pivot block for ``today``, fetched at most once per process day.

    Only successful fetches are memoised (same policy as the VIX block) so a
    transient failure at 09:20 does not blank the levels for the whole day.
    Never raises — ``None`` on any failure (the UI renders nothing).
    """
    date_str = today or _today_str()
    if _PIVOTS_CACHE["date"] == date_str and _PIVOTS_CACHE["value"] is not None:
        return _PIVOTS_CACHE["value"]
    value: Optional[dict] = None
    try:
        value = await _fetch_pivots(date_str)
    except Exception:
        value = None
    if value is not None:
        _PIVOTS_CACHE["date"] = date_str
        _PIVOTS_CACHE["value"] = value
    return value


# ---------------------------------------------------------------------------
# Spot vs candle close, and 1-minute candle gaps
# ---------------------------------------------------------------------------
#: A tape-derived gap fill may not step more than this away from the last real
#: candle close. On 2026-11-03 the option chain's ``underlying_spot_price`` sat
#: ~79 pts (0.33%) ABOVE the index's last 1-minute close (23,810.85 vs
#: 23,731.85) and the recorder persisted it as the 15:29 tape row: filling that
#: minute into the candle series would have invented a +79 pt last-minute move.
GAP_FILL_MAX_STEP_PCT = 0.0025
#: Never synthesise more than this many minutes from one gap (~one session).
GAP_FILL_MAX_MINUTES = 400


def _finite(value: Any) -> Optional[float]:
    """Finite float or ``None`` — canonical ``safe_float`` with a ``None`` default."""
    return _safe_float(value, default=None)


def _candle_ohlc(candle: Any) -> Optional[tuple[float, float, float, float]]:
    """``(open, high, low, close)`` when all four are finite, else ``None``.

    Upstox returns rows with null OHLC for a minute it has not aggregated yet;
    those are not a flat candle, they are *no* candle.
    """
    if not isinstance(candle, dict):
        return None
    vals = tuple(_finite(candle.get(k)) for k in ("open", "high", "low", "close"))
    if any(v is None for v in vals):
        return None
    return vals  # type: ignore[return-value]


def _candle_dt(candle: Any) -> Optional[datetime]:
    """Parsed ``time`` of a candle, or ``None`` when it is not ISO-8601."""
    try:
        return datetime.fromisoformat(str((candle or {}).get("time")))
    except (TypeError, ValueError):
        return None


def closed_market_spot(candles: Optional[list[dict]]) -> Optional[float]:
    """Last valid 1-minute **close**, clamped to the session's ``[low, high]``.

    After the close the chain's ``underlying_spot_price`` is not the index
    close: on 2026-11-03 it printed 23,810.85 while the last 1-minute candle
    closed at 23,731.85 (a 79-pt gap, the same forward/cash spread the tape
    records). The settled number is the last candle that actually carries an
    OHLC, so that is what the page must show once the session ends. Clamping to
    the day's range keeps a partial/stale series from printing a spot the day
    never traded.
    """
    valid = []
    for candle in candles or []:
        ohlc = _candle_ohlc(candle)
        if ohlc is not None:
            valid.append(ohlc)
    if not valid:
        return None
    close = valid[-1][3]
    high = max(v[1] for v in valid)
    low = min(v[2] for v in valid)
    return round(min(max(close, low), high), 2)


def fill_candle_gaps(candles: Optional[list[dict]],
                     tape_rows: Optional[list[dict]] = None, *,
                     max_step_pct: float = GAP_FILL_MAX_STEP_PCT,
                     max_fill_minutes: int = GAP_FILL_MAX_MINUTES,
                     ) -> list[dict]:
    """Drop null-OHLC candles and fill missing 1-minute bars from the tape.

    Two failure modes this closes (2026-11-03):

    * the intraday endpoint returned rows with ``null`` OHLC after 12:04 while
      the tape kept recording. A null row is NOT a flat candle — it is dropped,
      because keeping it poisons every close-based series (EMA, RV, ATR).
    * a dropped/minutes-long hole must never be closed by widening the next
      candle: each missing minute becomes its OWN bar with
      ``O=H=L=C=tape.spot, volume=0`` (flagged ``synthetic``). That is the only
      shape that cannot turn a 90-minute gap into one giant candle.

    A fill is skipped when the tape's spot for that minute is missing, or when
    it steps more than ``max_step_pct`` from the last real close (a different
    print, not this series). Gaps wider than ``max_fill_minutes`` are left
    alone. The tail is filled only as far as the tape's last minute.
    """
    kept = [c for c in (candles or [])
            if isinstance(c, dict) and _candle_ohlc(c) is not None]
    if not kept:
        return []
    kept.sort(key=lambda c: str(c.get("time") or ""))

    tape_spot: dict[datetime, float] = {}
    last_tape_dt: Optional[datetime] = None
    for row in tape_rows or []:
        if not isinstance(row, dict):
            continue
        spot = _finite(row.get("spot"))
        dt = _candle_dt(row) if row.get("t") is not None else None
        if dt is None:
            try:
                dt = datetime.fromisoformat(str(row.get("t")))
            except (TypeError, ValueError):
                continue
        dt = dt.replace(second=0, microsecond=0)
        if last_tape_dt is None or dt > last_tape_dt:
            last_tape_dt = dt
        if spot and spot > 0:
            tape_spot[dt] = spot

    out: list[dict] = []
    prev_dt: Optional[datetime] = None
    prev_close: Optional[float] = None

    def _fill(minute: datetime) -> Optional[dict]:
        spot = tape_spot.get(minute)
        if not spot:
            return None
        if prev_close and abs(spot - prev_close) / prev_close > max_step_pct:
            return None
        return {"time": minute.isoformat(), "open": round(spot, 2),
                "high": round(spot, 2), "low": round(spot, 2),
                "close": round(spot, 2), "volume": 0, "synthetic": True}

    for candle in kept:
        dt = _candle_dt(candle)
        if prev_dt is not None and dt is not None:
            gap = int((dt - prev_dt).total_seconds() // 60)
            if 1 < gap <= max_fill_minutes:
                for k in range(1, gap):
                    filled = _fill(prev_dt + timedelta(minutes=k))
                    if filled is not None:
                        out.append(filled)
        out.append(candle)
        if dt is not None:
            prev_dt = dt
        prev_close = _candle_ohlc(candle)[3]  # type: ignore[index]

    # Tail: the tape can be ahead of the last aggregated candle (2026-11-03:
    # candles ended 15:27, tape 15:29). Fill only up to the tape's last minute.
    if prev_dt is not None and last_tape_dt is not None:
        gap = int((last_tape_dt - prev_dt).total_seconds() // 60)
        if 0 < gap <= max_fill_minutes:
            for k in range(1, gap + 1):
                filled = _fill(prev_dt + timedelta(minutes=k))
                if filled is not None:
                    out.append(filled)
    out.sort(key=lambda c: str(c.get("time") or ""))
    return out


def reconcile_closed_market_spot(report: dict,
                                 market_open: Optional[bool] = None) -> dict:
    """After the close, make ``report["spot"]`` the last valid candle close.

    A wrapper around :func:`closed_market_spot` that keeps the served payload
    auditable: the replaced value is preserved as ``spot_chain`` and
    ``spot_source`` records why. No-op while the market is open (the live feed
    owns spot then) and when the series carries no usable candle.
    """
    if not isinstance(report, dict):
        return report
    is_open = _market_open() if market_open is None else bool(market_open)
    if is_open:
        return report
    spot = closed_market_spot(report.get("intraday") or report.get("candles"))
    if spot is None:
        return report
    previous = _finite(report.get("spot"))
    if previous is not None and round(previous, 2) == spot:
        return {**report, "spot_source": "last_candle_close"}
    return {**report, "spot": spot, "spot_source": "last_candle_close",
            "spot_chain": previous}


def build_report(expiry: str, spot: float, rows: list[dict], mode: str,
                 candles: Optional[list[dict]] = None) -> dict:
    """Assemble the report envelope shared by live and snapshot responses."""
    total_ce_oi = sum(r["ce"]["oi"] for r in rows)
    total_pe_oi = sum(r["pe"]["oi"] for r in rows)
    total_ce_vol = sum(r["ce"]["volume"] for r in rows)
    total_pe_vol = sum(r["pe"]["volume"] for r in rows)
    # Max pain is a CHAIN-wide concept: the strike where option writers lose
    # least. It used to be computed on a ±1500 pt window around spot, which
    # is not the chain's pain point at all — the level it printed was an
    # artefact of the truncation. The full chain is used and the scope that
    # was covered is reported next to it (``max_pain_scope_pts``).
    pain_rows = [
        {"strike": r["strike"], "ce_oi": r["ce"]["oi"], "pe_oi": r["pe"]["oi"]}
        for r in rows
    ]
    scope_pts = max((abs(r["strike"] - spot) for r in rows), default=0.0)
    return {
        "mode": mode,
        "expiry": expiry,
        "spot": spot,
        "fetched_at": datetime.now(config.IST).isoformat(),
        "pcr_oi": compute_pcr(total_pe_oi, total_ce_oi),
        "pcr_vol": compute_pcr(total_pe_vol, total_ce_vol),
        "max_pain": compute_max_pain(pain_rows),
        "max_pain_scope_pts": round(scope_pts, 2),
        "walls": {"calls": top_walls(rows, "ce", spot=spot), "puts": top_walls(rows, "pe", spot=spot)},
        "walls_near": {"calls": near_walls(rows, "ce", spot=spot),
                        "puts": near_walls(rows, "pe", spot=spot)},
        "gex": compute_gex(rows, spot),
        "positioning": compute_positioning(rows, spot),
        "strikes": rows,
        "candles": candles or [],
    }


def build_timeline_skeleton(report: dict) -> list[dict]:
    """Minimal timeline derived from a freshly computed report."""
    scope = report.get("max_pain_scope_pts")
    scope_txt = f"over the full chain (±{scope:.0f} pts of spot)" if scope else \
        "over the full chain"
    return [
        {"time": report.get("fetched_at", ""), "event": "snapshot",
         "detail": f"Nifty spot {report.get('spot')} (expiry {report.get('expiry')})"},
        {"time": report.get("fetched_at", ""), "event": "max_pain",
         "detail": f"Max pain {report.get('max_pain')} {scope_txt}"},
        {"time": report.get("fetched_at", ""), "event": "pcr",
         "detail": f"PCR-OI {report.get('pcr_oi')} / PCR-Vol {report.get('pcr_vol')}"},
    ]


def _build_snapshot_dict(report: dict, date_str: str) -> dict:
    """Build the standard snapshot envelope from a live report.

    Shared by :func:`create_nifty_snapshot` and :func:`nifty_snapshot_task`
    so the snapshot structure is identical in both paths.
    """
    return {
        **report,
        "mode": "snapshot",
        "date": date_str,
        "snapshot_at": datetime.now(config.IST).isoformat(),
        "source": "upstox-option-chain",
        "timeline": build_timeline_skeleton(report),
    }


# ---------------------------------------------------------------------------
# Snapshot persistence
# ---------------------------------------------------------------------------

def snapshot_path(date_str: str) -> Path:
    return SNAPSHOT_DIR / f"{date_str}.json"


def read_snapshot(date_str: str) -> Optional[dict]:
    path = snapshot_path(date_str)
    try:
        stat = path.stat()
    except OSError:
        return None
    key = str(path)
    cached = _SNAPSHOT_READ_CACHE.get(key)
    if (cached is not None and cached[0] == stat.st_mtime_ns
            and cached[1] == stat.st_size):
        # Top-level copy: callers may add a block, but must not mutate the
        # cached snapshot's keys. Nested structures are read-only by contract.
        return dict(cached[2])
    try:
        with open(path) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError, ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    if len(_SNAPSHOT_READ_CACHE) >= 16:
        _SNAPSHOT_READ_CACHE.clear()
    _SNAPSHOT_READ_CACHE[key] = (stat.st_mtime_ns, stat.st_size, data)
    return dict(data)


def write_snapshot(date_str: str, data: dict) -> Path:
    """Persist the day's snapshot atomically.

    Called once per minute by the recorder, so it is written compactly (the
    ``indent=2`` form was ~35% larger for zero benefit — this file is only ever
    read with ``json.load``) and via a temp file + ``os.replace`` so a reader
    can never observe a half-written snapshot. Blocking: callers on the event
    loop must use ``asyncio.to_thread``.
    """
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    path = snapshot_path(date_str)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    os.replace(tmp, path)
    return path


# ---------------------------------------------------------------------------
# Live computation (Upstox)
# ---------------------------------------------------------------------------

def _rolling_oi(rows: list[dict], minutes: tuple[int, ...] = (5, 15)) -> dict:
    """Rolling CE/PE OI change over the last N minutes of the tape.

    The session-cumulative ``positioning.flow`` hides intraday sign flips
    (on 2026-11-02 the last 5m was a put build while the last 15m was a call
    build). Raw OI units, anchored on the newest frame.
    """
    clean = [r for r in rows or [] if isinstance(r, dict) and r.get("t")]
    if not clean:
        return {}
    try:
        stamps = [datetime.fromisoformat(r["t"]) for r in clean]
    except (TypeError, ValueError):
        return {}
    last_ts = stamps[-1]
    last = clean[-1]
    out: dict = {"as_of": last["t"]}
    for m in minutes:
        cut = last_ts - timedelta(minutes=m)
        idx = min(range(len(clean)), key=lambda i: abs((stamps[i] - cut).total_seconds()))
        base = clean[idx]
        ce = (last.get("ce_oi") or 0) - (base.get("ce_oi") or 0)
        pe = (last.get("pe_oi") or 0) - (base.get("pe_oi") or 0)
        out[f"{m}m"] = {
            "from": base["t"],
            "ce": int(ce),
            "pe": int(pe),
            "net": int(ce - pe),
        }
    return out


async def _attach_verdicts(report: dict, rows: list[dict], spot: float,
                           for_date: Optional[str],
                           expiries: Optional[Mapping[Any, Iterable[Any]]] = None,
                           ) -> None:
    """Attach the four session-verdict blocks to ``report`` in place.

    Reuses the already-fetched chain/GEX/candles; only pulls today's 1-minute
    spot, the once-a-day session baseline and VIX (all cached in
    :mod:`api.reports_api.nifty_verdicts`). Never raises — a failure leaves the
    blocks absent rather than breaking ``/live``.

    ``expiries`` is an optional ``expiry -> parsed rows`` map used ONLY for the
    IV term structure (``iv_surface.term``). The report itself carries a single
    expiry, so without a caller-supplied map the term stays ``[]``. Rows are
    the exact shape from :func:`parse_chain_payload`; the caller owns fetching
    the extra expiries (this function never makes an upstream call for them).
    """
    try:
        from api.reports_api import nifty_verdicts as nv
    except Exception:
        return
    today = for_date or _today_str()
    is_today = today == _today_str()
    baseline: Optional[float] = None
    vix: Optional[dict] = None
    intraday: Optional[list] = None
    try:
        # Three independent fetches: run them together instead of paying the
        # baseline/VIX round trip and then the intraday one back-to-back on a
        # cold cache.
        results = await asyncio.gather(
            nv.get_baseline_range(today),
            nv.get_vix_block() if is_today else _async_none(),
            nv.get_intraday_candles(today) if is_today else _async_none(),
            return_exceptions=True,
        )
        if not isinstance(results[0], BaseException):
            baseline = results[0]
        if not isinstance(results[1], BaseException):
            vix = results[1]
        if not isinstance(results[2], BaseException):
            intraday = results[2]
    except Exception:
        pass
    # The tape is a growing JSONL (1.4 MB today); parse it in a worker thread.
    tape = await asyncio.to_thread(read_tape, today)
    # 1-minute today candles when available, else the report's own spot candles.
    # Null-OHLC rows are dropped and missing minutes are filled from the tape as
    # one flat bar per minute (never one wide bar across the hole) — see
    # :func:`fill_candle_gaps`. Only the 1-minute series is gap-filled: the 15m
    # yfinance fallback must not be diluted with synthetic minute bars.
    intraday = fill_candle_gaps(intraday, tape) if intraday else intraday
    candles = intraday or report.get("candles") or []
    # Fixed-strike ATM reference (see compute_reference) so the UI can show the
    # premium move instead of the self-cancelling rolling ATM leg.
    try:
        report["reference"] = compute_reference(tape, rows)
    except Exception:
        report["reference"] = None
    # Previous session's close: the realised vol needs it to become a full-day
    # figure (overnight gap included), which is the only like-for-like
    # comparison against a 24h implied vol. The pivots block already carries
    # it; it is fetched here only when the caller did not resolve the block
    # at all (the block is cached per process day, so this costs one fetch).
    prev_close = _prev_close_from_pivots(report.get("pivots"))
    if not prev_close and "pivots" not in report:
        try:
            pivots = await get_pivots_block(today)
            prev_close = _prev_close_from_pivots(pivots)
        except Exception:
            prev_close = None
    # Signed session delta-weighted flow (₹ Cr, positive = bullish). Use the
    # raw `flow`, NOT `initiated`: `initiated` is class-weighted by the
    # sentiment classifier, which read 99.8% bullish (bull 171,106 Cr vs
    # bear 387 Cr) on 2026-11-02 while spot broke 23,300 — it can only ever
    # name a writer. `flow` is the raw book change and flips sign with price.
    positioning = report.get("positioning")
    flow_bias = (positioning.get("flow")
                 if isinstance(positioning, dict) else None)
    try:
        report.update(nv.build_verdicts(
            rows=rows, spot=spot, gex=report.get("gex"), candles=candles,
            tape_rows=tape, baseline=baseline, vix=vix,
            # The pinned-strike reference is the like-for-like ATM straddle
            # read (one contract against itself) - the tape's first/last rows
            # compare two different contracts once the ATM strike rolls.
            reference=report.get("reference"),
            prev_close=prev_close,
            flow_bias=flow_bias))
    except Exception:
        pass
    # IV surface: ATM / 25-delta skew from the same chain rows. ``expiries`` is
    # supplied by the caller when it already holds other expiries' rows; the
    # term structure is [] otherwise (one chain does not a curve make).
    try:
        from api.reports_api.iv_surface import attach_iv_surface
        attach_iv_surface(report, rows, expiries=expiries)
    except Exception:
        pass
    # Rolling OI windows: the session flow is cumulative and hides intraday
    # sign flips; these are the 5m/15m raw CE/PE OI deltas the panel uses to
    # show whether the same side is still driving. ``tape`` was already parsed
    # above — re-reading the day file here doubled the per-build disk cost.
    try:
        if tape:
            report["flow_window"] = _rolling_oi(tape)
    except Exception:
        pass
    # Structural shifts (wall flips, wall migration, max-pain drift, PCR regime
    # change, volume spikes, level breaks) are the "why" behind the tape's raw
    # numbers: on 2026-10-14 the drop was 22,700 support collapsing into
    # resistance while calls stacked above it. Most recent 12, newest last.
    try:
        from api.reports_api.nifty_structure import detect_structure_shifts
        report["structure"] = detect_structure_shifts(tape)[-12:]
    except Exception:
        report["structure"] = []
    # 1-minute intraday candles + index-aligned EMA9/EMA20 series for the UI
    # chart overlay. Degrades to [] so a failure never breaks /live.
    try:
        report["intraday"] = intraday or []
        if intraday:
            vals: list = []
            for c in intraday:
                v = (c or {}).get("close")
                if v is None:
                    vals.append(None)
                else:
                    try:
                        vals.append(float(v))
                    except (TypeError, ValueError):
                        vals.append(None)
            report["emas"] = [
                {"period": 9, "data": nv.ema_series(vals, 9)},
                {"period": 20, "data": nv.ema_series(vals, 20)},
            ]
        else:
            report["emas"] = []
    except Exception:
        try:
            report["intraday"] = intraday or []
        except Exception:
            report["intraday"] = []
        report["emas"] = []


async def _async_none() -> None:
    return None


def _prev_close_from_pivots(pivots: Any) -> Optional[float]:
    """The previous session's close from a ``pivots`` block, or ``None``."""
    if not isinstance(pivots, dict):
        return None
    prev = pivots.get("prev")
    if not isinstance(prev, dict):
        return None
    return _safe_float(prev.get("close")) or None


def _chain10s_chain(expiry: Optional[str] = None,
                    max_age_sec: float = CHAIN10S_REUSE_MAX_AGE_SEC,
                    ) -> Optional[tuple[str, float, list[dict]]]:
    """``(expiry, spot, rows)`` from the newest 10s poller frame, or ``None``.

    The 10s poller already fetches the FULL chain (greeks + prev_oi) every
    10s; rebuilding the snapshot on a second REST call cost ~50s and pushed the
    snapshot cadence past 100s. Reuse is gated on freshness
    (:func:`chain10s.fresh_frame`), a usable chain, and — when the caller named
    an expiry — a matching expiry, so an explicit weekly request never gets the
    front-week frame. Any failure returns ``None`` and the caller fetches.
    """
    try:
        from api.reports_api.chain10s import fresh_frame
        frame = fresh_frame(max_age_sec=max_age_sec)
    except Exception:
        return None
    if not isinstance(frame, dict):
        return None
    rows = frame.get("rows") or []
    if not has_usable_chain(rows):
        return None
    frame_expiry = str(frame.get("expiry") or "")
    if expiry and frame_expiry and expiry != frame_expiry:
        return None
    return (frame_expiry or expiry or "", _safe_float(frame.get("spot")), rows)


async def _fetch_chain_payload(expiry: Optional[str]) -> tuple[str, dict]:
    """Resolve the nearest expiry (when needed) and fetch one raw chain payload.

    When ``expiry`` is not provided, the **nearest expiry strictly after today**
    is chosen (``days_to_expiry > 0``). This avoids picking a chain that expires
    today and may already be settled/illiquid.

    Raises ``HTTPException(502)`` when no expiry is listed or the fetch fails.
    """
    from api.options import fetch_upstox, get_instrument_key
    from api.options import get_expiries as _get_expiries

    if not expiry:
        listing = await _get_expiries("NIFTY")
        expiries = listing.get("expiries", [])
        if not expiries:
            raise HTTPException(status_code=502, detail="no NIFTY expiries available")
        # Pick the nearest non-expiring chain. Prefer the listed
        # `days_to_expiry`; when an older listing omits it, fall back to the
        # date comparison. If neither yields a future expiry, keep the first
        # listing (test fixtures and stale feeds) instead of 502-ing the desk.
        today = _today_str()

        def _is_future(entry: dict) -> bool:
            days = entry.get("days_to_expiry")
            if days is not None:
                try:
                    return float(days) > 0
                except (TypeError, ValueError):
                    return False
            return str(entry.get("date") or "") > today

        future_expiries = [e for e in expiries if _is_future(e)]
        chosen = future_expiries or expiries
        expiry = chosen[0]["date"]

    try:
        payload = await fetch_upstox("/option/chain", {
            "instrument_key": get_instrument_key("NIFTY"),
            "expiry_date": expiry,
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"option chain fetch failed: {e}")
    return expiry, payload


async def _compute_live(expiry: Optional[str], for_date: Optional[str] = None,
                      walkback_days: int = 5, with_verdicts: bool = True,
                      with_candles: bool = True,
                      payload: Optional[dict] = None,
                      expiries: Optional[Mapping[Any, Iterable[Any]]] = None,
                      ) -> dict:
    """Fetch the Upstox chain + spot and build a live report (no caching).

    ``with_verdicts`` attaches the four session-verdict blocks (live/snapshot).
    ``with_candles`` / ``with_verdicts`` are both off for the per-minute tape
    tick, which only reads chain aggregates and must stay yfinance-free.
    ``payload`` lets a caller reuse an already-fetched raw chain (the recorder
    builds two views per minute from a single upstream call).

    ``expiries`` is the optional ``expiry -> parsed rows`` map for the IV term
    structure (``report["iv_surface"]["term"]``). This function fetches only the
    report's own chain, so callers that already hold other expiries pass them
    here — e.g. ``await _compute_live(None, expiries={exp: rows_for(exp)})``
    where each value is ``parse_chain_payload(payload)[2]``. With no map the
    term stays ``[]`` (the honest answer for a single expiry).

    Chain source: when ``payload`` is omitted the newest 10s poller frame is
    reused if fresh (:func:`_chain10s_chain`); only when there is no fresh frame
    does this issue its own REST chain call. ``report["chain_source"]`` records
    which path was taken ("chain10s" / "rest") for the cadence audit.

    Raises ``HTTPException(502)`` when the chain comes back empty or with no
    OI at all: that is a failed fetch, not a market state, and serving it as a
    report produced the ``strikes: [] / net_total: 0 / regime: "flat" /
    max_pain: 0`` payloads that then got persisted.
    """
    # Lazy imports: keeps this module import-light and avoids import cycles.
    from api.options import get_spot_price

    chain_source = "rest"
    chain_expiry = ""
    spot = 0.0
    rows: list[dict] = []
    if payload is None:
        reused = _chain10s_chain(expiry)
        if reused is not None:
            chain_expiry, spot, rows = reused
            chain_source = "chain10s"
        else:
            expiry, payload = await _fetch_chain_payload(expiry)
    if payload is not None:
        chain_expiry, spot, rows = parse_chain_payload(payload)

    if not has_usable_chain(rows):
        # ``status: success`` with an empty ``data`` array is what Upstox
        # returns for an expiry that does not exist (e.g. the synthetic
        # "next Thursday" the old expiry fallback invented). Never build a
        # report from it.
        raise HTTPException(
            status_code=502,
            detail=(f"option chain empty for expiry {expiry} "
                    f"({len(rows)} rows)"),
        )
    if not spot:
        try:
            spot = (await get_spot_price("NIFTY")).get("spot", 0)
        except Exception:
            pass
    candles = (await asyncio.to_thread(_fetch_nifty_candles_cached,
                                          for_date or _today_str(),
                                          walkback_days)
               if with_candles else [])
    report = build_report(chain_expiry or expiry, spot, rows, mode="live",
                          candles=candles)
    report["chain_source"] = chain_source
    report["market"] = market_block()
    # Previous-session pivot levels (classic), cached per process day. A
    # failure stores None so the chart simply renders no levels.
    try:
        report["pivots"] = await get_pivots_block(for_date or _today_str())
    except Exception:
        report["pivots"] = None
    # See reconcile_closed_market_spot: a closed session is priced by its last
    # candle close, not by the chain's underlying (forward) price.
    report = reconcile_closed_market_spot(report)
    spot = _safe_float(report.get("spot")) or spot
    if with_verdicts:
        await _attach_verdicts(report, rows, spot, for_date, expiries=expiries)
        # Verdict attachment builds the richer 1-minute series (gap-filled from
        # the tape); reconcile once more so the stored spot matches the last
        # candle it just produced (see reconcile_closed_market_spot).
        report = reconcile_closed_market_spot(report)
    return report


async def _compute_sensex_live() -> dict:
    """Build the small live Sensex context block used by the Nifty page.

    Sensex uses the same Upstox option-chain source as Nifty. Max pain comes
    from Upstox's dedicated endpoint when available because it accounts for
    the exchange's complete chain; the local chain calculation is only a
    fallback for older API deployments.
    """
    from api.options import fetch_upstox, get_instrument_key
    from api.options import get_expiries as _get_expiries

    listing = await _get_expiries("SENSEX")
    expiries = listing.get("expiries", [])
    if not expiries:
        raise HTTPException(status_code=502, detail="no SENSEX expiries available")
    expiry = expiries[0]["date"]
    instrument_key = get_instrument_key("SENSEX")
    try:
        payload = await fetch_upstox("/option/chain", {
            "instrument_key": instrument_key,
            "expiry_date": expiry,
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Sensex option chain fetch failed: {e}")

    chain_expiry, spot, rows = parse_chain_payload(payload)
    if not spot:
        raise HTTPException(status_code=502, detail="Sensex option chain has no spot price")

    total_ce_oi = sum(r["ce"]["oi"] for r in rows)
    total_pe_oi = sum(r["pe"]["oi"] for r in rows)
    total_ce_vol = sum(r["ce"]["volume"] for r in rows)
    total_pe_vol = sum(r["pe"]["volume"] for r in rows)
    pain_rows = [
        {"strike": r["strike"], "ce_oi": r["ce"]["oi"], "pe_oi": r["pe"]["oi"]}
        for r in rows
    ]
    max_pain = compute_max_pain(pain_rows)
    try:
        pain_payload = await fetch_upstox("/market/max-pain", {
            "instrument_key": instrument_key,
            "expiry": chain_expiry or expiry,
            "date": _today_str(),
            "bucket_interval": 30,
        })
        pain_data = pain_payload.get("data") or {}
        if isinstance(pain_data, list):
            pain_data = pain_data[0] if pain_data else {}
        official_pain = _safe_float(pain_data.get("max_pain"))
        if official_pain > 0:
            max_pain = official_pain
    except Exception:
        pass

    ohlc = {"open": spot, "high": spot, "low": spot, "close": spot}
    try:
        quote = await fetch_upstox("/market-quote/ohlc", {
            "instrument_key": instrument_key,
            "interval": "1d",
        })
        quote_data = quote.get("data") or {}
        quote_row = next(iter(quote_data.values()), {})
        # Upstox nests the OHLC fields under a child "ohlc" object; only
        # last_price sits at the row level. Reading open/high/low off the row
        # itself always returned None, which fell back to spot and shipped a
        # flat bar (open == high == low == spot).
        row_ohlc = quote_row.get("ohlc") or {}
        ohlc = {
            "open": _safe_float(row_ohlc.get("open"), spot),
            "high": _safe_float(row_ohlc.get("high"), spot),
            "low": _safe_float(row_ohlc.get("low"), spot),
            "close": _safe_float(quote_row.get("last_price") or row_ohlc.get("close"), spot),
        }
        spot = ohlc["close"] or spot
    except Exception:
        pass

    return {
        "symbol": "SENSEX",
        "expiry": chain_expiry or expiry,
        "spot": spot,
        "ohlc": ohlc,
        "fetched_at": datetime.now(config.IST).isoformat(),
        "pcr_oi": compute_pcr(total_pe_oi, total_ce_oi),
        "pcr_vol": compute_pcr(total_pe_vol, total_ce_vol),
        "max_pain": max_pain,
        "walls": {"calls": top_walls(rows, "ce", spot=spot), "puts": top_walls(rows, "pe", spot=spot)},
        "walls_near": {"calls": near_walls(rows, "ce", spot=spot),
                        "puts": near_walls(rows, "pe", spot=spot)},
        "market": market_block(),
    }


@router.get("/nifty/expiries")
async def get_nifty_expiries():
    """Available NIFTY expiry dates for the report expiry picker."""
    from api.options import get_expiries as _get_expiries
    try:
        listing = await _get_expiries("NIFTY")
        return {"expiries": listing.get("expiries", [])}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"expiries fetch failed: {e}")


async def get_cached_live(expiry: Optional[str] = None,
                          expiries: Optional[Mapping[Any, Iterable[Any]]] = None,
                          ) -> dict:
    """Live report with the shared 5s in-memory TTL.

    The WS and the REST endpoint must both go through this: calling
    ``_compute_live`` directly regenerates ``fetched_at`` on every call, which
    made the WebSocket re-send the whole report every tick (heavy upstream
    fetches + a 60KB frame + a full re-parse/re-render every 1s).

    ``expiries`` (the optional IV term map, see :func:`_compute_live`) bypasses
    the TTL cache: the cache key cannot describe which extra expiries were
    supplied, so a cached report would carry another caller's term structure.
    """
    key = expiry or "default"
    now = time.time()
    if expiries is None:
        hit = _live_cache.get(key)
        if hit and now - hit["ts"] < _LIVE_TTL:
            return hit["data"]
    if expiries is None:
        report = await _compute_live(expiry)
    else:
        report = await _compute_live(expiry, expiries=expiries)
    try:
        # Where the prices came from — the panel can flag a feed it doubts.
        report["feed"] = {"source": "rest"}
    except Exception:
        pass
    if expiries is None:
        _live_cache[key] = {"ts": now, "data": report}
    return report


# ---------------------------------------------------------------------------
# Live WS path (api.reports_api.nifty_md, optional) with REST fallback
# ---------------------------------------------------------------------------

#: Minimum distinct strikes for a WS snapshot to count as a real chain.
_MIN_LIVE_STRIKES = 20
#: Live-built reports are fresh for ~1s so multiple WS clients share one build.
_LIVE_WS_TTL = 1.0
_live_ws_cache: dict[str, dict] = {}
#: Maximum age (seconds) of a WS snapshot's option legs before the report
#: refuses it. The index ticks constantly, so a socket whose option stream
#: died still looks "live" — serving its frozen ladder is how the report
#: showed 130.30 for 22 minutes while the chain traded 148.35 (2026-10-22).
LIVE_LEG_MAX_AGE_SEC = 15.0


def _nifty_md() -> Optional[Any]:
    """Return the ``nifty_md`` module, or ``None`` when unavailable.

    The module is built in parallel — it may be missing, empty, or lack the
    expected attrs. Every caller must treat ``None`` as "use the REST path".
    """
    try:
        import importlib
        mod = importlib.import_module("api.reports_api.nifty_md")
    except Exception:
        return None
    if mod is None:
        return None
    for attr in ("is_live", "snapshot"):
        if not callable(getattr(mod, attr, None)):
            return None
    return mod


def _snapshot_leg_age(snapshot: Any) -> Optional[float]:
    """Age (seconds) of a WS snapshot's option legs; None when unknown.

    ``legs_ts`` is the epoch of the last option-leg tick. A snapshot without
    it carries no freshness proof, so it is treated as unknown (``None``)
    and the caller decides.
    """
    try:
        legs_ts = (snapshot or {}).get("legs_ts")
        if legs_ts is None:
            return None
        return max(0.0, time.time() - float(legs_ts))
    except (TypeError, ValueError):
        return None


def _ws_chain_rows(snapshot: dict,
                   max_leg_age_sec: float = LIVE_LEG_MAX_AGE_SEC
                   ) -> Optional[tuple[float, list[dict], float]]:
    """``(spot, rows, leg_age_sec)`` from a WS snapshot, or ``None``.

    ``snapshot`` legs are keyed ``"<strike>:ce"`` / ``"<strike>:pe"`` with
    ``{oi, iv, ltp, volume, delta, gamma}``. Returns ``None`` when the legs
    hold fewer than ~20 distinct strikes (not a real chain), when the snapshot
    carries no ``legs`` dict, or when the legs are older than
    ``max_leg_age_sec`` (a frozen option stream is not a live chain either).
    Never raises.
    """
    try:
        legs = (snapshot or {}).get("legs") or {}
        if not isinstance(legs, dict):
            return None
        # Freshness gate: a snapshot whose option quotes stopped moving while
        # the index kept ticking is stale — the REST chain is the only honest
        # source then.
        leg_age = _snapshot_leg_age(snapshot)
        if leg_age is None or leg_age > float(max_leg_age_sec):
            logger.warning(
                "nifty report: WS snapshot legs are %s old — using the REST chain",
                "unknown" if leg_age is None else f"{leg_age:.0f}s")
            return None
        grouped: dict[float, dict] = {}
        for key, leg in legs.items():
            try:
                strike_raw, side = str(key).rsplit(":", 1)
                strike = float(strike_raw)
                side = side.strip().lower()
                if side not in ("ce", "pe"):
                    continue
            except (TypeError, ValueError):
                continue
            if not isinstance(leg, dict):
                leg = {}
            grouped.setdefault(strike, {})[side] = leg
        if len(grouped) < _MIN_LIVE_STRIKES:
            return None

        def _leg(d: dict) -> dict:
            return {
                "ltp": _safe_float(d.get("ltp")),
                "oi": _safe_int(d.get("oi")),
                "volume": _safe_int(d.get("volume")),
                "oi_change": 0,
                "sentiment": {"type": "Neutral"},
                "gamma": _safe_float(d.get("gamma")),
                "delta": _safe_float(d.get("delta")) if d.get("delta") is not None else None,
                "iv": _safe_float(d.get("iv")) if d.get("iv") is not None else None,
            }

        rows = [
            {"strike": strike,
             "ce": _leg(sides.get("ce") or {}),
             "pe": _leg(sides.get("pe") or {})}
            for strike, sides in grouped.items()
        ]
        rows.sort(key=lambda r: r["strike"])
        return _safe_float((snapshot or {}).get("spot")), rows, leg_age
    except Exception:
        return None


def build_report_from_live(snapshot: dict, expiry: Optional[str],
                           candles: Optional[list[dict]] = None,
                           max_leg_age_sec: float = LIVE_LEG_MAX_AGE_SEC) -> Optional[dict]:
    """Build the report envelope from a WS ``snapshot`` instead of REST rows.

    See :func:`_ws_chain_rows` for the usability gates. Never raises.
    """
    parsed = _ws_chain_rows(snapshot, max_leg_age_sec)
    if parsed is None:
        return None
    try:
        spot, rows, leg_age = parsed
        exp = expiry or (snapshot or {}).get("expiry") or ""
        report = build_report(exp, spot, rows, mode="live",
                              candles=candles or [])
        try:
            report["market"] = market_block()
        except Exception:
            pass
        try:
            report["feed"] = {"source": "ws", "leg_age_sec": round(leg_age, 1)}
        except Exception:
            pass
        return report
    except Exception:
        return None


def _merge_ws_vix(report: dict, snapshot: dict) -> dict:
    """Replace ``report["vix"]`` with the WS VIX reading when it carries one.

    ``_attach_verdicts`` sets a REST VIX block; the WS tick is fresher, so it
    wins. A scalar WS reading is merged into the existing block so the change %
    survives. Never raises; returns ``report`` when there is nothing to merge.
    """
    try:
        ws_vix = (snapshot or {}).get("vix")
        if ws_vix is None:
            return report
        if isinstance(ws_vix, dict):
            return {**report, "vix": ws_vix}
        if isinstance(report.get("vix"), dict):
            try:
                return {**report, "vix": {**report["vix"], "ltp": float(ws_vix)}}
            except (TypeError, ValueError):
                return report
        return {**report, "vix": ws_vix}
    except Exception:
        return report


def _overlay_ws_blocks(report: dict, snapshot: Optional[dict],
                       max_leg_age_sec: float = LIVE_LEG_MAX_AGE_SEC,
                       market_open: Optional[bool] = None) -> dict:
    """Project live WS blocks onto a saved report WITHOUT writing a snapshot.

    Replaces ``spot`` / ``vix`` from the WS snapshot, and — when the snapshot
    converts to a usable chain (:func:`_ws_chain_rows`) — ``walls``,
    ``walls_near``, ``positioning`` and ``gex``, which are pure functions of
    the legs. This is what makes ``GET /nifty`` follow a wall relocation between
    two 20s snapshot writes.

    **Spot is a session-time read only.** The WS spot tick lags the index at
    the close and, worse, the chain's underlying price carries the forward
    basis: on 2026-11-03 the overlay served 23,810.85 while the last 1-minute
    candle closed at 23,731.85. So the overlay is gated on market hours; once
    the session is over the spot is the last valid candle close clamped to the
    day's range (:func:`reconcile_closed_market_spot`). ``market_open`` is
    injectable so the gate is testable without a clock.

    ``control`` and ``strikes`` are replaced ONLY when the snapshot carries them
    itself: WS legs have no ``prev_oi``, so recomputing control from them would
    print a fake zero OI change and a "flat" verdict. Never raises; returns the
    input report unchanged when the snapshot is unusable.
    """
    if not isinstance(report, dict) or not isinstance(snapshot, dict):
        return report
    is_open = _market_open() if market_open is None else bool(market_open)
    out = report
    if is_open:
        try:
            ws_spot = _safe_float(snapshot.get("spot"))
            if ws_spot > 0:
                out = {**out, "spot": ws_spot}
        except Exception:
            pass
    else:
        out = reconcile_closed_market_spot(out, market_open=False)
    out = _merge_ws_vix(out, snapshot)
    parsed = _ws_chain_rows(snapshot, max_leg_age_sec)
    if parsed is not None:
        try:
            spot, rows, leg_age = parsed
            # Levels are relative to the SERVED spot, not the WS tick: after
            # the close those differ (candle close vs chain underlying).
            level = _safe_float(out.get("spot")) or spot
            out = {
                **out,
                "walls": {"calls": top_walls(rows, "ce", spot=level),
                          "puts": top_walls(rows, "pe", spot=level)},
                "walls_near": {"calls": near_walls(rows, "ce", spot=level),
                               "puts": near_walls(rows, "pe", spot=level)},
                "positioning": compute_positioning(rows, level),
                "gex": compute_gex(rows, level),
                "live_overlay": {"source": "ws" if is_open else "ws_closed",
                                 "leg_age_sec": round(leg_age, 1)},
            }
        except Exception:
            out = report
    for key in ("control", "strikes"):
        value = snapshot.get(key)
        if key == "control" and isinstance(value, dict) and value:
            out = {**out, "control": value}
        elif key == "strikes" and isinstance(value, list) and value:
            out = {**out, "strikes": value}
    return out


async def get_live_report(expiry: Optional[str] = None,
                          expiries: Optional[Mapping[Any, Iterable[Any]]] = None,
                          ) -> dict:
    """Live report, preferring the WS snapshot when it is live.

    When ``nifty_md.is_live()`` and the snapshot converts to a full report
    (its option legs are FRESH — see :func:`build_report_from_live`), it is
    built once per ~1s (shared across WS clients) with verdicts attached;
    otherwise this degrades to :func:`get_cached_live` (REST). Never raises
    anything the REST path wouldn't raise.

    ``expiries`` is the optional IV term map (:func:`_compute_live`); supplying
    it bypasses the 1s WS cache because that cache is keyed only on expiry.
    """
    key = expiry or "default"
    if expiries is None:
        try:
            now = time.time()
            hit = _live_ws_cache.get(key)
            if hit and now - hit["ts"] < _LIVE_WS_TTL:
                return hit["data"]
        except Exception:
            pass
    try:
        md = _nifty_md()
        if md is not None and bool(md.is_live()):
            snap = md.snapshot() or {}
            if isinstance(snap, dict) and isinstance(snap.get("legs"), dict):
                exp = expiry or snap.get("expiry") or ""
                if not exp or (expiry is None and exp <= _today_str()):
                    try:
                        from api.options import get_expiries as _get_expiries
                        listing = await _get_expiries("NIFTY")
                        exps = (listing or {}).get("expiries", []) or []
                        future = [e for e in exps if e.get("days_to_expiry", 0) > 0]
                        chosen = future or exps
                        if chosen:
                            exp = chosen[0].get("date", "") or exp
                    except Exception:
                        pass
                try:
                    candles = await asyncio.to_thread(
                        _fetch_nifty_candles_cached, _today_str(), 5)
                except Exception:
                    candles = []
                report = build_report_from_live(snap, exp, candles)
                if report is not None:
                    # Previous-session pivot levels (classic), cached per
                    # process day; None keeps the chart level-free. Resolved
                    # BEFORE the verdicts: the pivots carry the previous
                    # session's close, which the regime block needs to turn
                    # the realised vol into a full-day (like-for-like) figure.
                    try:
                        report["pivots"] = await get_pivots_block(None)
                    except Exception:
                        report["pivots"] = None
                    try:
                        await _attach_verdicts(
                            report, report.get("strikes", []),
                            report.get("spot", 0), None, expiries=expiries)
                    except Exception:
                        pass
                    # Project the WS VIX reading (and any explicit control /
                    # walls blocks the snapshot carries) onto the report.
                    # _attach_verdicts already set report["vix"] to the REST
                    # block (or null); the WS tick is fresher.
                    report = _overlay_ws_blocks(report, snap)
                    if expiries is None:
                        try:
                            _live_ws_cache[key] = {"ts": time.time(), "data": report}
                        except Exception:
                            pass
                    return report
    except Exception:
        pass
    if expiries is None:
        return await get_cached_live(expiry)
    return await get_cached_live(expiry, expiries=expiries)


@router.get("/nifty/live")
async def get_nifty_live(expiry: Optional[str] = Query(default=None, description="Expiry YYYY-MM-DD (default: nearest)")):
    """On-demand Nifty report from the live Upstox option chain (5s TTL)."""
    _ensure_tape_task()
    if expiry:
        validate_date(expiry)
    return await get_cached_live(expiry)


async def _get_cached_sensex() -> dict:
    """Sensex context block behind the shared 5s cache (endpoint + snapshot)."""
    now = time.time()
    hit = _sensex_cache.get("default")
    if hit and now - hit["ts"] < _LIVE_TTL:
        return hit["data"]
    report = await _compute_sensex_live()
    _sensex_cache["default"] = {"ts": now, "data": report}
    return report


@router.get("/nifty/sensex")
async def get_sensex_live():
    """Live Sensex levels for the Nifty report's cross-index context card."""
    return await _get_cached_sensex()


def _with_delta_flip(report: dict) -> dict:
    """Project the corrected blocks onto snapshots recorded before they existed.

    Older snapshots still carry per-leg deltas and greeks in ``strikes``, so
    two blocks can be derived on read by the same pure functions that compute
    them live:

    * ``positioning`` — the delta-flip level (and the class-weighted
      ``initiated`` / ``flow_class``) that did not exist when the snapshot
      was written.
    * ``gex`` — snapshots taken before the lot-size fix carry a GEX inflated
      65× (the OI is already in units, so the lot must not be applied again).
      Re-deriving the block from the same per-leg gamma/OI in ``strikes``
      means a served report can never mix a 65× gex with a corrected
      positioning block.

    The report is returned untouched when there is nothing to derive (no
    ``strikes``), and each block is replaced independently so one failure
    never costs the other.
    """
    if not isinstance(report, dict):
        return report
    strikes = report.get("strikes")
    if not isinstance(strikes, list) or not strikes:
        return report
    out = report
    spot = _safe_float(report.get("spot"))
    positioning = report.get("positioning")
    # Recompute the positioning block when a piece of the CURRENT convention
    # is missing: snapshots taken before the delta-flip existed have no
    # ``delta_flip``, and snapshots taken before the class-weighted flow
    # existed have no ``flow_class`` (their verdict was computed with the
    # signed-delta flow, which disagrees with the class-weighted
    # ``initiated`` on ~94% of the minutes of a session).
    missing = not isinstance(positioning, dict) or (
        "delta_flip" not in positioning or "flow_class" not in positioning)
    if missing:
        try:
            out = {**out, "positioning": compute_positioning(strikes, spot)}
        except Exception:
            pass
    try:
        out = {**out, "gex": compute_gex(strikes, spot)}
    except Exception:
        pass
    return out


#: Last computed breadth payload is served from the 60s cache owned by
#: :mod:`api.reports_api.breadth`. Reading it here never triggers a quote call.
_BREADTH_MAX_AGE_SEC = 900.0

#: Where the last fresh advance/decline reading is kept so a process restart
#: (which empties every in-process cache) still has an honest last-known value
#: to serve instead of ``null``. Tiny JSON, overwritten in place.
_BREADTH_LAST_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "experiments" / "data" / "nifty_breadth" / "last.json")

#: How old the persisted reading may be before it is ignored (a week covers a
#: long weekend without resurrecting a month-old number).
_BREADTH_LAST_MAX_AGE_SEC = 7 * 86_400.0
_BREADTH_LAST: dict = {"loaded": False, "block": None}


def _cached_breadth() -> Optional[dict]:
    """The desk breadth strip from the 60s cache, or ``None`` when cold.

    ``GET /nifty`` must never block on the five-index quote call, so this is a
    cache read only: the desk strip polls ``/api/reports/breadth`` and keeps it
    warm. A payload older than 15 min is dropped rather than serving yesterday's
    closes as today's breadth.
    """
    try:
        from api.reports_api import breadth as breadth_mod
        cache = getattr(breadth_mod, "_cache", None) or {}
        payload = cache.get("payload")
        at = float(cache.get("at") or 0.0)
        if not isinstance(payload, dict) or not payload.get("available"):
            return None
        if not at or time.time() - at > _BREADTH_MAX_AGE_SEC:
            return None
        return {
            "up": payload.get("up"),
            "count": payload.get("count"),
            "rows": payload.get("rows") or [],
            "fetched_at": payload.get("fetched_at"),
        }
    except Exception:
        return None


def _rotation_breadth_state() -> Optional[dict]:
    """Fresh-or-stale India advance/decline state from the rotation cache.

    :func:`api.rotation.cached_breadth` is a cache read — it never fetches the
    universe frame — and returns ``stale``/``as_of`` alongside the percentage.
    Only the India market is accepted: a US risk-off print is not Nifty breadth.
    """
    try:
        from api import rotation
        return rotation.cached_breadth("india")
    except Exception:
        return None


def _cached_rotation_breadth() -> Optional[float]:
    """Advance/decline breadth (%) from the rotation overview cache, fresh only.

    :func:`api.rotation._market_breadth` needs the full universe frame (a slow
    Upstox fetch), but the overview endpoint already computed it and cached the
    result for ``CACHE_TTL_SECONDS``. This is a read of that cache — no fetch.
    An expired entry is not "warm" here; :func:`_breadth_block` serves it as a
    last-known value with ``stale: true`` instead.
    """
    state = _rotation_breadth_state()
    if not state or state.get("stale"):
        return None
    return state.get("advances_pct")


def _load_last_breadth() -> Optional[dict]:
    """The persisted last-known breadth block, or ``None`` (read once)."""
    if _BREADTH_LAST["loaded"]:
        return _BREADTH_LAST["block"]
    _BREADTH_LAST["loaded"] = True
    try:
        with open(_BREADTH_LAST_PATH) as f:
            payload = json.load(f)
        block = payload.get("block") if isinstance(payload, dict) else None
        at = float(payload.get("at") or 0.0)
        if (isinstance(block, dict) and at
                and time.time() - at <= _BREADTH_LAST_MAX_AGE_SEC):
            _BREADTH_LAST["block"] = {**block, "stale": True}
    except (OSError, ValueError, TypeError):
        pass
    return _BREADTH_LAST["block"]


def _persist_last_breadth(block: dict) -> None:
    """Remember a FRESH breadth reading for the next cold start. Never raises."""
    if not isinstance(block, dict) or block.get("advances_pct") is None:
        return
    current = _BREADTH_LAST.get("block") or {}
    if current.get("as_of") == block.get("as_of"):
        return
    _BREADTH_LAST["block"] = dict(block)
    _BREADTH_LAST["loaded"] = True
    try:
        _BREADTH_LAST_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = _BREADTH_LAST_PATH.with_suffix(".json.tmp")
        with open(tmp, "w") as f:
            json.dump({"at": time.time(), "block": block}, f,
                      separators=(",", ":"))
        os.replace(tmp, _BREADTH_LAST_PATH)
    except OSError:
        pass


def _breadth_block() -> Optional[dict]:
    """Read-only breadth for ``GET /nifty``: rotation A/D % + index strip rows.

    Every source is a cache read (rotation overview, desk strip, last-known
    file); when they are all cold the block is omitted, so the request never
    waits on a quote/frame fetch. A cold *rotation* cache does not blank the
    reading: the last value is served with ``as_of`` + ``stale: true``.
    """
    strip = _cached_breadth()
    fresh_pct = _cached_rotation_breadth()
    state = _rotation_breadth_state()
    advances_pct = fresh_pct
    stale = False
    if advances_pct is None and isinstance(state, dict):
        advances_pct = state.get("advances_pct")
        # A value read from an expired overview entry is the last known one.
        stale = advances_pct is not None
    if advances_pct is None and strip is None:
        last = _load_last_breadth()
        return {**last, "stale": True} if isinstance(last, dict) else None

    state = state if isinstance(state, dict) else {}
    block = {
        "advances_pct": advances_pct,
        "advances": state.get("advances"),
        "declines": state.get("declines"),
        "total": state.get("total"),
        "up": (strip or {}).get("up"),
        "count": (strip or {}).get("count"),
        "rows": (strip or {}).get("rows") or [],
        "fetched_at": (strip or {}).get("fetched_at"),
        # When the advance/decline figure was computed; the strip carries its
        # own ``fetched_at`` so each source stays auditable.
        "as_of": state.get("as_of") if advances_pct is not None
        else (strip or {}).get("fetched_at"),
        "stale": stale,
    }
    if advances_pct is not None and not stale:
        _persist_last_breadth(block)
    return block



def _overlay_live_today(report: dict) -> dict:
    """Overlay the live WS feed on TODAY's saved snapshot (no write).

    The background task rewrites the snapshot every
    :data:`SNAPSHOT_REFRESH_SEC`, but a wall relocation can happen inside that
    window. ``GET /nifty`` serves the saved file, so projecting the WS blocks
    here keeps the served report current without touching the file. Past dates
    are never overlaid (the WS feed describes today).
    """
    try:
        md = _nifty_md()
        if md is None or not bool(md.is_live()):
            return report
        snap = md.snapshot() or {}
        if not isinstance(snap, dict):
            return report
        return _overlay_ws_blocks(report, snap)
    except Exception:
        return report


def _derived_snapshot(date_str: str, data: dict) -> dict:
    """``_with_delta_flip`` behind the snapshot's (mtime_ns, size) stamp.

    ``GET /nifty`` is polled every 1-2s while ``nifty_snapshot_task`` rewrites
    the file every 20s; re-deriving the positioning/GEX blocks on every poll
    recomputed the same answer ~10-20 times per version. The cache key is the
    file stamp, so a new snapshot (or a replayed past day) invalidates it.
    Returns a top-level copy — the cached dict is never handed out for mutation.
    """
    try:
        stat = snapshot_path(date_str).stat()
    except OSError:
        return _with_delta_flip(data)
    key = str(snapshot_path(date_str))
    cached = _DERIVED_SNAPSHOT_CACHE.get(key)
    if (cached is not None and cached[0] == stat.st_mtime_ns
            and cached[1] == stat.st_size):
        return dict(cached[2])
    out = _with_delta_flip(data)
    if len(_DERIVED_SNAPSHOT_CACHE) >= 16:
        _DERIVED_SNAPSHOT_CACHE.clear()
    _DERIVED_SNAPSHOT_CACHE[key] = (stat.st_mtime_ns, stat.st_size, out)
    return dict(out)


@router.get("/nifty")
def get_nifty_report(date: Optional[str] = Query(default=None, description="Snapshot date YYYY-MM-DD (default: today)")):
    """Serve the saved Nifty snapshot for ``date``; 404 envelope when missing."""
    date_str = validate_date(date or _today_str())
    data = read_snapshot(date_str)
    if data is None:
        raise HTTPException(status_code=404, detail={
            "is_trading_day": False,
            "date": date_str,
            "message": f"no Nifty snapshot for {date_str}",
        })
    data = _derived_snapshot(date_str, data)
    if date_str == _today_str():
        data = _overlay_live_today(data)
        # After the close the served spot is the last valid candle close, even
        # when the WS feed is no longer "live" enough to overlay (the saved
        # snapshot's chain spot carries the forward basis — 23,810.85 vs a
        # 23,731.85 index close on 2026-11-03).
        data = reconcile_closed_market_spot(data)
        breadth = _breadth_block()
        if breadth is not None:
            data = {**data, "breadth": breadth}
    return data


class NiftySnapshotRequest(BaseModel):
    date: Optional[str] = None
    expiry: Optional[str] = None
    #: Archive a PAST day instead of overwriting the live record. A snapshot
    #: is always built from LIVE data, so writing one under a past date
    #: replaced that day's real report with today's tape. With ``force`` the
    #: result is written to the archive path (``nifty_reports/archive/``) and
    #: the day's own record and replay log are left untouched.
    force: bool = False


#: Where a forced (past-day) snapshot is archived. Kept OUT of the served
#: directory so ``GET /nifty?date=`` can never return an archived copy.
SNAPSHOT_ARCHIVE_DIR = SNAPSHOT_DIR / "archive"


@router.post("/nifty/snapshot", dependencies=[Depends(get_current_user)])
async def create_nifty_snapshot(body: NiftySnapshotRequest):
    """Build a snapshot from live data and persist it under ``date``.

    Requires authentication (it writes to the day's record). A snapshot is
    always built from LIVE data, so it may only be stored under TODAY's date;
    asking for a past date is rejected with 400 unless ``force`` is set, in
    which case the result is archived (``nifty_reports/archive/<date>.json``)
    and the past day's record and replay log are left alone. A past day's
    replay log is never appended to with a ``now`` stamp.
    """
    date_str = validate_date(body.date or _today_str())
    if body.expiry:
        validate_date(body.expiry)
    today = _today_str()
    is_today = date_str == today
    if not is_today and not body.force:
        raise HTTPException(status_code=400, detail={
            "date": date_str,
            "today": today,
            "message": (
                "a snapshot is built from live data and may only be stored "
                f"under today ({today}); pass force=true to archive it"),
        })
    report = await _compute_live(body.expiry, for_date=date_str, walkback_days=0)
    snapshot = _build_snapshot_dict(report, date_str)
    if is_today:
        write_snapshot(date_str, snapshot)
    else:
        # Archive only: the past day's own record must not be replaced by a
        # frame that describes today's market.
        SNAPSHOT_ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
        archive = SNAPSHOT_ARCHIVE_DIR / f"{date_str}.json"
        tmp = archive.with_suffix(".json.tmp")
        with open(tmp, "w") as f:
            json.dump({**snapshot, "archived_at": snapshot["snapshot_at"]},
                      f, separators=(",", ":"))
        os.replace(tmp, archive)
    # Also land it in the replay log (one line) so a manual/EOD snapshot is
    # replayable even on a day the per-minute recorder never ran. ONLY for
    # today: a past day's log must never receive a frame stamped with "now".
    if is_today:
        try:
            sensex = None
            try:
                sensex = await _get_cached_sensex()
            except Exception:
                sensex = None
            _append_snapshot_line(date_str,
                                  snapshot.get("snapshot_at") or datetime.now(config.IST).isoformat(),
                                  report, sensex)
        except Exception:
            pass
    return snapshot


async def nifty_snapshot_task() -> None:
    """Keep today's Nifty snapshot fresh (target: ≤35s) during market hours.

    The snapshot is what ``GET /nifty`` serves; before this task it was only
    written by the SNAPSHOT button, so control/positioning/walls could be
    hours old while spot/VIX were overlaid live. Only the snapshot file is
    written here — the replay log stays owned by the tape recorder.

    Cadence: each iteration reuses the 10s chain poller's frame
    (:func:`_chain10s_chain`), so the build no longer pays a ~50s REST chain
    call; the sleep is then computed against a WALL-CLOCK target
    (:data:`SNAPSHOT_REFRESH_SEC`, 20s) instead of a fixed 60s *after* the
    build. The old shape produced 60s + ~50s ≈ 110s between ``snapshot_at``
    stamps. A build slower than the target (REST fallback when the poller is
    down) simply runs back-to-back with no sleep.
    """
    while True:
        started = time.time()
        try:
            from trading.utils import is_derivatives_open
        except Exception:  # pragma: no cover - import guard
            is_derivatives_open = lambda: False  # type: ignore[assignment]
        try:
            if is_derivatives_open():
                date_str = _today_str()
                report = await _compute_live(None, for_date=date_str, walkback_days=0)
                snapshot = _build_snapshot_dict(report, date_str)
                write_snapshot(date_str, snapshot)
        except Exception:
            pass
        elapsed = time.time() - started
        await asyncio.sleep(max(1.0, SNAPSHOT_REFRESH_SEC - elapsed))


# ---------------------------------------------------------------------------
# OI tape: per-minute time series of the Nifty chain
# ---------------------------------------------------------------------------

# stock-screener-ui/api/reports_api/nifty.py -> parents[2] == stock-screener-ui
TAPE_DIR = Path(__file__).resolve().parent.parent.parent / "experiments" / "data" / "nifty_tape"
#: Parsed tape rows keyed by path, validated on (mtime_ns, size). The file is
#: appended once a minute while the snapshot build reads it every 20s.
_TAPE_READ_CACHE: dict[str, tuple[int, int, list[dict]]] = {}
TAPE_INTERVAL_SEC = 60
# Keep one slow upstream request from pushing the next tape attempt into the
# following minute.  The loop is wall-clock paced below, so a timed-out tick
# leaves a short recovery window before the next scheduled attempt.
TAPE_TICK_TIMEOUT_SEC = 55


def tape_path(date_str: str) -> Path:
    return TAPE_DIR / f"{date_str}.jsonl"


def gap_log_path(date_str: str) -> Path:
    return TAPE_DIR / f"{date_str}.gaps.jsonl"


def _tick_stamp(now: Optional[datetime] = None) -> tuple[str, str]:
    """ISO stamp + ``YYYY-MM-DD`` for a recorder tick (IST)."""
    ts = now or datetime.now(config.IST)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=config.IST)
    t_iso = ts.isoformat()
    return t_iso, t_iso[:10]


def _err_detail(exc: BaseException) -> str:
    """One-line detail of a failure (gap journal / log). Never raises."""
    try:
        return f"{type(exc).__name__}: {str(exc)[:180]}"
    except Exception:
        return type(exc).__name__


#: Minutes already recorded in the day's gap journal (in-process cache), so a
#: skipped minute is journalled ONCE even when two recorder loops (or a retry)
#: hit the same minute. The journal counts MISSING MINUTES, not attempts.
_GAP_MINUTES: dict[str, set[str]] = {}


def _gap_minutes_seen(date_str: str) -> set[str]:
    """Minutes already present in the day's gap journal (loaded once per day).

    The cache is keyed by the journal PATH, not by the date: the journal
    directory can be redirected (tests, archives) and a date-keyed cache would
    then report minutes as "already journalled" that were never written to
    the file in front of it.
    """
    path = gap_log_path(date_str)
    key = str(path)
    cached = _GAP_MINUTES.get(key)
    if cached is not None:
        return cached
    seen: set[str] = set()
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    t = json.loads(line).get("t")
                except (json.JSONDecodeError, ValueError):
                    continue
                if isinstance(t, str) and t:
                    seen.add(t[:16])
    except OSError:
        pass
    _GAP_MINUTES[key] = seen
    return seen


def _append_gap(date_str: str, t_iso: str, reason: str, detail: str = "") -> None:
    """Best-effort append of one *skipped* minute to the day's gap journal.

    The recorder's skip reasons used to live only in memory
    (``_tape_last_skip``) while the API log is truncated (``: >`` in
    start.sh) on every restart — so "why are there holes in yesterday?" was
    unanswerable. This is the durable, append-only record: one
    ``{"t", "reason"}`` line per skipped minute. Never raises.

    ``detail`` carries the failure text (e.g. the 401) without changing the
    ``reason`` key, so the reason COUNTS stay one-per-kind.

    Deduped by MINUTE: the journal answers "which minutes are missing and
    why", so a minute that was skipped twice (two recorder loops, a retry)
    is journalled once — otherwise the coverage numbers claim more missing
    minutes than the session actually had.
    """
    try:
        minute = str(t_iso)[:16]
        seen = _gap_minutes_seen(date_str)
        if minute in seen:
            return
        TAPE_DIR.mkdir(parents=True, exist_ok=True)
        entry = {"t": t_iso, "reason": reason}
        if detail:
            entry["detail"] = str(detail)[:200]
        with open(gap_log_path(date_str), "a") as f:
            f.write(json.dumps(entry) + "\n")
        seen.add(minute)
    except Exception:
        pass


def read_gap_reasons(date_str: str) -> dict:
    """``{reason: number of missing minutes}`` from the day's gap journal.

    Counts DISTINCT minutes per reason (a journal written by an older build
    can hold several entries for one minute), so the numbers describe
    MISSING MINUTES rather than skip attempts. ``{}`` when absent.

    Days recorded before the journal existed simply have no file — the UI
    treats a missing journal as "reasons not recorded" and falls back to the
    coverage numbers alone.
    """
    path = gap_log_path(date_str)
    if not path.exists():
        return {}
    counts: dict[str, int] = {}
    seen: set[tuple[str, str]] = set()
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                reason = entry.get("reason")
                if not isinstance(reason, str) or not reason:
                    continue
                t = entry.get("t")
                key = (str(t)[:16] if isinstance(t, str) else "", reason)
                if key in seen:
                    continue
                seen.add(key)
                counts[reason] = counts.get(reason, 0) + 1
    except OSError:
        return {}
    return counts


def read_tape(date_str: str) -> list[dict]:
    """Raw tape rows for ``date_str`` (JSONL, one snapshot per line).

    Skips blank/corrupt lines; returns [] when the file is missing.

    The parsed rows are cached against ``(mtime_ns, size)``: the snapshot build
    re-reads this file every 20s and the file only grows once a minute, so two
    of three builds used to spend ~40 ms re-parsing an unchanged 2.6 MB JSONL
    (the tape tick and the bursts/stream feeds paid it too). A caller gets a
    fresh list (rows are read-only) so appending cannot poison the cache.
    """
    path = tape_path(date_str)
    try:
        stat = path.stat()
    except OSError:
        return []
    key = str(path)
    cached = _TAPE_READ_CACHE.get(key)
    if (cached is not None and cached[0] == stat.st_mtime_ns
            and cached[1] == stat.st_size):
        return list(cached[2])
    rows: list[dict] = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except (json.JSONDecodeError, ValueError):
                    continue
    except OSError:
        return []
    if len(_TAPE_READ_CACHE) >= 8:
        _TAPE_READ_CACHE.clear()
    _TAPE_READ_CACHE[key] = (stat.st_mtime_ns, stat.st_size, rows)
    return list(rows)


# ---------------------------------------------------------------------------
# Full per-minute replay snapshots (the exact report envelope the UI renders)
# ---------------------------------------------------------------------------

#: One JSONL line per minute: ``{"t", "fetched_at", "report", "sensex"}`` where
#: ``report`` is the FULL envelope ``/api/reports/nifty/live`` returns, so the
#: whole report screen can be replayed after the day ends (single source of
#: truth: recorded once per minute here, served by ``/nifty/replay``).
SNAPSHOT_LOG_DIR = Path(__file__).resolve().parent.parent.parent / "experiments" / "data" / "nifty_snapshots"


def snapshot_log_path(date_str: str) -> Path:
    return SNAPSHOT_LOG_DIR / f"{date_str}.jsonl"


def read_snapshots(date_str: str) -> list[dict]:
    """Full replay snapshot lines for ``date_str`` (JSONL, appended per minute).

    Skips blank/corrupt/non-object lines; returns [] when the file is missing.
    Every line the recorder writes is a ``{"t", ..., "report": {...}}`` object,
    so anything else is corruption from an interrupted write.

    The lines are returned in ASCENDING ``t`` order and de-duplicated by
    MINUTE (``t[:16]``). A log written by two recorder loops can hold the
    same minute twice (and out of order — a 10:01 frame appended after a
    15:04 one), and the replay cursor ("the frame at or before ``t``") is
    only meaningful on an ordered, unique list.
    """
    path = snapshot_log_path(date_str)
    if not path.exists():
        return []
    rows: list[dict] = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    value = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                if not isinstance(value, dict):
                    continue
                rows.append(value)
    except OSError:
        return []
    rows.sort(key=lambda r: str(r.get("t") or ""))
    out: list[dict] = []
    seen: set[str] = set()
    for row in rows:
        minute = str(row.get("t") or "")[:16]
        if minute and minute in seen:
            continue
        if minute:
            seen.add(minute)
        out.append(row)
    return out


def _tail_last_json_line(path: Path, chunk: int = 65536) -> Optional[dict]:
    """Last complete JSON object in a growing JSONL file, reading only the tail.

    These logs reach tens of MB by the close, and both the tape and snapshot
    writers only need the final line. Reading the whole file every minute was
    O(file) blocking work; this is O(1) (last ``chunk`` bytes, growing if the
    last line is longer). Never raises.
    """
    try:
        if not path.exists():
            return None
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            window = min(chunk, size)
            while True:
                f.seek(size - window)
                data = f.read(window)
                lines = [ln for ln in data.split(b"\n") if ln.strip()]
                if len(lines) >= (1 if window == size else 2) or window == size:
                    break
                window = min(window * 2, size)
        if not lines:
            return None
        value = json.loads(lines[-1])
        return value if isinstance(value, dict) else None
    except Exception:
        return None


#: Minutes already written to the day's replay log (in-process cache). The
#: log is de-duplicated by MINUTE, so a second frame for a minute that is
#: already there is refused - including a frame that arrives out of order
#: (the old "last line" check only saw the tail and let 10:01 in twice).
_SNAPSHOT_MINUTES: dict[str, set[str]] = {}


def _snapshot_minutes(date_str: str) -> set[str]:
    """Minutes already present in the day's replay log (loaded once per day).

    Cached by the log PATH, not by the date: the log directory can be
    redirected (tests, archives) and a date-keyed cache would then report
    minutes as "already written" that were never written to the file in front
    of it — the snapshot was silently dropped for the rest of the session.
    """
    path = snapshot_log_path(date_str)
    key = str(path)
    cached = _SNAPSHOT_MINUTES.get(key)
    if cached is not None:
        return cached
    seen: set[str] = set()
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    value = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                t = value.get("t") if isinstance(value, dict) else None
                if isinstance(t, str) and t:
                    seen.add(t[:16])
    except OSError:
        pass
    _SNAPSHOT_MINUTES[key] = seen
    return seen


def _peek_last_snapshot_t(path: Path) -> Optional[str]:
    """The last snapshot line's ``t`` (minute dedupe anchor) — never raises."""
    last = _tail_last_json_line(path)
    t = last.get("t") if last else None
    return str(t) if t else None


def _append_snapshot_line(date_str: str, t_iso: str,
                          report: Optional[dict],
                          sensex: Optional[dict]) -> Optional[dict]:
    """Append ONE snapshot line to the replay log (deduped by minute).

    The lower-level writer shared by the per-minute recorder and the manual/EOD
    snapshot path. Never raises; returns the line on success.

    An empty/all-zero-OI report is refused: those are failed fetches, and a
    persisted empty row is what made the replay and burst views read a
    ``net_total: 0 / regime: "flat" / max_pain: 0`` frame as real data.
    """
    try:
        if not isinstance(report, dict) or not report:
            return None
        if not has_usable_chain(report.get("strikes")):
            return None
        # De-duplicate by MINUTE, not by the exact stamp: two recorder loops
        # (or a manual snapshot) used to write the same minute twice with
        # different sub-second stamps, and the out-of-order pair (10:01 after
        # 15:04) broke the replay cursor.
        minute = str(t_iso)[:16]
        seen = _snapshot_minutes(date_str)
        if minute and minute in seen:
            return None
        line = {
            "t": t_iso,
            "fetched_at": report.get("fetched_at"),
            # Stamped on the LINE as well as inside the report so a replay
            # consumer can tell what a frame is without walking into it.
            "mode": report.get("mode", "snapshot"),
            "snapshot_at": report.get("snapshot_at") or t_iso,
            "source": report.get("source", "upstox-option-chain"),
            "report": report,
            "sensex": sensex,
        }
        SNAPSHOT_LOG_DIR.mkdir(parents=True, exist_ok=True)
        with open(snapshot_log_path(date_str), "a") as f:
            f.write(json.dumps(line) + "\n")
        if minute:
            seen.add(minute)
        return line
    except Exception:
        return None


async def _append_minute_snapshot(date_str: str, t_iso: str,
                                  report: Optional[dict] = None) -> Optional[dict]:
    """Append ONE full-report snapshot line for tick minute ``t_iso``.

    ``report`` is the full envelope ``/nifty/live`` renders (strikes, gex,
    positioning, control/regime/vix/strength, pivots, reference, intraday,
    emas, market). The recorder passes the report it already fetched; when it
    is omitted (manual/EOD callers) a full pass is made here.

    Historically this ALWAYS did a second ``_compute_live`` pass per minute on
    top of the tape row's pass — two chain fetches, two Sensex builds and two
    expiry listings every minute, each of which could stall the event loop.
    Callers that already have the report must pass it.

    Deduped by minute (skipped when the file's last line carries the same
    ``t``) and NEVER raises — a snapshot failure must not stop the light tape
    row, which is written before this runs.
    """
    try:
        # Minute de-duplication (the writer refuses a minute that is already
        # in the log) replaces the old "last line == this stamp" check, which
        # only ever saw the tail of the file.
        if str(t_iso)[:16] in _snapshot_minutes(date_str):
            return None
        if not isinstance(report, dict) or not report:
            report = await _compute_live(None, walkback_days=0,
                                         with_verdicts=True, with_candles=True)
        if not has_usable_chain(report.get("strikes")):
            return None
        sensex: Optional[dict] = None
        try:
            sensex = await _get_cached_sensex()
        except Exception:
            sensex = None
        # JSON encoding + append are blocking; keep them off the event loop.
        return await asyncio.to_thread(
            _append_snapshot_line, date_str, t_iso, report, sensex)
    except Exception:
        return None


def drop_empty_chain_rows(rows: list[dict]) -> list[dict]:
    """Rows carrying no usable chain — a failed fetch, not a market state.

    On 2026-10-14 the recorder persisted rows with ``ce_oi = pe_oi = 0``,
    ``strikes_top`` empty and ``pcr_oi = 0.00`` (10:08 and 11:42). The next good
    row then difference against them and looked like a +121M one-minute OI
    build, which scored as a CRITICAL burst. An empty snapshot is not a data
    point, so it is dropped on read as well as no longer written.
    """
    out: list[dict] = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        strikes = r.get("strikes_top")
        total_oi = _safe_int(r.get("ce_oi")) + _safe_int(r.get("pe_oi"))
        # The observed corruption is an all-zero snapshot (no OI, no strikes);
        # `== 0` rather than `<= 0` so a synthetic negative is not swept up.
        if total_oi == 0 and not strikes:
            continue
        out.append(r)
    return out


def drop_implausible_spots(rows: list[dict]) -> list[dict]:
    """Drop single-row spot spikes that the market immediately retracts.

    On 2026-10-14 two rows recorded 22,363 while the real market was ~22,690
    (1.56% out), which skewed the displayed session range and the EMA20 trend
    gate every burst signal is filtered through.

    A plain "jump too big" test is WRONG: a recorder gap followed by a genuine
    move looks identical. On 2026-10-15 the tape missed 61 minutes and the real
    +0.98% re-open tripped the threshold, so the last *accepted* row never
    advanced and EVERY row after the gap was rejected — the tape silently ended
    at 09:23 while the file held 13 rows.

    A bad row is one the market RETRACTS. A row is dropped only when one of the
    next ``LOOKAHEAD`` rows comes back to within ``SPOT_JUMP_MAX`` of the last
    accepted value (the 10-14 pair needed lookahead because both rows were bad);
    a sustained move is kept and re-anchors the baseline.
    """
    src = [r for r in (rows or []) if isinstance(r, dict)]
    kept: list[dict] = []
    prev: Optional[float] = None
    i = 0
    while i < len(src):
        row = src[i]
        spot = _safe_float(row.get("spot")) or None
        if spot and prev and abs(spot - prev) / prev > SPOT_JUMP_MAX:
            retracted = False
            for nxt_row in src[i + 1:i + 1 + SPOT_LOOKAHEAD]:
                nxt = _safe_float(nxt_row.get("spot")) or None
                if nxt and abs(nxt - prev) / prev <= SPOT_JUMP_MAX:
                    retracted = True
                    break
            if retracted:
                i += 1
                continue  # a spike the market took back — drop it
        if spot:
            prev = spot
        kept.append(row)
        i += 1
    return kept


def derive_tape_rows(raw_rows: list[dict]) -> list[dict]:
    """Attach derived deltas to raw tape rows.

    Formulas (all deltas vs the day's FIRST row unless noted):
      - ``call_doi = ce_oi - first.ce_oi`` (whole contracts, int)
      - ``put_doi  = pe_oi - first.pe_oi`` (whole contracts, int)
      - ``net      = put_doi - call_doi`` (whole contracts, int;
        positive = put-side OI building faster than call-side)
      - ``net_pct  = 100 * net / (|call_doi| + |put_doi|)`` rounded 2dp;
        0.0 when the denominator is 0 (e.g. the first row). Absolute-share
        denominator: stays sane on expiry-day unwinding when total ΔOI
        itself goes negative.
      - ``call_tick = ce_vol - prev_row.ce_vol`` (0 for the first row;
        whole contracts, int; Upstox volume is cumulative so the diff
        is the minute's traded volume)
      - ``put_tick`` likewise for ``pe_vol``
      - ``pcr_doi  = pcr_oi - first.pcr_oi`` rounded 2dp
      - ``spot_flip = spot - flip`` rounded 2dp; None when ``flip`` is null
    Raw keys are preserved; derived keys are added.

    The rows are SORTED by ``t`` before anything is differenced. The file is
    append-only, but two recorder loops (or a late write) can land a row out
    of order — and differencing an out-of-order pair produced a NEGATIVE
    per-minute volume (10:01 on 2026-10-21: ``call_tick`` −2.56M) that then
    read as a huge one-minute OI collapse.
    """
    raw_rows = drop_empty_chain_rows(drop_implausible_spots(raw_rows))
    raw_rows = sorted(raw_rows, key=lambda r: str((r or {}).get("t") or ""))
    if not raw_rows:
        return []
    first = raw_rows[0]
    f_ce = _safe_int(first.get("ce_oi"))
    f_pe = _safe_int(first.get("pe_oi"))
    f_pcr = _safe_float(first.get("pcr_oi"))
    out: list[dict] = []
    prev_ce_vol: Optional[int] = None
    prev_pe_vol: Optional[int] = None
    for i, r in enumerate(raw_rows):
        ce_oi = _safe_int(r.get("ce_oi"))
        pe_oi = _safe_int(r.get("pe_oi"))
        ce_vol = _safe_int(r.get("ce_vol"))
        pe_vol = _safe_int(r.get("pe_vol"))
        pcr_oi = _safe_float(r.get("pcr_oi"))
        spot = _safe_float(r.get("spot"))
        flip = r.get("flip")
        # OI deltas vs the day's first row (whole contracts).
        call_doi = ce_oi - f_ce
        put_doi = pe_oi - f_pe
        # Net build: put-side DOI minus call-side DOI.
        net = put_doi - call_doi
        # Net as % of absolute positioning flow; guarded against zero.
        denom = abs(call_doi) + abs(put_doi)
        net_pct = round(100.0 * net / denom, 2) if denom != 0 else 0.0
        # Per-minute traded volume = cumulative-volume diff vs prev row.
        if i == 0:
            call_tick = 0
            put_tick = 0
        else:
            call_tick = ce_vol - (prev_ce_vol if prev_ce_vol is not None else ce_vol)
            put_tick = pe_vol - (prev_pe_vol if prev_pe_vol is not None else pe_vol)
            # A cumulative-volume counter that resets (or a row that arrives
            # out of order) yields a negative minute volume. Traded volume is
            # never negative, so the artefact is floored at zero instead of
            # being published as a real sell-off.
            call_tick = max(0, call_tick)
            put_tick = max(0, put_tick)
        # PCR-OI drift vs the day's first row.
        pcr_doi = round(pcr_oi - f_pcr, 2)
        # Distance of spot above/below the GEX flip level.
        try:
            spot_flip = round(spot - float(flip), 2) if flip is not None else None
        except (TypeError, ValueError):
            spot_flip = None
        out.append({**r,
                    "call_doi": call_doi, "put_doi": put_doi,
                    "net": net, "net_pct": net_pct,
                    "call_tick": call_tick, "put_tick": put_tick,
                    "pcr_doi": pcr_doi, "spot_flip": spot_flip})
        prev_ce_vol = ce_vol
        prev_pe_vol = pe_vol
    return out


def _atm_premium_snapshot(strikes: list, spot: float) -> tuple[Optional[float], Optional[float], Optional[float]]:
    """``(atm_strike, ce_ltp, pe_ltp)`` for the strike nearest spot.

    Skips strikes where BOTH legs are effectively dead (expiry-day < ₹1), and
    stores ``None`` for an individual dead leg, so the snapshot is always
    useful: on expiry day the ATM strike typically has one live leg.
    Returns ``(None, None, None)`` when nothing qualifies.
    """
    best = None
    for r in strikes or []:
        try:
            strike = _safe_float(r.get("strike"))
            ce = _safe_float((r.get("ce") or {}).get("ltp"))
            pe = _safe_float((r.get("pe") or {}).get("ltp"))
        except Exception:
            continue
        if not strike or (ce < 1.0 and pe < 1.0):
            continue
        dist = abs(strike - spot) if spot else 0.0
        if best is None or dist < best[0]:
            best = (dist, strike, ce if ce >= 1.0 else None, pe if pe >= 1.0 else None)
    if best is None:
        return None, None, None
    return best[1], best[2], best[3]


def _premium_chain_snapshot(strikes: list, spot: float,
                            n: Optional[int] = None) -> dict:
    """``{"strike": [ce_ltp, pe_ltp, ce_oi, pe_oi, ce_vol, pe_vol]}``.

    ``n=None`` records **every** strike in the chain: the paper engine marks a
    position at its entry strike, and per-strike OI/volume let walls, PCR and
    per-strike flow be rebuilt later from the tape alone. A dead leg is stored as
    ``null`` rather than ``0`` so "no trade" is distinguishable from "no price".
    Pass ``n`` to keep only ATM +/- n strikes (a smaller row).
    """
    out: dict = {}
    if not strikes or not spot:
        return out
    ordered = sorted(strikes,
                     key=lambda r: abs(_safe_float(r.get("strike")) - spot))
    for r in (ordered if not n else ordered[: 2 * n + 1]):
        k = _safe_float(r.get("strike"))
        if not k:
            continue
        ce, pe = (r.get("ce") or {}), (r.get("pe") or {})

        def _g(leg: dict, key: str):
            v = _safe_float(leg.get(key))
            return v if v > 0 else None

        out[str(int(k))] = [_g(ce, "ltp"), _g(pe, "ltp"), _g(ce, "oi"),
                            _g(pe, "oi"), _g(ce, "volume"), _g(pe, "volume")]
    return out


def _strike_oi_snapshot(strikes: list, spot: float, n: int = 3) -> list[dict]:
    """ATM ± ``n`` strikes with both legs' OI, for per-strike burst detection.

    The index totals in a tape row dilute a single strike exploding (16M at one
    strike is a rounding error across 100+ strikes), so the alert could never
    say WHICH strike. Empty list when nothing is usable.
    """
    rows = []
    for r in strikes or []:
        try:
            strike = _safe_float(r.get("strike"))
        except Exception:
            continue
        if not strike:
            continue
        rows.append({
            "strike": strike,
            "ce_oi": _safe_int((r.get("ce") or {}).get("oi")),
            "pe_oi": _safe_int((r.get("pe") or {}).get("oi")),
        })
    if not rows or not spot:
        return []
    rows.sort(key=lambda x: abs(x["strike"] - spot))
    kept = rows[: max(1, 2 * n + 1)]
    kept.sort(key=lambda x: x["strike"])
    return kept


#: Max chain-vs-index disagreement tolerated before the index quote wins (0.25%).
SPOT_CHAIN_DEV_MAX = 0.0025
#: Max minute-over-minute spot move accepted without an independent confirmation.
#: 0.75% (~170 pts) is calibrated against the recorded tapes: on 2026-10-14 it
#: isolates exactly the three corrupt rows (12:53, 12:54, 13:19) and drops no
#: legitimate ones, while 0.50% cascades and discards 16 good rows behind them.
SPOT_JUMP_MAX = 0.0075
#: How many following rows may confirm that a spike was retracted. The
#: 2026-10-14 corruption came as a PAIR (12:53 and 12:54 both wrong), so a
#: single-row check would have missed it.
SPOT_LOOKAHEAD = 3


def reconcile_spot(chain_spot: float, index_spot: Optional[float],
                   last_spot: Optional[float],
                   *, chain_dev_max: float = SPOT_CHAIN_DEV_MAX,
                   jump_max: float = SPOT_JUMP_MAX) -> Optional[float]:
    """The most trustworthy spot for a tape row, or ``None`` to drop the row.

    Upstox's ``/option/chain`` ``underlying_spot_price`` went badly wrong on
    2026-10-14: two rows recorded 22,363 while the real market was ~22,690
    (~1.5% off, and inconsistent with the row's own ATM strike). A bad spot
    poisons the EMA20 trend gate every burst signal is filtered through, so it
    is cross-checked against the index quote and the previous row first.

    ``index_spot`` failing (e.g. an expired token) is fine — the jump check then
    stands alone and the row is dropped rather than persisted wrong.
    """
    spot = _safe_float(chain_spot) or None
    index = _safe_float(index_spot) or None
    last = _safe_float(last_spot) or None

    # 1. Prefer the index quote when the chain value disagrees materially.
    if index and (spot is None or abs(spot - index) / index > chain_dev_max):
        spot = index
    if spot is None:
        return None

    # 2. Drop a jump too large to be real — unless an independent quote agrees
    #    (a genuine gap move is allowed through when the index quote confirms).
    if last and abs(spot - last) / last > jump_max:
        confirmed = index is not None and abs(index - last) / last > jump_max
        if not confirmed:
            return None
    return spot


def _peek_last_tape_row(path: Path, minute: str) -> tuple[Optional[float], bool]:
    """``(last row's spot, last row shares this minute)`` — never raises."""
    last = _tail_last_json_line(path)
    if not last:
        return None, False
    last_spot = _safe_float(last.get("spot")) or None
    return last_spot, str(last.get("t", ""))[:16] == minute


def _append_tape_line(path: Path, row: dict) -> None:
    """Append one JSON line to the day's tape (blocking; call via a thread)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as f:
        f.write(json.dumps(row) + "\n")


async def record_nifty_tape_tick(now: Optional[datetime] = None) -> Optional[dict]:
    """Record ONE per-minute tape row from the live chain; never raises.

    ONE ``_compute_live(None)`` pass (nearest expiry) serves BOTH the tape row
    (aggregates ``{t, spot, ce_oi, pe_oi, ce_vol, pe_vol, pcr_oi, pcr_vol,
    max_pain, flip, walls, expiry, atm_strike, atm_ce_ltp, atm_pe_ltp}``) and
    the full replay snapshot. An empty/all-zero-OI chain is skipped, never
    persisted. Rows sharing the same IST minute bucket as the file's last row
    are skipped (returns None). ALL exceptions are swallowed — returns the row
    on success, None otherwise — but a failure is LOGGED and journalled with
    its reason (an Upstox 401 must be visible, not a silent hole).
    """
    global _tape_last_skip, _tape_last_error
    _tape_last_error = None
    # ONE computation per minute serves both the light tape row and the full
    # replay snapshot. This used to be two separate ``_compute_live`` passes
    # (one light, one full), i.e. two chain fetches + two Sensex builds every
    # minute; the extra pass bought nothing (the tape row reads aggregates that
    # the full report already contains) and doubled the per-minute stall budget.
    try:
        report = await _compute_live(None, walkback_days=0, with_verdicts=True,
                                     with_candles=True)
    except Exception as exc:
        # A dead upstream (401 / network) is a bad MINUTE, not a dead
        # recorder: log it, journal it, and let the next tick try again.
        _tape_last_skip = "chain-failed"
        _tape_last_error = f"chain fetch failed: {type(exc).__name__}: {str(exc)[:160]}"
        stamp, gdate = _tick_stamp(now)
        _append_gap(gdate, stamp, "chain-failed", _err_detail(exc))
        logger.warning("nifty tape: chain fetch failed (%s) — retrying next tick: %s",
                       type(exc).__name__, exc)
        return None
    try:
        ts = now or datetime.now(config.IST)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=config.IST)
        t_iso = ts.isoformat()
        date_str = ts.strftime("%Y-%m-%d")
        path = tape_path(date_str)
        minute = t_iso[:16]
        # Serialise the read-check + write per day: two ticks that both read
        # "the last row is minute X" would both write minute X+1.
        async with _tape_lock(date_str):
            return await _write_tape_row(report, date_str, t_iso, ts, path, minute)
    except Exception as exc:
        _tape_last_skip = "chain-failed"
        _tape_last_error = f"tape write failed: {type(exc).__name__}: {str(exc)[:160]}"
        stamp, gdate = _tick_stamp(now)
        _append_gap(gdate, stamp, "chain-failed", _err_detail(exc))
        logger.warning("nifty tape: row write failed (%s) — retrying next tick: %s",
                       type(exc).__name__, exc)
        return None


async def _write_tape_row(report: dict, date_str: str, t_iso: str, ts: datetime,
                          path: Path, minute: str) -> Optional[dict]:
    """Write ONE tape row (and its replay frame). Caller holds the day lock."""
    # The skip reason is published on the module (the status endpoint reads
    # it), so it MUST be declared global here — without it every assignment
    # below created a function-local variable and the status always reported
    # "no skip" (e.g. "empty-chain" never reached the caller).
    global _tape_last_skip
    try:
        last_spot, same_minute = await asyncio.to_thread(
            _peek_last_tape_row, path, minute)
        if same_minute:
            _tape_last_skip = "same-minute"
            return None
        # Cross-check before anything derives from the spot (ATM, strikes_top).
        # The independent quote is bought LAZILY: only when the chain value is
        # worth confirming. A normal tick (or the day's first row) costs no
        # extra network call, so the 1-minute recorder stays cheap.
        spot_chain = _safe_float(report.get("spot"))
        index_spot = None
        if last_spot and (spot_chain <= 0
                          or abs(spot_chain - last_spot) / last_spot > SPOT_CHAIN_DEV_MAX):
            try:
                from api.options import get_spot_price
                index_spot = (await get_spot_price("NIFTY")).get("spot")
            except Exception:
                index_spot = None
        spot = reconcile_spot(spot_chain, index_spot, last_spot)
        if spot is None:
            global _tape_spot_rejections
            _tape_spot_rejections += 1
            _tape_last_skip = "spot-rejected"
            _append_gap(date_str, t_iso, "spot-rejected")
            return None
        strikes = report.get("strikes", []) or []
        ce_oi = sum(_safe_int((r.get("ce") or {}).get("oi")) for r in strikes)
        pe_oi = sum(_safe_int((r.get("pe") or {}).get("oi")) for r in strikes)
        # An empty chain is a failed fetch, not a market state: writing it makes
        # the NEXT row difference into a fake +100M "burst".
        if not has_usable_chain(strikes):
            _tape_last_skip = "empty-chain"
            _append_gap(date_str, t_iso, "empty-chain")
            return None
        ce_vol = sum(_safe_int((r.get("ce") or {}).get("volume")) for r in strikes)
        pe_vol = sum(_safe_int((r.get("pe") or {}).get("volume")) for r in strikes)
        gex = report.get("gex", {}) or {}
        # ATM premiums: anchored to the strike nearest spot with a tradeable
        # premium, so a future burst can be scored in real rupees instead of
        # index points. Only LTP is stored — the chain is not persisted.
        atm_strike, atm_ce_ltp, atm_pe_ltp = _atm_premium_snapshot(strikes, spot)
        # Per-minute GEX + ATM IV so the UI can chart cumulative net gamma and
        # the ATM IV / straddle series without re-fetching history.
        try:
            from api.reports_api.nifty_verdicts import atm_ivs
            atm_ce_iv, atm_pe_iv = atm_ivs(strikes, spot)
        except Exception:
            atm_ce_iv, atm_pe_iv = None, None
        walls_near = (report.get("walls_near") or report.get("walls")
                      or {"calls": [], "puts": []})
        row = {
            "t": t_iso,
            "spot": spot,
            "ce_oi": ce_oi,
            "pe_oi": pe_oi,
            "ce_vol": ce_vol,
            "pe_vol": pe_vol,
            "pcr_oi": _safe_float(report.get("pcr_oi")),
            "pcr_vol": _safe_float(report.get("pcr_vol")),
            "max_pain": _safe_float(report.get("max_pain")),
            # The live report prefers Upstox's OFFICIAL max pain (sourced from a
            # 30-min bucket) and only falls back to the computed value, but the
            # row did not record which. The two disagree by a strike on 21 of 338
            # rows (2026-10-22), so every "did price pin to max pain" study mixed
            # two definitions. Store the computed value alongside the printed one.
            "max_pain_computed": compute_max_pain([
                {"strike": _safe_float(r.get("strike")) or 0.0,
                 "ce_oi": _safe_int((r.get("ce") or {}).get("oi")),
                 "pe_oi": _safe_int((r.get("pe") or {}).get("oi"))}
                for r in strikes
            ]) if strikes else None,
            # A degraded GEX block (no gamma anywhere) is an OI proxy, not a
            # gamma profile: its flip/net_gex are artefacts and are NOT written
            # to the tape — a fabricated flip in the day's log is read back as
            # a real gamma level by every consumer.
            "flip": None if gex.get("degraded") else gex.get("zero_cross"),
            "net_gex": None if gex.get("degraded") else gex.get("net_total"),
            "gex_degraded": bool(gex.get("degraded")),
            # The NEAR walls: the tape's wall consumers (the wall-migration
            # detector, the squeeze detector) compare the wall strike
            # minute-to-minute, so an unrestricted ranking makes the wall
            # "migrate" whenever a far mega-wall outranks the near one —
            # six spurious migrations in one afternoon (2026-10-22).
            "walls": walls_near,
            # Scalar top-of-book walls: the wall-change detector diffs TWO
            # FRAMES (this row vs the previous minute), and digging the strike
            # out of the ranked list on every diff is both slow and easy to get
            # wrong. ``null`` when the chain had no walls (never 0).
            "call_wall": _top_wall_strike(walls_near, "calls"),
            "put_wall": _top_wall_strike(walls_near, "puts"),
            "expiry": report.get("expiry", ""),
            "atm_strike": atm_strike,
            "atm_ce_ltp": atm_ce_ltp,
            "atm_pe_ltp": atm_pe_ltp,
            "atm_ce_iv": atm_ce_iv,
            "atm_pe_iv": atm_pe_iv,
            # ATM +/-3 strikes with both legs' OI — lets a future alert name the
            # exact strike instead of only the index total.
            "strikes_top": _strike_oi_snapshot(strikes, spot),
            # EVERY strike: CE/PE LTP + OI + volume per strike. Lets the options
            # paper engine mark a position at the contract it actually bought
            # (the ATM drifts), and lets walls/PCR be rebuilt per strike later.
            "chain": _premium_chain_snapshot(strikes, spot),
        }
        # Spot freeze: keep the cash-CAS flag from is_cas_window(ts), but
        # the index spot is frozen/fixed from 15:15 through the 15:40 F&O
        # close, so flag the whole 15:15-15:40 window as cas + spot_frozen.
        try:
            _mins = ts.hour * 60 + ts.minute
        except Exception:
            _mins = -1
        if is_cas_window(ts) or (CAS_START_MIN <= _mins < SPOT_FROZEN_END_MIN):
            # NSE Closing Auction Session: the index spot is frozen/fixed
            # from 15:15 through the 15:40 F&O close, so this row's spot is
            # stale by construction. Flag it so EOD can prefer the official
            # OHLC close. Additive only.
            row["cas"] = True
            row["spot_frozen"] = True
        TAPE_DIR.mkdir(parents=True, exist_ok=True)
        # JSON encoding + append are blocking; off the event loop.
        await asyncio.to_thread(_append_tape_line, path, row)
        # Keep the day's snapshot fresh so the EOD tab has data. Previously the
        # snapshot was written ONLY by POST /nifty/snapshot (the SNAPSHOT button),
        # so GET /nifty raised its 404 envelope on every day nobody clicked it —
        # the EOD tab has effectively never worked. The recorder already fetches
        # the chain every minute, so persisting it here costs one small JSON write
        # (overwritten in place, never deleted).
        try:
            snapshot = {
                **report,
                "mode": "snapshot",
                "date": date_str,
                "snapshot_at": t_iso,
                "source": "upstox-option-chain",
                "timeline": build_timeline_skeleton(report),
            }
            # ~150-200 KB with indent=2; encoding it on the loop was a visible
            # per-minute stall, so both encode and write happen in a thread.
            await asyncio.to_thread(write_snapshot, date_str, snapshot)
        except Exception:
            pass
        # Full per-minute replay snapshot: append the exact report envelope the
        # UI renders (verdicts + candles ON) plus the Sensex context block, so
        # the whole report screen can be replayed after the day ends. Reuses the
        # single report computed above. Infallible: a snapshot failure must not
        # stop the light tape row.
        try:
            await _append_minute_snapshot(date_str, t_iso, report)
        except Exception:
            pass
        _tape_last_skip = None
        return row
    except Exception as exc:
        _tape_last_skip = "chain-failed"
        _tape_last_error = f"tape row failed: {type(exc).__name__}: {str(exc)[:160]}"
        stamp, gdate = _tick_stamp(ts)
        _append_gap(gdate, stamp, "chain-failed", _err_detail(exc))
        logger.warning("nifty tape: row write failed (%s): %s",
                       type(exc).__name__, exc)
        return None


_tape_last_tick: Optional[str] = None
#: Rows dropped because the spot could not be trusted (see reconcile_spot).
_tape_spot_rejections: int = 0
#: Why the last tick produced no row: "same-minute" (normal), "spot-rejected"
#: (data quality) or "chain-failed" (a real error). Lets the status endpoint
#: tell a deliberate skip apart from a failure.
_tape_last_skip: Optional[str] = None
_tape_last_error: Optional[str] = None
_tape_iterations: int = 0
#: Consecutive failed ticks — a streak means the upstream is down (401, DNS),
#: not that one minute was unlucky. Drives the log's "still down" line.
_tape_failure_streak: int = 0
#: The ONE recorder loop. The FastAPI lifespan starts it directly (it keeps
#: its own handle) while the HTTP handlers start it through
#: ``_ensure_tape_task`` (which keeps THIS handle). The two were never the
#: same object, so a second loop always started: the pair wrote duplicate
#: tape rows 26 ms apart and journalled the same gap twice.
_tape_task = None
#: The loop the recorder runs on. Published so a request handler (the bursts
#: feed is a sync def, so FastAPI runs it in a threadpool) can still schedule
#: a restart on the right loop.
_tape_loop: Optional[asyncio.AbstractEventLoop] = None
#: Delay before a dead recorder is restarted.
TAPE_RESTART_DELAY_SEC = 5.0
#: Per-day writer locks. Two ticks (two loops, or a manual tick racing the
#: loop) could both read "the last row is from minute X" and then both write
#: a row for minute X+1. The write section of a tick is serialised per
#: calendar day so a minute is written exactly once.
_TAPE_LOCKS: dict[str, asyncio.Lock] = {}


def _tape_lock(date_str: str) -> asyncio.Lock:
    """The writer lock for ``date_str`` (created on first use)."""
    lock = _TAPE_LOCKS.get(date_str)
    if lock is None:
        lock = asyncio.Lock()
        _TAPE_LOCKS[date_str] = lock
    return lock


def _start_tape_task(loop) -> None:
    """Create the recorder task on ``loop`` (one instance only)."""
    global _tape_task
    if _tape_task is not None and not _tape_task.done():
        return
    try:
        _tape_task = loop.create_task(start_nifty_tape_task())
        logger.warning("nifty tape: recorder (re)started — the tape was blind")
    except Exception:
        pass


def _ensure_tape_task() -> None:
    """Start the recorder loop if it isn't running (watchdog).

    Called from the handlers the desk already polls, so a recorder that died
    (an Upstox 401, an unhandled error) is back within seconds instead of
    staying blind for the rest of the session. Safe to call from a worker
    thread: the start is scheduled onto the recorder's own loop.
    """
    global _tape_task
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    loop = running or _tape_loop
    if loop is None or loop.is_closed():
        return
    try:
        if _tape_task is not None and not _tape_task.done():
            return
    except Exception:
        return
    if running is loop:
        _start_tape_task(loop)
        return
    try:
        loop.call_soon_threadsafe(_start_tape_task, loop)
    except RuntimeError:
        pass


def _schedule_tape_restart(delay: float = TAPE_RESTART_DELAY_SEC) -> None:
    """Re-arm the recorder after it died. Never raises."""
    loop = _tape_loop
    if loop is None or loop.is_closed():
        return
    try:
        loop.call_later(delay, _ensure_tape_task)
    except RuntimeError:
        pass


def _market_open() -> bool:
    """Is the market open? Falls back to an hour window on import failure."""
    try:
        from trading.utils import is_derivatives_open

        return bool(is_derivatives_open())
    except Exception:
        return 8 <= datetime.now(config.IST).hour <= 16


async def _tape_tick(poll_sec: int) -> None:
    """One recorder tick. Never raises — a failure is a missing minute."""
    global _tape_iterations, _tape_last_tick, _tape_last_error
    timeout_sec = max(1.0, min(float(poll_sec), TAPE_TICK_TIMEOUT_SEC))
    try:
        row = await asyncio.wait_for(record_nifty_tape_tick(), timeout=timeout_sec)
    except asyncio.TimeoutError:
        _tape_iterations += 1
        _tape_last_error = f"tick timed out after {timeout_sec:.0f}s"
        stamp, gdate = _tick_stamp()
        _append_gap(gdate, stamp, "timeout")
        logger.warning("nifty tape: tick timed out after %.0fs", timeout_sec)
        return
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        _tape_iterations += 1
        _tape_last_error = f"{type(exc).__name__}: {str(exc)[:200]}"
        stamp, gdate = _tick_stamp()
        _append_gap(gdate, stamp, "loop-error", _err_detail(exc))
        logger.warning("nifty tape: tick raised %s: %s", type(exc).__name__, exc)
        return
    _tape_iterations += 1
    if row is not None:
        _tape_last_tick = row.get("t")
        _tape_last_error = None
    elif _tape_last_skip == "chain-failed":
        # The tick already recorded WHY (401, network) — keep that detail.
        if not _tape_last_error:
            _tape_last_error = "tick returned None (chain fetch failed?)"
    else:
        # A deliberate skip (same minute, or a rejected spot) is not a
        # failure — don't leave a stale error behind.
        _tape_last_error = None


async def _tape_recorder_loop(poll_sec: int) -> None:
    """The recorder heartbeat: one tick per ``poll_sec`` seconds.

    A tick that fails (Upstox 401, network, timeout) must NOT end the loop —
    on 2026-10-22 a 401 took the tape, the burst feed and the desk watchers
    blind for ten minutes because the failure was swallowed with no retry and
    no log. Every failure is logged, journalled and retried on the next tick.
    """
    global _tape_task, _tape_loop, _tape_failure_streak, _tape_last_error
    current = asyncio.current_task()
    if (_tape_task is not None and _tape_task is not current
            and not _tape_task.done()):
        # Another recorder already owns the tape - this is a duplicate.
        return
    _tape_task = current
    _tape_loop = asyncio.get_running_loop()
    loop = _tape_loop
    next_tick = loop.time()
    while True:
        try:
            if _market_open():
                await _tape_tick(poll_sec)
                if _tape_last_error:
                    _tape_failure_streak += 1
                    if _tape_failure_streak == 1 or _tape_failure_streak % 5 == 0:
                        logger.warning(
                            "nifty tape: %d consecutive failed ticks (last: %s)",
                            _tape_failure_streak, _tape_last_error)
                else:
                    if _tape_failure_streak:
                        logger.warning("nifty tape: recovered after %d failed ticks",
                                       _tape_failure_streak)
                    _tape_failure_streak = 0
            next_tick += poll_sec
            await asyncio.sleep(max(0.0, next_tick - loop.time()))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # A bug in the tick path must not end the recorder.
            logger.exception("nifty tape: recorder loop error (%s) — retrying",
                             type(exc).__name__)
            if not _tape_last_error:
                _tape_last_error = f"{type(exc).__name__}: {str(exc)[:200]}"
            next_tick = loop.time() + poll_sec
            await asyncio.sleep(poll_sec)


async def start_nifty_tape_task(poll_sec: int = TAPE_INTERVAL_SEC) -> None:
    """Background loop: one tape tick every ``poll_sec``s while the market is open.

    Market gate delegates to ``trading.utils.is_derivatives_open`` (hour-window
    fallback on import failure, mirroring the server's ``_is_market_hours``).
    A tick failure is logged and retried on the next tick; the loop itself
    only ends on cancellation or a fatal error, and a fatal error is LOUD
    (logged) and restarts the recorder instead of leaving the tape blind.
    Heartbeat (for /nifty/tape/status): ``_tape_last_tick/_tape_last_error``.

    Only ONE instance may run. The lifespan starts this coroutine directly
    while the HTTP handlers start it through ``_ensure_tape_task``; whichever
    starts first owns the recorder and the other returns immediately. Without
    that guard two loops wrote the same minute twice (26 ms apart) and
    journalled the same gap twice.
    """
    try:
        await _tape_recorder_loop(poll_sec)
    except asyncio.CancelledError:
        logger.info("nifty tape: recorder cancelled — stopping")
        raise
    except BaseException:
        logger.exception("nifty tape: recorder died — restarting in %.0fs",
                         TAPE_RESTART_DELAY_SEC)
        _schedule_tape_restart()
        raise


@router.get("/nifty/bursts/stream", dependencies=[Depends(get_current_user)])
async def stream_nifty_bursts():
    """Server-Sent Events: push newly detected alerts instead of polling.

    Sends a small snapshot of recent events first, then live ones, with a
    heartbeat so intermediaries don't drop an idle connection. The client is
    expected to fall back to `/nifty/bursts` polling if this errors.
    """
    from fastapi.responses import StreamingResponse

    from api.reports_api import nifty_stream as stream

    queue = stream.subscribe()

    async def _gen():
        try:
            # Immediate preamble so a client (and any proxy) sees the stream is
            # live even when there is nothing to send yet.
            yield ": connected\n\n"
            for event in stream.recent_events(limit=20):
                yield stream.sse_payload(event)
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=25.0)
                    yield stream.sse_payload(event)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            stream.unsubscribe(queue)

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/nifty/tape/status")
def get_nifty_tape_status():
    """Heartbeat for the background recorder: last tick time / last error."""
    _ensure_tape_task()
    return {"last_tick": _tape_last_tick, "last_error": _tape_last_error,
            "iterations": _tape_iterations, "interval_sec": TAPE_INTERVAL_SEC,
            "spot_rejections": _tape_spot_rejections,
            "last_skip": _tape_last_skip}


@router.get("/nifty/tape")
def get_nifty_tape(date: Optional[str] = Query(default=None, description="Tape date YYYY-MM-DD (default: today)")):
    """Serve the day's per-minute OI tape with derived deltas.

    NOTE: past minutes are NEVER backfilled — rows exist only for minutes
    the recorder was alive during market hours, so gaps stay gaps. A
    missing/empty tape yields a 404 ``{is_trading_day: False}`` envelope.
    See :func:`derive_tape_rows` for the per-row formulas.
    """
    date_str = validate_date(date or _today_str())
    raw = read_tape(date_str)
    if not raw:
        raise HTTPException(status_code=404, detail={
            "is_trading_day": False,
            "date": date_str,
            "message": f"no Nifty tape for {date_str}",
        })
    rows = derive_tape_rows(raw)
    # Honest baseline: deltas are measured vs the day's FIRST recorded row,
    # which may be well after the open when the recorder booted late.
    baseline_t = rows[0].get("t") if rows else None
    payload = {"date": date_str, "interval_sec": TAPE_INTERVAL_SEC,
               "baseline_t": baseline_t, "rows": rows}
    # Pre-encoded response: the tape payload is ~3MB of plain JSON primitives
    # parsed via json.loads, so FastAPI's jsonable_encoder pass is a pure
    # deep-copy (~500ms for a full day's 368 rows). The bytes below use the
    # exact JSONResponse.render settings, so the wire output is identical.
    from fastapi.responses import Response
    body = json.dumps(payload, ensure_ascii=False, allow_nan=False,
                      separators=(",", ":")).encode("utf-8")
    return Response(content=body, media_type="application/json")


@router.get("/nifty/replay/dates", dependencies=[Depends(get_current_user)])
def get_nifty_replay_dates(limit: int = Query(15, ge=1, le=120)):
    """Dates that have a per-minute replay log, newest first.

    The report panel opens on the newest recorded day when the market is
    closed, so a holiday or weekend resolves to the last session that actually
    recorded — never to an empty Live screen.
    """
    dates: list[str] = []
    for path in sorted(SNAPSHOT_LOG_DIR.glob("*.jsonl"), reverse=True):
        try:
            datetime.strptime(path.stem, "%Y-%m-%d")
        except ValueError:
            continue
        try:
            if path.stat().st_size == 0:
                continue
        except OSError:
            continue
        dates.append(path.stem)
        if len(dates) >= limit:
            break
    return {"dates": dates, "latest": dates[0] if dates else None}


def _slim_replay_report(report: Optional[dict], window: float = 750.0) -> Optional[dict]:
    """Drop fields the replay UI never reads (and far strikes) from a frame.

    Never mutates the stored payload; never raises — a malformed frame is
    returned unchanged rather than dropping the whole day.
    """
    if not isinstance(report, dict):
        return report
    try:
        out = dict(report)
        spot = _safe_float(out.get("spot"))
        strikes = out.get("strikes")
        if spot and isinstance(strikes, list):
            out["strikes"] = [
                s for s in strikes
                if isinstance(s, dict)
                and abs(_safe_float(s.get("strike")) - spot) <= window
            ]
        out.pop("emas", None)
        return out
    except Exception:
        return report


# One parsed+slimmed day, keyed by (date, mtime). Scrubbing asks for one frame
# per move; without this every request re-read and re-parsed the whole 74 MB
# JSONL. The mtime key invalidates naturally while the recorder is appending.
_SLIM_CACHE: dict = {"key": None, "rows": None}


def _slimmed_snapshots(date_str: str) -> list[dict]:
    """Replay frames with the UI-only projection applied, cached per file mtime."""
    path = snapshot_log_path(date_str)
    try:
        st = path.stat() if path.exists() else None
        mtime = st.st_mtime if st else 0.0
        size = st.st_size if st else 0
    except OSError:
        mtime, size = 0.0, 0
    # Path + size + mtime: two temp logs in a test run can share a second.
    key = (date_str, str(path), mtime, size)
    if _SLIM_CACHE.get("key") == key and _SLIM_CACHE.get("rows") is not None:
        return _SLIM_CACHE["rows"]
    rows = [
        {**s, "report": _slim_replay_report(_with_delta_flip(s.get("report")))}
        if isinstance(s, dict) and isinstance(s.get("report"), dict)
        else s
        for s in read_snapshots(date_str)
    ]
    _SLIM_CACHE["key"] = key
    _SLIM_CACHE["rows"] = rows
    return rows


@router.get("/nifty/replay", dependencies=[Depends(get_current_user)])
def get_nifty_replay(
    date: str = Query(..., description="Replay date YYYY-MM-DD"),
    t: Optional[str] = Query(default=None, description=(
        "ISO minute; when given, returns the snapshot recorded at the last "
        "minute at or before ``t`` instead of the whole day")),
    meta: bool = Query(default=False, description=(
        "Return only the frame list (t + spot, no report bodies) so the replay "
        "scrubber can load one full frame at a time instead of the whole day")),
):
    """Serve the day's per-minute FULL report snapshots (replay source).

    Without ``t``: ``{"date", "count", "interval_sec", "snapshots"}`` — every
    recorded snapshot line in ascending-order as appended. A missing/empty log
    yields the same 404 ``{is_trading_day: False}`` envelope as ``/nifty/tape``.
    With ``t``: ``{"date", "snapshot"}`` — the single snapshot whose minute is
    the closest at or before ``t`` (``snapshot: null`` when none qualify —
    e.g. before the day's first recording).
    """
    date_str = validate_date(date)
    snaps = _slimmed_snapshots(date_str)
    if not snaps:
        raise HTTPException(status_code=404, detail={
            "is_trading_day": False,
            "date": date_str,
            "message": f"no Nifty snapshots for {date_str}",
        })
    if meta is True:
        # ~40 bytes per frame instead of ~103 KB: the client keeps the playhead
        # list and fetches the selected frame via ?t=. This is the difference
        # between a ~33 MB day in JS heap and a ~100 KB list.
        frames = [
            {"t": s.get("t"),
             "spot": _safe_float((s.get("report") or {}).get("spot"))}
            for s in snaps
            if isinstance(s, dict)
        ]
        return {"date": date_str, "count": len(frames),
                "interval_sec": TAPE_INTERVAL_SEC, "frames": frames,
                "gap_reasons": read_gap_reasons(date_str)}

    # `_slimmed_snapshots` already applied the projection (and cached it):
    # frames are ~103 KB instead of ~227 KB, and the whole day is not re-parsed
    # on every scrub.
    if t and isinstance(t, str):
        # FULL timestamps are compared, not minute buckets: truncating both
        # sides to [:16] made "10:01:30" select the 10:01:59 frame as well.
        # Same-tz ISO strings compare correctly as text; a " " separator is
        # normalised to "T" so a space-separated stamp does not sort before
        # every "T"-stamped frame of the same minute. The isinstance guard
        # also keeps the direct (non-HTTP) call sentinel Query object out of
        # the path.
        target = t.strip().replace(" ", "T")
        chosen: Optional[dict] = None
        for snap in snaps:
            snap_t = str(snap.get("t") or "")
            if snap_t and snap_t <= target:
                chosen = snap
        return {"date": date_str, "snapshot": chosen}
    return {"date": date_str, "count": len(snaps),
            "interval_sec": TAPE_INTERVAL_SEC, "snapshots": snaps,
            "gap_reasons": read_gap_reasons(date_str)}


# ---------------------------------------------------------------------------
# OI bursts: recomputable from the stored tape
# ---------------------------------------------------------------------------

def _recent_news_for(date_str: str) -> list[dict]:
    """Stored headlines around ``date_str`` (±12h) for burst tagging.

    Reads `news_articles` only — no network. Returns `[]` when the news tables
    or rows are unavailable, so burst tagging can never break the endpoint.
    """
    try:
        from datetime import datetime, timedelta

        from db.database import SessionLocal
        from db.models.news import NewsArticle

        day = datetime.strptime(date_str, "%Y-%m-%d")
        lo = day - timedelta(hours=12)
        hi = day + timedelta(hours=12)
        db = SessionLocal()
        try:
            rows = (
                db.query(NewsArticle.headline, NewsArticle.published_at,
                         NewsArticle.url, NewsArticle.source)
                .filter(NewsArticle.published_at.isnot(None))
                .filter(NewsArticle.published_at >= lo)
                .filter(NewsArticle.published_at <= hi)
                .order_by(NewsArticle.published_at)
                .limit(2000)
                .all()
            )
        finally:
            db.close()
        return [
            {"heading": h, "published_at": p, "url": u, "source": s}
            for (h, p, u, s) in rows
        ]
    except Exception:
        return []


def _snapshot_oi_context(date_str: str) -> tuple[Optional[list], float]:
    """``(strikes, spot)`` from the day's saved snapshot.

    Returns ``(None, 0.0)`` when the snapshot is missing, unreadable,
    malformed, or lacks ``strikes``/``spot``. Never raises, never touches
    the network — a burst without a snapshot simply carries ``signal: null``.
    """
    try:
        snap = read_snapshot(date_str)
        if not isinstance(snap, dict):
            return None, 0.0
        strikes = snap.get("strikes")
        spot = _safe_float(snap.get("spot"))
        if not strikes or not spot:
            return None, 0.0
        return strikes, spot
    except Exception:
        return None, 0.0


def _frame_wall(row: dict, side: str) -> Optional[float]:
    """Top wall strike on ONE tape frame (scalar first, list fallback)."""
    key = "call_wall" if side == "call" else "put_wall"
    strike = _safe_float(row.get(key))
    if strike:
        return strike
    walls = row.get("walls")
    if isinstance(walls, dict):
        return _top_wall_strike(walls, "calls" if side == "call" else "puts")
    return None


def _frame_gap_minutes(a: dict, b: dict) -> Optional[int]:
    """Whole minutes between two tape frames, or ``None`` when unparseable."""
    try:
        delta = (datetime.fromisoformat(str(b.get("t"))) -
                 datetime.fromisoformat(str(a.get("t")))).total_seconds()
    except (TypeError, ValueError):
        return None
    return int(delta // 60)


#: Nifty's option ladder: one "strike" of migration is 50 points. A 1-strike
#: move is book rank noise, not a level moving — see detect_wall_moves.
WALL_STRIKE_STEP = 50.0
#: A wall comparison across a recorder gap is not a one-minute move.
WALL_MOVE_MAX_GAP_MIN = 2


def detect_wall_moves(rows: list[dict],
                      min_strikes: int = 2) -> list[dict]:
    """Wall relocation alerts with hysteresis, from consecutive tape frames.

    A wall's top strike changes rank constantly: on 2026-11-02 the call wall
    wobbled between 23,500 and 23,450 every few minutes while nothing in the
    book changed. Alerting every 50-pt move buries the real events, so a move
    only becomes an alert when

    * a SIDE FLIP occurs — the previous put wall becomes the new call wall (or
      vice versa): support has become resistance; or
    * the wall migrates at least ``min_strikes`` strikes (2 × 50 = 100 pts).

    Returns burst-shaped dicts (``type``/``kind`` = "wall", ``from``/``to``,
    ``side``, ``severity``) so they flow through the existing burst feed and
    its coalescing. Frames must be adjacent (≤ :data:`WALL_MOVE_MAX_GAP_MIN`
    minutes apart); a recorder gap is never read as a one-minute migration.
    """
    ordered = sorted(
        (r for r in rows or [] if isinstance(r, dict) and r.get("t")),
        key=lambda r: str(r.get("t")))
    out: list[dict] = []
    prev: Optional[dict] = None
    for row in ordered:
        if prev is not None:
            gap = _frame_gap_minutes(prev, row)
            if gap is not None and 0 < gap <= WALL_MOVE_MAX_GAP_MIN:
                spot = _safe_float(row.get("spot"))
                cw_prev, pw_prev = _frame_wall(prev, "call"), _frame_wall(prev, "put")
                cw, pw = _frame_wall(row, "call"), _frame_wall(row, "put")
                for side, old, new, other_prev in (("call", cw_prev, cw, pw_prev),
                                                   ("put", pw_prev, pw, cw_prev)):
                    if not old or not new or old == new:
                        continue
                    # The previous opposite-side wall is now THIS side's wall:
                    # support became resistance (or vice versa).
                    flip = other_prev == new
                    steps = abs(new - old) / WALL_STRIKE_STEP
                    if not flip and steps < float(min_strikes):
                        continue
                    out.append({
                        "t": str(row.get("t")),
                        "type": "wall",
                        "kind": "wall",
                        "side": side,
                        "from": old,
                        "to": new,
                        "strike": new,
                        "migration_strikes": round(steps, 1),
                        "flip": bool(flip),
                        "spot": spot,
                        "severity": "alert" if flip else "watch",
                        "score": round(max(steps, 2.0 if flip else steps), 1),
                        "detail": (
                            f"{side} wall {old:,.0f} -> {new:,.0f}"
                            + (" (side flip)" if flip else "")),
                    })
        prev = row
    return out


def _wall_event_alerts(rows: list[dict],
                       date_str: Optional[str] = None) -> list[dict]:
    """Map tape wall tests/rejections/breaks into the bursts feed.

    Validated on 2026-11-03: call wall 23,700 tested at 11:54, rejected at
    12:10, max pain 23,650 hit. Put-wall breaks are surfaced as break-risk
    (historical hold rate was 2/8), never as support bounces.

    When ``date_str`` is given every detected event is appended to the day's
    recall journal (``experiments/data/nifty_wall_events/{date}.jsonl``,
    deduped on ``t+side+kind+level``) so
    ``scripts/nifty_event_recall.py`` can prove what the feed alerted against
    what the tape actually contained.
    """
    from api.reports_api.nifty_wall_events import detect_wall_events

    events = detect_wall_events(rows)
    if date_str:
        try:
            from api.reports_api.nifty_wall_events import persist_events

            persist_events(events, date_str)
        except Exception:
            pass

    out: list[dict] = []
    for event in events:
        side = event.get("side") or "call"
        level = event.get("level")
        label_side = "CALL" if side == "call" else "PUT"
        try:
            level_txt = f"{float(level):,.0f}"
        except (TypeError, ValueError):
            level_txt = "—"
        kind = event.get("kind")
        if kind == "wall_test":
            out.append({
                "type": "wall_test", "kind": "wall_test", "side": side,
                "t": event.get("t"), "strike": level,
                "label": f"{label_side} WALL {level_txt} TESTED",
                "detail": f"{side} wall {level_txt} held for 10+ minutes",
                "severity": "watch",
            })
        elif kind == "rejection":
            target = event.get("target")
            try:
                target_txt = f" · target max pain {float(target):,.0f}" if target else ""
            except (TypeError, ValueError):
                target_txt = ""
            out.append({
                "type": "rejection", "kind": "rejection", "side": side,
                "t": event.get("t"), "strike": level, "target": target,
                "spot": event.get("spot"),
                "label": f"{label_side} WALL REJECTED {level_txt}",
                "detail": f"rejected {event.get('moved_pts', 0):.1f} pts{target_txt}",
                "severity": "alert",
            })
        elif kind == "break":
            out.append({
                "type": "break", "kind": "break", "side": side,
                "t": event.get("t"), "strike": level,
                "label": f"CALL WALL BREAK {level_txt}",
                "detail": f"broke {event.get('moved_pts', 0):.1f} pts above the wall",
                "severity": "alert",
            })
        elif kind == "wall_break":
            out.append({
                "type": "wall_break", "kind": "wall_break", "side": side,
                "t": event.get("t"), "strike": level,
                "label": f"PUT WALL BREAK {level_txt}",
                "detail": f"broke {event.get('moved_pts', 0):.1f} pts below the wall",
                "severity": "alert",
            })
    return out


# ---------------------------------------------------------------------------
# Data watchdog + Telegram fan-out for the bursts feed
# ---------------------------------------------------------------------------
#: A tape whose newest row is older than this during market hours is blind: the
#: recorder died (or the chain feed did) and every panel above the bursts feed
#: is stale without saying so. 2 minutes is one missed tick plus one retry.
TAPE_STALE_SEC = 120.0
#: Re-emit a stale alert at most once per this window (the feed is polled every
#: few seconds and the same outage must not alert 200 times).
STALE_ALERT_DEDUPE_SEC = 300.0
#: ``date -> epoch`` of the last emitted stale alert. Process-local on purpose:
#: a restart re-arms the watchdog, which is when it matters most.
_STALE_ALERT_AT: dict[str, float] = {}
#: ``date -> {(type, t, side)}`` already pushed to Telegram, so a polling
#: browser never re-notifies a historical event.
_NOTIFIED_ALERTS: dict[str, set[tuple[str, str, str]]] = {}

#: The recorder is expected to have written at least one row by this time (IST).
#: Market opens at 09:15; 09:20 gives 5 minutes for the first tick to land.
NO_TAPE_BY_HOUR = 9
NO_TAPE_BY_MINUTE = 20
#: Re-emit a "no tape" alert at most once per this window.
NO_TAPE_ALERT_DEDUPE_SEC = 300.0
#: ``date -> epoch`` of the last emitted "no tape" alert.
_NO_TAPE_ALERT_AT: dict[str, float] = {}


def detect_data_stale(rows: Optional[list[dict]],
                      now: Optional[datetime] = None,
                      market_open: Optional[bool] = None) -> Optional[dict]:
    """The ``data_stale`` alert when the tape's last row is too old, else None.

    Only meaningful while the market is open — outside it the tape is supposed
    to stop, and alerting every evening would train the desk to ignore it.
    Never raises.
    """
    try:
        is_open = _market_open() if market_open is None else bool(market_open)
        if not is_open:
            return None
        last = None
        for row in reversed(list(rows or ())):
            if isinstance(row, dict) and row.get("t"):
                last = row
                break
        if last is None:
            return None
        try:
            last_dt = datetime.fromisoformat(str(last.get("t")))
        except (TypeError, ValueError):
            return None
        now_dt = now or datetime.now(config.IST)
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=config.IST)
        if now_dt.tzinfo is None:
            now_dt = now_dt.replace(tzinfo=config.IST)
        age = (now_dt - last_dt).total_seconds()
        if age <= TAPE_STALE_SEC:
            return None
        return {
            "type": "data_stale", "kind": "data_stale",
            "severity": "critical", "t": last.get("t"),
            "spot": _safe_float(last.get("spot")) or None,
            "age_sec": round(age, 1),
            "label": "TAPE STALE",
            "detail": (
                f"last tape row {str(last.get('t'))[11:19]} is "
                f"{age / 60.0:.1f} min old (> {TAPE_STALE_SEC / 60.0:.0f} min "
                "watchdog) — the recorder or the chain feed is down"),
        }
    except Exception:
        return None


def data_stale_alert(rows: Optional[list[dict]], date_str: str,
                     now: Optional[datetime] = None,
                     market_open: Optional[bool] = None,
                     state: Optional[dict[str, float]] = None,
                     ) -> Optional[dict]:
    """``detect_data_stale`` behind a per-day, 5-minute emit gate.

    Returns the alert only when it is due; ``None`` while the same outage is
    still inside :data:`STALE_ALERT_DEDUPE_SEC`. ``state`` is injectable (tests);
    the default is the process-local :data:`_STALE_ALERT_AT`.
    """
    alert = detect_data_stale(rows, now=now, market_open=market_open)
    if alert is None:
        return None
    clock = state if state is not None else _STALE_ALERT_AT
    now_dt = now or datetime.now(config.IST)
    if now_dt.tzinfo is None:
        now_dt = now_dt.replace(tzinfo=config.IST)
    stamp = now_dt.timestamp()
    last = clock.get(date_str)
    if last is not None and stamp - last < STALE_ALERT_DEDUPE_SEC:
        return None
    clock[date_str] = stamp
    return alert


def detect_no_tape_alert(date_str: str,
                         rows: Optional[list[dict]],
                         now: Optional[datetime] = None,
                         market_open: Optional[bool] = None) -> Optional[dict]:
    """The ``data_stale`` alert when the tape has NO rows by 09:20 IST.

    Only fires for TODAY, while the market is open, and when the local time
    is >= 09:20. This catches the case where the recorder dies BEFORE writing
    any row — the existing 2-minute staleness watchdog only triggers when there
    is at least one row to measure age from. Never raises.
    """
    try:
        today = _today_str()
        if date_str != today:
            return None
        is_open = _market_open() if market_open is None else bool(market_open)
        if not is_open:
            return None
        now_dt = now or datetime.now(config.IST)
        if now_dt.tzinfo is None:
            now_dt = now_dt.replace(tzinfo=config.IST)
        mins = now_dt.hour * 60 + now_dt.minute
        cutoff = NO_TAPE_BY_HOUR * 60 + NO_TAPE_BY_MINUTE
        if mins < cutoff:
            return None
        # Empty or None rows means no tape written yet
        if rows:
            return None
        return {
            "type": "data_stale", "kind": "data_stale",
            "severity": "critical", "t": now_dt.isoformat(),
            "spot": None,
            "age_sec": None,
            "label": "TAPE MISSING",
            "detail": (
                f"no tape rows recorded since market open (09:15); "
                f"it is now {now_dt.strftime('%H:%M')} — the recorder did not start"
            ),
        }
    except Exception:
        return None


def no_tape_alert(date_str: str,
                  rows: Optional[list[dict]],
                  now: Optional[datetime] = None,
                  market_open: Optional[bool] = None,
                  state: Optional[dict[str, float]] = None) -> Optional[dict]:
    """``detect_no_tape_alert`` behind a per-day, 5-minute emit gate.

    Returns the alert only when it is due; ``None`` while the same outage is
    still inside :data:`NO_TAPE_ALERT_DEDUPE_SEC`. ``state`` is injectable (tests);
    the default is the process-local :data:`_NO_TAPE_ALERT_AT`.
    """
    alert = detect_no_tape_alert(date_str, rows, now=now, market_open=market_open)
    if alert is None:
        return None
    clock = state if state is not None else _NO_TAPE_ALERT_AT
    now_dt = now or datetime.now(config.IST)
    if now_dt.tzinfo is None:
        now_dt = now_dt.replace(tzinfo=config.IST)
    stamp = now_dt.timestamp()
    last = clock.get(date_str)
    if last is not None and stamp - last < NO_TAPE_ALERT_DEDUPE_SEC:
        return None
    clock[date_str] = stamp
    return alert


#: Tracks whether the "Telegram notifier unavailable" warning has been logged
#: in this process. Used to emit the warning exactly once per process lifetime.
_TELEGRAM_WARNED = False


def notify_telegram(alert: Optional[dict]) -> bool:
    """Fire-and-forget Telegram for an ``alert``/``critical`` burst.

    Returns True when a send was handed to the notifier. The notifier submits
    to its own thread pool (and no-ops when Telegram is unconfigured), so this
    never blocks the request path and never raises — a dead notifier must not
    take the feed down.

    If the notifier is unavailable (unconfigured or send fails), a single
    warning is logged per process and False is returned.
    """
    global _TELEGRAM_WARNED
    try:
        if not isinstance(alert, dict):
            return False
        if str(alert.get("severity")) not in ("alert", "critical"):
            return False
        from trading.telegram_notifier import _is_available, send_alert

        # Check if notifier is configured; if not, log once and return False.
        if not _is_available():
            if not _TELEGRAM_WARNED:
                import logging
                logging.getLogger(__name__).warning(
                    "Telegram notifier unavailable (bot_token or chat_id not set); "
                    "burst alerts will not be sent."
                )
                _TELEGRAM_WARNED = True
            return False

        # A test/CI run must never POST with the real notifier (it truly sends
        # when configured). A monkeypatched send_alert is allowed so the
        # failure path stays testable.
        import os as _os
        if (_os.environ.get("PYTEST_CURRENT_TEST") or _os.environ.get("CI_MODE")) and \
           getattr(send_alert, "__module__", "").startswith("trading.telegram_notifier"):
            return False

        label = alert.get("label") or alert.get("type") or "NIFTY ALERT"
        detail = alert.get("detail") or ""
        send_alert(f"*{label}*\n{detail}",
                   cooldown_key=f"nifty:{alert.get('type')}:{alert.get('t')}")
        return True
    except Exception:
        if not _TELEGRAM_WARNED:
            import logging
            logging.getLogger(__name__).warning(
                "Telegram send failed; burst alerts will not be sent.", exc_info=True
            )
            _TELEGRAM_WARNED = True
        return False


def notify_new_bursts(bursts: Iterable[dict], date_str: str,
                      latest_minute: Optional[str] = None) -> int:
    """Telegram ``alert``/``critical`` bursts for the CURRENT tape minute only.

    Historical bursts are re-served on every poll; notifying them again would
    page the desk about 11:54 at 15:29. Entries are deduped in-process on
    ``(type, t, side)``. Returns the number handed to the notifier.
    """
    sent = 0
    seen = _NOTIFIED_ALERTS.setdefault(date_str, set())
    for burst in bursts or ():
        try:
            if str(burst.get("severity")) not in ("alert", "critical"):
                continue
            t = str(burst.get("t") or "")
            if latest_minute and t[:16] != latest_minute[:16]:
                continue
            key = (str(burst.get("type")), t, str(burst.get("side") or ""))
            if key in seen:
                continue
            seen.add(key)
            if notify_telegram(burst):
                sent += 1
        except Exception:
            continue
    return sent


@router.get("/nifty/bursts")
@router.get("/nifty/bursts", dependencies=[Depends(get_current_user)])
def get_nifty_bursts(
    date: Optional[str] = Query(default=None, description="Burst date YYYY-MM-DD (default: today)"),
    window: int = Query(default=OI_BURST_WINDOW, ge=3, le=60, description="Trailing minutes for the baseline"),
    min_abs: float = Query(default=OI_BURST_MIN_ABS, ge=0, description="Absolute ΔOI floor (contracts)"),
    _now: Optional[datetime] = None,  # injectable for tests
):
    """Per-minute OI bursts recomputed from the stored tape — never errors.

    The tape's ``call_doi``/``put_doi`` are cumulative from the day's first
    row, so a burst is the first difference between consecutive minutes.
    History is recomputable for any recorded day (independent of the browser),
    so a missing/empty tape is a normal ``count: 0`` response (HTTP 200), not a
    404. ``signal`` is attached from the day's saved snapshot when available;
    otherwise it is ``null``. No network/Upstox calls are made here.
    """
    # The desk polls this feed, so it doubles as the recorder's watchdog: a
    # recorder that died is restarted here instead of staying blind.
    _ensure_tape_task()
    date_str = validate_date(date or _today_str())
    raw = read_tape(date_str)
    if not raw:
        # Empty tape: check for "no tape by 09:20" alert (today, market open, >=09:20)
        bursts: list[dict] = []
        try:
            no_tape = no_tape_alert(date_str, raw, now=_now)
            if no_tape is not None:
                bursts.append(no_tape)
                notify_telegram(no_tape)
        except Exception:
            pass
        return {"date": date_str, "count": len(bursts), "interval_sec": TAPE_INTERVAL_SEC,
                "bursts": bursts, "reason": "no tape"}

    rows = derive_tape_rows(raw)
    # Fades (OI bursts) + momentum (wall-break squeezes) in one feed.
    bursts = detect_oi_bursts(rows, window=window, min_abs=min_abs)
    try:
        bursts += detect_squeezes(rows)
    except Exception:
        pass
    try:
        bursts += detect_strike_bursts(rows)
    except Exception:
        pass
    try:
        bursts += detect_premium_moves(rows)
    except Exception:
        pass
    try:
        bursts += detect_coiling(rows)
    except Exception:
        pass
    # Wall relocations are a STATE change (old -> new strike), not an OI delta;
    # they flow through the same feed/coalescing but carry their own kind so
    # the UI can label them.
    try:
        bursts += detect_wall_moves(rows)
    except Exception:
        pass
    # Wall test / rejection / break (tape-based). These are the pre-move
    # triggers validated on 2026-11-03: test 11:54 → rejection 12:10 →
    # max pain 23,650. They carry their own target/level, so no synthetic plan.
    try:
        bursts += _wall_event_alerts(rows, date_str)
    except Exception:
        pass
    bursts.sort(key=lambda b: str(b.get("t") or ""))
    # One alert per (minute, side): a single directional minute trips several
    # strikes/detectors and they describe the same event.
    bursts = coalesce_bursts(bursts)
    # Data watchdog: appended AFTER coalescing so a dead recorder can never be
    # merged away by a same-minute burst. Deduped per 5 minutes.
    try:
        stale = data_stale_alert(rows, date_str, now=_now)
        if stale is not None:
            bursts.append(stale)
            notify_telegram(stale)
    except Exception:
        pass
    # Telegram fan-out for live alert/critical bursts (never blocks, no-op when
    # the notifier is unavailable). Only the current tape minute is pushed.
    try:
        latest_minute = str(rows[-1].get("t") or "") if rows else None
        notify_new_bursts(bursts, date_str, latest_minute)
    except Exception:
        pass
    strikes, spot = _snapshot_oi_context(date_str)
    try:
        trend = session_trend(rows)
    except Exception:
        trend = None
    # Named levels the desk trades against — a close beyond one is structure.
    levels: dict[str, float] = {}
    try:
        snap = read_snapshot(date_str) or {}
        for kind, key in (("max_pain", "max_pain"),):
            v = _safe_float(snap.get(key))
            if v:
                levels[kind] = v
        walls = (snap.get("walls_near") or snap.get("walls") or {})
        for side_key, kind in (("calls", "wall"), ("puts", "wall")):
            entries = walls.get(side_key) or []
            if entries and _safe_float((entries[0] or {}).get("strike")):
                levels[f"{kind}_{side_key}"] = _safe_float(entries[0]["strike"])
    except Exception:
        levels = {}
    for b in bursts:
        try:
            # Trend at the burst's own minute, not at the close.
            b_trend = session_trend(rows, at_time=b.get("t")) or trend
            prem = b.get("premChg")
            building = _safe_float(b.get("delta")) > 0
            b["fuel_state"] = fuel_state(building, None if prem is None else float(prem))
            b["structure"] = structure_evidence(rows, str(b.get("t") or ""), levels)
            if b["structure"]:
                b["invalidation"] = b["structure"].get("level")
            b["signal"] = derive_oi_signal(b, strikes, spot, trend=b_trend)
            try:
                side = str(b.get("side") or "call").lower()
                wall = levels.get("wall_calls" if side == "call" else "wall_puts")
                if wall is None:
                    wall = b.get("wall")
                b.update(setup_for_burst(
                    side=side,
                    fuel=b.get("fuel_state"),
                    trend=b_trend,
                    spot=_safe_float(b.get("spot")) or None,
                    wall=_safe_float(wall) or None,
                    burst_type=b.get("type"),
                    score=_safe_float(b.get("score")) or None,
                ))
            except Exception:
                pass
            if (b.get("signal") is None and strikes and spot
                    and b.get("type") not in ("coil", "squeeze", "premium", "wall",
                                              "wall_test", "rejection", "break",
                                              "wall_break", "data_stale")):
                b["plan_suppressed"] = True
                b["signal"] = {
                    "leg": None, "strike": None, "entry": None, "sl": None,
                    "target": None, "qty": 0, "lots": 0,
                    "basis": basis_text(b.get("fuel_state"), b.get("side") or "call",
                                        b.get("structure"), _safe_float(b.get("spot"))),
                }
        except Exception:
            b["signal"] = None
    if trend:
        for b in bursts:
            b["trend"] = trend

    # Attach nearby headlines so a burst can be read with its likely catalyst.
    # Reads only what is already stored — no network call in this endpoint.
    try:
        attach_news(bursts, _recent_news_for(date_str), window_min=NEWS_WINDOW_MIN)
    except Exception:
        for b in bursts:
            b.setdefault("news", [])

    return {"date": date_str, "count": len(bursts),
            "interval_sec": TAPE_INTERVAL_SEC, "bursts": bursts}
