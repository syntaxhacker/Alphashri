"""Deep Value gate filters (pure functions, no I/O).

A filter dict maps known keys to bounds; every key is optional and unknown
keys are ignored silently. A row whose value is ``None``/missing fails any
bound it cannot satisfy (unknown != pass). All numeric bounds are inclusive.
"""

from __future__ import annotations

from typing import Mapping, Sequence

from ._numeric import num as _num
from .scoring import sector_bucket

#: Preset name -> filter dict. Bounds are inclusive.
PRESETS: dict[str, dict] = {
    # NOTE: the "cheap" presets are MARKET-RELATIVE (percentile gates inside the
    # row's own sector bucket) because absolute multiples do not travel between
    # markets - P/E <= 12 is unremarkable in the USA and exceptional in India.
    # Percentiles are computed on the pre-gate frame and attached as row["_pct"].
    "SERIOUS": {
        "pe_pct_max": 0.35,
        "roe_pct_min": 0.55,
        "fcf_yield_pct_min": 0.65,
        "eps_yoy_pct_min": 0.50,
        # not broken: better than the worst quarter of the market on drawdown
        # from the 52w high (portable stand-in for "above the 200dma", which
        # would empty a market that is simply in a downtrend)
        "off_52w_high_pct_min": 0.25,
        "min_eps_yoy": -50,
        "max_de": 1.0,
        "min_mcap_bn": 0.5,
    },
    "DEEP": {
        "pe_pct_max": 0.15,
        "pb_pct_max": 0.30,
        "roe_pct_min": 0.70,
        "fcf_yield_pct_min": 0.80,
        "eps_yoy_pct_min": 0.50,
        "off_52w_high_pct_min": 0.15,
        "min_eps_yoy": -50,
        "max_de": 0.8,
        "min_mcap_bn": 0.5,
    },
    "GARP_VALUE": {
        "pe_pct_max": 0.60,
        "roe_pct_min": 0.70,
        "rev_yoy_pct_min": 0.55,
        "eps_yoy_pct_min": 0.55,
        "min_rev_yoy": 5,
        "min_eps_yoy": 5,
        "min_fcf_yield": 1,
    },
    "YIELD": {
        "min_div_yield": 4,
        "pe_pct_max": 0.50,
        "fcf_yield_pct_min": 0.60,
        "min_eps_yoy": 0,
    },
    "TURNAROUND": {
        "max_pe": 15,
        "min_eps_yoy": 0,
        "max_rev_yoy": 5,
        "above_200dma": True,
    },
    "NO_GATE": {},
}

#: Debt/equity ceiling used by the ``require_low_de`` boolean gate.
LOW_DE_THRESHOLD = 1.0

#: Keys understood by :func:`apply_filters`. ``max_rev_yoy`` is an addition
#: beyond the original key list, required by the TURNAROUND preset.
KNOWN_KEYS = frozenset(
    {
        "max_pe",
        "min_pe",
        "max_ps",
        "max_pb",
        "min_roe",
        "min_fcf_yield",
        "min_rev_yoy",
        "max_rev_yoy",
        "min_eps_yoy",
        "min_div_yield",
        "max_de",
        "min_mcap_bn",
        "max_mcap_bn",
        "require_low_de",
        "exclude_negative_fcf",
        "exclude_negative_eps",
        "above_200dma",
        "sectors",
        "min_price",
        "min_volume",
        "max_rsi",
        "exclude_loss_making",
        # market-relative percentile gates (0..1, within the row's own sector
        # bucket). These travel between markets: absolute multiples do not.
        "pe_pct_max",
        "ps_pct_max",
        "pb_pct_max",
        "de_pct_max",
        "roe_pct_min",
        "fcf_yield_pct_min",
        "rev_yoy_pct_min",
        "eps_yoy_pct_min",
        "off_52w_high_pct_min",
    }
)

#: Percentile gates: key -> (metric, "min"|"max")
_PERCENTILE_GATES = {
    "pe_pct_max": ("pe", "max"),
    "ps_pct_max": ("ps", "max"),
    "pb_pct_max": ("pb", "max"),
    "de_pct_max": ("de", "max"),
    "roe_pct_min": ("roe", "min"),
    "fcf_yield_pct_min": ("fcf_yield", "min"),
    "rev_yoy_pct_min": ("rev_yoy", "min"),
    "eps_yoy_pct_min": ("eps_yoy", "min"),
    "off_52w_high_pct_min": ("off_52w_high", "min"),
}


def _fcf_yield(row: Mapping) -> float | None:
    fcf = _num(row.get("free_cash_flow_ttm"))
    mcap = _num(row.get("market_cap_basic"))
    if fcf is None or mcap is None or mcap <= 0:
        return None
    return fcf / mcap * 100.0


def _mcap_bn(row: Mapping) -> float | None:
    mcap = _num(row.get("market_cap_basic"))
    if mcap is None:
        return None
    return mcap / 1e9


