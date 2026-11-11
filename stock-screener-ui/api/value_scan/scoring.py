"""Deep Value scoring engine.

Pure functions only: no network, no redis, no filesystem, no global state.
Import-safe. Rows are plain mappings coming from the TradingView scanner.

Missing data policy: a ``None``/``NaN``/non-numeric value is UNKNOWN and
scores 0 points for every component that needs it. It is never treated as a
cheap-looking 0.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from typing import Mapping, Sequence

from ._numeric import num as _num

# ---------------------------------------------------------------------------
# Sector buckets
# ---------------------------------------------------------------------------

#: Normalised TradingView sector -> peer bucket.
SECTOR_BUCKETS: dict[str, str] = {
    "Technology": "Technology",
    "Healthcare": "Healthcare",
    "Financial": "Financials",
    "Financial Services": "Financials",
    "Finance": "Financials",
    "Banks": "Banks",
    "Banking": "Banks",
    "Insurance": "Insurance",
    "Energy": "Energy",
    "Oil & Gas": "Energy",
    "Industrials": "Industrials",
    "Industrial": "Industrials",
    "Consumer Cyclical": "Consumer Cyclical",
    "Consumer Defensive": "Consumer Staples",
    "Consumer Non-Cyclical": "Consumer Staples",
    "Consumer Staples": "Consumer Staples",
    "Basic Materials": "Materials",
    "Materials": "Materials",
    "Utilities": "Utilities",
    "Communication Services": "Communication",
    "Communication": "Communication",
    "Real Estate": "Real Estate",
    "Realty": "Real Estate",
}

_BUCKET_LOOKUP: dict[str, str] = {k.lower(): v for k, v in SECTOR_BUCKETS.items()}

#: Buckets where P/S is meaningless (lending/insurer revenue); the 5 P/S
#: points move to the P/B term, which then carries 9 points.
BANK_LIKE_BUCKETS = frozenset({"Banks", "Insurance"})

#: Fundamental inputs counted for the "unknown-fundamentals" flag. More than
#: half of these missing -> flag.
FUNDAMENTAL_KEYS: tuple[str, ...] = (
    "price_earnings_ttm",
    "price_sales_ratio",
    "price_book_fq",
    "return_on_equity_fq",
    "gross_margin_ttm",
    "operating_margin_ttm",
    "debt_to_equity_fq",
    "current_ratio",
    "free_cash_flow_ttm",
    "market_cap_basic",
    "total_revenue_yoy_growth_ttm",
    "earnings_per_share_diluted_yoy_growth_ttm",
    "earnings_per_share_diluted_ttm",
    "dividends_yield_current",
)


def sector_bucket(sector: str | None) -> str:
    """Map a TradingView sector string to its peer bucket.

    Lookup is case-insensitive and whitespace-tolerant. ``None``/empty maps
    to ``"Other"``; an unrecognised non-empty sector is returned stripped, so
    identical unknown sectors still group together as peers.
    """
    if sector is None:
        return "Other"
    text = str(sector).strip()
    if not text:
        return "Other"
    return _BUCKET_LOOKUP.get(text.lower(), text)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ScoreConfig:
    """Tuning knobs for :func:`score_row`."""

    use_peer_relative: bool = True
    penalise_trend: bool = True  # include 200d/rsi/market-verdict terms
    min_confidence: float = 0.5  # missing data always scores 0 for its term


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _fcf_yield(row: Mapping) -> float | None:
    """Free-cash-flow yield in percent, or ``None`` when unknown."""
    fcf = _num(row.get("free_cash_flow_ttm"))
    mcap = _num(row.get("market_cap_basic"))
    if fcf is None or mcap is None or mcap <= 0:
        return None
    return fcf / mcap * 100.0


def _earnings_yield_frac(row: Mapping) -> float | None:
    """Earnings yield as a fraction (1 / P/E), or ``None`` when unknown."""
    pe = _num(row.get("price_earnings_ttm"))
    if pe is None or pe == 0.0:
        return None
    return 1.0 / pe


def _vs_200dma(row: Mapping) -> float | None:
    """Distance of close above the 200-day SMA in percent."""
    close = _num(row.get("close"))
    sma = _num(row.get("SMA200"))
    if close is None or sma is None or sma <= 0:
        return None
    return (close / sma - 1.0) * 100.0


def _off_52w_high(row: Mapping) -> float | None:
    """Distance of close below the 52-week high in percent."""
    close = _num(row.get("close"))
    high = _num(row.get("price_52_week_high"))
    if close is None or high is None or high <= 0:
        return None
    return (close / high - 1.0) * 100.0


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    return float(statistics.median(values))


def _clamp25(points: float) -> int:
    """Clamp a sub-score to an int in 0..25."""
    return max(0, min(25, int(round(points))))


def _rescale(terms: Sequence[float], total: float) -> list[int]:
    """Rescale terms proportionally so they sum to ``total`` (largest remainder)."""
    terms = [max(0.0, float(t)) for t in terms]
    raw = sum(terms)
    if raw <= 0:
        return [0] * len(terms)
    scaled = [t / raw * total for t in terms]
    base = [math.floor(v) for v in scaled]
    leftover = int(total) - sum(base)
    order = sorted(range(len(scaled)), key=lambda i: scaled[i] - base[i], reverse=True)
    for i in order[: max(0, leftover)]:
        base[i] += 1
    return base


# ---------------------------------------------------------------------------
# Peer medians
# ---------------------------------------------------------------------------


#: Metrics kept as full distributions so a row can be turned into a
#: market-relative percentile (portable "cheap" thresholds across markets).
_DIST_METRICS = (
    "pe", "ps", "pb", "roe", "fcf_yield", "rev_yoy", "eps_yoy", "de", "off_52w_high",
)

#: Reserved key inside the mapping returned by :func:`peer_medians`.
_DIST_KEY = "__dist__"

#: Reserved key holding per-bucket metric coverage (fraction of rows with a value).
_COV_KEY = "__cov__"

#: A metric is only used for scoring / gating when at least this fraction of
#: the bucket has a value. Below it the metric is treated as UNAVAILABLE for the
#: whole bucket: its points are redistributed and its gates are skipped.
#: (TradingView populates free_cash_flow_ttm for ~3% of Indian names and for
#: ~85% of US names, so a hard FCF gate would silently empty a whole market.)
MIN_METRIC_COVERAGE = 0.25


def peer_medians(rows: Sequence[Mapping]) -> dict[str, dict]:
    """Median fundamentals per peer bucket over the FULL input frame.

    Call this before any gate/filter step: medians must describe the whole
    universe, not the survivors. Buckets with no rows, and metrics with no
    valid values, are simply absent from the result.
    """
    acc: dict[str, dict[str, list[float]]] = {}
    _bucket_size: dict[str, int] = {}
    for row in rows:
        bucket = sector_bucket(row.get("sector"))
        slot = acc.setdefault(bucket, {})
        _bucket_size[bucket] = _bucket_size.get(bucket, 0) + 1
        candidates: dict[str, float | None] = {
            "pe": _num(row.get("price_earnings_ttm")),
            "ps": _num(row.get("price_sales_ratio")),
            "pb": _num(row.get("price_book_fq")),
            "roe": _num(row.get("return_on_equity_fq")),
            "fcf_yield": _fcf_yield(row),
            "rev_yoy": _num(row.get("total_revenue_yoy_growth_ttm")),
            "eps_yoy": _num(row.get("earnings_per_share_diluted_yoy_growth_ttm")),
            "de": _num(row.get("debt_to_equity_fq")),
            "gross_margin": _num(row.get("gross_margin_ttm")),
            "op_margin": _num(row.get("operating_margin_ttm")),
            "off_52w_high": _off_52w_high(row),
        }
        for key, value in candidates.items():
            if value is not None:
                slot.setdefault(key, []).append(value)
    medians: dict[str, dict[str, float]] = {}
    for bucket, vals in acc.items():
        bucket_medians: dict[str, float] = {}
        for key, series in vals.items():
            med = _median(series)
            if med is not None:
                bucket_medians[key] = med
        medians[bucket] = bucket_medians
    # Reserved key: the full per-bucket distributions. Consumers (score_row) use
    # them to turn a row's value into a market-relative percentile, which is what
    # makes a "cheap" threshold portable across markets with very different
    # absolute multiples (India vs USA). Must be built from the PRE-GATE frame.
    medians[_DIST_KEY] = {
        bucket: {key: sorted(series) for key, series in vals.items() if key in _DIST_METRICS}
        for bucket, vals in acc.items()
    }
    # Reserved key: per-bucket metric coverage. A metric with almost no values
    # in a bucket is UNAVAILABLE for that bucket (see MIN_METRIC_COVERAGE).
    coverage: dict[str, dict[str, float]] = {}
    for bucket, vals in acc.items():
        size = _bucket_size.get(bucket) or 0
        if size:
            coverage[bucket] = {
                key: (len(series) / size) for key, series in vals.items()
            }
    medians[_COV_KEY] = coverage
    return medians


# ---------------------------------------------------------------------------
# Term scorers (each returns an int within its point budget)
# ---------------------------------------------------------------------------


def _ey_points(ey: float | None, med: float | None, peer: bool, loss: bool) -> int:
    if loss or ey is None:
        return 0
    if peer and med is not None and med > 0 and ey > 0:
        ratio = ey / med
        if ratio >= 1.5:
            return 10
        if ratio >= 1.2:
            return 8
        if ratio >= 1.0:
            return 6
        if ratio >= 0.7:
            return 3
        return 1
    if ey >= 0.10:
        return 10
    if ey >= 0.07:
        return 8
    if ey >= 0.05:
        return 6
    if ey >= 0.03:
        return 3
    return 0


def _fcf_points(fy: float | None, med: float | None, peer: bool, neg_fcf: bool) -> int:
    if neg_fcf or fy is None:
        return 0
    if peer and med is not None and med > 0 and fy > 0:
        ratio = fy / med
        if ratio >= 1.5:
            return 6
        if ratio >= 1.2:
            return 5
        if ratio >= 1.0:
            return 4
        if ratio >= 0.7:
            return 2
        return 1
    if fy >= 8.0:
        return 6
    if fy >= 5.0:
        return 5
    if fy >= 3.0:
        return 4
    if fy >= 1.5:
        return 2
    if fy > 0:
        return 1
    return 0


def _low_is_better(ratio: float | None, bands: Sequence[tuple[float, int]]) -> int:
    if ratio is None:
        return 0
    for bound, pts in bands:
        if ratio <= bound:
            return pts
    return 0


def _ps_points(ps: float | None, med: float | None, peer: bool) -> int:
    if ps is None or ps <= 0:
        return 0
    if peer and med is not None and med > 0:
        return _low_is_better(ps / med, ((0.5, 5), (0.7, 4), (0.9, 3), (1.1, 2), (1.5, 1)))
    if ps <= 0.5:
        return 5
    if ps <= 1.0:
        return 4
    if ps <= 2.0:
        return 3
    if ps <= 4.0:
        return 2
    return 1


def _pb_points(pb: float | None, med: float | None, peer: bool, bank_like: bool) -> int:
    if pb is None or pb <= 0:
        return 0
    if bank_like:
        if peer and med is not None and med > 0:
            return _low_is_better(pb / med, ((0.5, 9), (0.7, 7), (1.0, 5), (1.3, 3), (1.6, 1)))
        if pb <= 0.5:
            return 9
        if pb <= 1.0:
            return 7
        if pb <= 1.5:
            return 5
        if pb <= 2.5:
            return 3
        if pb <= 4.0:
            return 1
        return 0
    if peer and med is not None and med > 0:
        return _low_is_better(pb / med, ((0.5, 4), (0.7, 3), (1.0, 2), (1.3, 1)))
    if pb <= 0.5:
        return 4
    if pb <= 1.0:
        return 3
    if pb <= 2.0:
        return 2
    if pb <= 3.0:
        return 1
    return 0


def _roe_points(roe: float | None, med: float | None, peer: bool) -> int:
    if roe is None:
        return 0
    if peer and med is not None and med > 0 and roe > 0:
        ratio = roe / med
        if ratio >= 1.5:
            return 8
        if ratio >= 1.2:
            return 6
        if ratio >= 1.0:
            return 5
        if ratio >= 0.8:
            return 3
        return 1
    if roe >= 25.0:
        return 8
    if roe >= 18.0:
        return 6
    if roe >= 12.0:
        return 5
    if roe >= 8.0:
        return 3
    if roe > 0:
        return 1
    return 0


def _margin_points(val: float | None, med: float | None, peer: bool, top: int, absolute: Sequence[tuple[float, int]]) -> int:
    if val is None:
        return 0
    if peer and med is not None:
        diff = val - med
        step = top / 5.0
        if diff >= 10.0:
            return top
        if diff >= 5.0:
            return min(top, int(round(top - step)))
        if diff >= 0.0:
            return min(top, int(round(top - 2 * step)))
        if diff >= -5.0:
            return 1
        return 0
    for bound, pts in absolute:
        if val >= bound:
            return pts
    return 0


def _growth_points(val: float | None, med: float | None, peer: bool) -> int:
    if val is None:
        return 0
    if peer and med is not None:
        diff = val - med
        if diff >= 15.0:
            return 9
        if diff >= 8.0:
            return 7
        if diff >= 3.0:
            return 5
        if diff >= 0.0:
            return 3
        if diff >= -5.0:
            return 1
        return 0
    if val >= 25.0:
        return 9
    if val >= 15.0:
        return 7
    if val >= 8.0:
        return 5
    if val >= 0.0:
        return 3
    if val >= -10.0:
        return 1
    return 0


def _verdict_leg(perf: float | None) -> int:
    if perf is None:
        return 0
    if perf >= 10.0:
        return 4
    if perf >= 0.0:
        return 2
    return 0


# ---------------------------------------------------------------------------
# score_row
# ---------------------------------------------------------------------------


def score_row(
    row: Mapping,
    peers: Mapping[str, Mapping[str, float]],
    cfg: ScoreConfig | None = None,
) -> dict:
    """Score one scanner row. Returns a NEW dict: input row plus extras.

    Adds ``subscores`` (value/quality/growth/health, each 0-25),
    ``score`` (0-100, the sum), ``flags``, ``peer`` medians and ``derived``
    values. Never mutates the input row.
    """
    cfg = cfg or ScoreConfig()
    peer_mode = cfg.use_peer_relative

    bucket = sector_bucket(row.get("sector"))
    med: Mapping[str, float] = peers.get(bucket, {})
    cov_all = peers.get(_COV_KEY)
    cov: Mapping[str, float] = (
        cov_all.get(bucket, {}) if isinstance(cov_all, Mapping) else {}
    )

    def available(metric: str) -> bool:
        """True when the metric is populated for enough of this bucket."""
        rate = cov.get(metric)
        if rate is None:
            # no coverage info -> assume the metric is usable
            return True
        return rate >= MIN_METRIC_COVERAGE

    has_fcf = available("fcf_yield")
    has_roe = available("roe")
    has_gm = available("gross_margin")
    has_om = available("op_margin")
    has_rev = available("rev_yoy")
    has_eps = available("eps_yoy")
    has_de = available("de")
    has_pe = available("pe")
    has_pb = available("pb")
    has_ps = available("ps")

    pe = _num(row.get("price_earnings_ttm"))
    ps = _num(row.get("price_sales_ratio"))
    pb = _num(row.get("price_book_fq"))
    roe = _num(row.get("return_on_equity_fq"))
    gm = _num(row.get("gross_margin_ttm"))
    om = _num(row.get("operating_margin_ttm"))
    de = _num(row.get("debt_to_equity_fq"))
    cr = _num(row.get("current_ratio"))
    fcf = _num(row.get("free_cash_flow_ttm"))
    mcap = _num(row.get("market_cap_basic"))
    rev_yoy = _num(row.get("total_revenue_yoy_growth_ttm"))
    eps_yoy = _num(row.get("earnings_per_share_diluted_yoy_growth_ttm"))
    eps = _num(row.get("earnings_per_share_diluted_ttm"))
    div = _num(row.get("dividends_yield_current"))
    volume = _num(row.get("volume"))
    rsi = _num(row.get("RSI"))
    perf3 = _num(row.get("Perf.3M"))
    perf1 = _num(row.get("Perf.1M"))
    rec = _num(row.get("Recommend.All"))

    fcf_yield = _fcf_yield(row)
    ey_frac = _earnings_yield_frac(row)
    ey_pct = 100.0 * ey_frac if ey_frac is not None else None
    vs200 = _vs_200dma(row)
    off_high = _off_52w_high(row)

    loss_making = eps is not None and eps < 0
    negative_fcf = fcf is not None and fcf < 0
    distorted = pe is not None and pe < 6 and (roe is not None and roe > 25)
    missing_count = sum(1 for key in FUNDAMENTAL_KEYS if _num(row.get(key)) is None)
    # A huge EPS swing on flat sales is a one-off (asset sale, tax credit, write-back),
    # not repeatable growth -> flag it and winsorise the growth term.
    one_off = (
        eps_yoy is not None
        and abs(eps_yoy) > 60.0
        and (rev_yoy is None or rev_yoy < 10.0)
    )
    eps_yoy_scored = None if eps_yoy is None else max(-60.0, min(60.0, eps_yoy))

    flags: list[str] = []
    if vs200 is not None:
        if vs200 > 0:
            flags.append("above-200dma")
        elif vs200 < 0:
            flags.append("below-200dma")
    if distorted:
        flags.append("distorted-pe")
    if pe is None:
        flags.append("no-earnings")
    if loss_making:
        flags.append("loss-making")
    if negative_fcf:
        flags.append("negative-fcf")
    if de is not None and de > 1.0:
        flags.append("high-debt")
    if div is not None and div > 0:
        flags.append("paying-dividend")
    if volume is not None and volume < 100_000:
        flags.append("thin-volume")
    if missing_count > len(FUNDAMENTAL_KEYS) / 2:
        flags.append("unknown-fundamentals")
    if one_off:
        flags.append("one-off-earnings")

    bank_like = bucket in BANK_LIKE_BUCKETS

    # -- VALUE (25): 10 ey + 6 fcf + 5 ps + 4 pb (banks: 0 ps + 9 pb) --
    pe_med = med.get("pe")
    ey_med = 1.0 / pe_med if pe_med is not None and pe_med > 0 else None
    v_ey = _ey_points(ey_frac, ey_med, peer_mode, loss_making)
    v_fcf = _fcf_points(fcf_yield, med.get("fcf_yield"), peer_mode, negative_fcf) if has_fcf else 0
    v_ps = 0 if bank_like else _ps_points(ps, med.get("ps"), peer_mode)
    v_pb = _pb_points(pb, med.get("pb"), peer_mode, bank_like)
    value_terms = [v_ey, v_fcf, v_ps, v_pb]
    if not has_fcf:
        value_terms = _rescale(value_terms, 25)
    value = _clamp25(sum(value_terms) - (4 if distorted else 0))

    # -- QUALITY (25): 8 roe + 5 gm + 4 om + 4 balance sheet + 4 dividend --
    q_roe = _roe_points(roe, med.get("roe"), peer_mode) if has_roe else 0
    q_gm = _margin_points(gm, med.get("gross_margin"), peer_mode, 5, ((50.0, 5), (30.0, 4), (15.0, 3), (5.0, 1))) if has_gm else 0
    q_om = _margin_points(om, med.get("op_margin"), peer_mode, 4, ((25.0, 4), (15.0, 3), (8.0, 2), (0.0, 1))) if has_om else 0
    q_de = 0
    if has_de and de is not None and de >= 0:
        q_de = 2 if de <= 0.3 else (1 if de <= 0.7 else 0)
    q_cr = 0
    if cr is not None:
        q_cr = 2 if cr >= 2.0 else (1 if cr >= 1.2 else 0)
    q_div = 0
    if div is not None and div > 0:
        q_div = 4 if div >= 6.0 else (3 if div >= 4.0 else (2 if div >= 2.0 else 1))
    quality_terms = [q_roe, q_gm, q_om, q_de, q_cr, q_div]
    if not (has_roe and has_gm and has_om):
        quality_terms = _rescale(quality_terms, 25)
    quality = _clamp25(sum(quality_terms))

    # -- GROWTH (25): 9 rev + 9 eps + 4 verdict + 3 recommend --
    g_rev = _growth_points(rev_yoy, med.get("rev_yoy"), peer_mode) if has_rev else 0
    g_eps = (
        0
        if (loss_making or not has_eps)
        else _growth_points(eps_yoy_scored, med.get("eps_yoy"), peer_mode)
    )
    g_verdict = min(4, _verdict_leg(perf3) + _verdict_leg(perf1))
    g_rec = 0
    if rec is not None:
        g_rec = 3 if rec >= 0.1 else (2 if rec >= -0.1 else (1 if rec >= -0.3 else 0))
    if cfg.penalise_trend:
        growth_terms = [g_rev, g_eps, g_verdict, g_rec]
        if not (has_rev and has_eps):
            growth_terms = _rescale(growth_terms, 25)
        growth = _clamp25(sum(growth_terms))
    else:
        g_rev2, g_eps2 = _rescale([g_rev, g_eps], 25)
        growth = _clamp25(g_rev2 + g_eps2)

    # -- HEALTH (25): 6 stability + 5 de + 5 off-high + 4 rsi + 5 liquidity --
    h_stab = 0
    if eps_yoy is not None:
        ae = abs(eps_yoy)
        h_stab = 6 if ae <= 15 else (4 if ae <= 30 else (2 if ae <= 60 else 0))
    h_de = 0
    if has_de and de is not None and de >= 0:
        de_med = med.get("de")
        if peer_mode and de_med is not None and de_med > 0:
            h_de = _low_is_better(de / de_med, ((0.5, 5), (0.8, 4), (1.1, 2), (1.5, 1)))
        else:
            h_de = 5 if de <= 0.3 else (4 if de <= 0.6 else (2 if de <= 1.0 else (1 if de <= 1.5 else 0)))
    h_off = 0
    if off_high is not None:
        h_off = (
            5
            if -25.0 <= off_high <= -5.0
            else (3 if -40.0 <= off_high < -25.0 else (1 if -60.0 <= off_high < -40.0 else 0))
        )
    h_rsi = 0
    if rsi is not None:
        h_rsi = 4 if 30.0 <= rsi <= 70.0 else (2 if 20.0 <= rsi < 30.0 or 70.0 < rsi <= 80.0 else 0)
    h_liq = 0
    if mcap is not None:
        h_liq = (
            5
            if mcap >= 100e9
            else (4 if mcap >= 10e9 else (3 if mcap >= 1e9 else (1 if mcap >= 1e8 else 0)))
        )
    if cfg.penalise_trend:
        health_terms = [h_stab, h_de, h_off, h_rsi, h_liq]
        if not has_de:
            health_terms = _rescale(health_terms, 25)
        health = _clamp25(sum(health_terms))
    else:
        parts = _rescale([h_stab, h_de, h_off, h_liq], 25)
        health = _clamp25(sum(parts))

    subscores = {"value": value, "quality": quality, "growth": growth, "health": health}
    if one_off:
        # one-off earnings are not repeatable growth -> take the points back
        growth = _clamp25(growth - 4)
        subscores["growth"] = growth
    out = dict(row)
    out["subscores"] = subscores
    out["score"] = value + quality + growth + health
    out["flags"] = flags
    out["peer"] = {
        "bucket": bucket,
        "pe_median": med.get("pe"),
        "roe_median": med.get("roe"),
        "fcf_yield_median": med.get("fcf_yield"),
    }
    out["derived"] = {
        "fcf_yield": fcf_yield,
        "earnings_yield": ey_pct,
        "net_cash": None,
        "vs_200dma": vs200,
        "off_52w_high": off_high,
        "distorted_pe": bool(distorted),
    }
    # Market-relative percentile ranks (0 = cheapest / weakest, 1 = richest /
    # strongest) inside the row's own sector bucket. Portable "cheap" gates use
    # these instead of absolute multiples, which do not travel between markets.
    out["_pct"] = _percentiles(row, peers, bucket)
    out["_avail"] = {
        "pe": has_pe,
        "ps": has_ps,
        "pb": has_pb,
        "roe": has_roe,
        "fcf_yield": has_fcf,
        "rev_yoy": has_rev,
        "eps_yoy": has_eps,
        "de": has_de,
        "off_52w_high": True,
    }
    return out


def _percentiles(row: Mapping, peers: Mapping, bucket: str) -> dict[str, float]:
    """Percentile rank of each metric inside its peer bucket (0..1)."""
    dist_all = peers.get(_DIST_KEY)
    if not isinstance(dist_all, Mapping):
        return {}
    dist = dist_all.get(bucket)
    if not isinstance(dist, Mapping):
        return {}
    values = {
        "pe": _num(row.get("price_earnings_ttm")),
        "ps": _num(row.get("price_sales_ratio")),
        "pb": _num(row.get("price_book_fq")),
        "roe": _num(row.get("return_on_equity_fq")),
        "fcf_yield": _fcf_yield(row),
        "rev_yoy": _num(row.get("total_revenue_yoy_growth_ttm")),
        "eps_yoy": _num(row.get("earnings_per_share_diluted_yoy_growth_ttm")),
        "de": _num(row.get("debt_to_equity_fq")),
        "off_52w_high": _off_52w_high(row),
    }
    out: dict[str, float] = {}
    for key, value in values.items():
        series = dist.get(key)
        if value is None or not series:
            continue
        out[key] = sum(1 for v in series if v <= value) / len(series)
    return out


__all__ = [
    "SECTOR_BUCKETS",
    "FUNDAMENTAL_KEYS",
    "BANK_LIKE_BUCKETS",
    "ScoreConfig",
    "sector_bucket",
    "peer_medians",
    "score_row",
]
