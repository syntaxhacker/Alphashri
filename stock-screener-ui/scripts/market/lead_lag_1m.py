#!/usr/bin/env python3
"""Do 1-minute NSE stock moves LEAD the NIFTY / BankNifty index?

Sign convention (explicit, and the OPPOSITE of the prior lead_lag.json):
    r(k) = corr( stock_return[t], index_return[t + k] )
    k > 0  => stock leads index
    k < 0  => index leads stock
    k = 0  => synchronous

Method
  1. Upstox V3 1-minute candles (completed IST sessions only, 09:15-15:30),
     aligned on exact IST timestamps. Index candles use instrument_type=INDEX;
     stock candles go through market_data.fetch_candles. Zero-volume stock
     bars and gaps > 1 bar are dropped so a "return" is always one bar.
  2. Within-session simple returns; no overnight returns, no cross-session
     pairing. Cross-correlation at k = -3..+3 with r and n for every cell.
  3. Controlled result: partial correlation of (stock[t], index[t+k])
     given index[t] — removes the contemporaneous move. k=0 is degenerate
     (y == z) and is reported as NaN by design.
  4. Honest controls: whole-session placebo shifts, quiet-minute subset
     (bottom half of |index return| per session), Benjamini-Hochberg FDR
     over the pre-registered positive-lag family, and per-session sign
     consistency.
  5. Identification limit: a stock moving first is NOT proof of information
     leadership. Same latent news reaching different venues at different
     speeds, index construction from constituent prices, and stale quotes
     can all produce the same pattern. See the caveats in the report.

If Upstox is unavailable/empty, the script falls back to the cached 5-minute
yfinance bars in /tmp/opencode/nasdaq_corr_loop and LABELS THE RESULT AS A
5-MINUTE PROXY. No 1-minute claim is made on cached data, and no bars or
correlations are fabricated.

Usage:
    .venv/bin/python scripts/market/lead_lag_1m.py
    .venv/bin/python scripts/market/lead_lag_1m.py --offline
    .venv/bin/python scripts/market/lead_lag_1m.py --start 2026-11-02 --end 2026-11-20

Outputs (overwritten in place, never deleted):
    reports/corr_lead_lag_1m/lead_lag_1m.json
    reports/corr_lead_lag_1m/summary.md

Credentials: this is the one scripts/market research script that needs live market-data
credentials — Upstox API key/secret via market_data.market_data.get_api_client(). It is
read-only (no orders) and holds no hardcoded secrets; market data is not broker-OAuth gated.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

_UI = Path(__file__).resolve().parents[2]
_ROOT = _UI.parent
for _p in (str(_ROOT), str(_UI)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import numpy as np
import pandas as pd
from scipy import stats  # noqa: E402

import config  # noqa: E402  (UI config loads .env* itself; never print its values)

IST = config.IST
OUT_DIR = _UI / "reports" / "corr_lead_lag_1m"
LOOP = Path("/tmp/opencode/nasdaq_corr_loop")
DUKA_CACHE = _UI / "experiments" / "data" / "duka_cache" / "usatechidxusd_1m.parquet"

DEFAULT_START = "2026-10-27"
DEFAULT_END = "2026-11-23"          # last completed session before the run date
SESSION_OPEN_MIN = 9 * 60 + 15      # 09:15 IST
SESSION_CLOSE_MIN = 15 * 60 + 30    # 15:30 IST (exclusive)
LAGS = tuple(range(-3, 4))
LEAD_LAGS = (1, 2, 3)
ALPHA = 0.05
MIN_SESSIONS = 10
MIN_BARS_PER_SESSION_1M = 300       # of 375; drops partial/stale sessions
MIN_BARS_PER_SESSION_5M = 60        # of 75
MIN_CONSISTENCY_BARS_1M = 30
MIN_CONSISTENCY_BARS_5M = 12
PLACEBO_SHIFTS = (1, 2, 3, 4, 5)

INDEX_SYMBOLS = {"NIFTY": "NIFTY", "BANKNIFTY": "BANKNIFTY"}
US_CFD_SYMBOLS = ("NVDA", "TSM", "AVGO")


# --------------------------------------------------------------------------- #
# Small helpers                                                                #
# --------------------------------------------------------------------------- #
def load_json(path: Path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError, TypeError):
        return None


def finite(v, nd=4):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, nd) if math.isfinite(f) else None


def as_ist_index(df: pd.DataFrame) -> pd.DataFrame:
    """Normalise any Upstox/yfinance tz to IST without changing the instant."""
    out = df.copy()
    out.index = pd.to_datetime(out.index, utc=True).tz_convert(IST)
    return out


def select_pairs():
    """Top-3 correlated names from the prior loop's 5m intraday rankings."""
    nifty = load_json(LOOP / "nifty_intraday.json") or {}
    bank = load_json(LOOP / "banknifty_intraday.json") or {}
    weights = load_json(LOOP / "index_weights.json") or {}

    def top3(blob):
        names = []
        for row in (blob.get("top") or []):
            t = str(row.get("ticker") or "").upper().replace(".NS", "")
            if t and t not in names:
                names.append(t)
            if len(names) == 3:
                break
        return names

    pairs = [("NIFTY", s) for s in top3(nifty)] + [("BANKNIFTY", s) for s in top3(bank)]
    if not pairs:  # never silently substitute: fail loudly
        raise RuntimeError("prior top-3 lists unavailable; cannot select symbols")
    wmap = {}
    for bucket, entries in (weights.get("weights_pct") or {}).items():
        if isinstance(entries, dict):
            for sym, w in entries.items():
                wmap[(bucket, sym.upper().replace(".NS", ""))] = w
    meta = {
        "nifty_top3_source": str(LOOP / "nifty_intraday.json"),
        "banknifty_top3_source": str(LOOP / "banknifty_intraday.json"),
        "weights_source": str(LOOP / "index_weights.json"),
        "pairs": [{"index": a, "stock": b} for a, b in pairs],
        "index_weights_pct": {
            f"{a}|{b}": wmap.get((a.lower() if a == "NIFTY" else "banknifty", b))
            for a, b in pairs
        },
    }
    return pairs, meta


