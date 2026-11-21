"""No-lookahead intraday simulator for multi-leg option structures.

The honesty contract (same one the single-leg research engine follows)
---------------------------------------------------------------------
* A spec names only *when* to enter, never *why*. The signal bar is the first
  tape minute at/after ``entry_time``; the fill is the **next** recorded minute.
  Nothing on the signal bar is used for the fill price.
* A position is marked at the **contracts it holds**, priced from that
  minute's chain. A dead or absent strike carries its last seen price; the
  current ATM is never substituted, because the ATM drifts onto a different
  contract.
* Exit checks run only on bars **after** the fill bar, in a fixed order:
  EOD, max hold, stop, trail, target. Stops are evaluated before targets.
* A target that the bar overshoots is booked **at the target**, never at the
  close. Stops fill at the close — the conservative side.
* Entry is skipped, with a reason, when anything would have to be invented:
  no fill bar, a strike that is not on the ladder, or a leg with no premium.
* Costs come from ``options_paper.costs`` (one round trip per leg); margin from
  the same module. Nothing here duplicates those formulas.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field, replace
from datetime import datetime, time
from typing import Optional

from . import structures
from .costs import option_round_trip_cost, sell_margin_estimate
from .strategies import chain_px
from .tape import Tick

_DEFAULT_ENTRY = time(9, 35)
_DEFAULT_EOD = time(15, 10)


@dataclass
class ExecSpec:
    id: str
    name: str
    legs: list[structures.LegSpec]
    entry_time: str = "09:35"
    sl_pct: float = 30.0
    tp_pct: float = 60.0
    max_hold_min: int = 60
    trail_pct: float = 0.0
    eod_exit: str = "15:10"
    lots: int = 1


@dataclass
class StrategyResult:
    id: str
    name: str
    legs: list = field(default_factory=list)
    net_debit: float = 0.0
    max_profit: float = 0.0
    max_loss: float = 0.0
    breakevens: list = field(default_factory=list)
    margin_est: float = 0.0
    trades: list = field(default_factory=list)
    open: list = field(default_factory=list)
    realized: float = 0.0
    unrealized: float = 0.0
    total: float = 0.0
    stats: dict = field(default_factory=dict)
    equity: list = field(default_factory=list)
    payoff: dict = field(default_factory=lambda: {"spots": [], "expiry": []})
    skipped: Optional[str] = None

    def as_dict(self) -> dict:
        """The exact camelCase payload the API and the report UI consume."""
        return {
            "id": self.id,
            "name": self.name,
            "legs": self.legs,
            "netDebit": self.net_debit,
            "maxProfit": self.max_profit,
            "maxLoss": self.max_loss,
            "breakevens": self.breakevens,
            "marginEst": self.margin_est,
            "trades": self.trades,
            "open": self.open,
            "realized": self.realized,
            "unrealized": self.unrealized,
            "total": self.total,
            "stats": self.stats,
            "equity": self.equity,
            "payoff": self.payoff,
            "skipped": self.skipped,
        }


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------
def _r2(value: float) -> float:
    out = round(float(value), 2)
    return 0.0 if out == 0 else out


def _r3(value: float) -> float:
    out = round(float(value), 3)
    return 0.0 if out == 0 else out


def _parse_hhmm(value, fallback: time) -> time:
    """``HH:MM`` / ISO time, falling back to the documented default."""
    try:
        return time.fromisoformat(str(value).strip())
    except (TypeError, ValueError):
        pass
    try:
        hh, _, rest = str(value).strip().partition(":")
        return time(int(hh), int(rest[:2] or 0))
    except (TypeError, ValueError):
        return fallback


def _prep_ticks(ticks) -> list[Tick]:
    """Minute-deduped, sorted, positive-spot ticks on the dominant expiry."""
    cleaned: list[Tick] = []
    for tk in ticks or []:
        if tk is None or not isinstance(getattr(tk, "t", None), datetime):
            continue
        try:
            spot = float(tk.spot)
        except (TypeError, ValueError):
            continue
        if not spot > 0:
            continue
        cleaned.append(tk)
    # Sort BEFORE deduping so "the last row of the minute" is the latest one,
    # not whichever happened to appear last in the caller's list.
    cleaned.sort(key=lambda tk: tk.t)
    by_minute: dict[datetime, Tick] = {}
    for tk in cleaned:
        by_minute[tk.t.replace(second=0, microsecond=0)] = tk
    ordered = [by_minute[k] for k in sorted(by_minute)]
    if not ordered:
        return []
    expiry = Counter(t.expiry for t in ordered).most_common(1)[0][0]
    return [t for t in ordered if t.expiry == expiry]


def _ladder_at(tick: Tick) -> list[float]:
    """The strikes quotable at ``tick``.

    The chain is authoritative. A tape that records only ATM premiums still
    has a real quote for the ATM contract, so that strike is added when the
    chain is absent — it is never invented for a strike the tape did not quote.
    """
    keys = set()
    for k in (tick.chain or {}):
        try:
            keys.add(float(k))
        except (TypeError, ValueError):
            continue
    try:
        atm = float(tick.atm_strike or 0.0)
    except (TypeError, ValueError):
        atm = 0.0
    if atm > 0:
        keys.add(atm)
    return sorted(keys)


def _leg_premium(tick: Tick, strike: float, opt: str) -> float:
    """Held-strike premium at ``tick``; 0.0 when the leg is dead/absent."""
    px = chain_px(tick, strike, opt)
    return float(px) if px and px > 0 else 0.0


def _stats(trades: list[dict], equity: list[dict]) -> dict:
    n = len(trades)
    pnls = [float(t["netPnl"]) for t in trades]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    win_rate = 100.0 * len(wins) / n if n else 0.0
    # A book with no losing trade has no profit factor; 0 is the documented
    # "undefined" marker (an infinite ratio would break JSON clients).
    profit_factor = sum(wins) / abs(sum(losses)) if losses else 0.0
    avg_hold = (sum(float(t["holdMin"]) for t in trades) / n) if n else 0.0

    peak = 0.0
    drawdown = 0.0
    for point in equity or []:
        pnl = float(point["pnl"])
        peak = max(peak, pnl)
        drawdown = max(drawdown, peak - pnl)
    return {
        "trades": n,
        "winRate": _r2(win_rate),
        "profitFactor": _r2(profit_factor),
        "avgHoldMin": _r2(avg_hold),
        "maxDrawdown": _r2(drawdown),
    }


def _shell(spec: ExecSpec, day: list[Tick], skipped: str) -> StrategyResult:
    equity = [{"t": t.t.isoformat(), "pnl": 0.0} for t in day]
    return StrategyResult(
        id=spec.id, name=spec.name, equity=equity,
        stats=_stats([], equity), skipped=skipped,
        payoff={"spots": [], "expiry": []},
    )


# --------------------------------------------------------------------------
# One spec over the whole day
# --------------------------------------------------------------------------
def _run_one(spec: ExecSpec, day: list[Tick], lot_size: int,
             slippage_ticks: float, costs_enabled: bool) -> StrategyResult:
    lot = max(int(lot_size or 0), 1)
    lots = max(int(spec.lots or 0), 1)
    unit_qty = lots * lot                      # one lot of the structure
    slip = max(float(slippage_ticks or 0.0), 0.0)

    if not day:
        return _shell(spec, day, "no ticks")

    entry_t = _parse_hhmm(spec.entry_time, _DEFAULT_ENTRY)
    eod_t = _parse_hhmm(spec.eod_exit, _DEFAULT_EOD)

    signal_i = next(
        (i for i, t in enumerate(day) if entry_t <= t.t.time() < eod_t), None
    )
    if signal_i is None or signal_i + 1 >= len(day):
        return _shell(spec, day, "no fill bar")
    fill_i = signal_i + 1
    fill = day[fill_i]

    if not spec.legs:
        return _shell(spec, day, "no legs")

    ladder = _ladder_at(fill)
    try:
        # One structure unit = spec.lots x lot_size; LegSpec.lots scales an
        # individual leg (ratio spreads) on top of that.
        resolved = structures.resolve_legs(spec.legs, fill.spot, ladder, unit_qty)
    except ValueError:
        return _shell(spec, day, "strike unavailable")
    if not resolved:
        return _shell(spec, day, "strike unavailable")

    entry_legs: list[structures.ResolvedLeg] = []
    for leg in resolved:
        px = _leg_premium(fill, leg.strike, leg.opt)
        if not px > 0:
            return _shell(spec, day, "leg unpriced at entry")
        sign = structures.leg_sign(leg.action)
        # Buys pay up, sells receive less: slippage always works against us.
        entry_px = max(px + sign * slip, 0.0)
        entry_legs.append(replace(leg, entry_premium=entry_px))

    net_entry = structures.net_entry_cost(entry_legs)
    # A debit risks what it pays; a credit risks its gross premium. Either
    # way the denominator is strictly positive, so pnl% is always defined.
    risk_basis = abs(net_entry) if net_entry > 0 else sum(
        leg.entry_premium * leg.qty for leg in entry_legs
    )
    if risk_basis <= 0:
        return _shell(spec, day, "leg unpriced at entry")

    top_legs = [{
        "action": leg.action,
        "opt": leg.opt,
        "strike": _r2(leg.strike),
        "lots": leg.lots,
        "qty": leg.qty,
        "entryPremium": _r2(leg.entry_premium),
    } for leg in entry_legs]

    margin_est = sum(
        sell_margin_estimate(float(fill.spot), lot, leg.lots * lots)
        for leg in entry_legs if leg.action == "SELL"
    )

    n = len(day)
    equity: list[dict] = [{"t": t.t.isoformat(), "pnl": 0.0} for t in day]
    last: list[float] = [leg.entry_premium for leg in entry_legs]
    peak_pct = 0.0
    realized_cum = 0.0
    open_position = False
    trade: Optional[dict] = None

    sl_pct = abs(float(spec.sl_pct))
    tp_pct = abs(float(spec.tp_pct))
    trail_pct = max(float(spec.trail_pct or 0.0), 0.0)
    max_hold = max(float(spec.max_hold_min or 0), 0.0)

    def gross_at(prices: list[float]) -> float:
        return sum(
            structures.leg_sign(leg.action) * (prices[i] - leg.entry_premium) * leg.qty
            for i, leg in enumerate(entry_legs)
        )

    for j in range(n):
        tk = day[j]
        if j < fill_i:
            equity[j] = {"t": tk.t.isoformat(), "pnl": 0.0}
            continue
        if j == fill_i:
            # Entered at this bar's prices: marked flat, not at its close.
            open_position = True
            equity[j] = {"t": tk.t.isoformat(), "pnl": realized_cum}
            continue
        if not open_position:
            equity[j] = {"t": tk.t.isoformat(), "pnl": _r2(realized_cum)}
            continue

        for i, leg in enumerate(entry_legs):
            px = _leg_premium(tk, leg.strike, leg.opt)
            if px > 0:
                last[i] = px

        gross = gross_at(last)
        pnl_pct = gross / risk_basis * 100.0
        peak_pct = max(peak_pct, pnl_pct)
        hold_min = (tk.t - fill.t).total_seconds() / 60.0

        reason = None
        if tk.t.time() >= eod_t:
            reason = "EOD"
        elif hold_min >= max_hold:
            reason = "MAX_HOLD"
        elif pnl_pct <= -sl_pct:
            reason = "STOP"
        elif trail_pct > 0 and peak_pct - pnl_pct >= trail_pct:
            reason = "TRAIL"
        elif pnl_pct >= tp_pct:
            reason = "TARGET"

        if reason is None:
            equity[j] = {"t": tk.t.isoformat(), "pnl": _r2(realized_cum + gross)}
            continue

        exit_px: list[float] = []
        for i, leg in enumerate(entry_legs):
            sign = structures.leg_sign(leg.action)
            # A buy exits at the bid, a sell at the ask.
            exit_px.append(max(last[i] - sign * slip, 0.0))

        gross = gross_at(exit_px)
        if reason == "TARGET":
            # Booking the overshoot would flatter every target; cap it.
            gross = min(gross, tp_pct / 100.0 * risk_basis)

        leg_costs = 0.0
        if costs_enabled:
            for i, leg in enumerate(entry_legs):
                leg_costs += option_round_trip_cost(
                    leg.entry_premium, exit_px[i], leg.qty,
                    is_short=(leg.action == "SELL"),
                )["costs"]
        net = gross - leg_costs

        trade = {
            "id": f"{spec.id}#{fill.t.isoformat()}",
            "strategyId": spec.id,
            "strategyName": spec.name,
            "legs": [{
                "action": leg.action,
                "opt": leg.opt,
                "strike": _r2(leg.strike),
                "lots": leg.lots,
                "qty": leg.qty,
                "entryPremium": _r2(leg.entry_premium),
                "exitPremium": _r2(exit_px[i]),
            } for i, leg in enumerate(entry_legs)],
            "entryTime": fill.t.isoformat(),
            "exitTime": tk.t.isoformat(),
            "entrySpot": _r2(fill.spot),
            "exitSpot": _r2(tk.spot),
            "entryPremium": _r2(sum(
                structures.leg_sign(leg.action) * leg.entry_premium * leg.qty
                for leg in entry_legs) / unit_qty),
            "exitPremium": _r2(sum(
                structures.leg_sign(leg.action) * exit_px[i] * leg.qty
                for i, leg in enumerate(entry_legs)) / unit_qty),
            "lots": lots,
            "qty": unit_qty,
            "grossPnl": _r2(gross),
            "costs": _r2(leg_costs),
            "netPnl": _r2(net),
            "points": _r3(net / unit_qty),
            "exitReason": reason,
            "holdMin": round(hold_min, 1),
            "priced": True,
        }
        realized_cum += net
        open_position = False
        equity[j] = {"t": tk.t.isoformat(), "pnl": _r2(realized_cum)}

    trades = [trade] if trade is not None else []

    open_marks: list[dict] = []
    unrealized = 0.0
    if open_position:
        last_tick = day[-1]
        gross = gross_at(last)
        unrealized = gross
        open_marks.append({
            "strategyId": spec.id,
            "strategyName": spec.name,
            "legs": [{
                "action": leg.action,
                "opt": leg.opt,
                "strike": _r2(leg.strike),
                "lots": leg.lots,
                "qty": leg.qty,
                "entryPremium": _r2(leg.entry_premium),
                "mark": _r2(last[i]),
                "pnl": _r2(structures.leg_sign(leg.action)
                           * (last[i] - leg.entry_premium) * leg.qty),
            } for i, leg in enumerate(entry_legs)],
            "entryTime": fill.t.isoformat(),
            "entrySpot": _r2(fill.spot),
            "markTime": last_tick.t.isoformat(),
            "markSpot": _r2(last_tick.spot),
            "entryPremium": _r2(net_entry / unit_qty),
            "markPremium": _r2(sum(
                structures.leg_sign(leg.action) * last[i] * leg.qty
                for i, leg in enumerate(entry_legs)) / unit_qty),
            "grossPnl": _r2(gross),
            "netPnl": _r2(gross),
            "points": _r3(gross / unit_qty),
            "priced": all(px > 0 for px in last),
        })

    spots = structures.default_spot_range(entry_legs)
    expiry = structures.payoff_curve(entry_legs, spots) if spots else []
    if spots:
        max_profit, max_loss = structures.max_profit_loss(
            entry_legs, spots[0], spots[-1])
        bes = structures.breakevens(entry_legs, spots[0], spots[-1])
    else:
        max_profit = max_loss = 0.0
        bes = []

    realized = _r2(sum(t["netPnl"] for t in trades))
    return StrategyResult(
        id=spec.id,
        name=spec.name,
        legs=top_legs,
        net_debit=_r2(net_entry),
        max_profit=_r2(max_profit),
        max_loss=_r2(max_loss),
        breakevens=bes,
        margin_est=_r2(margin_est),
        trades=trades,
        open=open_marks,
        realized=realized,
        unrealized=_r2(unrealized),
        total=_r2(realized + unrealized),
        stats=_stats(trades, equity),
        equity=equity,
        payoff={"spots": spots, "expiry": expiry},
        skipped=None,
    )


def run_specs(specs: list[ExecSpec], ticks: list[Tick], lot_size: int,
              slippage_ticks: float = 0.0,
              costs: bool = True) -> list[StrategyResult]:
    """Run every spec independently over the **same** tape.

    Each spec gets its own day copy and its own ledger, so one bad spec can
    never affect another. Results are returned in input order.
    """
    day = _prep_ticks(ticks)
    return [_run_one(spec, day, lot_size, slippage_ticks, costs)
            for spec in specs or []]
