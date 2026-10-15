"""Realistic NSE index-option execution model: fees, spread, slippage, margin.

Fee constants mirror ``scripts/paper_sensex.py:option_costs`` (the repo's single
source of truth for index-option charges). Spread/slippage are explicit because
we only hold a *current* chain snapshot, never a historical bid/ask series — the
defaults are calibrated from the recorded FYERS chain (ATM half-spread
~0.3-0.5%) and deliberately set conservatively for backtests.
"""

from __future__ import annotations

from dataclasses import dataclass

# --- NSE F&O index-option charges (premium-based) -------------------------
BROKERAGE_PCT = 0.0003          # 0.03%, min ₹20 per order
MIN_BROKERAGE = 20.0
STT_SELL_PCT = 0.001            # 0.1% on the sell side only (options)
EXCHANGE_PCT = 0.0003503        # 0.03503% both sides
SEBI_PCT = 0.000001             # ₹10 / crore
STAMP_BUY_PCT = 0.00003         # 0.003% buy side
GST_PCT = 0.18                  # 18% on (brokerage + exchange + SEBI)

# --- market-impact assumptions (not observable in historical candles) -----
DEFAULT_HALF_SPREAD_PCT = 0.0035   # ~0.35% per side
DEFAULT_SLIPPAGE_PCT = 0.0015      # ~0.15% extra per side


@dataclass(frozen=True)
class ExecutionModel:
    half_spread_pct: float = DEFAULT_HALF_SPREAD_PCT
    slippage_pct: float = DEFAULT_SLIPPAGE_PCT
    lot: int = 65

    def buy_fill(self, ref_price: float) -> float:
        """Pay the ask plus slippage."""
        return ref_price * (1.0 + self.half_spread_pct + self.slippage_pct)

    def sell_fill(self, ref_price: float) -> float:
        """Receive the bid minus slippage."""
        return max(0.05, ref_price * (1.0 - self.half_spread_pct - self.slippage_pct))


def leg_costs(price: float, lot: int, side: str) -> float:
    """One-way charges for a single option leg. ``side`` in {BUY, SELL}."""
    val = max(price, 0.0) * lot
    brk = min(MIN_BROKERAGE, val * BROKERAGE_PCT)
    exch = val * EXCHANGE_PCT
    sebi = val * SEBI_PCT
    if side.upper() == "BUY":
        return brk + val * STAMP_BUY_PCT + exch + sebi + GST_PCT * (brk + exch + sebi)
    return brk + val * STT_SELL_PCT + exch + sebi + GST_PCT * (brk + exch + sebi)


def round_trip_costs(entry_premium: float, exit_premium: float, lot: int,
                     entry_side: str = "BUY", exit_side: str | None = None) -> float:
    """Total charges for a round trip on one leg.

    ``entry_side`` is what you do to open (BUY for long, SELL for short); the
    exit is the opposite unless overridden.
    """
    if exit_side is None:
        exit_side = "SELL" if entry_side.upper() == "BUY" else "BUY"
    return leg_costs(entry_premium, lot, entry_side) + leg_costs(exit_premium, lot, exit_side)


# --- margin (SPAN + exposure approximation) ------------------------------
# NSE index-option margin is not published per-contract; the broker terminal is
# authoritative. This is the standard approximation: SPAN ~12% of notional for a
# naked short index option plus 3% exposure, with hedged structures capped at the
# width of the payoff. Clearly labelled as an estimate everywhere it is reported.
SPAN_PCT_NAKED = 0.12
EXPOSURE_PCT = 0.03


def short_margin_per_lot(spot: float, lot: int, strike: float | None = None,
                         option_type: str | None = None) -> float:
    """Approximate overnight margin for one *naked* short index option (₹)."""
    notional = spot * lot
    otm_buffer = 0.0
    if strike is not None:
        otm_buffer = max(0.0, abs(strike - spot)) * 0.5 * lot * 0.02
    return (SPAN_PCT_NAKED + EXPOSURE_PCT) * notional + otm_buffer


def spread_margin_per_lot(spot: float, lot: int, width: float) -> float:
    """Defined-risk credit/vertical spread margin ≈ max loss = width × lot."""
    return width * lot


def _otype(l: dict) -> str:
    return l.get("option_type") or l.get("opt") or ""


def capital_for_structure(spot: float, lot: int, legs: list[dict]) -> float:
    """Capital requirement for a multi-leg structure.

    ``legs`` = list of ``{side: 'BUY'|'SELL', premium, strike, option_type/opt}``.
    Long-only: net debit. Fully hedged spread: width × lot. Naked short: SPAN
    approximation (labelled as an estimate).
    """
    net_debit = sum((1 if l["side"] == "BUY" else -1) * l.get("premium", 0.0) * lot for l in legs)
    shorts = [l for l in legs if l["side"] == "SELL"]
    if not shorts:
        return max(net_debit, 0.0)
    longs = [l for l in legs if l["side"] == "BUY"]
    if longs:
        widths = []
        for s in shorts:
            same = [l for l in longs if _otype(l) == _otype(s)]
            if same:
                widths.append(min(abs(l["strike"] - s["strike"]) for l in same))
        if widths:
            return max(max(widths) * lot, net_debit, 0.0)
    margin = sum(short_margin_per_lot(spot, lot, l.get("strike"), _otype(l)) for l in shorts)
    return margin + max(net_debit, 0.0)
