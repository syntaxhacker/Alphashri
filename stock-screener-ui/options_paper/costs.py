"""Realistic option round-trip cost model (Upstox, 2026 rates).

Unlike ``backtest/costs.py`` (equity, percentage brokerage, no STT on premium),
option charges are dominated by a flat **₹30 per executed order** and a 0.15%
STT on the sell premium. Premiums are small, so costs are a large fraction of a
trade's value — which is exactly why the buyer's edge question is sensitive to
them.

The brokerage rule
------------------
Brokerage is charged **per executed order** and equals the lesser of

* a flat **₹30**, and
* **2.5% of that order's turnover** (the order's premium value).

i.e. ``brokerage = min(₹30, 2.5% × turnover)``. A small order pays the
percentage, a large order pays the ₹30 cap.

A straddle is **four** orders (buy CE, buy PE, sell CE, sell PE) and is
therefore charged four times — never once for the combined premium. The same
rule applies to the break-even move: a structure's break-even is the sum of
its legs' break-evens, because each leg carries its own round trip.

Cost model version
------------------
:data:`COSTS_VERSION` names the schedule a trade was priced with. Every booked
trade carries it, so a schedule change (e.g. the ₹20 -> ₹30 brokerage revision
of 2026-10-21) can be *detected* and the affected rows recomputed from one
schedule instead of leaving a book priced under two.
"""

from __future__ import annotations

from .spec import CHARGES, Charges, get_lot

#: Identifies the charge schedule. Bump it whenever ``CHARGES`` changes — the
#: stamp is written on every booked trade so mixed-schedule books are visible.
COSTS_VERSION = "upstox-2026-10-21-v2"

#: Brokerage is the lesser of a flat ₹30/order and this share of the order's
#: turnover (premium value). See the module docstring.
BROKERAGE_PCT_OF_TURNOVER = 0.025


def _side_costs(premium_value: float, is_buy: bool, ch: Charges) -> dict:
    """Charges for one executed order of premium value ``premium_value``."""
    # Flat ₹30 per executed order, capped at 2.5% of the order's turnover.
    brokerage = (min(ch.brokerage_per_order,
                     premium_value * BROKERAGE_PCT_OF_TURNOVER)
                 if premium_value > 0 else 0.0)
    txn = premium_value * ch.exch_txn_pct
    sebi = premium_value * ch.sebi_pct
    ipft = premium_value * ch.ipft_pct
    gst = ch.gst_pct * (brokerage + txn + sebi + ipft)
    stamp = premium_value * ch.stamp_buy_pct if is_buy else 0.0
    stt = 0.0 if is_buy else premium_value * ch.stt_sell_pct
    total = brokerage + txn + sebi + ipft + gst + stamp + stt
    return {
        "brokerage": round(brokerage, 4),
        "txn": round(txn, 4),
        "sebi": round(sebi, 4),
        "ipft": round(ipft, 4),
        "gst": round(gst, 4),
        "stamp": round(stamp, 4),
        "stt": round(stt, 4),
        "total": round(total, 4),
    }


def option_round_trip_cost(
    entry_premium: float,
    exit_premium: float,
    qty: int,
    is_short: bool = False,
    ch: Charges = CHARGES,
) -> dict:
    """Full round-trip cost + gross/net P&L for one option leg.

    ``qty`` is total units (lots x lot size). ``is_short`` inverts the cash
    flow and moves the STT to the entry (sell) premium.
    Long : buy at ``entry_premium``, sell at ``exit_premium``.
    Short: sell at ``entry_premium``, buy back at ``exit_premium``.

    One call = **one leg** = two executed orders. A straddle is two calls (one
    per leg), i.e. four orders.
    """
    if qty <= 0:
        raise ValueError("qty must be positive")

    if is_short:
        sell_value = entry_premium * qty
        buy_value = exit_premium * qty
        gross = sell_value - buy_value
    else:
        buy_value = entry_premium * qty
        sell_value = exit_premium * qty
        gross = sell_value - buy_value

    buy = _side_costs(buy_value, is_buy=True, ch=ch)
    sell = _side_costs(sell_value, is_buy=False, ch=ch)
    total_costs = buy["total"] + sell["total"]

    return {
        "qty": qty,
        "buy_value": round(buy_value, 2),
        "sell_value": round(sell_value, 2),
        "gross_pnl": round(gross, 2),
        "costs": round(total_costs, 2),
        "net_pnl": round(gross - total_costs, 2),
        "breakdown": {"buy": buy, "sell": sell},
        "costs_version": COSTS_VERSION,
    }


class BreakEven(float):
    """The break-even move in premium points, plus whether a root was found.

    A ``float`` subclass so existing arithmetic keeps working
    (``entry - be_pts``); ``found`` is ``False`` when the round-trip costs can
    never be covered by any legal exit premium. In that case the value is the
    *bound* of the search (never an arbitrary 100 points, which used to push a
    short's stop below zero).
    """

    found: bool

    def __new__(cls, points: float, found: bool = True):
        obj = super().__new__(cls, points)
        obj.found = bool(found)
        return obj

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"BreakEven({float(self):.2f}, found={self.found})"