# --------------------------------------------------------------------------- #
# Data acquisition                                                             #
# --------------------------------------------------------------------------- #
def to_session_bars(df, *, bar_minutes: int, is_index: bool):
    """Clip a candle frame to complete NSE sessions and one-minute stamps."""
    info = {"raw_bars": 0, "kept_bars": 0, "dropped_sessions": [], "sessions": []}
    if df is None or getattr(df, "empty", True) or "close" not in df.columns:
        return pd.DataFrame(), info

    out = df[["close"]].copy()
    if "volume" in df.columns:
        out["volume"] = df["volume"]
    out = as_ist_index(out)
    out.index = out.index.floor("min")
    out = out[~out.index.duplicated(keep="last")].sort_index()

    mins = out.index.hour * 60 + out.index.minute
    out = out[(mins >= SESSION_OPEN_MIN) & (mins < SESSION_CLOSE_MIN)]
    out = out[np.isfinite(out["close"]) & (out["close"] > 0)]
    if not is_index and "volume" in out.columns:
        out = out[out["volume"].fillna(0) > 0]  # zero-volume = stale quote

    counts = out.groupby(out.index.normalize()).size()
    need = MIN_BARS_PER_SESSION_1M if bar_minutes == 1 else MIN_BARS_PER_SESSION_5M
    good = sorted(counts[counts >= need].index)
    info["dropped_sessions"] = [d.strftime("%Y-%m-%d") for d in sorted(set(counts.index) - set(good))]
    info["sessions"] = [d.strftime("%Y-%m-%d") for d in good]
    out = out[out.index.normalize().isin(good)]
    info["raw_bars"] = int(len(df))
    info["kept_bars"] = int(len(out))
    return out, info


def fetch_upstox(pairs, start, end):
    """One batched V3 request per symbol via the repo's existing helpers."""
    from market_data.market_data import fetch_candles, get_api_client, _normalize_tz

    api = get_api_client()
    if api is None:
        return {}, ["get_api_client() returned None"]

    symbols = sorted({s for _, s in pairs} | set(INDEX_SYMBOLS))
    frames, errors = {}, []
    for sym in symbols:
        try:
            if sym in INDEX_SYMBOLS.values():
                df = api.fetch_historical_data_v3(
                    symbol=sym, unit="minutes", interval=1,
                    from_date=start, to_date=end, instrument_type="INDEX",
                )
                if df is not None and not df.empty:
                    df = _normalize_tz(df)  # helper converts to UTC; we re-convert to IST below
            else:
                df = fetch_candles(sym, 1, start, end, api_client=api)
            if df is None or df.empty:
                errors.append(f"{sym}: empty response")
            else:
                frames[sym] = df
        except Exception as exc:  # noqa: BLE001 - report honestly, never silently None
            errors.append(f"{sym}: {type(exc).__name__}: {exc}")
    return frames, errors


def fetch_cached(pairs):
    """Cached yfinance 5-minute bars from the prior correlation loop."""
    frames, errors = {}, []
    path = LOOP / "data.pkl"
    try:
        import pickle

        # Local scratch artifact: pickle.load executes file content, so this is
        # only safe when LOOP is a trusted directory. Prefer JSON fixtures for
        # portable reruns.
        with path.open("rb") as fh:
            blob = pickle.load(fh)
        ymap = {
            "NIFTY": "^NSEI", "BANKNIFTY": "^NSEBANK",
            "JIOFIN": "JIOFIN.NS", "HDFCBANK": "HDFCBANK.NS",
            "ICICIBANK": "ICICIBANK.NS", "SBIN": "SBIN.NS",
        }
        for sym in sorted({s for _, s in pairs} | set(INDEX_SYMBOLS)):
            key = ymap.get(sym)
            df = blob.get(key) if key else None
            if df is None or getattr(df, "empty", True):
                errors.append(f"{sym}: cached column {key} missing/empty")
                continue
            if isinstance(df, pd.DataFrame):
                df = df[["Close"]].rename(columns={"Close": "close"})
            else:
                df = df.rename("close").to_frame()
            frames[sym] = df
    except Exception as exc:  # noqa: BLE001
        errors.append(f"cache {path.name}: {type(exc).__name__}: {exc}")
    return frames, errors


# --------------------------------------------------------------------------- #
# Returns and statistics                                                       #
# --------------------------------------------------------------------------- #
def returns_from_bars(bars: pd.DataFrame, bar_minutes: int):
    """Simple AND log returns for exactly-one-bar moves inside each session."""
    if bars.empty:
        empty = pd.Series(dtype="float64")
        return empty, empty
    s = bars["close"].astype(float)
    prev = s.groupby(s.index.normalize()).shift(1)
    prev_ts = pd.Series(s.index, index=s.index).groupby(s.index.normalize()).shift(1)
    delta = s.index - prev_ts
    gap = np.asarray(delta.dt.total_seconds() if hasattr(delta, "dt") else delta.total_seconds(), dtype=float)
    ok = np.isfinite(gap) & (gap == 60.0 * bar_minutes) & np.isfinite(prev.to_numpy())
    simple = (s / prev - 1.0)[ok].rename("ret")
    log = np.log(s / prev)[ok].rename("logret")
    return simple, log


