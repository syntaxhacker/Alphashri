"""Pure, side-effect-free feature extraction for chart-pattern detection.

All functions operate on a *normalised* OHLCV ``pandas.DataFrame``:

* columns ``open, high, low, close, volume`` (lower-case),
* a UTC ``DatetimeIndex`` sorted ascending,
* float dtype.

Nothing here mutates its inputs or touches I/O. Detectors compose these
primitives to describe geometry (pivots, trendlines, curvature, ATR).
"""

from __future__ import annotations

from typing import Iterable, Sequence

import numpy as np
import pandas as pd

OHLCV_COLUMNS = ["open", "high", "low", "close", "volume"]

# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------


def normalize_ohlcv(df: pd.DataFrame | None) -> pd.DataFrame | None:
    """Return a defensive copy normalised to the feature contract.

    Handles upper/lower-case column names, missing ``volume`` (filled with 0),
    duplicate/non-monotonic index and NaN closes. Returns ``None`` for empty
    input. Raises ``ValueError`` when a required price column is absent.
    """
    if df is None:
        return None
    if not isinstance(df, pd.DataFrame) or df.empty:
        return None

    out = df.copy()
    out.columns = [str(c).lower() for c in out.columns]
    # Drop any memoized ATR (see ``atr_value``): the copy inherits the input's
    # ``attrs``, but filtering/sorting below can change the rows, so a cached
    # value from the source frame must never be reused here.
    try:
        out.attrs.pop("_atr_cache", None)
    except AttributeError:
        pass
    for col in ("open", "high", "low", "close"):
        if col not in out.columns:
            raise ValueError(f"OHLCV frame missing required column {col!r}")
    if "volume" not in out.columns:
        out["volume"] = 0.0

    out = out[OHLCV_COLUMNS].apply(pd.to_numeric, errors="coerce")
    out = out[~out.index.duplicated(keep="last")].sort_index()
    out = out.dropna(subset=["close"])
    if out.empty:
        return None
    # volume NaN -> 0 so downstream comparisons are well defined.
    out["volume"] = out["volume"].fillna(0.0)
    return out


# ---------------------------------------------------------------------------
# Swing pivots (fractals)
# ---------------------------------------------------------------------------


def _pivot_indices(values: np.ndarray, left: int, right: int, kind: str) -> list[int]:
    n = len(values)
    out: list[int] = []
    if n < left + right + 1:
        return out
    for i in range(left, n - right):
        window = values[i - left : i + right + 1]
        centre = values[i]
        if kind == "high":
            if centre < window.max():
                continue
            # must be strictly above at least one neighbour (rejects all-flat)
            if centre > values[i - 1] or centre > values[i + 1]:
                out.append(i)
        else:
            if centre > window.min():
                continue
            if centre < values[i - 1] or centre < values[i + 1]:
                out.append(i)
    return out


def find_swing_highs(high: pd.Series, left: int = 2, right: int = 2) -> list[int]:
    """Positions ``i`` where ``high[i]`` is the local max of ``[i-left, i+right]``."""
    return _pivot_indices(np.asarray(high, dtype=float), left, right, "high")


def find_swing_lows(low: pd.Series, left: int = 2, right: int = 2) -> list[int]:
    """Positions ``i`` where ``low[i]`` is the local min of ``[i-left, i+right]``."""
    return _pivot_indices(np.asarray(low, dtype=float), left, right, "low")


def swing_points(
    df: pd.DataFrame, left: int = 2, right: int = 2
) -> list[tuple[int, str, float]]:
    """All pivots as ``(position, "H"|"L", price)`` sorted by position."""
    highs = find_swing_highs(df["high"], left, right)
    lows = find_swing_lows(df["low"], left, right)
    pts = [(i, "H", float(df["high"].iloc[i])) for i in highs]
    pts += [(i, "L", float(df["low"].iloc[i])) for i in lows]
    pts.sort(key=lambda p: p[0])
    return pts


def pivot_frame(df: pd.DataFrame, left: int = 2, right: int = 2) -> pd.DataFrame:
    """Frame with ``high_pivot`` / ``low_pivot`` columns (NaN elsewhere)."""
    hi = pd.Series(np.nan, index=df.index, dtype=float)
    lo = pd.Series(np.nan, index=df.index, dtype=float)
    for i in find_swing_highs(df["high"], left, right):
        hi.iloc[i] = float(df["high"].iloc[i])
    for i in find_swing_lows(df["low"], left, right):
        lo.iloc[i] = float(df["low"].iloc[i])
    return pd.DataFrame({"high_pivot": hi, "low_pivot": lo}, index=df.index)