def break_even_move_points(
    entry_premium: float,
    qty: int,
    is_short: bool = False,
    ch: Charges = CHARGES,
) -> BreakEven:
    """Premium move (in points) needed just to cover round-trip costs.

    A long option must rise this many points; a short must fall this many.
    Because costs scale with both sides' premium value, we solve iteratively
    for the exit premium that makes ``net_pnl == 0``.

    The search is bounded by what the contract can actually do:

    * a **short**'s exit premium cannot go below 0, so the move is bounded by
      ``entry`` (the old unbounded search returned ~100 points, which put the
      stop *below zero*);
    * a **long**'s exit premium is searched up to 4x the entry (at least ₹100).

    When no root exists inside those bounds the returned move is the bound
    itself and ``found`` is ``False`` — the caller must not treat it as a real
    break-even.
    """
    if entry_premium <= 0 or qty <= 0:
        return BreakEven(0.0, False)

    if is_short:
        lo, hi = 0.0, entry_premium
    else:
        lo, hi = 0.0, max(entry_premium * 4.0, 100.0)

    def net_at(mid: float) -> float:
        exit_premium = (max(entry_premium - mid, 0.0) if is_short
                        else entry_premium + mid)
        return option_round_trip_cost(entry_premium, exit_premium, qty,
                                       is_short, ch)["net_pnl"]

    # A root only exists if the net is positive at the far end of the range.
    if net_at(hi) <= 0:
        return BreakEven(round(hi, 2), False)

    for _ in range(60):
        mid = (lo + hi) / 2.0
        # The gross P&L grows with the move for BOTH directions (a long
        # gains ``mid * qty`` as the premium rises, a short gains the same
        # as it falls), so the net is increasing in ``mid`` and the root is
        # found the same way in both directions.
        if net_at(mid) > 0:
            hi = mid
        else:
            lo = mid
    return BreakEven(round(hi, 2), True)


def break_even_move_points_multi(
    leg_premiums: list[float],
    qty: int,
    is_short: bool = False,
    ch: Charges = CHARGES,
) -> BreakEven:
    """Break-even move for a multi-leg structure (a straddle = two legs).

    Every leg carries its own round trip (2 orders per leg, 4 for a straddle),
    so the structure's break-even is the **sum of the legs' break-even
    moves** — pricing the combined premium as a single leg would understate
    the costs by half.
    """
    total = 0.0
    found = True
    for premium in leg_premiums:
        if premium <= 0:
            continue
        be = break_even_move_points(premium, qty, is_short=is_short, ch=ch)
        total += float(be)
        found = found and be.found
    return BreakEven(round(total, 2), found)


def reprice_trade_costs(row: dict, ch: Charges = CHARGES) -> dict:
    """Recompute gross/costs/net/points for a booked trade under ``ch``.

    ``row`` is a journal/DB-shaped dict. A straddle is repriced leg by leg
    (four orders) when its leg premiums are known, otherwise as one leg.
    Returns the corrected fields plus the schedule version — the caller
    decides whether to write them back.
    """
    entry = float(row.get("entry_premium") or 0.0)
    exit_px = float(row.get("exit_premium") or 0.0)
    qty = int(row.get("qty") or 0)
    is_short = str(row.get("direction") or "LONG").upper() == "SHORT"
    opt = str(row.get("opt") or "").upper()

    entry_ce = float(row.get("entry_ce") or 0.0)
    entry_pe = float(row.get("entry_pe") or 0.0)
    exit_ce = float(row.get("exit_ce") or 0.0)
    exit_pe = float(row.get("exit_pe") or 0.0)

    legs: list[tuple[float, float]] = []
    if opt == "STRADDLE" and entry_ce > 0 and entry_pe > 0:
        legs.append((entry_ce, exit_ce))
        legs.append((entry_pe, exit_pe))
    elif entry > 0:
        legs.append((entry, exit_px))

    if not legs or qty <= 0:
        return {
            "gross_pnl": float(row.get("gross_pnl") or 0.0),
            "costs": float(row.get("costs") or 0.0),
            "net_pnl": float(row.get("net_pnl") or 0.0),
            "points": float(row.get("points") or 0.0),
            "costs_version": COSTS_VERSION,
            "repriced": False,
        }

    gross = costs_total = net = 0.0
    for leg_entry, leg_exit in legs:
        rc = option_round_trip_cost(leg_entry, leg_exit, qty, is_short, ch)
        gross += rc["gross_pnl"]
        costs_total += rc["costs"]
        net += rc["net_pnl"]
    return {
        "gross_pnl": round(gross, 2),
        "costs": round(costs_total, 2),
        "net_pnl": round(net, 2),
        "points": round(net / qty, 3),
        "costs_version": COSTS_VERSION,
        "repriced": True,
    }


def sell_margin_estimate(spot: float, lot: int, lots: int = 1) -> float:
    """Rough SPAN+exposure margin for a naked short option position (₹).

    Deliberately conservative; the real number comes from the broker's margin
    API. Used only to gate whether a short-premium strategy is affordable.
    """
    from .spec import SELL_MARGIN_PCT_OF_NOTIONAL, SELL_MARGIN_MIN_PER_LOT
    notional = spot * lot * lots
    return round(max(notional * SELL_MARGIN_PCT_OF_NOTIONAL,
                     SELL_MARGIN_MIN_PER_LOT * lots), 2)


def costs_to_points(costs_rupees: float, lots: int, lot: int) -> float:
    """Convert a ₹ cost into premium points (per unit)."""
    denom = max(lots * lot, 1)
    return round(costs_rupees / denom, 4)