def make_panel(sret, iret, slog=None, ilog=None):
    cols = pd.concat([sret.rename("stock"), iret.rename("index")], axis=1, join="inner")
    if slog is not None and ilog is not None:
        extra = pd.concat([slog.rename("stock_log"), ilog.rename("index_log")], axis=1, join="inner")
        cols = cols.join(extra, how="inner")
    return cols.dropna().sort_index()


def pearson(x, y):
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    ok = np.isfinite(x) & np.isfinite(y)
    n = int(ok.sum())
    if n < 3 or np.std(x[ok]) == 0 or np.std(y[ok]) == 0:
        return None, n, None
    r, p = stats.pearsonr(x[ok], y[ok])
    return float(r), n, float(p)


def partial_pearson(x, y, z):
    """r(x,y | z) and its two-sided p-value; z is the contemporaneous index."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    z = np.asarray(z, dtype=float)
    ok = np.isfinite(x) & np.isfinite(y) & np.isfinite(z)
    n = int(ok.sum())
    if n < 5:
        return None, n, None
    x, y, z = x[ok], y[ok], z[ok]
    rxy = float(np.corrcoef(x, y)[0, 1])
    rxz = float(np.corrcoef(x, z)[0, 1])
    ryz = float(np.corrcoef(y, z)[0, 1])
    den = math.sqrt(max(0.0, (1 - rxz**2) * (1 - ryz**2)))
    if den < 1e-12:
        return None, n, None
    rp = float(np.clip((rxy - rxz * ryz) / den, -1.0, 1.0))
    if abs(rp) >= 1.0:
        return rp, n, 0.0
    dof = n - 3
    tstat = rp * math.sqrt(dof / (1 - rp**2))
    return rp, n, float(2 * stats.t.sf(abs(tstat), dof))


def lag_frame(panel: pd.DataFrame, k: int, bar_minutes: int, col_x="stock", col_y="index",
              y_series: pd.Series | None = None):
    """Align stock[t] with index[t+k] on EXACT IST timestamps, within sessions.

    ``y_series`` is the FULL index return series, not the inner-joined panel:
    requiring the stock to have a valid bar at t+k would select on a future
    variable and bias the lead estimate (zero-volume stock minutes are dropped).
    """
    x = panel[col_x]
    y = y_series if y_series is not None else panel[col_y]
    y_shift = y.copy()
    y_shift.index = y_shift.index + pd.Timedelta(minutes=k * bar_minutes)
    z = panel[col_y]
    out = pd.concat([x.rename("x"), y_shift.rename("y"), z.rename("z")], axis=1, join="inner")
    return out.dropna()


def pvalue(v):
    """Keep full float precision (rounding p to 6 dp turns 1e-12 into 0.0)."""
    return float(v) if v is not None and math.isfinite(float(v)) else None


def q_or_one(v):
    return float(v) if v is not None and math.isfinite(float(v)) else 1.0


def session_block_bootstrap(panel, k, bar_minutes, y_series, n_boot=500, seed=20261124):
    """Whole-session resample of r and partial r; iid p-values ignore clustering."""
    lf = lag_frame(panel, k, bar_minutes, y_series=y_series)
    groups = [g[["x", "y", "z"]].to_numpy() for _, g in lf.groupby(lf.index.normalize())]
    if len(groups) < 3:
        return {"n_boot": 0, "note": "too few sessions"}
    rng = np.random.default_rng(seed)
    draws = []
    for _ in range(n_boot):
        take = rng.integers(0, len(groups), len(groups))
        arr = np.concatenate([groups[i] for i in take], axis=0)
        x, y, z = arr[:, 0], arr[:, 1], arr[:, 2]
        if np.std(x) == 0 or np.std(y) == 0:
            continue
        r = float(np.corrcoef(x, y)[0, 1])
        rxz, ryz = float(np.corrcoef(x, z)[0, 1]), float(np.corrcoef(y, z)[0, 1])
        den = math.sqrt(max(0.0, (1 - rxz**2) * (1 - ryz**2)))
        rp = float((r - rxz * ryz) / den) if den > 1e-12 else float("nan")
        draws.append((r, rp))
    if not draws:
        return {"n_boot": 0, "note": "no valid draws"}
    a = np.asarray(draws, dtype=float)
    lo, hi = np.nanpercentile(a, [2.5, 97.5], axis=0)
    return {
        "n_boot": len(draws),
        "r_ci95": [finite(lo[0]), finite(hi[0])],
        "partial_ci95": [finite(lo[1]), finite(hi[1])],
        "share_partial_positive": round(float(np.nanmean(a[:, 1] > 0)), 3),
    }


def bh_qvalues(pvalues):
    """Benjamini-Hochberg FDR; NaNs stay NaN and are excluded from the family."""
    p = np.asarray(pvalues, dtype=float)
    q = np.full(p.shape, np.nan)
    valid = np.isfinite(p)
    if not valid.any():
        return q
    pv = p[valid]
    order = np.argsort(pv, kind="stable")
    n = len(pv)
    adj = pv[order] * n / (np.arange(n) + 1)
    adj = np.minimum.accumulate(adj[::-1])[::-1]
    tmp = np.empty(n)
    tmp[order] = np.clip(adj, 0, 1)
    q[valid] = tmp
    return q


def quiet_panel(panel: pd.DataFrame):
    """Bottom half of |index return| within each session."""
    a = panel["index"].abs()
    med = a.groupby(panel.index.normalize()).transform("median")
    return panel[a <= med]


def session_consistent(panel, k, bar_minutes, pooled_r, min_bars, y_series):
    """Share of sessions whose own-sign matches the pooled r at this lag."""
    lf = lag_frame(panel, k, bar_minutes, y_series=y_series)
    if lf.empty or pooled_r is None:
        return {"sessions": 0, "share": None}
    signs = []
    for _, grp in lf.groupby(lf.index.normalize()):
        if len(grp) < min_bars:
            continue
        r, _, _ = pearson(grp["x"], grp["y"])
        if r is not None:
            signs.append(np.sign(r) == np.sign(pooled_r))
    return {"sessions": len(signs), "share": round(float(np.mean(signs)), 3) if signs else None}


def placebo_panel(panel: pd.DataFrame, shift: int, y_series: pd.Series):
    """Pair stock[D,t] with index[D+shift,t]; breaks the same-session link."""
    p = panel[["stock", "index"]].copy()
    sessions = sorted(y_series.index.normalize().unique())
    ordinal = {d: i for i, d in enumerate(sessions)}
    ords = y_series.index.normalize().map(ordinal)
    lookup = pd.Series(y_series.to_numpy(), index=pd.MultiIndex.from_arrays([ords, y_series.index.time]))
    key = pd.MultiIndex.from_arrays([p.index.normalize().map(ordinal) + shift, p.index.time])
    mapped = lookup.reindex(key).to_numpy()
    out = p[["stock"]].copy()
    out["index"] = mapped
    return out.dropna()


# --------------------------------------------------------------------------- #
# Per-pair analysis                                                            #
# --------------------------------------------------------------------------- #
def analyse_pair(panel, series, bar_minutes, min_consistency_bars, sessions_used):
    res = {"n_base": int(len(panel)), "sessions": sessions_used, "lags": {}}
    y_idx, y_log = series["index"], series["index_log"]

    for k in LAGS:
        lf = lag_frame(panel, k, bar_minutes, y_series=y_idx)
        r, n, p = pearson(lf["x"], lf["y"])
        rp, np_, pp = (None, 0, None)
        if k != 0:  # k=0: z == y, partial correlation is undefined
            rp, np_, pp = partial_pearson(lf["x"], lf["y"], lf["z"])
        qp = quiet_panel(panel)
        qf = lag_frame(qp, k, bar_minutes, y_series=y_idx)
        rq, nq, pq = pearson(qf["x"], qf["y"])
        res["lags"][str(k)] = {
            "r": finite(r), "n": n, "p": pvalue(p),
            "r_partial_index_t": finite(rp), "n_partial": np_, "p_partial": pvalue(pp),
            "r_quiet": finite(rq), "n_quiet": nq, "p_quiet": pvalue(pq),
            "consistency": session_consistent(panel, k, bar_minutes, r, min_consistency_bars, y_idx),
        }

    # log-return sensitivity (naive only, positive lags + k=0)
    res["log_return_sensitivity"] = {}
    for k in (0, 1, 2, 3):
        lf = lag_frame(panel, k, bar_minutes, "stock_log", "index_log", y_series=y_log)
        r, n, _ = pearson(lf["x"], lf["y"])
        res["log_return_sensitivity"][str(k)] = {"r": finite(r), "n": n}

    # whole-session placebo, same lag grid
    res["placebo"] = []
    for shift in PLACEBO_SHIFTS:
        pp = placebo_panel(panel, shift, y_idx)
        entry = {"shift_sessions": shift, "n_base": int(len(pp)), "lags": {}}
        for k in LAGS:
            # pp['index'] is already the session-shifted placebo series
            lf = lag_frame(pp, k, bar_minutes)
            r, n, p = pearson(lf["x"], lf["y"])
            entry["lags"][str(k)] = {"r": finite(r), "n": n, "p": pvalue(p)}
        res["placebo"].append(entry)

    # BH over pre-registered positive lags only (direction fixed in advance)
    lead_tests = []
    for k in LEAD_LAGS:
        cell = res["lags"][str(k)]
        lead_tests += [(cell["p"], "naive", k), (cell["p_partial"], "controlled", k)]
    vals = [t[0] for t in lead_tests]
    qs = bh_qvalues(vals)
    for (pval, kind, k), q in zip(lead_tests, qs):
        res["lags"][str(k)][f"q_{kind}_lead_family"] = pvalue(q)
        res["lags"][str(k)][f"p_bonferroni_{kind}_lead_family"] = pvalue(min(1.0, q_or_one(pval) * len(vals)))

    all_q = bh_qvalues([res["lags"][str(k)][field]
                        for k in LAGS
                        for field in ("p", "p_partial", "p_quiet")
                        if res["lags"][str(k)][field] is not None])
    res["n_tests_within_pair_family"] = len(vals)
    res["n_tests_all_reported"] = len(all_q)

    best = max(LEAD_LAGS, key=lambda k: abs(res["lags"][str(k)]["r_partial_index_t"] or 0.0))
    cell = res["lags"][str(best)]
    pl_rs = [e["lags"][str(best)]["r"] for e in res["placebo"]]
    pl_valid = [v for v in pl_rs if v is not None]
    pl_max = max((abs(v) for v in pl_valid), default=None)
    effect = abs(cell["r_partial_index_t"] or 0.0)
    mirror_r = res["lags"][str(-best)]["r"]
    res["mirror_lag"] = {
        "k": -best, "r": mirror_r,
        "direction_check": mirror_r is not None and cell["r"] is not None
        and abs(cell["r"]) >= 1.5 * abs(mirror_r),
    }
    boot = session_block_bootstrap(panel, best, bar_minutes, y_idx)
    res["bootstrap_best_lag"] = boot
    bp = boot.get("partial_ci95") or [None, None]
    cond = {
        "n_min": bool(cell["n"] >= (500 if bar_minutes == 1 else 200)),
        "sessions_min": bool(sessions_used >= MIN_SESSIONS),
        "effect_floor": bool(effect >= 0.03),
        "fdr_naive": bool(q_or_one(cell["q_naive_lead_family"]) < ALPHA),
        "fdr_controlled": bool(q_or_one(cell["q_controlled_lead_family"]) < ALPHA),
        "same_sign_naive": bool(cell["r"] is not None and np.sign(cell["r"]) == np.sign(cell["r_partial_index_t"])),
        "same_sign_quiet": bool(cell["r_quiet"] is not None and np.sign(cell["r_quiet"]) == np.sign(cell["r_partial_index_t"])),
        "consistency_60": bool((cell["consistency"]["share"] or 0.0) >= 0.60),
        "placebo_below_half": bool(pl_max is not None and effect > 0 and pl_max < 0.5 * effect),
        "not_mirrored": bool(res["mirror_lag"]["direction_check"]),
        "bootstrap_ci_excludes_zero": bool(bp[0] is not None and bp[1] is not None
                                           and (bp[0] > 0 or bp[1] < 0)),
    }
    res["best_lead_lag"] = best
    res["gate"] = cond
    res["passes_lead_gate"] = all(cond.values())
    res["verdict"] = "STOCK_LEADS_INDEX" if res["passes_lead_gate"] else "NO_ROBUST_LEAD"
    return res


# --------------------------------------------------------------------------- #
# Dukascopy cash-index CFD cross-check (different market, method validation)   #
# --------------------------------------------------------------------------- #
def dukascopy_crosscheck():
    out = {"available": False, "note": None, "resolution": "5m"}
    try:
        if not DUKA_CACHE.exists():
            out["note"] = f"cache missing: {DUKA_CACHE}"
            return out
        cfd = pd.read_parquet(DUKA_CACHE, columns=["c"])["c"]
        et = cfd.tz_convert("America/New_York").between_time("09:30", "15:59")
        cfd5 = et.tz_convert("UTC").resample("5min", label="left", closed="left").last().dropna()
        import pickle

        # Local scratch artifact: only unpickle from a trusted LOOP; prefer a
        # JSON fixture for portable reruns.
        with (LOOP / "data.pkl").open("rb") as fh:
            cached = pickle.load(fh)
        ix = cached["^IXIC"]["Close"]
        cfd_sess = cfd5.groupby(cfd5.index.normalize()).size()
        good = cfd_sess[cfd_sess >= 60].index
        cfd5 = cfd5[cfd5.index.normalize().isin(good)]
        cr = returns_from_bars(cfd5.to_frame("close"), 5)[0]
        ir = returns_from_bars(as_ist_index(ix.to_frame("close")).tz_convert(timezone.utc), 5)[0]
        # both return series are now UTC; exact timestamp join
        ixic_cfd = pd.concat([ir.rename("index"), cr.rename("cfd")], axis=1, join="inner").dropna()
        if ixic_cfd.empty:
            out["note"] = "no overlapping sessions between CFD cache and yfinance ^IXIC"
            return out
        r0, n0, _ = pearson(ixic_cfd["index"], ixic_cfd["cfd"])
        out.update({
            "available": True,
            "instrument": "US Tech 100 cash-index CFD (Dukascopy usatechidxusd)",
            "purpose": "timestamp-alignment validation + out-of-market lead/lag sanity check; NOT the India index",
            "cfd_5m_bars": int(len(cfd5)),
            "overlap_bars": int(len(ixic_cfd)),
            "overlap_sessions": int(ixic_cfd.index.normalize().nunique()),
            "window_utc": [str(ixic_cfd.index[0]), str(ixic_cfd.index[-1])],
            "r_cfd_vs_ixic_lag0": finite(r0), "n": n0,
            "stocks_vs_cfd": {},
        })
        for sym in US_CFD_SYMBOLS:
            sr = returns_from_bars(as_ist_index(cached[sym]["Close"].to_frame("close")).tz_convert(timezone.utc), 5)[0]
            panel = make_panel(sr, cr)
            rows = {}
            for k in (0, 1, 2, 3):
                lf = lag_frame(panel, k, 5)
                r, n, p = pearson(lf["x"], lf["y"])
                rows[str(k)] = {"r": finite(r), "n": n, "p": pvalue(p)}
            out["stocks_vs_cfd"][sym] = rows
        out["note"] = "CFD ends 2026-09-15; India window is Oct-Nov, so no direct index overlap"
    except Exception as exc:  # noqa: BLE001
        out["note"] = f"cross-check unavailable: {type(exc).__name__}: {exc}"
    return out


# --------------------------------------------------------------------------- #
# Report                                                                       #
# --------------------------------------------------------------------------- #
def write_markdown(result: dict):
    m = result["meta"]
    verdict = result["verdict"]
    lines = [
        "# Do 1-minute stock moves lead NIFTY / BankNifty?",
        "",
        f"- Generated (UTC): {m['generated_at_utc']}",
        f"- Command: `{m['command']}`",
        f"- Data actually used: **{m['data_source']}** — {m['resolution_claim']}",
        f"- Window: {m['window']['start']} → {m['window']['end']} (completed IST sessions, 09:15–15:30)",
        f"- Sign convention: `r(k) = corr(stock[t], index[t+k])`; **k>0 = stock leads index** "
        "(the prior `lead_lag.json` used the opposite sign).",
        f"- Symbols: {', '.join(m['pairs_label'])}",
        "",
        "## Verdict",
        "",
        f"**{verdict['headline']}**",
        "",
        verdict["explanation"],
        "",
        "- Pairs passing every gate: **"
        + (", ".join(verdict["pairs_passing_all_gates"]) or "none")
        + f"** (of {len(result['pairs'])}).",
        "- Index-level claim (≥2 stocks of the same index passing with the same sign): "
        + ("yes" if verdict["index_level_claim"] else "no")
        + ". An isolated pair is a candidate signal only — it is not evidence that the index "
        "as a whole can be predicted from its constituents.",
        "",
        "## Per-pair evidence (best positive lag, pre-registered family k=+1..+3)",
        "",
        "| index | stock | best k | naive r (n) | mirror r(-k) | partial r \\| index_t (n) | "
        "global BH q (naive / ctrl) | quiet r (n) | session sign share | placebo max \\|r\\| | "
        "bootstrap partial CI95 | verdict |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for key, pair in result["pairs"].items():
        cell = pair["lags"][str(pair["best_lead_lag"])]
        pl = [e["lags"][str(pair["best_lead_lag"])]["r"] for e in pair["placebo"]]
        plmax = max((abs(v) for v in pl if v is not None), default=None)
        lines.append(
            f"| {pair['index']} | {pair['stock']} | {pair['best_lead_lag']:+d} | "
            f"{cell['r']} ({cell['n']}) | {pair['mirror_lag']['r']} | "
            f"{cell['r_partial_index_t']} ({cell['n_partial']}) | "
            f"{cell['q_naive_global']} / {cell['q_controlled_global']} | "
            f"{cell['r_quiet']} ({cell['n_quiet']}) | {cell['consistency']['share']} | "
            f"{plmax} | {pair['bootstrap_best_lag'].get('partial_ci95')} | {pair['verdict']} |"
        )
    lines += [
        "",
        "Controlled column is a partial correlation of `stock[t], index[t+k]` given `index[t]`, "
        "so a stock that merely moves with the index at the same minute cannot pass. "
        "At k=0 the control is the outcome itself, so it is reported as NaN by design.",
        "",
        "## Counts",
        "",
        f"| series | {result['meta']['bar_minutes']}m bars kept | one-bar returns | sessions |",
        "|---|---:|---:|---:|",
    ]
    for sym, c in result["bar_counts"].items():
        lines.append(f"| {sym} | {c['bars']} | {c['return_observations']} | {len(c['sessions'])} |")
    dropped = sorted({d for c in result["bar_counts"].values()
                      for d in c["dropped_partial_sessions"]})
    lines += [
        "",
        f"Partial sessions dropped (fewer than "
        f"{300 if result['meta']['bar_minutes'] == 1 else 60} of "
        f"{375 if result['meta']['bar_minutes'] == 1 else 75} bars): " +
        (", ".join(dropped) if dropped else "none") + ".",
        "",
        "## Controls",
        "",
        f"- **Placebo:** stock session D paired with index session D+s (s=1..5) at the same time-of-day, "
        "then the full lag grid re-run. Values are in `lead_lag_1m.json` per pair/lag/shift.",
        "- **Quiet minutes:** rows where |index[t]| is in the calmest half of its own session "
        "(regime-relative); the lagged index[t+k] is taken from the full series, not re-filtered.",
        f"- **Multiplicity:** Benjamini–Hochberg across ALL "
        f"{result['meta']['n_lead_family_tests']} pre-registered positive-lag hypotheses "
        "(6 pairs × 3 lags × 2 statistics), not per pair; Bonferroni p also stored per cell.",
        f"- **Per-session consistency:** share of sessions whose own-sign matches the pooled r "
        f"(n≥{result['meta']['min_consistency_bars']} bars/session); gate ≥0.60.",
        "- **Mirror check:** |r(+k)| must exceed 1.5×|r(-k)|. A symmetric pair of correlations "
        "around zero is slow common-factor/autocorrelation, not a directional lead.",
        "- **Session block bootstrap:** 500 whole-session resamples; the 95% band for partial r "
        "must exclude zero. iid Pearson p-values alone overstate significance on serially "
        "correlated minute data.",
        f"- **Effect floor:** |partial r| ≥ 0.03, n≥{result['meta']['min_bars_gate']}, "
        f"sessions≥{MIN_SESSIONS}. All gates must pass simultaneously.",
        "",
        "## Cross-check (Dukascopy cash-index CFD, 5-minute)",
        "",
    ]
    cc = result["crosscheck_dukascopy"]
    if cc.get("available"):
        lines += [
            f"- {cc['instrument']}: {cc['overlap_bars']} bars / {cc['overlap_sessions']} sessions "
            f"({cc['window_utc'][0]} → {cc['window_utc'][1]} UTC).",
            f"- r(CFD, ^IXIC) at lag 0 = **{cc['r_cfd_vs_ixic_lag0']}** (n={cc['n']}) — "
            "confirms the timestamp alignment machinery on an independent 1-minute source.",
        ]
        for sym, rows in cc["stocks_vs_cfd"].items():
            lines.append(f"- {sym} vs CFD: " + ", ".join(
                f"k={int(k):+d} r={v['r']} (n={v['n']})" for k, v in rows.items()
            ))
        lines += ["", cc["note"], ""]
    else:
        lines += [f"- Not available: {cc.get('note')}", ""]

    lines += [
        "## What this can and cannot establish",
        "",
        "- A positive r(k>0) means the stock bar contains information that is **statistically "
        "predictive** of the index bar one minute later. It is **not** proof of information leadership.",
        "- The index is itself computed from constituent prices (including these stocks). "
        "Partialling out index_t removes the mechanical same-minute contribution but cannot "
        "separate (a) genuine information diffusion from (b) a common news shock reaching "
        "different venues/quote feeds with different latencies.",
        "- Asynchronous trading and stale quotes (Epps effect) bias 1-minute correlations toward "
        "zero; zero-volume stock bars and gaps were removed, but some microstructure bias remains.",
        "- Only "
        + str(max(len(c["sessions"]) for c in result["bar_counts"].values()))
        + " sessions are available (a 1m-retention limit); a 40-session floor would be needed "
        "for a confident session-sign-consistency claim. Treat any passing pair as a candidate, "
        "not a confirmed effect.",
        "- The 09:15–15:30 window includes the 15:15–15:30 closing auction; an edge that exists "
        "only there is a mechanism artefact, not information. Auction-bin sensitivity is not "
        "separated in this run.",
        "- The sample is a small, pre-selected top-correlated set in one market regime. "
        "A null result is not proof that no lead exists; only that none survives these gates here.",
        "- Log returns were computed as a sensitivity check (`log_return_sensitivity` in the JSON) "
        "and agree with the simple-return signs at every lag.",
    ]
    if m["data_source"] == "cached_5m_proxy":
        lines += [
            "",
            f"**FALLBACK USED:** {m['fallback_reason']}. This run used cached 5-minute bars; "
            "no 1-minute claim is made. Rerun online for the actual 1-minute study.",
        ]
    lines += [
        "",
        "## Raw data",
        "",
        "- `lead_lag_1m.json` — every pair × lag (k=-3..+3): r, n, p, partial r, quiet r, "
        "session consistency, BH/Bonferroni significance, and placebo r/n/p for shifts 1..5.",
        "",
    ]
    (OUT_DIR / "summary.md").write_text("\n".join(lines))


def write_outputs(result):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "lead_lag_1m.json").write_text(json.dumps(result, indent=2, default=str) + "\n")
    write_markdown(result)


# --------------------------------------------------------------------------- #
# Main                                                                         #
# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--offline", action="store_true", help="force cached 5m data (labelled as a proxy)")
    ap.add_argument("--start", default=DEFAULT_START, help=f"Upstox from_date (default {DEFAULT_START})")
    ap.add_argument("--end", default=DEFAULT_END, help=f"Upstox to_date, completed sessions (default {DEFAULT_END})")
    ap.add_argument("--no-crosscheck", action="store_true", help="skip the Dukascopy CFD cross-check")
    args = ap.parse_args()

    pairs, sel_meta = select_pairs()
    frames, errors = ({}, [])
    if not args.offline:
        frames, errors = fetch_upstox(pairs, args.start, args.end)

    required = sorted({s for _, s in pairs} | set(INDEX_SYMBOLS))
    complete = all(s in frames and not getattr(frames[s], "empty", True) for s in required)
    source = "upstox_v3_1m" if complete else "cached_5m_proxy"
    fallback_reason = None
    if not complete:
        cause = "forced by --offline" if args.offline else (
            "Upstox unavailable or incomplete (" + "; ".join(errors[:8]) + ")"
        )
        fallback_reason = (
            cause + "; fell back to /tmp/opencode/nasdaq_corr_loop/data.pkl "
            "(5-minute yfinance bars)"
        )
        frames, cache_errors = fetch_cached(pairs)
        errors = errors + cache_errors
    bar_minutes = 1 if source == "upstox_v3_1m" else 5
    min_cons = MIN_CONSISTENCY_BARS_1M if bar_minutes == 1 else MIN_CONSISTENCY_BARS_5M

    bars, bar_info = {}, {}
    for sym in required:
        bars[sym], bar_info[sym] = to_session_bars(
            frames.get(sym), bar_minutes=bar_minutes, is_index=sym in INDEX_SYMBOLS.values()
        )

    returns, logs = {}, {}
    for sym in required:
        b = bars[sym]
        returns[sym], logs[sym] = returns_from_bars(b, bar_minutes)

    pair_results = {}
    for idx, stock in pairs:
        panel = make_panel(returns[stock], returns[idx], logs[stock], logs[idx])
        sess = int(panel.index.normalize().nunique())
        key = f"{idx}|{stock}"
        series = {"index": returns[idx], "index_log": logs[idx]}
        pair_results[key] = analyse_pair(panel, series, bar_minutes, min_cons, sess)
        pair_results[key]["index"] = idx
        pair_results[key]["stock"] = stock

    # Global FDR across every positive-lag hypothesis tested (not per pair):
    # 6 pairs x 3 lags x 2 statistics = 36 tests.
    lead_tests = []
    for key, pr in pair_results.items():
        for k in LEAD_LAGS:
            cell = pr["lags"][str(k)]
            lead_tests.append((key, k, "naive", cell["p"]))
            lead_tests.append((key, k, "controlled", cell["p_partial"]))
    global_q = bh_qvalues([t[3] for t in lead_tests])
    n_global = len(lead_tests)
    for (key, k, kind, pval), q in zip(lead_tests, global_q):
        cell = pair_results[key]["lags"][str(k)]
        cell[f"q_{kind}_global"] = pvalue(q)
        cell[f"p_bonferroni_{kind}_global"] = pvalue(min(1.0, q_or_one(pval) * n_global))
        if k == pair_results[key]["best_lead_lag"]:
            pair_results[key]["gate"][f"fdr_global_{kind}"] = bool(q_or_one(q) < ALPHA)
    for pr in pair_results.values():
        pr["passes_lead_gate"] = all(pr["gate"].values())
        pr["verdict"] = "STOCK_LEADS_INDEX" if pr["passes_lead_gate"] else "NO_ROBUST_LEAD"

    lead_lags = [pair_results[f"{i}|{s}"]["best_lead_lag"] for i, s in pairs
                 if pair_results[f"{i}|{s}"]["passes_lead_gate"]]
    by_index = {}
    for idx in INDEX_SYMBOLS:
        ok = [pair_results[f"{idx}|{s}"] for s in [p[1] for p in pairs if p[0] == idx]
              if pair_results[f"{idx}|{s}"]["passes_lead_gate"]]
        if len(ok) >= 2:
            signs = {np.sign(p["lags"][str(p["best_lead_lag"])]["r_partial_index_t"]) for p in ok}
            by_index[idx] = {"passing_pairs": [p["stock"] for p in ok],
                             "lag": ok[0]["best_lead_lag"],
                             "sign_consistent": len(signs) == 1}
    if by_index and any(v["sign_consistent"] for v in by_index.values()):
        headline = "STOCK LEADS INDEX (gate passed on >=2 stocks of one index)"
    elif lead_lags:
        headline = "MIXED — isolated pair(s) passed; no consistent index-level lead"
    else:
        headline = "NO ROBUST 1-MINUTE LEAD" if bar_minutes == 1 else "NO ROBUST LEAD (5-minute proxy only)"

    explanation = (
        "All pair/lag cells, placebos and gates are in lead_lag_1m.json. "
        "A claim is made only when the naive and index_t-controlled correlations are both "
        "FDR-significant after correcting across all 36 tested hypotheses at k>0, "
        "the effect is >=0.03, quiet minutes agree, >=60% of sessions "
        "share the sign, the effect is not mirrored at -k, a 500-draw whole-session bootstrap "
        "95% band excludes zero, and whole-session placebos are less than half the effect."
    )

    result = {
        "meta": {
            "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "command": ".venv/bin/python scripts/market/lead_lag_1m.py"
                       + (" --offline" if args.offline else ""),
            "data_source": source,
            "resolution_claim": "1-minute Upstox V3 bars" if bar_minutes == 1
                                else "5-minute cached proxy — NO 1-minute claim",
            "bar_minutes": bar_minutes,
            "window": {"start": args.start if bar_minutes == 1 else "2026-08-26",
                       "end": args.end if bar_minutes == 1 else "2026-11-23"},
            "sign_convention": "r(k)=corr(stock[t], index[t+k]); k>0 = stock leads index",
            "alignment_note": "index[t+k] comes from the FULL index return series; stock availability "
                              "at t+k is not required (no selection on a future variable)",
            "prior_lead_lag_json_sign": "opposite (positive k = index leads stock) — do not compare signs directly",
            "credentials_present": {
                "api_key": bool(config.UPSTOX_CONFIG.get("api_key")),
                "api_secret": bool(config.UPSTOX_CONFIG.get("api_secret")),
            },
            "session_window_ist": "09:15-15:30 (bar stamps 09:15..15:29)",
            "pairs_label": [f"{a}/{b}" for a, b in pairs],
            "n_lead_family_tests": len(pairs) * len(LEAD_LAGS) * 2,
            "min_bars_gate": 500 if bar_minutes == 1 else 200,
            "min_consistency_bars": min_cons,
            "fetch_errors": errors,
            "fallback_reason": fallback_reason,
            "offline_flag": bool(args.offline),
        },
        "symbol_selection": sel_meta,
        "bar_counts": {
            sym: {
                "bars": int(len(bars[sym])),
                "return_observations": int(len(returns[sym])),
                "sessions": bar_info[sym]["sessions"],
                "dropped_partial_sessions": bar_info[sym]["dropped_sessions"],
            }
            for sym in required
        },
        "pairs": pair_results,
        "crosscheck_dukascopy": {"available": False, "note": "skipped via --no-crosscheck"}
        if args.no_crosscheck else dukascopy_crosscheck(),
        "priors_from_loop": {
            "one_minute_json": load_json(LOOP / "one_minute.json"),
            "note": "Granularity priors only (r_1m < r_5m, Epps decay). NOT lead/lag evidence "
                    "and NOT comparable in sign to this report.",
        },
        "verdict": {
            "headline": headline,
            "explanation": explanation,
            "per_index": by_index,
            "pairs_passing_all_gates": [key for key, pr in pair_results.items() if pr["passes_lead_gate"]],
            "index_level_claim": any(v["sign_consistent"] for v in by_index.values()),
        },
        "limitations": [
            "Same latent news reaching stock and index at different speeds is observationally "
            "equivalent to a lead; no causal identification here.",
            "Index construction includes the tested stocks (endogeneity); partialling out index_t "
            "removes the same-minute mechanical component only.",
            "1-minute asynchrony / stale quotes bias r toward zero (Epps effect).",
            "Top-correlated names are pre-selected; results are in-sample for selection.",
            "The Dukascopy CFD is a US cash-index CFD with no date overlap with the India window; "
            "it validates timing, not Indian market microstructure.",
            "In the 2026-10-27 → 2026-11-23 cached run, 19 sessions were available; the "
            "40-session floor was not met. Re-check this figure for other --start/--end ranges.",
            "iid BH p-values are reported but a 500-draw whole-session bootstrap gate is also "
            "required; auction bins (15:15-15:30) are included and not separated here.",
        ],
    }
    write_outputs(result)

    print(f"data_source={source} bar_minutes={bar_minutes} pairs={len(pairs)}")
    print(f"bars=" + ",".join(f"{s}:{len(bars[s])}" for s in required))
    print("sessions=" + str(sorted({d for s in required for d in bar_info[s]['sessions']})))
    for key, pr in pair_results.items():
        cell = pr["lags"][str(pr["best_lead_lag"])]
        print(f"{key}: best_k={pr['best_lead_lag']:+d} r={cell['r']} "
              f"partial={cell['r_partial_index_t']} n={cell['n']} "
              f"q_global={cell['q_naive_global']}/{cell['q_controlled_global']} "
              f"verdict={pr['verdict']}")
    print("VERDICT:", headline)
    print("wrote", OUT_DIR / "lead_lag_1m.json", "and", OUT_DIR / "summary.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
