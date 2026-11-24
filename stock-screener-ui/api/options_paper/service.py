"""Business logic for the options paper book.

The domain maths and the replay engine live in ``options_paper/``; this module
only wires them to the request's DB session and shapes the wire payloads.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import config

from db.models.broker import Instrument
from db.models.option_snapshot import OptionChainSnapshot
from db.models.options_paper import OptionPaperLeg, OptionPaperPosition
from db.models.trade import Trade
from options_paper import structures
from options_paper.costs import COSTS_VERSION, option_entry_cost, option_round_trip_cost
from options_paper.multi_day_replay import ReplayResult, build_replay
from options_paper.replay_data import (
    MAX_ROWS,
    CompositeChainProvider,
    FileChainProvider,
    SnapshotChainProvider,
    UpstoxChainProvider,
    available_sessions,
    safe_underlying,
    upstox_fetch_candles,
    upstox_history_enabled,
    upstox_resolve_key,
)
from options_paper.spec import get_lot, option_symbol

from .schemas import AddLegRequest, OptionPaperOrderRequest

logger = logging.getLogger("options_paper.service")

IST = config.IST
MAX_SESSIONS = 200
MAX_UNDERLYINGS = 80
_MAX_SNAPSHOT_ROWS = 2000
_MAX_EXPIRY_PAST = timedelta(days=365)
_MAX_EXPIRY_FUTURE = timedelta(days=365 * 3)


class OrderError(ValueError):
    """A user-facing 400: the message names the offending request field."""


def _finite(value, default: float = 0.0) -> float:
    """Never let NaN/infinity from an upstream quote enter a book or a P&L."""
    try:
        out = float(value)
    except (TypeError, ValueError, OverflowError):
        return default
    return out if math.isfinite(out) else default


def _require_spot(spot, context: str) -> float:
    """A non-positive spot would silently resolve ATM to the lowest strike."""
    value = _finite(spot)
    if not value > 0:
        raise OrderError(f"spot: no usable spot for {context}")
    return value


def _r2(value: float) -> float:
    out = round(_finite(value), 2)
    return 0.0 if out == 0 else out


def _as_ist(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=IST)
    return ts.astimezone(IST)


def _wall(ts: datetime) -> datetime:
    """IST wall clock without tzinfo, matching how SQLite stores snapshots."""
    return _as_ist(ts).replace(tzinfo=None)


def _now() -> datetime:
    """Single seam for 'now' in expiry, DTE and replay bounds.

    Expiry settlement must read the same clock as the marks it settles;
    keeping one indirect read lets a replay book run on a pinned session
    clock instead of nine scattered wall-clock calls that can drift apart.
    """
    return datetime.now(IST)


@dataclass
class ReplayLeg:
    """Duck-typed ``ResolvedLeg`` carrying contract identity for build_replay.

    ``entry_time`` is the per-leg fill time: build_replay activates a leg only
    once the replay clock reaches it, so staggered additions mark to market from
    their own entry instead of the position's original one.
    """

    action: str
    opt: str
    strike: float
    lots: int
    qty: int
    entry_premium: float = 0.0
    underlying: str = ""
    expiry: str = ""
    entry_time: datetime | None = None


def _leg_entry_time(position, leg) -> datetime | None:
    """Effective per-leg fill time, falling back to the position entry."""
    ts = getattr(leg, "effective_entry_ts", None)
    if ts is None:
        ts = getattr(leg, "entry_ts", None)
    if ts is None:
        ts = getattr(position, "entry_ts", None)
    return _as_ist(ts) if ts else None


def _market_open_now() -> bool:
    """Only an omitted entryTs during session may use the live chain."""
    try:
        from trading.utils import is_market_open
        return bool(is_market_open(_now()))
    except Exception:  # a holiday calendar failure must not block a replay fill
        return False


class _BorrowedSession:
    """Read-only view of the request session for the lazy domain providers.

    ``SnapshotChainProvider`` closes the session it is given. The request owns
    this one, so closing is a no-op here.
    """

    def __init__(self, session):
        self._session = session

    def query(self, *args, **kwargs):
        return self._session.query(*args, **kwargs)

    def close(self) -> None:
        pass


def make_provider(db) -> CompositeChainProvider:
    """Snapshot → recorded files → opt-in Upstox active-contract history."""
    return CompositeChainProvider([
        SnapshotChainProvider(session_factory=lambda: _BorrowedSession(db)),
        FileChainProvider(),
        UpstoxChainProvider(
            resolve_key=upstox_resolve_key(),
            fetch_candles=upstox_fetch_candles(),
            enabled=upstox_history_enabled(),
        ),
    ])


def _lot_size(db, underlying: str) -> int:
    """Resolve a lot from the spec, then the broker master; never invent one."""
    try:
        return get_lot(underlying)
    except KeyError:
        row = (
            db.query(Instrument)
            .filter(
                Instrument.segment.like("NSE_FO%"),
                Instrument.name.ilike(f"%{underlying}%"),
            )
            .first()
        )
        if row is not None and row.lot_size and row.lot_size > 0:
            return int(row.lot_size)
    raise OrderError(
        f"underlying: no verified lot size for {underlying}; add it to options_paper.spec.STOCK_LOTS"
    )


def _leg_key(leg) -> str:
    opt = getattr(leg, "opt", None) or getattr(leg, "opt_type", "")
    return f"{float(leg.strike):g}-{str(opt).upper()}"


def _spec_identity(spec) -> tuple:
    """Canonical ``(action, opt, strike)`` key for duplicate detection.

    Numeric refs compare by value so ``82.5`` and ``82.50`` are the same leg;
    symbolic refs (ATM, ATM+2) compare by their normalised text.
    """
    ref = str(spec.strike).strip().upper().replace(" ", "")
    try:
        numeric = float(ref)
    except (TypeError, ValueError):
        numeric = None
    if numeric is not None and math.isfinite(numeric):
        return (spec.action, spec.opt, round(numeric, 6))
    return (spec.action, spec.opt, ref)


def _shape_replay(result: ReplayResult, position_id: int | None = None) -> dict:
    """JSON payload matching ``normalizeOptionReplayResult`` in the client."""
    payload = result.as_dict()
    payload["positionId"] = position_id
    summary = dict(payload.get("summary") or {})
    summary["costs"] = summary.get("costsTotal", _r2(result.costs_total))
    payload["summary"] = summary
    payload.setdefault("frames", [])
    payload.setdefault(
        "coverage", {"frames": 0, "first": None, "last": None, "gaps": 0}
    )
    payload.setdefault("payoff", {"spots": [], "expiry": []})
    payload.setdefault("breakevens", [])
    payload.setdefault("skipped", None)
    payload.setdefault("source", "")
    return payload


# ---------------------------------------------------------------------------
# Order validation and pricing
# ---------------------------------------------------------------------------
def parse_order(order: OptionPaperOrderRequest):
    """Validate the request; return (specs, underlying, expiry_date, expiry)."""
    try:
        underlying = safe_underlying(order.underlying)
    except ValueError:
        raise OrderError(f"underlying: invalid symbol {order.underlying!r}") from None
    expiry = str(order.expiry or "").strip()
    try:
        expiry_date = date.fromisoformat(expiry)
    except (TypeError, ValueError):
        raise OrderError(f"expiry must be YYYY-MM-DD, got {order.expiry!r}") from None
    if order.source == "live":
        today = _now().date()
        if expiry_date < today - _MAX_EXPIRY_PAST or expiry_date > today + _MAX_EXPIRY_FUTURE:
            raise OrderError(f"expiry: out of range {expiry!r}")

    if order.source == "replay" and order.entry_ts is None:
        raise OrderError("entryTs is required when source is 'replay'")

    legs = list(order.legs or [])
    if not 1 <= len(legs) <= 4:
        raise OrderError(f"legs must contain between 1 and 4 entries, got {len(legs)}")

    leg_expiries = {
        str(leg.expiry).strip()
        for leg in legs
        if leg.expiry and str(leg.expiry).strip()
    }
    if len(leg_expiries) > 1 or (leg_expiries and expiry not in leg_expiries):
        raise OrderError(
            f"expiry: all legs must share the order expiry {expiry}, got "
            f"{sorted(leg_expiries)}"
        )

    specs = []
    for leg in legs:
        raw = leg.model_dump()
        raw["opt"] = str(leg.opt).strip().upper()
        raw["action"] = str(leg.action).strip().upper()
        try:
            specs.append(structures.parse_leg_spec(raw))
        except ValueError as exc:
            raise OrderError(str(exc)) from None

    seen: set[tuple] = set()
    for spec in specs:
        identity = _spec_identity(spec)
        if identity in seen:
            raise OrderError(
                f"legs: duplicate {spec.action} {spec.opt} {spec.strike}"
            )
        seen.add(identity)
    return specs, underlying, expiry_date, expiry


def _replay_pricing(
    db, specs, underlying: str, expiry: str, entry_ts: datetime,
    slippage_ticks: float,
):
    """Price a backdated structure from the provider at the requested time."""
    lot_size = _lot_size(db, underlying)
    provider = make_provider(db)
    try:
        quote = provider.chain_at(underlying, expiry, entry_ts)
    except Exception as exc:  # provider must never turn an order into a 500
        raise OrderError(f"entryTs: chain data unavailable ({exc})") from None
    if quote is None:
        raise OrderError(
            f"entryTs: no chain snapshot for {underlying} {expiry} at "
            f"{_as_ist(entry_ts).isoformat()}"
        )

    spot = _require_spot(
        quote.spot,
        f"{underlying} {expiry} at {_as_ist(entry_ts).isoformat()}",
    )
    try:
        resolved = structures.resolve_legs(specs, spot, quote.ladder, lot_size)
    except ValueError as exc:
        raise OrderError(f"legs: {exc}") from None

    duck_legs = [
        ReplayLeg(
            action=leg.action, opt=leg.opt, strike=leg.strike, lots=leg.lots,
            qty=leg.qty, underlying=underlying, expiry=expiry,
        )
        for leg in resolved
    ]
    replay = build_replay(
        legs=duck_legs,
        entry_ts=_as_ist(entry_ts),
        end_ts=_now(),
        provider=provider,
        lot_size=lot_size,
        slippage_ticks=slippage_ticks,
        costs=True,
        underlying=underlying,
        expiry=expiry,
    )
    return spot, resolved, replay


async def _live_pricing(
    db, specs, underlying: str, expiry: str, slippage_ticks: float, legs,
):
    """Price a structure from the CURRENT live chain (no duplicated HTTP code)."""
    from api.options import _fetch_chain_rows

    chain, spot = await _fetch_chain_rows(underlying, expiry)
    chain = list(chain or [])
    spot = _require_spot(spot, f"live chain for {underlying} {expiry}")
    ladder = [row.get("strike") for row in chain if row.get("strike") is not None]
    lot_size = _lot_size(db, underlying)
    try:
        resolved = structures.resolve_legs(specs, spot, ladder, lot_size)
    except ValueError as exc:
        raise OrderError(f"legs: {exc}") from None

    by_key: dict[tuple[float, str], dict] = {}
    for row in chain:
        for opt in ("CE", "PE"):
            contract = row.get(opt.lower()) or {}
            by_key[(float(row["strike"]), opt)] = contract

    slip = max(_finite(slippage_ticks), 0.0)
    filled = []
    keys = []
    for i, leg in enumerate(resolved):
        contract = by_key.get((leg.strike, leg.opt))
        ltp = _finite(((contract or {}).get("market_data") or {}).get("ltp"))
        if not ltp > 0:
            raise OrderError(
                f"legs: strike {leg.strike:g} {leg.opt} is unpriced in the live chain"
            )
        sign = structures.leg_sign(leg.action)
        fill = max(ltp + sign * slip, 0.0)
        instrument_key = str(legs[i].instrument_key or "").strip() or str(
            (contract or {}).get("instrument_key") or ""
        )
        filled.append(
            structures.ResolvedLeg(
                action=leg.action, opt=leg.opt, strike=leg.strike, lots=leg.lots,
                qty=leg.qty, entry_premium=fill,
            )
        )
        keys.append(instrument_key)
    return _finite(spot), resolved, filled, keys


def _metrics(filled):
    """Gross payoff, costs and breakevens for filled legs."""
    spots = structures.default_spot_range(filled)
    payoff = structures.payoff_curve(filled, spots) if spots else []
    if spots:
        max_profit, max_loss = structures.max_profit_loss(filled, spots[0], spots[-1])
        breakevens = structures.breakevens(filled, spots[0], spots[-1])
    else:
        max_profit = max_loss = 0.0
        breakevens = []
    costs = 0.0
    for leg in filled:
        costs += option_entry_cost(
            leg.entry_premium, leg.qty, is_short=leg.action == "SELL"
        )["costs"]
    return {
        "net_debit": structures.net_entry_cost(filled),
        "costs": costs,
        "max_profit": max_profit,
        "max_loss": max_loss,
        "breakevens": breakevens,
        "spots": spots,
        "payoff": payoff,
    }


async def place_order(db, user_id: int, order: OptionPaperOrderRequest) -> dict:
    """Place (or preview) a live or backdated multi-leg paper order."""
    specs, underlying, _expiry_date, expiry = parse_order(order)
    # Minute resolution keeps two identical dry runs byte-for-byte equal.
    entry_ts = _as_ist(order.entry_ts) if order.entry_ts else _now().replace(
        second=0, microsecond=0
    )
    slippage = _finite(order.slippage_ticks)

    if order.source == "replay":
        if upstox_history_enabled():
            # The async Upstox seams use asyncio.run(); keep them off the
            # event-loop thread. Flag-off keeps the original in-thread path.
            entry_spot, resolved, replay = await asyncio.to_thread(
                _replay_pricing, db, specs, underlying, expiry, entry_ts, slippage
            )
        else:
            entry_spot, resolved, replay = _replay_pricing(
                db, specs, underlying, expiry, entry_ts, slippage
            )
        if replay.skipped:
            payload = _shape_replay(replay)
            if order.dry_run:
                return {"dryRun": True, "position": None, "replay": payload}
            raise OrderError(f"entryTs: replay could not be built ({replay.skipped})")

        # Contract identity needs all three parts: BUY CE and BUY PE at the
        # same strike are different fills and used to share one premium.
        fill_by_key: dict[tuple[str, str, float], float] = {}
        for leg in replay.legs:
            fill_by_key[(
                str(leg.get("action", "")).upper(),
                str(leg.get("opt", "")).upper(),
                round(float(leg.get("strike", 0)), 2),
            )] = float(leg.get("entryPremium") or 0.0)
        filled = []
        for leg in resolved:
            fill = fill_by_key.get((leg.action, leg.opt, round(leg.strike, 2)))
            if fill is None:
                raise OrderError(
                    f"legs: no replay fill for strike {leg.strike:g} {leg.opt}"
                )
            filled.append(
                structures.ResolvedLeg(
                    action=leg.action, opt=leg.opt, strike=leg.strike, lots=leg.lots,
                    qty=leg.qty, entry_premium=fill,
                )
            )
        instrument_keys = [str(leg.instrument_key or "") for leg in order.legs]
    else:
        entry_spot, resolved, filled, instrument_keys = await _live_pricing(
            db, specs, underlying, expiry, slippage, list(order.legs or [])
        )
        replay = None

    metrics = _metrics(filled)
    if order.dry_run:
        preview = replay if replay is not None else ReplayResult(
            underlying=underlying,
            expiry=expiry,
            entry_time=entry_ts,
            legs=[
                {
                    "action": leg.action, "opt": leg.opt,
                    "strike": _r2(leg.strike), "lots": leg.lots, "qty": leg.qty,
                    "entryPremium": _r2(leg.entry_premium),
                }
                for leg in filled
            ],
            frames=[],
            path=[],
            net_debit=metrics["net_debit"],
            max_profit=metrics["max_profit"],
            max_loss=metrics["max_loss"],
            breakevens=metrics["breakevens"],
            costs_total=metrics["costs"],
            coverage={"frames": 0, "first": None, "last": None, "gaps": 0},
            payoff={"spots": metrics["spots"], "expiry": metrics["payoff"]},
            source="live",
        )
        return {
            "dryRun": True,
            "position": None,
            "replay": _shape_replay(preview),
        }

    position = OptionPaperPosition(
        user_id=user_id,
        source=order.source,
        status="open",
        underlying=underlying,
        expiry=expiry,
        name=str(order.name or "")[:120],
        entry_ts=entry_ts,
        entry_spot=float(entry_spot or 0.0),
        lots=max(spec.lots for spec in specs),
        net_debit=metrics["net_debit"],
        costs_est=metrics["costs"],
        max_profit=metrics["max_profit"],
        max_loss=metrics["max_loss"],
        breakevens=json.dumps(metrics["breakevens"]),
        realized_pnl=0.0,
        close_reason="",
        notes=str(order.notes or "")[:500],
    )
    db.add(position)
    db.flush()
    for leg, instrument_key in zip(filled, instrument_keys):
        db.add(
            OptionPaperLeg(
                position_id=position.id,
                action=leg.action,
                opt_type=leg.opt,
                strike=leg.strike,
                lots=leg.lots,
                qty=leg.qty,
                instrument_key=instrument_key or None,
                entry_premium=leg.entry_premium,
                mark_premium=leg.entry_premium,
                mark_ts=entry_ts,
                exit_premium=None,
            )
        )
    db.commit()
    db.refresh(position)
    return {
        "dryRun": False,
        "position": serialize_position(db, position),
        "replay": None,
    }


# ---------------------------------------------------------------------------
# Staggered leg additions
# ---------------------------------------------------------------------------
async def add_leg(db, position, payload: AddLegRequest) -> dict:
    """Append one leg at its own entry time and reprice the whole structure."""
    if position.status != "open":
        raise OrderError(f"status: position is already {position.status}")
    if len(position.legs) >= 4:
        raise OrderError(
            f"legs: a position holds at most 4 legs, got {len(position.legs) + 1}"
        )
    if payload.expiry and str(payload.expiry).strip() != str(position.expiry).strip():
        raise OrderError(f"expiry: leg must match position expiry {position.expiry}")
    if payload.underlying:
        try:
            requested_underlying = safe_underlying(payload.underlying)
        except ValueError:
            raise OrderError(f"underlying: invalid symbol {payload.underlying!r}") from None
        if requested_underlying != str(position.underlying).upper():
            raise OrderError(
                f"underlying: leg must match position underlying {position.underlying}"
            )

    raw = payload.model_dump()
    raw["opt"] = str(payload.opt).strip().upper()
    raw["action"] = str(payload.action).strip().upper()
    try:
        spec = structures.parse_leg_spec(raw)
    except ValueError as exc:
        raise OrderError(str(exc)) from None

    def _duplicate(action: str, opt: str, strike: float) -> bool:
        identity = (action, opt, round(float(strike), 2))
        return any(
            (str(item.action).upper(), str(item.opt_type).upper(),
             round(float(item.strike), 2)) == identity
            for item in position.legs
        )

    def _reject_duplicate(strike: float) -> None:
        if _duplicate(spec.action, spec.opt, strike):
            raise OrderError(
                f"legs: duplicate {spec.action} {spec.opt} {float(strike):g}"
            )

    # A numeric strike is its own identity; symbolic refs need a ladder first.
    try:
        numeric_strike = float(spec.strike)
    except (TypeError, ValueError):
        numeric_strike = None
    if numeric_strike is not None:
        _reject_duplicate(numeric_strike)

    entry_ts = (
        _as_ist(payload.entry_ts) if payload.entry_ts
        else _now().replace(second=0, microsecond=0)
    )
    position_entry = _as_ist(position.entry_ts) if position.entry_ts else None
    if position_entry is not None and entry_ts < position_entry:
        raise OrderError(
            f"entryTs: a staggered leg cannot be entered before the position "
            f"entry {position_entry.isoformat()}"
        )
    underlying, expiry = str(position.underlying), str(position.expiry)
    if payload.entry_ts is None and _market_open_now():
        _spot, resolved, filled, keys = await _live_pricing(
            db, [spec], underlying, expiry, 0.0, [payload]
        )
        strike = float(resolved[0].strike)
        premium = float(filled[0].entry_premium)
        qty = int(filled[0].qty)
        instrument_key = str(keys[0] or "").strip() or None
    else:
        provider = make_provider(db)
        try:
            quote = provider.chain_at(underlying, expiry, entry_ts)
        except Exception as exc:
            raise OrderError(f"entryTs: chain data unavailable ({exc})") from None
        if quote is None:
            raise OrderError(
                f"entryTs: no chain snapshot for {underlying} {expiry} at "
                f"{entry_ts.isoformat()}"
            )
        spot = _require_spot(
            quote.spot, f"{underlying} {expiry} at {entry_ts.isoformat()}"
        )
        try:
            resolved = structures.resolve_legs(
                [spec], spot, quote.ladder, _lot_size(db, underlying)
            )
        except ValueError as exc:
            raise OrderError(f"strike: {exc}") from None
        new_leg = resolved[0]
        strike, qty = float(new_leg.strike), int(new_leg.qty)
        try:
            premium = float(quote.premiums.get((new_leg.strike, new_leg.opt)))
        except (TypeError, ValueError):
            premium = 0.0
        if not premium > 0:
            raise OrderError(
                f"strike: {strike:g} {new_leg.opt} is unpriced at {entry_ts.isoformat()}"
            )
        instrument_key = str(payload.instrument_key or "").strip() or None

    _reject_duplicate(strike)
    leg = OptionPaperLeg(
        position=position,
        action=spec.action,
        opt_type=spec.opt,
        strike=strike,
        lots=spec.lots,
        qty=qty,
        instrument_key=instrument_key,
        entry_premium=premium,
        mark_premium=premium,
        mark_ts=entry_ts,
        exit_premium=None,
    )
    if leg not in position.legs:
        position.legs.append(leg)
    leg.entry_ts = entry_ts
    db.add(leg)

    filled = [
        structures.ResolvedLeg(
            action=str(item.action).upper(), opt=str(item.opt_type).upper(),
            strike=float(item.strike), lots=int(item.lots), qty=int(item.qty),
            entry_premium=float(item.entry_premium),
        )
        for item in position.legs
    ]
    metrics = _metrics(filled)
    position.net_debit = metrics["net_debit"]
    position.costs_est = metrics["costs"]
    position.max_profit = metrics["max_profit"]
    position.max_loss = metrics["max_loss"]
    position.breakevens = json.dumps(metrics["breakevens"])
    db.commit()
    db.refresh(position)
    return serialize_position(db, position)


# ---------------------------------------------------------------------------
# Marks, P&L and projection
# ---------------------------------------------------------------------------
def _latest_snapshot(db, position, leg):
    return (
        db.query(OptionChainSnapshot)
        .filter(
            OptionChainSnapshot.underlying == position.underlying,
            OptionChainSnapshot.expiry == position.expiry,
            OptionChainSnapshot.strike == leg.strike,
            OptionChainSnapshot.side == leg.opt_type,
            OptionChainSnapshot.ltp.isnot(None),
            OptionChainSnapshot.ltp > 0,
        )
        .order_by(OptionChainSnapshot.ts.desc())
        .first()
    )


def _mark_for(db, position, leg) -> tuple[float, str | None]:
    """Mark the held contract from the chain — never the drifting ATM."""
    row = _latest_snapshot(db, position, leg)
    if row is not None:
        premium = _finite(row.ltp)
        if premium > 0:
            return premium, row.ts.isoformat() if row.ts else None
    stored = leg.mark_premium
    return (_finite(stored) if stored is not None
            else _finite(leg.entry_premium)), None


def _dte(position) -> int:
    try:
        return max(0, (date.fromisoformat(position.expiry) - _now().date()).days)
    except (TypeError, ValueError):
        return 0


def serialize_position(db, position) -> dict:
    """Model ``to_dict()`` plus legs, live marks, P&L and DTE."""
    base = position.to_dict()
    legs = []
    for leg in position.legs:
        row = leg.to_dict()
        if "entryTs" not in row:
            ts = _leg_entry_time(position, leg)
            row["entryTs"] = ts.isoformat() if ts else None
        if position.status == "open":
            premium, mark_ts = _mark_for(db, position, leg)
        else:
            premium = float(
                leg.exit_premium if leg.exit_premium is not None
                else (leg.mark_premium if leg.mark_premium is not None else leg.entry_premium)
            )
            mark_ts = row.get("markTs")
        row["markPremium"] = _r2(premium)
        if mark_ts:
            row["markTs"] = mark_ts
        legs.append(row)

    gross = sum(
        structures.leg_sign(leg["action"])
        * (float(leg["markPremium"]) - float(leg["entryPremium"] or 0.0))
        * int(leg["qty"] or 0)
        for leg in legs
    )
    costs = 0.0
    for item in legs:
        qty = int(item["qty"] or 0)
        if qty > 0:
            costs += option_entry_cost(
                float(item["entryPremium"] or 0.0), qty,
                is_short=str(item["action"]).upper() == "SELL",
            )["costs"]
    unrealized = _r2(gross - costs) if position.status == "open" else 0.0
    realized = float(position.realized_pnl or 0.0)

    spot_row = (
        db.query(OptionChainSnapshot)
        .filter(
            OptionChainSnapshot.underlying == position.underlying,
            OptionChainSnapshot.expiry == position.expiry,
            OptionChainSnapshot.spot.isnot(None),
        )
        .order_by(OptionChainSnapshot.ts.desc())
        .first()
    )
    mark_spot = (_finite(spot_row.spot) if spot_row and spot_row.spot
                 else _finite(position.entry_spot))
    base.update({
        "legs": legs,
        "costsEst": _r2(costs),
        "unrealizedPnl": unrealized,
        "totalPnl": _r2(realized + unrealized),
        "markSpot": mark_spot,
        "markTs": max((leg["markTs"] for leg in legs if leg.get("markTs")), default=None),
        "dte": _dte(position),
    })
    return base


# ---------------------------------------------------------------------------
# Close / trade projection
# ---------------------------------------------------------------------------
def _override_premium(leg, premiums: dict[str, float], index: int = 0) -> float | None:
    base = _leg_key(leg)
    action = str(getattr(leg, "action", "")).upper()
    keys = (
        str(leg.id),
        # Collision-safe replay keys (strike-opt-ACTION-index) come first so a
        # same-strike buy/sell pair can be exited at different premiums.
        f"{base}-{action}-{index}",
        f"{base}-{action}",
        base,
        f"{leg.opt_type.upper()}-{float(leg.strike):g}",
        f"{float(leg.strike):g}",
    )
    for key in keys:
        if key in premiums:
            raw = _finite(premiums[key], default=float("nan"))
            if not math.isfinite(raw):
                raise OrderError(f"premiums: invalid premium for leg {key}")
            return raw
    return None


def _book_trade(db, position, leg, entry_px, exit_px, cost, now, reason, notes,
                entry_time=None) -> None:
    """Project one leg exit into the canonical trades table."""
    source = "options_paper_replay" if position.source == "replay" else "options_paper_ui"
    db.add(
        Trade(
            user_id=position.user_id,
            bot_id=None,
            strategy_id=None,
            strategy_name="options_paper_ui",
            symbol=option_symbol(position.underlying, position.expiry, leg.strike, leg.opt_type),
            side=str(leg.action).upper(),
            quantity=int(leg.qty),
            entry_price=entry_px,
            entry_time=entry_time or position.entry_ts,
            exit_price=exit_px,
            exit_time=now,
            pnl=float(cost["gross_pnl"]),
            pnl_pct=round(float(cost["net_pnl"]) / max(entry_px * int(leg.qty), 1.0) * 100.0, 4),
            costs=float(cost["costs"]),
            net_pnl=float(cost["net_pnl"]),
            exit_reason=reason,
            source=source,
            reason=f"{reason} | {position.name or position.underlying}".strip()[:500],
            notes=f"costs_version={cost.get('costs_version') or COSTS_VERSION}; {notes}"[:500],
            is_test=False,
            stop_loss=0.0,
            take_profit=0.0,
            peak_price=0.0,
            low_price=0.0,
        )
    )


def _expiry_intrinsic(db, position, leg) -> tuple[float, bool]:
    """Settlement value is intrinsic at expiry, not the last traded premium."""
    spot_row = (
        db.query(OptionChainSnapshot)
        .filter(
            OptionChainSnapshot.underlying == position.underlying,
            OptionChainSnapshot.expiry == position.expiry,
            OptionChainSnapshot.spot.isnot(None),
            OptionChainSnapshot.spot > 0,
        )
        .order_by(OptionChainSnapshot.ts.desc())
        .first()
    )
    if spot_row is None or not spot_row.spot or spot_row.spot <= 0:
        return 0.0, False
    value = structures.intrinsic(str(leg.opt_type).upper(), float(leg.strike),
                                 _finite(spot_row.spot))
    return float(value), True


def settle_expired(db, user_id: int | None = None) -> int:
    """Settle positions whose expiry has passed (lazy, concurrency-safe).

    The UI polls positions, so settlement runs on read. A conditional UPDATE
    claims each row before any trade is booked, so two concurrent polls cannot
    insert the same trade twice. OTM legs settle intrinsic (zero), never at a
    stale traded premium.
    """
    now = _now()
    today = now.date()
    query = db.query(OptionPaperPosition).filter(OptionPaperPosition.status == "open")
    if user_id is not None:
        query = query.filter(OptionPaperPosition.user_id == user_id)
    settled = 0
    for position in query.all():
        try:
            expiry_date = date.fromisoformat(str(position.expiry)[:10])
        except (TypeError, ValueError):
            continue
        if expiry_date >= today:
            continue
        claimed = (
            db.query(OptionPaperPosition)
            .filter(OptionPaperPosition.id == position.id,
                    OptionPaperPosition.status == "open")
            .update({"status": "settling"}, synchronize_session=False)
        )
        if not claimed:
            continue
        realized = 0.0
        for leg in position.legs:
            exit_px, has_spot = _expiry_intrinsic(db, position, leg)
            entry_px = _finite(leg.entry_premium)
            cost = option_round_trip_cost(
                entry_px, exit_px, int(leg.qty),
                is_short=(str(leg.action).upper() == "SELL"),
            )
            leg.exit_premium = exit_px
            leg.mark_premium = exit_px
            leg.mark_ts = now
            realized += float(cost["net_pnl"])
            note = (
                f"expiry settlement: {leg.action} {leg.qty} {leg.opt_type} "
                f"{float(leg.strike):g} {entry_px:.2f}->{exit_px:.2f}"
                + ("" if has_spot else " (no final spot; intrinsic=0)")
            )
            _book_trade(
                db, position, leg, entry_px, exit_px, cost, now, "EXPIRED",
                note, entry_time=_leg_entry_time(position, leg),
            )
        position.realized_pnl = _r2(realized)
        position.status = "expired"
        position.close_reason = "EXPIRED"
        position.closed_at = now
        settled += 1
    if settled:
        db.commit()
    return settled


def close_position(db, position, premiums: dict[str, float] | None) -> dict:
    """Exit at supplied/current marks, book costs and project into ``trades``.

    The row is claimed by a conditional UPDATE before any Trade is inserted.
    Two readers holding a stale 'open' object cannot both book the same exit;
    the loser sees zero claimed rows and gets a 400 instead of a duplicate.
    """
    if position.status != "open":
        raise OrderError(f"status: position is already {position.status}")
    claimed = (
        db.query(OptionPaperPosition)
        .filter(OptionPaperPosition.id == position.id,
                OptionPaperPosition.status == "open")
        .update({"status": "closing"}, synchronize_session=False)
    )
    if not claimed:
        fresh = db.query(OptionPaperPosition.status).filter(
            OptionPaperPosition.id == position.id).scalar()
        raise OrderError(f"status: position is already {fresh or 'closed'}")

    premium_map = dict(premiums or {})
    try:
        now = _now()
        realized = 0.0
        for index, leg in enumerate(position.legs):
            override = _override_premium(leg, premium_map, index)
            if override is not None and (not math.isfinite(override) or override < 0):
                raise OrderError("premiums: an exit premium cannot be negative or non-finite")
            exit_px, _mark_ts = (
                (override, now.isoformat()) if override is not None
                else _mark_for(db, position, leg)
            )
            exit_px = _finite(exit_px)
            entry_px = _finite(leg.entry_premium)
            is_short = str(leg.action).upper() == "SELL"
            cost = option_round_trip_cost(entry_px, exit_px, int(leg.qty), is_short=is_short)
            leg.exit_premium = exit_px
            leg.mark_premium = exit_px
            leg.mark_ts = now
            realized += _finite(cost["net_pnl"])
            note = (
                f"manual exit: {leg.action} {leg.qty} {leg.opt_type} "
                f"{float(leg.strike):g} {entry_px:.2f}->{exit_px:.2f}"
            )
            _book_trade(
                db, position, leg, entry_px, exit_px, cost, now, "MANUAL",
                note, entry_time=_leg_entry_time(position, leg),
            )

        position.realized_pnl = _r2(realized)
        position.status = "closed"
        position.close_reason = "MANUAL"
        position.closed_at = now
        # A caller may hold a detached/stale object; persist the final state
        # through an explicit UPDATE, not ORM dirty tracking on that object.
        db.query(OptionPaperPosition).filter(
            OptionPaperPosition.id == position.id
        ).update({
            "realized_pnl": position.realized_pnl,
            "status": "closed",
            "close_reason": "MANUAL",
            "closed_at": now,
        }, synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return serialize_position(db, position)


# ---------------------------------------------------------------------------
# Replay readers and sessions
# ---------------------------------------------------------------------------
def replay_for_position(db, position) -> dict:
    """Recompute frames from the stored legs; never raise on missing history."""
    legs = [
        ReplayLeg(
            action=leg.action, opt=leg.opt_type, strike=float(leg.strike),
            lots=int(leg.lots), qty=int(leg.qty), entry_premium=float(leg.entry_premium or 0.0),
            underlying=position.underlying, expiry=position.expiry,
            entry_time=_leg_entry_time(position, leg),
        )
        for leg in position.legs
    ]
    empty = ReplayResult(
        underlying=position.underlying, expiry=position.expiry,
        entry_time=_as_ist(position.entry_ts) if position.entry_ts else None,
        source=position.source,
    )
    if not legs:
        empty.skipped = "no legs"
        return _shape_replay(empty, position.id)
    try:
        result = build_replay(
            legs=legs,
            entry_ts=_as_ist(position.entry_ts),
            end_ts=_now(),
            provider=make_provider(db),
            lot_size=_lot_size(db, position.underlying),
            slippage_ticks=0.0,
            costs=True,
            underlying=position.underlying,
            expiry=position.expiry,
        )
    except Exception as exc:
        logger.warning("replay %s unavailable: %s", position.id, exc)
        result = ReplayResult(
            underlying=position.underlying, expiry=position.expiry,
            entry_time=_as_ist(position.entry_ts), source=position.source,
            skipped=f"replay unavailable: {exc}",
        )
    return _shape_replay(result, position.id)


def replay_sessions(db) -> list[dict]:
    """Underlying/date/expiry pickers from DB snapshots and recorded chains."""
    underlyings = set()
    for (name,) in (
        db.query(OptionChainSnapshot.underlying)
        .distinct()
        .limit(_MAX_SNAPSHOT_ROWS)
        .all()
    ):
        if name:
            try:
                underlyings.add(safe_underlying(name))
            except ValueError:
                continue
    file_root = FileChainProvider().root / "options_chain10s"
    if file_root.is_dir():
        for child in file_root.iterdir():
            if child.is_dir():
                try:
                    underlyings.add(safe_underlying(child.name))
                except ValueError:
                    continue

    sessions: list[dict] = []
    for underlying in sorted(underlyings)[:MAX_UNDERLYINGS]:
        rows = (
            db.query(OptionChainSnapshot)
            .filter(OptionChainSnapshot.underlying == underlying)
            .order_by(OptionChainSnapshot.ts.desc())
            .limit(MAX_ROWS)
            .all()
        )
        by_date: dict[str, set[str]] = {}
        counts: dict[str, int] = {}
        for row in rows:
            day = row.session_date or (_wall(row.ts).date().isoformat() if row.ts else "")
            if not day:
                continue
            by_date.setdefault(day, set()).add(str(row.expiry or ""))
            counts[day] = counts.get(day, 0) + 1

        dates = available_sessions(
            underlying, session_factory=lambda: _BorrowedSession(db)
        )
        for day in dates:
            expiries = by_date.get(day) or {""}
            for expiry in sorted(expiries):
                sessions.append({
                    "underlying": underlying,
                    "expiry": expiry,
                    "date": day,
                    "source": "snapshot" if by_date.get(day) else "chain10s",
                    "frames": counts.get(day, 0),
                })
                if len(sessions) >= MAX_SESSIONS:
                    return sessions
    return sessions


def resolve_expiry(db, underlying: str, day: str) -> str:
    """Pick the contract expiry recorded for ``underlying`` on ``day``.

    The chain-at client sends only (underlying, date, time); the expiry comes
    from the recorded session rather than being guessed.
    """
    try:
        underlying = safe_underlying(underlying)
    except ValueError:
        raise OrderError(f"underlying: invalid symbol {underlying!r}") from None
    query = (
        db.query(OptionChainSnapshot.session_date, OptionChainSnapshot.ts, OptionChainSnapshot.expiry)
        .filter(OptionChainSnapshot.underlying == underlying)
    )
    try:
        day_date = date.fromisoformat(str(day)[:10])
    except (TypeError, ValueError):
        day_date = None
    if day_date is not None:
        start = datetime.combine(day_date, datetime.min.time(), tzinfo=IST)
        query = query.filter(
            (OptionChainSnapshot.session_date == str(day).strip())
            | ((OptionChainSnapshot.ts >= start)
               & (OptionChainSnapshot.ts < start + timedelta(days=1)))
        )
    rows = query.order_by(OptionChainSnapshot.ts.desc()).limit(MAX_ROWS).all()
    expiries = {
        str(expiry)
        for session, ts, expiry in rows
        if expiry and (
            str(session) == str(day)
            or (_wall(ts).date().isoformat() if ts else "") == str(day)
        )
    }
    return sorted(expiries)[0] if expiries else ""


def chain_at(db, underlying: str, expiry: str, day: str, time: str) -> dict:
    """Historical chain quote for strike selection in replay mode."""
    try:
        underlying = safe_underlying(underlying)
    except ValueError:
        raise OrderError(f"underlying: invalid symbol {underlying!r}") from None
    expiry = str(expiry or "").strip()
    time = str(time or "").strip()
    if not re.fullmatch(r"\d{2}:\d{2}", time):
        raise OrderError(f"time: expected HH:MM, got {time!r}")
    try:
        raw = f"{str(day).strip()}T{time}"
        ts = _as_ist(datetime.fromisoformat(raw))
    except (AttributeError, TypeError, ValueError):
        raise OrderError(f"date/time: expected YYYY-MM-DD and HH:MM, got {day!r} {time!r}") from None

    try:
        provider = make_provider(db)
        quote = provider.chain_at(underlying, expiry, ts)
    except ValueError as exc:
        raise OrderError(f"underlying: {exc}") from None
    if quote is None:
        raise OrderError(
            f"chain-at: no chain data for {underlying} {expiry} at {ts.isoformat()}"
        )
    spot = _require_spot(quote.spot, f"{underlying} {expiry} at {ts.isoformat()}")
    oi_by_leg: dict[tuple[float, str], tuple[float, float]] = {}
    if quote is not None:
        at = _wall(quote.t)
        rows = (
            db.query(OptionChainSnapshot)
            .filter(
                OptionChainSnapshot.underlying == underlying,
                OptionChainSnapshot.expiry == expiry,
                OptionChainSnapshot.ts <= at,
            )
            .order_by(OptionChainSnapshot.ts.desc())
            .limit(_MAX_SNAPSHOT_ROWS)
            .all()
        )
        for row in rows:
            key = (float(row.strike), str(row.side).upper())
            if key not in oi_by_leg:
                oi_by_leg[key] = (_finite(row.oi), _finite(row.volume))

    legs = []
    if quote is not None:
        for strike in sorted(quote.ladder):
            ce = float(quote.premiums.get((strike, "CE"), 0.0))
            pe = float(quote.premiums.get((strike, "PE"), 0.0))
            ce_oi, ce_vol = oi_by_leg.get((strike, "CE"), (0.0, 0.0))
            pe_oi, pe_vol = oi_by_leg.get((strike, "PE"), (0.0, 0.0))
            legs.append([
                _r2(strike), _r2(ce), _r2(ce_oi), _r2(ce_vol),
                _r2(pe), _r2(pe_oi), _r2(pe_vol),
            ])

    return {
        "t": quote.t.isoformat() if quote is not None else ts.isoformat(),
        "spot": _r2(spot),
        "expiry": expiry,
        "source": quote.source if quote is not None else "",
        "gaps": int(quote.gaps) if quote is not None else 0,
        "legs": legs,
    }
