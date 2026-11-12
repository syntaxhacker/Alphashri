"""Pure probability / feature helpers for the position-probability skill.

No network access in this module: every function takes plain pandas/numpy
inputs so the maths is unit-testable without Upstox, yfinance or the local API.
"""

from __future__ import annotations

from typing import Iterable, Sequence

import numpy as np
import pandas as pd

# --------------------------------------------------------------------------
# features
# --------------------------------------------------------------------------


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """Wilder RSI. `close` must be a float Series indexed by session date."""
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / period).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / period).mean()
    return 100 - 100 / (1 + up / dn)


def build_features(df: pd.DataFrame, rsi_period: int = 14) -> pd.DataFrame:
    """Feature frame for one instrument from an OHLCV frame (index = session date).

    Columns: close, volume, rsi, ret5/10/20/60/120, dma20/50/100/200,
    d20/d50/d100/d200 (distance to each DMA), slope200 (20-session % change of
    the 200-DMA), volr (volume / 60-session median volume), sig60/sig252
    (annualised realised vol), pos52 (position in the 52-week range).
    """
    c = df["close"].astype(float)
    o = pd.DataFrame(index=c.index)
    o["close"] = c
    o["volume"] = df["volume"].astype(float)
    o["rsi"] = rsi(c, rsi_period)
    for w in (5, 10, 20, 60, 120):
        o[f"ret{w}"] = c.pct_change(w)
    for w in (20, 50, 100, 200):
        o[f"dma{w}"] = c.rolling(w).mean()
        o[f"d{w}"] = c / o[f"dma{w}"] - 1
    o["slope200"] = o["dma200"].pct_change(20)
    o["volr"] = o["volume"] / o["volume"].rolling(60).median()
    o["ret1"] = c.pct_change()
    o["sig60"] = o["ret1"].rolling(60).std() * np.sqrt(252)
    o["sig252"] = o["ret1"].rolling(252).std() * np.sqrt(252)
    hi, lo = c.rolling(252).max(), c.rolling(252).min()
    o["pos52"] = (c - lo) / (hi - lo)
    return o


def describe_state(f: pd.DataFrame) -> dict:
    """Snapshot of the latest row: momentum, trend state, vol, volume."""
    last = f.iloc[-1]
    trend = "UPTREND" if last["d200"] > 0 else "DOWNTREND"
    slope = "rising" if last["slope200"] > 0 else "falling"
    return {
        "close": float(last["close"]),
        "rsi": float(last["rsi"]),
        "ret5": float(last["ret5"]),
        "ret10": float(last["ret10"]),
        "ret20": float(last["ret20"]),
        "ret60": float(last["ret60"]),
        "ret120": float(last["ret120"]),
        "d20": float(last["d20"]),
        "d50": float(last["d50"]),
        "d100": float(last["d100"]),
        "d200": float(last["d200"]),
        "dma20": float(last["dma20"]),
        "dma50": float(last["dma50"]),
        "dma100": float(last["dma100"]),
        "dma200": float(last["dma200"]),
        "slope200": float(last["slope200"]),
        "volr": float(last["volr"]),
        "sig60": float(last["sig60"]),
        "sig252": float(last["sig252"]),
        "pos52": float(last["pos52"]),
        "trend": trend,
        "slope": slope,
        "counter_trend": bool(last["d200"] < 0),
    }


# --------------------------------------------------------------------------
# cycle structure
# --------------------------------------------------------------------------


def zigzag(series: pd.Series, threshold_pct: float) -> list[tuple[int, float, str]]:
    """Alternating high/low pivots. Threshold is the % swing that flips the leg.

    direction starts at 1 (tracking a high) so the first pivot can be a low.
    """
    thr = threshold_pct / 100.0
    pivots: list[tuple[int, float, str]] = []
    direction = 1
    last_i, last_v = 0, float(series.iloc[0])
    for i in range(1, len(series)):
        v = float(series.iloc[i])
        if direction == 1:
            if v > last_v:
                last_i, last_v = i, v
            elif v <= last_v * (1 - thr):
                pivots.append((last_i, last_v, "H"))
                direction = -1
                last_i, last_v = i, v
        else:
            if v < last_v:
                last_i, last_v = i, v
            elif v >= last_v * (1 + thr):
                pivots.append((last_i, last_v, "L"))
                direction = 1
                last_i, last_v = i, v
    pivots.append((last_i, last_v, "H" if direction == 1 else "L"))
    return pivots


