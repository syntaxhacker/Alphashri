"""Pure, side-effect-free feature extraction for chart-pattern detection.

All functions operate on a *normalised* OHLCV ``pandas.DataFrame``:

* columns ``open, high, low, close, volume`` (lower-case),
* a UTC ``DatetimeIndex`` sorted ascending,
* float dtype.

Nothing here mutates its inputs or touches I/O. Detectors compose these
primitives to describe geometry (pivots, trendlines, curvature, ATR).
"""

from __future__ import annotations

import weakref
from collections import OrderedDict
from typing import Iterable, Sequence

import numpy as np
import pandas as pd
from numpy.lib.stride_tricks import sliding_window_view

OHLCV_COLUMNS = ["open", "high", "low", "close", "volume"]

# ``atr_value`` and ``envelope_line`` are called many times with the same frame
# inside one ``detect_patterns`` pass (~19 detectors, 63% of envelope calls are
# exact duplicates). Caching on ``df.attrs`` looked free but pandas 3 deep-copies
# ``attrs`` on every derived Series (``__finalize__``), which cost ~5% of the
# engine. This store is keyed by object identity, holds only a weak reference to
# the frame, and is bounded, so a frame's entries disappear with the frame and a
# recycled ``id`` can never produce a wrong hit (the weakref identity check
# fails and the entry is rebuilt).
#
# Values are keyed by shape + index edges (not by price values): the lifetime
# contract is "one frame, one value", exactly like the old ``attrs`` cache, so
# an in-place price edit on the same frame keeps the memoized ATR. ``envelope_line``
# additionally fingerprints the boundary column it reads, so a price edit there
# forces a refit rather than a stale line.

_FRAME_CACHE_MAX = 32
_ENVELOPE_ENTRY_MAX = 512
_MEAN_ENTRY_MAX = 512


class _FrameEntry:
    __slots__ = ("ref", "token", "atr", "envelope", "means")

    def __init__(self, token: tuple) -> None:
        self.ref = None
        self.token = token
        self.atr: dict[int, float] = {}
        self.envelope: dict[tuple, dict | None] = {}
        self.means: dict[tuple[int, int], float] = {}


_FRAME_CACHE: "OrderedDict[int, _FrameEntry]" = OrderedDict()


# ``normalize_ohlcv`` produces a defensive copy, so every call allocates a
# fresh frame. That is correct for callers (they mutate the result), but it
# means repeated normalization of the *same* source — the scan path normalizes
# once for detection and again for trendlines; live API reads normalize again
# — pays the full validation/copy cost each time and throws away the frame
# memo. This store caches the normalized template by source-frame identity,
# keyed by a cheap fingerprint so an in-place edit (or a recycled ``id``)
# misses rather than serving stale data. Hits still return a fresh defensive
# copy; only the template is hidden, never handed to a caller.
_NORM_CACHE_MAX = 32


class _NormEntry:
    __slots__ = ("ref", "fingerprint", "template")

    def __init__(self, fingerprint: tuple, template: pd.DataFrame) -> None:
        self.ref = None
        self.fingerprint = fingerprint
        self.template = template


_NORM_CACHE: "OrderedDict[int, _NormEntry]" = OrderedDict()


def _norm_fingerprint(df: pd.DataFrame) -> tuple | None:
    """Fingerprint of everything the normalization fast path reads.

    Returns ``None`` for frames that cannot be hashed as a float block (the
    full coercion path is left uncached). ``hash(bytes)`` is O(columns*rows)
    in C, far cheaper than the pandas Series construction it replaces.
    """
    try:
        columns = tuple(str(c) for c in df.columns)
        values = df.to_numpy(dtype=float, copy=False)
        if values.dtype != np.float64:
            return None
        index = df.index
        raw = getattr(index, "asi8", None)
        index_sig = hash(raw.tobytes()) if raw is not None else hash(tuple(index))
        return (columns, len(df), index_sig, hash(values.tobytes()))
    except Exception:
        return None