# ---------------------------------------------------------------------------
# Least-squares lines
# ---------------------------------------------------------------------------


def linreg_fit(
    x: Sequence[float], y: Sequence[float]
) -> tuple[float, float, float]:
    """Least-squares fit ``y = slope*x + intercept``.

    Returns ``(slope, intercept, r2)``. ``r2`` is clipped to ``[0, 1]``; a
    degenerate fit (single point / zero variance) reports ``r2 = 1.0``.
    """
    xs = np.asarray(x, dtype=float)
    ys = np.asarray(y, dtype=float)
    if len(xs) == 0:
        return 0.0, 0.0, 0.0
    if len(xs) == 1:
        return 0.0, float(ys[0]), 1.0
    slope, intercept = np.polyfit(xs, ys, 1)
    yhat = slope * xs + intercept
    ss_res = float(((ys - yhat) ** 2).sum())
    ss_tot = float(((ys - ys.mean()) ** 2).sum())
    if ss_tot <= 0:
        r2 = 1.0
    else:
        r2 = 1.0 - ss_res / ss_tot
    return float(slope), float(intercept), float(min(1.0, max(0.0, r2)))


def fit_pivot_line(
    pivots: Sequence[tuple[int, float]]
) -> tuple[float, float, float] | None:
    """Fit a line through ``(position, price)`` pivots. ``None`` if < 2 pivots."""
    if len(pivots) < 2:
        return None
    xs = [p for p, _ in pivots]
    ys = [q for _, q in pivots]
    return linreg_fit(xs, ys)


def line_value(slope: float, intercept: float, x: float) -> float:
    """Evaluate a line at ``x``."""
    return float(slope) * float(x) + float(intercept)


def sample_line(
    slope: float, intercept: float, x0: int, x1: int
) -> list[dict]:
    """Serialise a straight line as its two endpoints for overlays."""
    return [
        {"t": x0, "price": line_value(slope, intercept, x0)},
        {"t": x1, "price": line_value(slope, intercept, x1)},
    ]


def relative_slope(slope: float, span: int, mean_price: float) -> float:
    """Total price drift of a line over ``span`` bars as a fraction of price."""
    if mean_price <= 0 or span <= 0:
        return 0.0
    return float(slope) * float(span) / float(mean_price)


def is_horizontal(slope: float, span: int, mean_price: float, tol: float = 0.03) -> bool:
    """True when the line drifts less than ``tol`` of price over ``span`` bars."""
    return abs(relative_slope(slope, span, mean_price)) <= tol


# ---------------------------------------------------------------------------
# Polynomial / curvature helpers
# ---------------------------------------------------------------------------


def polyfit_values(
    y: Sequence[float], degree: int = 2, x: Sequence[float] | None = None
) -> tuple[np.ndarray, np.ndarray]:
    """Fit a polynomial to ``y`` returning ``(fitted_values, coefficients)``.

    Coefficients are highest-power first (numpy convention). Fitted values have
    the same length as ``y``.
    """
    ys = np.asarray(y, dtype=float)
    if x is None:
        xs = np.arange(len(ys), dtype=float)
    else:
        xs = np.asarray(x, dtype=float)
    if len(ys) <= degree:
        return ys.copy(), np.array([0.0] * degree + [ys.mean() if len(ys) else 0.0])
    coeffs = np.polyfit(xs, ys, degree)
    fitted = np.polyval(coeffs, xs)
    return fitted, coeffs


def r2_of(y: Sequence[float], fitted: Sequence[float]) -> float:
    """Coefficient of determination of ``fitted`` against ``y``."""
    ys = np.asarray(y, dtype=float)
    fs = np.asarray(fitted, dtype=float)
    ss_tot = float(((ys - ys.mean()) ** 2).sum())
    if ss_tot <= 0:
        return 1.0
    ss_res = float(((ys - fs) ** 2).sum())
    return float(min(1.0, max(0.0, 1.0 - ss_res / ss_tot)))


def curvature_sign(coeffs: Sequence[float]) -> int:
    """Sign of the leading coefficient for a degree>=2 fit (+1 cup, -1 dome)."""
    if len(coeffs) < 3:
        return 0
    lead = float(coeffs[0])
    if abs(lead) < 1e-12:
        return 0
    return 1 if lead > 0 else -1