def swing_legs(pivots: Sequence[tuple[int, float, str]], series: pd.Series) -> list[dict]:
    """Consecutive pivot pairs as RALLY/DROP legs with magnitude and duration."""
    legs = []
    for (i0, v0, _), (i1, v1, t1) in zip(pivots, pivots[1:]):
        legs.append({
            "type": "RALLY" if t1 == "H" else "DROP",
            "start": series.index[i0],
            "end": series.index[i1],
            "from": v0,
            "to": v1,
            "pct": (v1 / v0 - 1) * 100,
            "days": (series.index[i1] - series.index[i0]).days,
            "sessions": i1 - i0,
        })
    return legs


def drawdown_episodes(series: pd.Series, threshold: float, merge_sessions: int = 60) -> list[dict]:
    """Deepest trough of every drawdown that reached `threshold` (e.g. 0.30).

    A single long slide produces one trough per 30% leg, so nearby troughs are
    merged and the deepest one kept — otherwise one drawdown is counted twice.
    """
    peak = series.cummax()
    dd = series / peak - 1
    out: list[dict] = []
    trough_i: int | None = None
    for i in range(len(series)):
        if dd.iloc[i] <= -threshold:
            if trough_i is None or dd.iloc[i] < dd.iloc[trough_i]:
                trough_i = i
        elif trough_i is not None:
            out.append({"date": series.index[trough_i], "price": float(series.iloc[trough_i]),
                        "dd": float(dd.iloc[trough_i])})
            trough_i = None
    if trough_i is not None:
        out.append({"date": series.index[trough_i], "price": float(series.iloc[trough_i]),
                    "dd": float(dd.iloc[trough_i])})

    merged: list[dict] = []
    for ep in out:
        if merged:
            gap = series.index.get_loc(ep["date"]) - series.index.get_loc(merged[-1]["date"])
            if gap <= merge_sessions:
                if ep["dd"] < merged[-1]["dd"]:
                    merged[-1] = ep
                continue
        merged.append(ep)
    return merged


def forward_returns(series: pd.Series, horizon: int) -> pd.Series:
    """Return over the next `horizon` sessions, indexed by the entry session."""
    return (series.shift(-horizon) / series - 1).dropna()


def non_overlapping_episodes(mask: pd.Series, min_gap: int) -> list:
    """Indices where `mask` is true, keeping episodes `min_gap` sessions apart.

    Overlapping windows double-count a single rally; the episode list is the
    statistically honest sample, the pooled-day count is the optimistic one.
    """
    idx: list = []
    i = 0
    dates = list(mask.index)
    while i < len(dates):
        if bool(mask.iloc[i]):
            idx.append(dates[i])
            i += min_gap
        else:
            i += 1
    return idx


def rsi_peak_decay(base: pd.DataFrame, bins=(0, 1, 3, 6, 10, 21)) -> list[dict]:
    """Forward-return stats bucketed by sessions elapsed since a 21-session RSI peak.

    `base` must carry columns: rsi, fwd (forward return), and optionally d200/slope.
    The centred rolling peak needs one future session, so the newest row is
    excluded by construction.
    """
    peak = base["rsi"].rolling(21, center=True).max()
    since = (peak - base["rsi"])
    rows = []
    for lo, hi in zip(bins[:-1], bins[1:]):
        m = (since >= lo) & (since < hi)
        v = base.loc[m, "fwd"]
        if len(v) < 20:
            continue
        rows.append({"bin": f"{lo}-{hi}d", "n": len(v), "median": float(v.median()),
                     "p_up": float((v > 0).mean()), "p_up10": float((v > 0.10).mean()),
                     "p_dn5": float((v < -0.05).mean())})
    return rows


# --------------------------------------------------------------------------
# conditional (momentum / trend) sampling
# --------------------------------------------------------------------------