def _norm_dropper(key: int, entry: _NormEntry):
    def _drop(_ref) -> None:
        if _NORM_CACHE.get(key) is entry:
            _NORM_CACHE.pop(key, None)

    return _drop


def _norm_lookup(df: pd.DataFrame, fingerprint: tuple) -> _NormEntry | None:
    try:
        key = id(df)
    except Exception:
        return None
    entry = _NORM_CACHE.get(key)
    if (
        entry is not None
        and entry.ref is not None
        and entry.ref() is df
        and entry.fingerprint == fingerprint
    ):
        return entry
    return None


def _norm_store(df: pd.DataFrame, fingerprint: tuple, template: pd.DataFrame) -> None:
    try:
        key = id(df)
    except Exception:
        return
    entry = _NormEntry(fingerprint, template)
    try:
        entry.ref = weakref.ref(df, _norm_dropper(key, entry))
    except TypeError:
        return
    _NORM_CACHE[key] = entry
    if len(_NORM_CACHE) > _NORM_CACHE_MAX:
        try:
            _NORM_CACHE.popitem(last=False)
        except KeyError:
            pass


def _frame_token(df: pd.DataFrame) -> tuple | None:
    """Shape + index-edge fingerprint used to reject a recycled ``id``.

    ``DatetimeIndex.asi8`` exposes the raw int64 values without building a
    ``Timestamp`` per edge (~8x cheaper than ``index[0]``), which matters
    because this runs on every memoized call.
    """
    try:
        n = len(df)
        if n == 0:
            return (0, None, None)
        index = df.index
        raw = getattr(index, "asi8", None)
        if raw is not None:
            return (n, raw[0], raw[-1])
        return (n, index[0], index[-1])
    except Exception:
        return None


def _make_dropper(key: int, entry: _FrameEntry):
    def _drop(_ref) -> None:
        # Only remove our own entry: a later frame may already own ``key``.
        if _FRAME_CACHE.get(key) is entry:
            _FRAME_CACHE.pop(key, None)

    return _drop


def _frame_entry(df: pd.DataFrame) -> _FrameEntry | None:
    """Return this frame's memo entry, creating it on first use.

    The store is shared across detector threads: every operation is a single
    dict/OrderedDict call, and a lost race only causes a recompute — never a
    wrong hit (the weakref identity check and token still gate reuse).
    """
    try:
        key = id(df)
    except Exception:
        return None
    token = _frame_token(df)
    if token is None:
        return None
    entry = _FRAME_CACHE.get(key)
    if (
        entry is not None
        and entry.ref is not None
        and entry.ref() is df
        and token == entry.token
    ):
        return entry
    entry = _FrameEntry(token)
    try:
        entry.ref = weakref.ref(df, _make_dropper(key, entry))
    except TypeError:
        return None
    _FRAME_CACHE[key] = entry
    if len(_FRAME_CACHE) > _FRAME_CACHE_MAX:
        try:
            _FRAME_CACHE.popitem(last=False)
        except KeyError:  # another thread emptied it first
            pass
    return entry




