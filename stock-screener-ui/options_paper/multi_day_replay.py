"""Multi-day, no-lookahead replay of a resolved option structure.

This is the swing-hold sibling of :mod:`options_paper.structure_engine`: there
is no EOD exit and no stop/target, because the position is meant to survive to
expiry. The honesty contract is the same:

* the signal bar is the first provider bar at/after ``entry_ts``; the fill is
  the **next** bar, and nothing on the signal bar can set the entry premium.
  A leg may carry its own ``entry_time``: it then gets its own signal/fill pair
  and contributes nothing (P&L *and* costs) until that fill;
* every mark is for the held ``(strike, opt)`` — never the drifting ATM;
* a leg without a print carries its last known premium and ``priced`` is
  cleared, so gaps are visible instead of papered over;
* weekends and holidays are absent from the bar grid, never interpolated;
* costs come from :mod:`options_paper.costs`, payoff from
  :mod:`options_paper.structures`; neither formula is restated here;
* an IST-aware timestamp is used throughout;
* every frame carries an ``active`` map (same keys as ``marks``) so a staggered
  leg's join bar is visible to the UI.

Anything that would require invented data produces a ``skipped`` reason on the
result instead of raising.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Optional, Sequence

import config

from . import structures
from .costs import option_entry_cost
from .replay_data import ChainProvider

IST = config.IST


def _r2(value: float) -> float:
    out = round(float(value), 2)
    return 0.0 if out == 0 else out


def _as_ist(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=IST)
    return ts.astimezone(IST)


def _leg_key(leg) -> str:
    """Base identity used in refusal messages: ``STRIKE-OPT``."""
    return (f"{float(getattr(leg, 'strike', 0.0) or 0.0):g}-"
            f"{str(getattr(leg, 'opt', '') or '').upper()}")


def _frame_keys(legs) -> list[str]:
    """Unique ``marks``/``active`` keys, one per leg, in leg order.

    Two legs of the same contract (a same-strike backspread, or a staggered
    buy/sell of the same strike) used to overwrite each other in the maps: the
    second leg's mark and join flag silently replaced the first's. Unique legs
    keep the historical ``STRIKE-OPT`` key; only colliding pairs get a suffix.
    """
    base = [_leg_key(leg) for leg in legs]
    counts = Counter(base)
    keys = []
    for index, (leg, key) in enumerate(zip(legs, base)):
        if counts[key] == 1:
            keys.append(key)
            continue
        action = str(getattr(leg, "action", "") or "LEG").upper()
        keys.append(f"{key}-{action}-{index}")
    return keys


def _leg_entry_time(leg, entry: datetime) -> datetime:
    """A leg's own entry time, falling back to the shared ``entry_ts``."""
    raw = getattr(leg, "entry_time", None)
    return entry if raw is None else _as_ist(raw)


@dataclass
class ReplayResult:
    """Frames, summary, payoff and coverage for one replayed structure."""

    underlying: str = ""
    expiry: str = ""
    entry_time: Optional[datetime] = None
    fill_time: Optional[datetime] = None
    legs: list[dict] = field(default_factory=list)
    frames: list[dict] = field(default_factory=list)
    path: list[dict] = field(default_factory=list)
    net_debit: float = 0.0
    max_profit: float = 0.0
    max_loss: float = 0.0
    breakevens: list = field(default_factory=list)
    costs_total: float = 0.0
    realized: float = 0.0
    unrealized: float = 0.0
    total: float = 0.0
    coverage: dict = field(default_factory=dict)
    payoff: dict = field(default_factory=lambda: {"spots": [], "expiry": []})
    skipped: Optional[str] = None
    source: str = ""

    def as_dict(self) -> dict:
        """CamelCase, JSON-safe payload; mirrors ``StrategyResult.as_dict``."""
        peak = 0.0
        drawdown = 0.0
        for point in self.path:
            pnl = float(point["pnl"])
            peak = max(peak, pnl)
            drawdown = max(drawdown, peak - pnl)
        return {
            "underlying": self.underlying,
            "expiry": self.expiry,
            "entryTime": self.entry_time.isoformat() if self.entry_time else None,
            "fillTime": self.fill_time.isoformat() if self.fill_time else None,
            "legs": self.legs,
            "frames": self.frames,
            "path": self.path,
            "netDebit": _r2(self.net_debit),
            "maxProfit": _r2(self.max_profit),
            "maxLoss": _r2(self.max_loss),
            "breakevens": self.breakevens,
            "costsTotal": _r2(self.costs_total),
            "realized": _r2(self.realized),
            "unrealized": _r2(self.unrealized),
            "total": _r2(self.total),
            "coverage": self.coverage,
            "summary": {
                "realized": _r2(self.realized),
                "unrealized": _r2(self.unrealized),
                "total": _r2(self.total),
                "maxDrawdown": _r2(drawdown),
                "costsTotal": _r2(self.costs_total),
                "coverage": self.coverage,
            },
            "stats": {"maxDrawdown": _r2(drawdown), "frames": len(self.frames)},
            "payoff": self.payoff,
            "skipped": self.skipped,
            "source": self.source,
        }


