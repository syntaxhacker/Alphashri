"""Realistic option round-trip cost model (Upstox, 2026 rates).

Unlike ``backtest/costs.py`` (equity, percentage brokerage, no STT on premium),
option charges are dominated by a flat ₹20/order and a 0.15% STT on the sell
premium. Premiums are small, so costs are a large fraction of a trade's value —
which is exactly why the buyer's edge question is sensitive to them.
"""

from __future__ import annotations

from .spec import CHARGES, Charges, get_lot


def _side_costs(premium_value: float, is_buy: bool, ch: Charges) -> dict:
    """Charges for one executed order of premium value ``premium_value``."""
    brokerage = min(ch.brokerage_per_order, premium_value) if premium_value > 0 else 0.0
    # (flat ₹20, but never more than the trade is worth)
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
    }


def break_even_move_points(
    entry_premium: float,
    qty: int,
    is_short: bool = False,
    ch: Charges = CHARGES,
) -> float:
    """Premium move (in points) needed just to cover round-trip costs.

    A long option must rise this many points; a short must fall this many.
    Because costs scale with both sides' premium value, we solve iteratively
    for the exit premium that makes ``net_pnl == 0``.
    """
    lo, hi = 0.0, max(entry_premium * 4.0, 100.0)
    for _ in range(60):
        mid = (lo + hi) / 2.0
        exit_premium = entry_premium + mid if not is_short else entry_premium - mid
        exit_premium = max(exit_premium, 0.0)
        net = option_round_trip_cost(entry_premium, exit_premium, qty, is_short, ch)["net_pnl"]
        # For a long, net rises with exit; for a short, net rises as exit falls.
        rising = net > 0
        if not is_short:
            if rising:
                hi = mid
            else:
                lo = mid
        else:
            if rising:
                hi = mid
            else:
                lo = mid
    return round(hi, 2)


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