def _normalized_copy(df: pd.DataFrame) -> pd.DataFrame | None:
    """Fast path: a defensive copy when ``df`` already meets the contract.

    Returns ``None`` whenever the full path would do any real work (case
    normalisation, dtype coercion, dedupe/sort, NaN handling, missing volume),
    so the caller falls back with identical results. Extra columns (e.g. the
    ``oi`` column on cached frames) are allowed and dropped, matching the
    full path's ``out[OHLCV_COLUMNS]`` projection; they are never read here.
    """
    try:
        columns = list(df.columns)
        if len(columns) != len(set(columns)) or not set(OHLCV_COLUMNS) <= set(columns):
            return None
        for col in OHLCV_COLUMNS:
            if df[col].dtype != np.float64:
                return None
        index = df.index
        if not (index.is_unique and index.is_monotonic_increasing):
            return None
        close = df["close"].to_numpy(dtype=float, copy=False)
        volume = df["volume"].to_numpy(dtype=float, copy=False)
        if not np.isfinite(close).all() or not np.isfinite(volume).all():
            return None
        out = df.copy()
        if columns[: len(OHLCV_COLUMNS)] == OHLCV_COLUMNS:
            # Cached frames append extras (``oi``) after OHLCV: deleting them
            # from the copy is far cheaper than a ``df[OHLCV]`` re-selection.
            for col in columns[len(OHLCV_COLUMNS) :]:
                del out[col]
        else:
            out = out[OHLCV_COLUMNS]
        # Backward compatibility: callers may still inspect ``attrs``.
        out.attrs.pop("_atr_cache", None)
        return out
    except Exception:
        return None


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

    fingerprint = _norm_fingerprint(df)
    cached = _norm_lookup(df, fingerprint) if fingerprint is not None else None
    if cached is not None:
        return cached.template.copy()

    fast = _normalized_copy(df)
    if fast is not None:
        if fingerprint is not None:
            _norm_store(df, fingerprint, fast)
        return fast.copy()

    out = df.copy()
    out.columns = [str(c).lower() for c in out.columns]
    # Drop a legacy memoized ATR (see ``atr_value``): the copy inherits the
    # input's ``attrs``, but filtering/sorting below can change the rows, so a
    # cached value from the source frame must never be reused here.
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




def pivot_indices(
    values,
    left: int = 2,
    right: int = 2,
    kind: str = "high",
    nan_tolerant: bool = False,
) -> list[int]:
    """Fractal positions where ``values[i]`` beats its ``[i-left, i+right]`` window.

    ``nan_tolerant=False`` uses the strict-window rule: a NaN window fails the
    extremum comparison. ``nan_tolerant=True`` mirrors
    ``trendlines._swing_pivots``: such a window is accepted outright and the
    strict-neighbour test still decides.
    """
    arr = np.asarray(values, dtype=float)
    n = len(arr)
    if n < left + right + 1:
        return []
    win = sliding_window_view(arr, left + right + 1)
    centre = arr[left : n - right]
    prev = arr[left - 1 : n - right - 1]
    next_ = arr[left + 1 : n - right + 1]
    if nan_tolerant:
        has_nan = np.any(np.isnan(win), axis=1)
        if kind == "high":
            cond1 = has_nan | (centre >= np.max(win, axis=1))
            cond2 = (centre > prev) | (centre > next_)
        else:
            cond1 = has_nan | (centre <= np.min(win, axis=1))
            cond2 = (centre < prev) | (centre < next_)
    elif kind == "high":
        cond1 = centre >= np.max(win, axis=1)
        cond2 = (centre > prev) | (centre > next_)
    else:
        cond1 = centre <= np.min(win, axis=1)
        cond2 = (centre < prev) | (centre < next_)
    return (np.flatnonzero(cond1 & cond2) + left).tolist()


def _pivot_indices(values: np.ndarray, left: int, right: int, kind: str) -> list[int]:
    # Legacy scalar behaviour treated a NaN window as non-rejecting, which is
    # the NaN-tolerant mode; keep it for find_swing_highs/lows callers.
    return pivot_indices(values, left, right, kind, nan_tolerant=True)


def find_swing_highs(high: pd.Series, left: int = 2, right: int = 2) -> list[int]:
    return _pivot_indices(np.asarray(high, dtype=float), left, right, "high")


def find_swing_lows(low: pd.Series, left: int = 2, right: int = 2) -> list[int]:
    return _pivot_indices(np.asarray(low, dtype=float), left, right, "low")


def swing_points(
    df: pd.DataFrame, left: int = 2, right: int = 2
) -> list[tuple[int, str, float]]:
    highs = find_swing_highs(df["high"], left, right)
    lows = find_swing_lows(df["low"], left, right)
    pts = [(i, "H", float(df["high"].iloc[i])) for i in highs]
    pts += [(i, "L", float(df["low"].iloc[i])) for i in lows]
    pts.sort(key=lambda p: p[0])
    return pts