# ---------------------------------------------------------------------------
# Volatility / volume / extremes
# ---------------------------------------------------------------------------


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Average True Range (Wilder-style EMA of true range)."""
    if df is None or len(df) == 0:
        return pd.Series(dtype=float)
    high = df["high"].to_numpy(dtype=float)
    low = df["low"].to_numpy(dtype=float)
    close = df["close"].to_numpy(dtype=float)
    prev = np.empty_like(close)
    prev[0] = np.nan
    prev[1:] = close[:-1]
    # ``np.fmax`` skips NaN like pandas ``max(axis=1, skipna=True)``: the first
    # bar has no previous close, so its true range is just ``high - low``.
    tr = np.fmax.reduce(
        [high - low, np.abs(high - prev), np.abs(low - prev)]
    )
    return pd.Series(tr, index=df.index).ewm(
        alpha=1.0 / max(period, 1), adjust=False, min_periods=1
    ).mean()


def atr_value(df: pd.DataFrame, period: int = 14) -> float:
    """Last ATR value, with a sane fallback for very short frames.

    Memoized on the frame itself (``df.attrs``): one ``detect_patterns`` call
    runs ~19 detectors over the same normalised frame and each asks for the
    ATR, so the ~1ms EMA is computed once per frame instead of ~28 times. The
    cache dies with the frame, so distinct symbols/frames never share values.
    """
    if df is None or df.empty:
        return 0.0
    try:
        cache = df.attrs.get("_atr_cache")
    except AttributeError:
        cache = None
    if isinstance(cache, dict) and period in cache:
        return cache[period]
    series = atr(df, period)
    val = float(series.iloc[-1]) if not series.empty else 0.0
    if not np.isfinite(val) or val <= 0:
        rng = (df["high"] - df["low"]).astype(float)
        val = float(rng.tail(min(len(rng), period)).mean())
    if not np.isfinite(val) or val < 0:
        val = 0.0
    try:
        df.attrs.setdefault("_atr_cache", {})[period] = val
    except (AttributeError, TypeError):
        pass
    return val


def is_volume_confirmed(
    df: pd.DataFrame, idx: int, mult: float = 1.2, lookback: int = 20
) -> bool:
    """True when volume at ``idx`` exceeds ``mult`` x mean of prior ``lookback``."""
    if df is None or df.empty:
        return False
    vol = df["volume"].to_numpy(dtype=float)
    n = len(vol)
    if n == 0:
        return False
    if idx < 0:
        idx = n + idx
    if idx < 0 or idx >= n:
        return False
    lo = max(0, idx - lookback)
    prior = vol[lo:idx]
    if len(prior) == 0:
        return False
    base = float(np.nanmean(prior))
    if not np.isfinite(base) or base <= 0:
        return False
    return bool(vol[idx] > mult * base and vol[idx] > 0)


def swing_extremes(
    df: pd.DataFrame, start: int, end: int
) -> tuple[float, float, int, int]:
    """Highest high / lowest low (and their positions) within ``[start, end]``."""
    if df is None or df.empty:
        return 0.0, 0.0, start, end
    start = max(0, int(start))
    end = min(len(df) - 1, int(end))
    seg_high = df["high"].iloc[start : end + 1].astype(float)
    seg_low = df["low"].iloc[start : end + 1].astype(float)
    hi_pos = int(seg_high.values.argmax()) + start
    lo_pos = int(seg_low.values.argmin()) + start
    return float(seg_high.iloc[hi_pos - start]), float(seg_low.iloc[lo_pos - start]), hi_pos, lo_pos


def envelope_line(
    df: pd.DataFrame,
    pivots: Iterable[tuple[int, float]],
    side: str,
    tol: float,
) -> dict | None:
    """Best straight boundary through ``pivots`` that stays outside the candles.

    ``side="upper"`` → a resistance line at/above every candle high between its
    endpoints; ``side="lower"`` → a support line at/below every low. Picks the
    fewest-violation, longest-span pair of pivots, so the drawn trendline is a
    real boundary rather than a chord that cuts through price.
    """
    P = sorted(pivots, key=lambda t: t[0]) if pivots else []
    if len(P) < 2:
        return None
    # Fully vectorised over pivot pairs: one NumPy pass scores every ``(i, j)``
    # pair instead of a Python loop per pair per bar. The per-cell arithmetic
    # (``q0 + slope * (x - x0)``, ``d > tol``) is the same IEEE-754 float64
    # sequence as the scalar loop, rows run in the same ``(i, j)`` order, and
    # the winner is the first row with the minimal ``(viol, -span)`` key —
    # exactly the scalar loop's strict-``<`` pick. Rows are chunked so peak
    # memory stays bounded on pivot-dense frames.
    boundary = df["high"].to_numpy(dtype=float) if side == "upper" else df["low"].to_numpy(dtype=float)
    n = len(boundary)
    xs = np.array([int(p) for p, _ in P])
    qs = np.array([float(q) for _, q in P])
    m = len(P)
    rows_i, rows_j = np.triu_indices(m, k=1)
    keep = xs[rows_j] > xs[rows_i]
    if not bool(keep.all()):
        if not bool(keep.any()):
            return None
        rows_i, rows_j = rows_i[keep], rows_j[keep]
    X0 = xs[rows_i]
    X1 = xs[rows_j]
    Q0 = qs[rows_i]
    Q1 = qs[rows_j]
    span = X1 - X0
    slopes = (Q1 - Q0) / span
    grid = np.arange(n, dtype=float)
    best = None
    rows_per_chunk = max(1, min(len(X0), 1_000_000 // max(n, 1)))
    for blk in range(0, len(X0), rows_per_chunk):
        s = slice(blk, blk + rows_per_chunk)
        y = Q0[s, None] + slopes[s, None] * (grid[None, :] - X0[s, None])
        seg = (grid[None, :] >= X0[s, None]) & (grid[None, :] <= X1[s, None])
        if side == "upper":
            d = boundary[None, :] - y
        else:
            d = y - boundary[None, :]
        over = seg & (d > tol)
        viol = over.sum(axis=1)
        worst = np.where(over, d, -np.inf).max(axis=1)
        w = int(np.lexsort((-(span[s]), viol))[0])
        key = (int(viol[w]), -int(span[s][w]))
        if best is None or key < best["key"]:
            slope = float(slopes[s][w])
            x0 = int(X0[s][w])
            best = {
                "key": key,
                "slope": slope,
                "intercept": float(Q0[s][w]) - slope * x0,
                "x0": x0,
                "q0": float(Q0[s][w]),
                "x1": int(X1[s][w]),
                "q1": float(Q1[s][w]),
                "viol": int(viol[w]),
                "worst": float(worst[w]) if viol[w] > 0 else 0.0,
            }
    return best


def count_touches(
    pivots: Iterable[tuple[int, float]],
    slope: float,
    intercept: float,
    atr_val: float,
    tol_atr: float = 0.75,
) -> int:
    """How many pivots lie within ``tol_atr * ATR`` of a trendline."""
    if atr_val <= 0:
        return 0
    n = 0
    for pos, price in pivots:
        if abs(price - line_value(slope, intercept, pos)) <= tol_atr * atr_val:
            n += 1
    return n


def penetration_ratio(
    df: pd.DataFrame,
    slope: float,
    intercept: float,
    start: int,
    end: int,
    side: str,
    atr_val: float,
) -> float:
    """Fraction of closes that pierce a trendline by more than a small buffer.

    ``side="upper"`` measures closes *above* an upper (resistance) line;
    ``side="lower"`` measures closes *below* a lower (support) line. A low ratio
    means the line was never meaningfully violated (no body penetration).
    """
    if df is None or df.empty:
        return 1.0
    start = max(0, int(start))
    end = min(len(df) - 1, int(end))
    if end < start:
        return 0.0
    xs = np.arange(start, end + 1, dtype=float)
    line = slope * xs + intercept
    closes = df["close"].to_numpy(dtype=float)[start : end + 1]
    buf = max(atr_val * 0.25, 1e-9)
    if side == "upper":
        pierced = closes > line + buf
    elif side == "lower":
        pierced = closes < line - buf
    else:
        return 0.0
    return float(pierced.mean()) if len(closes) else 0.0


def last_n(pivots: Sequence[tuple[int, float]], n: int) -> list[tuple[int, float]]:
    """Last ``n`` pivots (pivots are position-ordered)."""
    if n <= 0:
        return []
    return list(pivots[-n:])


def between(
    pivots: Sequence[tuple[int, float]], lo: int, hi: int
) -> list[tuple[int, float]]:
    """Pivots with ``lo <= position <= hi``."""
    return [(p, q) for p, q in pivots if lo <= p <= hi]