def matched_analog(base: pd.DataFrame, rules: dict) -> pd.Series:
    """Forward returns of every session matching the current feature state.

    `rules` maps a feature column to (low, high) inclusive bounds; `None`
    values are ignored. Example:
        {"d200": (None, 0), "rsi": (50, 65), "ret10": (0, 0.08)}
    """
    m = pd.Series(True, index=base.index)
    for col, (lo, hi) in rules.items():
        if lo is not None:
            m &= base[col] >= lo
        if hi is not None:
            m &= base[col] <= hi
    return base.loc[m, "fwd"]


# --------------------------------------------------------------------------
# simulation
# --------------------------------------------------------------------------


def mc_bootstrap(returns: Iterable[float], spot: float, horizon: int, n: int,
                 rng: np.random.Generator) -> np.ndarray:
    """Resample historical daily returns with replacement -> terminal prices."""
    arr = np.asarray(list(returns), dtype=float)
    paths = rng.choice(arr, size=(n, horizon), replace=True)
    return spot * np.cumprod(1 + paths, axis=1)[:, -1]


def mc_lognormal(spot: float, horizon: int, ann_vol: float, drift_total: float,
                 n: int, rng: np.random.Generator) -> np.ndarray:
    """Log-normal terminal prices. `drift_total` is the expected total return."""
    dt = 1 / 252
    mu_d = drift_total / horizon
    z = rng.standard_normal((n, horizon))
    steps = (mu_d - 0.5 * ann_vol ** 2) * dt + ann_vol * np.sqrt(dt) * z
    return spot * np.exp(np.cumsum(steps, axis=1))[:, -1]


def mc_market_implied(spot: float, horizon: int, betas: Sequence[float],
                      mkt_sigs: Sequence[float], resid_ann_vol: float,
                      hist_corr: np.ndarray | None = None, n: int = 300_000,
                      rng: np.random.Generator | None = None) -> np.ndarray:
    """Terminal prices from index option-implied moves plus idiosyncratic noise.

    `mkt_sigs` are the per-index 1-sigma moves over the horizon taken from the
    option chain (ATM straddle / 0.7979 / spot), `betas` the regression
    betas of the stock on those indices, `resid_ann_vol` the annualised
    residual volatility left after the index betas.
    """
    rng = rng or np.random.default_rng(0)
    k = len(betas)
    z = rng.standard_normal((n, k))
    if hist_corr is not None and k > 1:
        chol = np.linalg.cholesky(np.asarray(hist_corr, dtype=float) + 1e-12 * np.eye(k))
        z = z @ chol.T
    idx_ret = z * np.asarray(mkt_sigs, dtype=float)
    resid = rng.standard_normal(n) * resid_ann_vol * np.sqrt(horizon / 252)
    total = idx_ret @ np.asarray(betas, dtype=float) + resid
    return spot * np.exp(total)


# --------------------------------------------------------------------------
# reporting helpers
# --------------------------------------------------------------------------


def bucket_table(terminal: np.ndarray, buckets: Sequence[tuple[float, float, str]]) -> list[dict]:
    """Probability mass per price bucket."""
    rows = []
    for lo, hi, label in buckets:
        rows.append({"bucket": label, "p": float(np.mean((terminal > lo) & (terminal <= hi)))})
    return rows


def key_levels(terminal: np.ndarray, levels: Sequence[float], spot: float) -> list[dict]:
    """P(close beyond level) for each level (above/below spot)."""
    rows = []
    for lv in levels:
        p = float(np.mean(terminal > lv)) if lv > spot else float(np.mean(terminal < lv))
        rows.append({"level": lv, "side": "above" if lv > spot else "below", "p": p})
    return rows


def summarise(terminal: np.ndarray) -> dict:
    return {
        "median": float(np.median(terminal)),
        "p10": float(np.percentile(terminal, 10)),
        "p25": float(np.percentile(terminal, 25)),
        "p75": float(np.percentile(terminal, 75)),
        "p90": float(np.percentile(terminal, 90)),
        "mean": float(terminal.mean()),
        "sd": float(terminal.std()),
    }