def pivot_frame(df: pd.DataFrame, left: int = 2, right: int = 2) -> pd.DataFrame:
    hi = pd.Series(np.nan, index=df.index, dtype=float)
    lo = pd.Series(np.nan, index=df.index, dtype=float)
    for i in find_swing_highs(df["high"], left, right):
        hi.iloc[i] = float(df["high"].iloc[i])
    for i in find_swing_lows(df["low"], left, right):
        lo.iloc[i] = float(df["low"].iloc[i])
    return pd.DataFrame({"high_pivot": hi, "low_pivot": lo}, index=df.index)




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
    # Closed-form OLS: avoids np.polyfit's SVD (`lstsq`) on every window.
    x_mean = float(xs.mean())
    y_mean = float(ys.mean())
    dx = xs - x_mean
    denom = float((dx * dx).sum())
    if denom <= 0:
        return 0.0, y_mean, 1.0
    slope = float((dx * (ys - y_mean)).sum() / denom)
    intercept = y_mean - slope * x_mean
    y_hat = slope * xs + intercept
    ss_res = float(((ys - y_hat) ** 2).sum())
    ss_tot = float(((ys - y_mean) ** 2).sum())
    r2 = 1.0 if ss_tot <= 0 else min(1.0, max(0.0, 1.0 - ss_res / ss_tot))
    return slope, intercept, r2


def fit_pivot_line(
    pivots: Sequence[tuple[int, float]]
) -> tuple[float, float, float] | None:
    if len(pivots) < 2:
        return None
    xs = [p for p, _ in pivots]
    ys = [q for _, q in pivots]
    return linreg_fit(xs, ys)


def line_value(slope: float, intercept: float, x: float) -> float:
    return float(slope) * float(x) + float(intercept)


def sample_line(
    slope: float, intercept: float, x0: int, x1: int
) -> list[dict]:
    return [
        {"t": x0, "price": line_value(slope, intercept, x0)},
        {"t": x1, "price": line_value(slope, intercept, x1)},
    ]


def relative_slope(slope: float, span: int, mean_price: float) -> float:
    if mean_price <= 0 or span <= 0:
        return 0.0
    return float(slope) * float(span) / float(mean_price)


def is_horizontal(slope: float, span: int, mean_price: float, tol: float = 0.03) -> bool:
    return abs(relative_slope(slope, span, mean_price)) <= tol




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
    ys = np.asarray(y, dtype=float)
    fs = np.asarray(fitted, dtype=float)
    ss_tot = float(((ys - ys.mean()) ** 2).sum())
    if ss_tot <= 0:
        return 1.0
    ss_res = float(((ys - fs) ** 2).sum())
    return float(min(1.0, max(0.0, 1.0 - ss_res / ss_tot)))


def quadratic_fit(y: Sequence[float]) -> tuple[np.ndarray, np.ndarray, float, float]:
    xs = np.arange(len(y), dtype=float)
    fitted, coeffs = polyfit_values(y, degree=2, x=xs)
    r2 = r2_of(y, fitted)
    if len(coeffs) >= 3 and abs(float(coeffs[0])) > 1e-12:
        vertex = -float(coeffs[1]) / (2.0 * float(coeffs[0]))
    else:
        vertex = len(y) / 2.0
    return fitted, coeffs, r2, vertex


def curvature_sign(coeffs: Sequence[float]) -> int:
    """Sign of the leading coefficient for a degree>=2 fit (+1 cup, -1 dome)."""
    if len(coeffs) < 3:
        return 0
    lead = float(coeffs[0])
    if abs(lead) < 1e-12:
        return 0
    return 1 if lead > 0 else -1




def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    from trading.indicators import atr_first_bar

    if df is None or len(df) == 0:
        return pd.Series(dtype=float)
    return atr_first_bar(df["high"], df["low"], df["close"], period, full=True)