def _shell(legs, underlying, expiry, entry_ts, skipped, source="") -> ReplayResult:
    """A refused replay still returns a well-shaped result."""
    return ReplayResult(
        underlying=underlying, expiry=expiry, entry_time=entry_ts,
        legs=[{"action": getattr(l, "action", ""), "opt": getattr(l, "opt", ""),
               "strike": _r2(getattr(l, "strike", 0.0)),
               "lots": getattr(l, "lots", 0), "qty": getattr(l, "qty", 0),
               "entryPremium": 0.0} for l in legs or []],
        coverage={"frames": 0, "first": None, "last": None, "gaps": 0,
                  "gapList": []},
        skipped=skipped, source=source,
    )


def _infer_meta(legs, underlying, expiry):
    exps = {str(getattr(l, "expiry")) for l in legs if getattr(l, "expiry", None)}
    unds = {str(getattr(l, "underlying")).upper()
            for l in legs if getattr(l, "underlying", None)}
    if underlying:
        unds.add(str(underlying).upper())
    if expiry:
        exps.add(str(expiry))
    return ((next(iter(unds)) if len(unds) == 1 else ""),
            (next(iter(exps)) if len(exps) == 1 else ""), exps)


def _series_map(provider: ChainProvider, underlying: str, expiry: str,
                legs, from_ts: datetime, to_ts: datetime):
    out = []
    for leg in legs:
        rows = provider.premium_series(underlying, expiry, float(leg.strike),
                                       str(leg.opt).upper(), from_ts, to_ts)
        by_ts = {}
        for ts, premium, priced in rows or []:
            by_ts[_as_ist(ts).replace(second=0, microsecond=0)] = (
                float(premium) if premium is not None else 0.0, bool(priced))
        out.append(by_ts)
    return out


def _spot_at(provider: ChainProvider, underlying: str, expiry: str,
             ts: datetime, cache: dict, carry: list) -> float:
    key = ts.replace(second=0, microsecond=0)
    if key not in cache:
        try:
            quote = provider.chain_at(underlying, expiry, ts)
        except NotImplementedError:
            quote = None
        cache[key] = (float(quote.spot) if quote is not None
                      and quote.spot and quote.spot > 0 else None)
    spot = cache[key]
    if spot is not None:
        carry[0] = spot
    return carry[0]


