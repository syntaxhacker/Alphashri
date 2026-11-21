"""Pure liquidity analytics for one option chain — bid/ask spread and Vol/OI.

No FastAPI, no network, no DB, no I/O: :func:`liquidity_block` is a function of
its chain rows alone. The chain DTO hands in ``{"strike", "ce": {...}, "pe":
{...}}`` rows; each leg carries a ``market_data`` mapping with ``bid_price``,
``ask_price``, ``volume``, ``oi`` and ``ltp``.

Contract, pinned by :mod:`tests.api.test_options_liquidity`:

* **Nullable, never zero.** A missing/zero/crossed quote or a missing volume /
  OI stays ``None`` end to end. Zero is a price, not a sentinel — a heatmap
  cannot render "no data" from it. There is no 0-fill anywhere.
* **Spread is quote-relative.** ``pct = (ask - bid) / mid * 100`` with
  ``mid = (bid + ask) / 2``. ``ltp`` is read with the other quote fields but
  does not enter the formula by contract; only a valid two-sided quote yields a
  spread.
* **Crossed / invalid data is surfaced, not silently dropped.** ``ask < bid``
  raises ``crossed_market``; a present-but-corrupt quote (NaN/inf/negative)
  raises ``invalid_quotes``; the same on volume/OI raises ``invalid_volume_oi``.
  An absent or zero quote is normal on a dead strike and is *not* warned.
* **Partial chains are first-class.** Rows without a strike, without a leg, or
  with an empty ``market_data`` are skipped/zero-filled with ``None`` and never
  raise.
"""

from __future__ import annotations

import math
from statistics import median
from typing import Any, Mapping, Optional

__all__ = ["liquidity_block", "ILLIQUID_SPREAD_PCT"]

#: A leg whose spread is wider than this (percent of mid) is illiquid. Also used
#: for legs with no usable two-sided quote at all — a dead strike cannot be
#: traded. Local to this engine: no cross-module convention for spreads exists.
ILLIQUID_SPREAD_PCT = 1.0

#: Fixed wire order; warnings are codes the UI maps, never free-form text.
_WARNING_ORDER = ("crossed_market", "invalid_quotes", "invalid_volume_oi")


def _finite(value: Any) -> Optional[float]:
    """Finite float or ``None``. NaN/inf and unparseable values are not data."""
    try:
        out = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return out if math.isfinite(out) else None


def _as_mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _leg_md(leg: Any) -> Mapping[str, Any]:
    """The leg's ``market_data`` mapping.

    Also accepts a leg that *is* a market-data mapping (flat/partial chains).
    Missing or non-mapping legs return an empty mapping and are rendered as
    ``None`` cells by the caller.
    """
    row = _as_mapping(leg)
    md = row.get("market_data")
    if isinstance(md, Mapping):
        return md
    if any(k in row for k in ("bid_price", "ask_price", "volume", "oi", "ltp")):
        return row
    return {}


def _spread(md: Mapping[str, Any], warnings: set[str]) -> tuple[Optional[float], Optional[float]]:
    """Return ``(spread_pct, spread_abs)`` — both ``None`` when unusable."""
    raw_bid, raw_ask = md.get("bid_price"), md.get("ask_price")
    bid, ask = _finite(raw_bid), _finite(raw_ask)

    # A present value that is not finite, or is negative, is corrupt data —
    # distinct from an absent/zero quote on a dead strike.
    if (raw_bid is not None and bid is None) or (raw_ask is not None and ask is None):
        warnings.add("invalid_quotes")
        return None, None
    if (bid is not None and bid < 0.0) or (ask is not None and ask < 0.0):
        warnings.add("invalid_quotes")
        return None, None
    # Absent or zero quotes are normal: no spread, no fill, no warning.
    if bid is None or ask is None or bid <= 0.0 or ask <= 0.0:
        return None, None
    if ask < bid:
        warnings.add("crossed_market")
        return None, None

    mid = (bid + ask) / 2.0
    spread_abs = ask - bid
    return spread_abs / mid * 100.0, spread_abs


def _vol_oi(md: Mapping[str, Any], warnings: set[str]) -> Optional[float]:
    """Return ``volume / oi`` — ``None`` when OI is zero or either is missing."""
    raw_volume, raw_oi = md.get("volume"), md.get("oi")
    volume, oi = _finite(raw_volume), _finite(raw_oi)

    if (raw_volume is not None and volume is None) or (raw_oi is not None and oi is None):
        warnings.add("invalid_volume_oi")
        return None
    if (volume is not None and volume < 0.0) or (oi is not None and oi < 0.0):
        warnings.add("invalid_volume_oi")
        return None
    if volume is None or oi is None or oi == 0.0:
        return None
    return volume / oi


def liquidity_block(rows: Any) -> dict[str, Any]:
    """Shape one chain into the per-strike liquidity arrays for the heatmap.

    Every array is aligned to :attr:`strikes` (finite strikes, ascending). A leg
    is *illiquid* when it has no usable two-sided quote or a spread wider than
    :data:`ILLIQUID_SPREAD_PCT`; :attr:`illiquidCount` counts such legs across
    both sides. :attr:`medianSpreadPct` is the median of all usable CE/PE spread
    percentages, or ``None`` when the chain has none.
    """
    warnings: set[str] = set()
    ordered: list[tuple[float, Mapping[str, Any]]] = []
    for row in rows or []:
        row_map = _as_mapping(row)
        strike = _finite(row_map.get("strike"))
        if strike is None:
            continue
        ordered.append((strike, row_map))
    ordered.sort(key=lambda item: item[0])

    strikes: list[float] = []
    ce_spread_pct: list[Optional[float]] = []
    pe_spread_pct: list[Optional[float]] = []
    ce_spread_abs: list[Optional[float]] = []
    pe_spread_abs: list[Optional[float]] = []
    ce_vol_oi: list[Optional[float]] = []
    pe_vol_oi: list[Optional[float]] = []
    all_spreads: list[float] = []
    illiquid = 0

    for strike, row_map in ordered:
        strikes.append(strike)
        for side, pcts, abses, ratios in (
            ("ce", ce_spread_pct, ce_spread_abs, ce_vol_oi),
            ("pe", pe_spread_pct, pe_spread_abs, pe_vol_oi),
        ):
            md = _leg_md(row_map.get(side))
            if not md:
                pcts.append(None)
                abses.append(None)
                ratios.append(None)
                illiquid += 1
                continue

            pct, spread_abs = _spread(md, warnings)
            ratio = _vol_oi(md, warnings)
            pcts.append(pct)
            abses.append(spread_abs)
            ratios.append(ratio)
            if pct is None or pct > ILLIQUID_SPREAD_PCT:
                illiquid += 1
            if pct is not None:
                all_spreads.append(pct)

    return {
        "strikes": strikes,
        "ceSpreadPct": ce_spread_pct,
        "peSpreadPct": pe_spread_pct,
        "ceSpreadAbs": ce_spread_abs,
        "peSpreadAbs": pe_spread_abs,
        "ceVolOi": ce_vol_oi,
        "peVolOi": pe_vol_oi,
        "medianSpreadPct": median(all_spreads) if all_spreads else None,
        "illiquidCount": illiquid,
        "warnings": [code for code in _WARNING_ORDER if code in warnings],
    }