def atr_value(df: pd.DataFrame, period: int = 14) -> float:
    """Last ATR value, with a sane fallback for very short frames.

    Memoized per frame in the frame-scoped store (see ``_frame_entry``): one
    ``detect_patterns`` call runs ~19 detectors over the same normalised frame
    and each asks for the ATR, so the ~1ms EMA is computed once per frame
    instead of ~28 times. The entry dies with the frame, so distinct
    symbols/frames never share values.
    """
    if df is None or df.empty:
        return 0.0
    entry = _frame_entry(df)
    if entry is not None and period in entry.atr:
        return entry.atr[period]
    series = atr(df, period)
    val = float(series.iloc[-1]) if not series.empty else 0.0
    if not np.isfinite(val) or val <= 0:
        rng = (df["high"] - df["low"]).astype(float)
        val = float(rng.tail(min(len(rng), period)).mean())
    if not np.isfinite(val) or val < 0:
        val = 0.0
    if entry is not None:
        entry.atr[period] = val
    return val


def is_volume_confirmed(
    df: pd.DataFrame, idx: int, mult: float = 1.2, lookback: int = 20
) -> bool:
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
    if df is None or df.empty:
        return 0.0, 0.0, start, end
    start = max(0, int(start))
    end = min(len(df) - 1, int(end))
    seg_high = df["high"].iloc[start : end + 1].astype(float)
    seg_low = df["low"].iloc[start : end + 1].astype(float)
    hi_pos = int(seg_high.values.argmax()) + start
    lo_pos = int(seg_low.values.argmin()) + start
    return float(seg_high.iloc[hi_pos - start]), float(seg_low.iloc[lo_pos - start]), hi_pos, lo_pos


def window_mean(df: pd.DataFrame, start: int, end: int) -> float:
    """Mean close over the inclusive bar window, memoized per frame.

    Detectors normalise slopes by the same window mean many times per pass
    (channels, wedges, H&S candidates); the numpy slice avoids a pandas
    ``iloc``/``astype`` chain on every call.
    """
    key = (int(start), int(end))
    entry = _frame_entry(df)
    if entry is not None:
        cached = entry.means.get(key)
        if cached is not None:
            return cached
    values = df["close"].to_numpy(dtype=float, copy=False)[start : end + 1]
    value = float(values.mean())
    if not np.isfinite(value) and bool(np.isnan(values).any()):
        value = float(np.nanmean(values))
    if entry is not None:
        if len(entry.means) >= _MEAN_ENTRY_MAX:
            entry.means.clear()
        entry.means[key] = value
    return value