def build_replay(
    legs: Sequence[structures.ResolvedLeg],
    entry_ts: datetime,
    end_ts: datetime,
    provider: ChainProvider,
    lot_size: int,
    slippage_ticks: float = 0.0,
    costs: bool = True,
    *,
    underlying: str = "",
    expiry: str = "",
) -> ReplayResult:
    """Precompute replay frames for a held structure, with staggered entries.

    ``underlying``/``expiry`` are optional because a :class:`ResolvedLeg` has no
    contract identity; when omitted they are inferred from ``leg.underlying`` /
    ``leg.expiry`` attributes on duck-typed legs. Passing two different leg
    expiries is refused instead of silently marking one contract's premiums
    against another's.

    A leg may carry an ``entry_time`` (IST-aware or naive). When it does, that
    leg's signal bar is the first grid bar at/after that time and its fill is
    the NEXT bar; it contributes no P&L and no entry cost before that fill.
    Legs without ``entry_time`` all use the shared ``entry_ts`` — the original
    single-entry behaviour, including its refusal reasons.
    """
    entry = _as_ist(entry_ts)
    end = _as_ist(end_ts)
    legs = list(legs or [])
    und, exp, exps = _infer_meta(legs, underlying, expiry)
    source = getattr(provider, "source", "")

    if not legs:
        return _shell(legs, und, exp, entry, "no legs", source)
    if len(exps) > 1:
        return _shell(legs, und, exp, entry, "mixed expiries", source)

    leg_entries = [_leg_entry_time(leg, entry) for leg in legs]
    # Only the presence of an explicit per-leg entry changes the refusal text;
    # callers that never set it keep the original, well-known reasons.
    leg_reasons = any(getattr(leg, "entry_time", None) is not None
                      for leg in legs)
    earliest = min(leg_entries)

    try:
        series = _series_map(provider, und, exp, legs, earliest, end)
    except (NotImplementedError, ConnectionError):
        return _shell(legs, und, exp, entry, "provider unavailable", source)

    grid = sorted({ts for s in series for ts in s})

    signal_i: list[int] = []
    fill_i: list[int] = []
    for i, entry_at in enumerate(leg_entries):
        si = next((idx for idx, t in enumerate(grid) if t >= entry_at), None)
        if si is None or si + 1 >= len(grid):
            reason = ("no fill bar for leg " + _leg_key(legs[i])
                      if leg_reasons else "no fill bar")
            return _shell(legs, und, exp, entry, reason, source)
        signal_i.append(si)
        fill_i.append(si + 1)

    first = min(signal_i)
    slip = max(float(slippage_ticks or 0.0), 0.0)

    # Each leg's premium comes from ITS OWN fill bar. A preset entry_premium is
    # never trusted to bypass the real-print check (backdated/live orders).
    entry_legs: list = []
    for i, leg in enumerate(legs):
        raw = series[i].get(grid[fill_i[i]])
        if raw is None or not raw[1] or not raw[0] > 0:
            reason = ("leg unpriced at entry " + _leg_key(legs[i])
                      if leg_reasons else "leg unpriced at entry")
            return _shell(legs, und, exp, entry, reason, source)
        sign = structures.leg_sign(leg.action)
        fill_px = max(raw[0] + sign * slip, 0.0)
        qty = int(leg.qty) if int(getattr(leg, "qty", 0) or 0) > 0 else (
            int(getattr(leg, "lots", 1) or 1) * max(int(lot_size or 0), 1))
        entry_legs.append(replace(leg, entry_premium=fill_px, qty=qty))

    net_debit = structures.net_entry_cost(entry_legs)

    # Entry-side cost per leg, computed from that leg's own fill premium —
    # never from a later mark. Booked when the leg fills, not at frame zero.
    leg_costs = [
        option_entry_cost(leg.entry_premium, leg.qty,
                          is_short=(leg.action == "SELL"))["costs"]
        if costs else 0.0
        for leg in entry_legs
    ]
    costs_total = sum(leg_costs)

    def gross_at(prices: list[float], j: int) -> float:
        # Strictly after the leg's own fill: the fill frame itself is flat.
        return sum(structures.leg_sign(leg.action)
                   * (prices[i] - leg.entry_premium) * leg.qty
                   for i, leg in enumerate(entry_legs) if j > fill_i[i])

    def costs_at(j: int) -> float:
        return sum(cost for i, cost in enumerate(leg_costs)
                   if j >= fill_i[i])

    # First pass: marks, join flags and last known premiums. A leg that has not
    # filled is excluded from ``priced`` so its own data gap cannot unprice a
    # frame the structure does not yet hold.
    marks_by_frame: list[dict] = []
    frame_keys = _frame_keys(entry_legs)
    last = [leg.entry_premium for leg in entry_legs]
    spot_cache: dict = {}
    spot_carry = [0.0]
    priced_after_fill = False
    for j in range(first, len(grid)):
        t = grid[j]
        spot = _spot_at(provider, und, exp, t, spot_cache, spot_carry)
        marks, active, leg_priced, prices = {}, {}, [], []
        for i, leg in enumerate(entry_legs):
            raw = series[i].get(t)
            if raw is not None and raw[1] and raw[0] > 0:
                last[i] = raw[0]
                leg_priced.append(True)
            else:
                leg_priced.append(False)
            key = frame_keys[i]
            marks[key] = _r2(last[i])
            active[key] = j >= fill_i[i]
            prices.append(last[i])
        active_flags = [j >= fi for fi in fill_i]
        priced = all(leg_priced[i] for i in range(len(entry_legs))
                     if active_flags[i])
        if priced and any(active_flags[i] and j > fill_i[i]
                          for i in range(len(entry_legs))):
            priced_after_fill = True
        marks_by_frame.append({
            "j": j, "t": t, "spot": spot, "marks": marks, "active": active,
            "prices": prices, "priced": priced,
        })
    if not priced_after_fill:
        return _shell(legs, und, exp, entry, "no marks after entry", source)

    frames, path, gap_list = [], [], []
    for item in marks_by_frame:
        j = item["j"]
        gross = gross_at(item["prices"], j)
        net = gross - costs_at(j)
        if not item["priced"] and any(item["active"].values()):
            gap_list.append(item["t"].isoformat())
        frames.append({
            "t": item["t"].isoformat(),
            "spot": _r2(item["spot"]),
            "marks": item["marks"],
            "active": item["active"],
            "priced": item["priced"],
            "grossPnl": _r2(gross),
            "netPnl": _r2(net),
            "netDebit": _r2(net_debit),
            "equity": _r2(net),
        })
        path.append({"t": item["t"].isoformat(), "pnl": _r2(net)})

    # Payoff describes the final structure: every leg at its own fill premium,
    # even though the P&L path above respects the staggered entries.
    spots = structures.adaptive_spot_range(entry_legs)
    payoff = structures.payoff_curve(entry_legs, spots) if spots else []
    if spots:
        max_profit, max_loss = structures.max_profit_loss(
            entry_legs, spots[0], spots[-1])
        bes = structures.breakevens(entry_legs, spots[0], spots[-1])
    else:
        max_profit = max_loss = 0.0
        bes = []

    unrealized = frames[-1]["netPnl"] if frames else 0.0
    return ReplayResult(
        underlying=und, expiry=exp, entry_time=entry,
        fill_time=grid[min(fill_i)],
        legs=[{
            "action": leg.action, "opt": leg.opt, "strike": _r2(leg.strike),
            "lots": leg.lots, "qty": leg.qty,
            "entryPremium": _r2(leg.entry_premium),
            "entryTime": leg_entries[i].isoformat(),
            "fillTime": grid[fill_i[i]].isoformat(),
        } for i, leg in enumerate(entry_legs)],
        frames=frames, path=path,
        net_debit=_r2(net_debit), max_profit=_r2(max_profit),
        max_loss=_r2(max_loss), breakevens=bes, costs_total=_r2(costs_total),
        realized=0.0, unrealized=_r2(unrealized), total=_r2(unrealized),
        coverage={"frames": len(frames),
                  "first": frames[0]["t"] if frames else None,
                  "last": frames[-1]["t"] if frames else None,
                  "gaps": len(gap_list), "gapList": gap_list[:50]},
        payoff={"spots": spots, "expiry": payoff},
        skipped=None, source=source,
    )


__all__ = ["ReplayResult", "build_replay"]