def _passes(row: Mapping, f: Mapping) -> bool:
    """Check one row against a normalised filter dict."""
    # market-relative percentile gates first (cheap, and they are the portable ones)
    active_pct = {k: f[k] for k in _PERCENTILE_GATES if f.get(k) is not None}
    if active_pct:
        pct = row.get("_pct")
        avail = row.get("_avail")
        if not isinstance(pct, Mapping):
            return False  # a percentile gate is active but the row has no ranking
        for key, (metric, mode) in _PERCENTILE_GATES.items():
            limit = active_pct.get(key)
            if limit is None:
                continue
            if isinstance(avail, Mapping) and avail.get(metric) is False:
                continue  # metric not populated for this bucket -> gate skipped
            value = pct.get(metric)
            if value is None:
                return False  # unknown != pass
            if mode == "max" and value > float(limit):
                return False
            if mode == "min" and value < float(limit):
                return False

    pe = _num(row.get("price_earnings_ttm"))
    if f.get("max_pe") is not None and not (pe is not None and pe <= float(f["max_pe"])):
        return False
    if f.get("min_pe") is not None and not (pe is not None and pe >= float(f["min_pe"])):
        return False

    ps = _num(row.get("price_sales_ratio"))
    if f.get("max_ps") is not None and not (ps is not None and ps <= float(f["max_ps"])):
        return False

    pb = _num(row.get("price_book_fq"))
    if f.get("max_pb") is not None and not (pb is not None and pb <= float(f["max_pb"])):
        return False

    roe = _num(row.get("return_on_equity_fq"))
    if f.get("min_roe") is not None and not (roe is not None and roe >= float(f["min_roe"])):
        return False

    fy = _fcf_yield(row)
    if f.get("min_fcf_yield") is not None and not (fy is not None and fy >= float(f["min_fcf_yield"])):
        return False

    rev = _num(row.get("total_revenue_yoy_growth_ttm"))
    if f.get("min_rev_yoy") is not None and not (rev is not None and rev >= float(f["min_rev_yoy"])):
        return False
    if f.get("max_rev_yoy") is not None and not (rev is not None and rev <= float(f["max_rev_yoy"])):
        return False

    eps_yoy = _num(row.get("earnings_per_share_diluted_yoy_growth_ttm"))
    if f.get("min_eps_yoy") is not None and not (eps_yoy is not None and eps_yoy >= float(f["min_eps_yoy"])):
        return False

    div = _num(row.get("dividends_yield_current"))
    if f.get("min_div_yield") is not None and not (div is not None and div >= float(f["min_div_yield"])):
        return False

    de = _num(row.get("debt_to_equity_fq"))
    if f.get("max_de") is not None and not (de is not None and de <= float(f["max_de"])):
        return False
    if f.get("require_low_de") and not (de is not None and de <= LOW_DE_THRESHOLD):
        return False

    mcap_bn = _mcap_bn(row)
    if f.get("min_mcap_bn") is not None and not (mcap_bn is not None and mcap_bn >= float(f["min_mcap_bn"])):
        return False
    if f.get("max_mcap_bn") is not None and not (mcap_bn is not None and mcap_bn <= float(f["max_mcap_bn"])):
        return False

    fcf = _num(row.get("free_cash_flow_ttm"))
    if f.get("exclude_negative_fcf") and not (fcf is not None and fcf >= 0):
        return False

    eps = _num(row.get("earnings_per_share_diluted_ttm"))
    if f.get("exclude_negative_eps") and not (eps is not None and eps >= 0):
        return False
    # "Exclude loss-making" is the NET LOSS gate (the UI shows it as a switch
    # separate from "Positive EPS"). It used to test EPS as well, which made
    # it a byte-for-byte duplicate of ``exclude_negative_eps`` — the switch
    # changed nothing. Net income is the loss-making metric and is what the
    # router's degraded fallback already uses.
    if f.get("exclude_loss_making"):
        net = _num(row.get("net_income"))
        if net is None or net <= 0:
            return False

    if f.get("above_200dma"):
        close = _num(row.get("close"))
        sma = _num(row.get("SMA200"))
        if not (close is not None and sma is not None and sma > 0 and close > sma):
            return False

    sectors = f.get("sectors")
    if sectors:
        wanted = {str(s).strip().lower() for s in sectors if str(s).strip()}
        if wanted and sector_bucket(row.get("sector")).lower() not in wanted:
            return False

    close = _num(row.get("close"))
    if f.get("min_price") is not None and not (close is not None and close >= float(f["min_price"])):
        return False

    vol = _num(row.get("volume"))
    if f.get("min_volume") is not None and not (vol is not None and vol >= float(f["min_volume"])):
        return False

    rsi = _num(row.get("RSI"))
    if f.get("max_rsi") is not None and not (rsi is not None and rsi <= float(f["max_rsi"])):
        return False

    return True


def apply_filters(rows: Sequence[Mapping], filters: Mapping | None) -> list[dict]:
    """Return the rows satisfying ``filters``, preserving order.

    ``None``/empty filters return every row. Unknown filter keys are ignored.
    Rows are returned as plain dicts; inputs are never mutated.
    """
    rows = list(rows)
    if not filters:
        return [dict(r) for r in rows]
    active = {k: v for k, v in filters.items() if k in KNOWN_KEYS and v is not None}
    if not active:
        return [dict(r) for r in rows]
    return [dict(r) for r in rows if _passes(r, active)]


def describe_filters(filters: Mapping | None) -> dict:
    """Normalise a filter dict for the API payload.

    Keeps known keys only; drops ``None`` values, ``False`` booleans (all
    boolean gates are opt-in) and empty collections/strings.
    """
    if not filters:
        return {}
    out: dict = {}
    for key, value in filters.items():
        if key not in KNOWN_KEYS or value is None:
            continue
        if isinstance(value, bool):
            if value:
                out[key] = True
            continue
        if isinstance(value, (list, tuple, set)):
            cleaned = [str(s).strip() for s in value if str(s).strip()]
            if cleaned:
                out[key] = cleaned
            continue
        if isinstance(value, str):
            if value.strip():
                out[key] = value.strip()
            continue
        if isinstance(value, Mapping):
            if len(value):
                out[key] = dict(value)
            continue
        out[key] = value
    return out


__all__ = ["PRESETS", "KNOWN_KEYS", "LOW_DE_THRESHOLD", "apply_filters", "describe_filters"]