def _boundary_values(df: pd.DataFrame, side: str) -> np.ndarray:
    """Current boundary column as a float64 array, without building a Series.

    ``df[col].to_numpy()`` allocates a Series on every call (~16us) even when
    nothing changed. The positional read returns the same block data in ~2us;
    it still reads current values, so in-place edits and column reassignment are
    both visible to the caller's byte hash.
    """
    col = "high" if side == "upper" else "low"
    try:
        values = df.values[:, df.columns.get_loc(col)]
        if values.ndim == 1 and values.dtype == np.float64:
            return values
    except Exception:
        pass
    return df[col].to_numpy(dtype=float, copy=False)


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
    # Vectorised over pivot pairs. Every pair (i, j) scores (violations, -span)
    # over bars in its own span [x0, x1]; cells outside the span never count, so
    # each pair is scored only over the bars its line is actually drawn across.
    # Violations for all pairs are counted in one np.bincount pass; the winner is
    # the first pair (pair order = triu_indices) with the minimal (viol, -span)
    # key under strict ``<`` improvement -- identical to the reference scalar
    # loop. ``worst`` (max pierce depth) is reported for the winning pair only and
    # is recomputed once after selection, so it can never influence which pair
    # wins.
    boundary = _boundary_values(df, side)
    n = len(boundary)
    # Frame-scoped memo: detectors ask for the same boundary repeatedly within
    # one pass. The key includes the boundary's byte hash so an in-place price
    # edit can never return a stale line, and the store is keyed by frame
    # identity (weakref-verified), so symbols never share entries.
    entry = _frame_entry(df)
    memo_key = None
    if entry is not None:
        try:
            # ``P`` is already a list of (position, price) 2-tuples. A shallow
            # tuple avoids ~40 int/float conversions per call; numpy scalars
            # hash equal to their native counterparts, so this key is
            # interchangeable with the old converted form.
            pivot_key = tuple(P)
            hash(pivot_key)
            memo_key = (
                side,
                pivot_key,
                float(tol),
                hash(boundary.tobytes()),
            )
        except (TypeError, ValueError):
            memo_key = None
        if memo_key is not None and memo_key in entry.envelope:
            cached = entry.envelope[memo_key]
            return dict(cached) if cached is not None else None
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
    counts = span.astype(np.int64) + 1
    num_pairs = len(X0)
    viol = np.zeros(num_pairs, dtype=np.int64)
    # Cell budget per block keeps peak memory bounded; blocks run in pair order
    # so the global first-wins tie-break is unchanged.
    blk_pairs = max(1, 1_000_000 // max(n, 1))
    for p0 in range(0, num_pairs, blk_pairs):
        p1 = min(p0 + blk_pairs, num_pairs)
        sl = slice(p0, p1)
        b_counts = counts[sl]
        b_total = int(b_counts.sum())
        Pidx = np.repeat(np.arange(p0, p1), b_counts)
        cell_idx = np.arange(b_total)
        starts = np.cumsum(b_counts) - b_counts
        X0p = X0[Pidx]
        K = (X0p + (cell_idx - np.repeat(starts, b_counts))).astype(np.int64)
        Kf = K.astype(np.float64)
        y = Q0[Pidx] + slopes[Pidx] * (Kf - X0p)
        if side == "upper":
            d = boundary[K] - y
        else:
            d = y - boundary[K]
        over = d > tol
        # Pidx holds GLOBAL pair indices (np.arange(p0, p1)), so bincount would
        # size the result to the global max index instead of this block - offset
        # by p0 to get exactly p1-p0 counts that fit the viol[sl] slice.
        viol[sl] = np.bincount(Pidx - p0, weights=over, minlength=p1 - p0).astype(np.int64)
    # Winner: fewest violations, then longest span, then first pair in
    # ``triu_indices`` order. lexsort's last key is primary; the pair index is
    # the final tie-break, so this is the same strict-``<`` scan as before.
    best = int(np.lexsort((np.arange(num_pairs), -span, viol))[0])
    # Winner's cells are contiguous ([start, start+count)), so its worst pierce
    # depth is one small vectorised reduction instead of per-row work.
    x0b = int(X0[best])
    x1b = int(X1[best])
    Kb = np.arange(x0b, x1b + 1, dtype=np.int64)
    Kbf = Kb.astype(np.float64)
    yb = float(Q0[best]) + float(slopes[best]) * (Kbf - X0[best])
    if side == "upper":
        db = boundary[Kb] - yb
    else:
        db = yb - boundary[Kb]
    overb = db > tol
    worst = float(db[overb].max()) if bool(overb.any()) else 0.0
    slope = float(slopes[best])
    result = {
        "slope": slope,
        "intercept": float(Q0[best]) - slope * x0b,
        "x0": x0b,
        "q0": float(Q0[best]),
        "x1": x1b,
        "q1": float(Q1[best]),
        "viol": int(viol[best]),
        "worst": worst,
    }
    if entry is not None and memo_key is not None:
        if len(entry.envelope) >= _ENVELOPE_ENTRY_MAX:
            entry.envelope.clear()
        # Store a private copy: the caller owns the returned dict and may edit it.
        entry.envelope[memo_key] = dict(result)
    return result


def count_touches(
    pivots: Iterable[tuple[int, float]],
    slope: float,
    intercept: float,
    atr_val: float,
    tol_atr: float = 0.75,
) -> int:
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
    if n <= 0:
        return []
    return list(pivots[-n:])


def between(
    pivots: Sequence[tuple[int, float]], lo: int, hi: int
) -> list[tuple[int, float]]:
    return [(p, q) for p, q in pivots if lo <= p <= hi]
