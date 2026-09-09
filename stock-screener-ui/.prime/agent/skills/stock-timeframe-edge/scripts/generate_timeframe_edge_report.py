#!/usr/bin/env python
"""
Timeframe-edge report for an NSE equity ticker.

Answers: which holding period (5m / 15m / 1h / 4h / overnight / 1d / 3d / 5d)
actually pays on this stock, and when (open vs midday vs close) should you enter?

Method:
  1. Session decomposition — attribute every day's move to overnight gap /
     opening session / midday / closing session; cumulative curves + waterfall.
  2. Monte-Carlo holding-period backtest — random-entry trades at every horizon,
     with bootstrap PF confidence intervals, SL/TP overlay, 200d-MA regime split,
     and NIFTY benchmark for the session split.

Usage (run from repo root, project venv):
    .venv/bin/python .prime/agent/skills/stock-timeframe-edge/scripts/generate_timeframe_edge_report.py --symbol NETWEB

Produces reports/<SYMBOL>_TIMEFRAME_EDGE/{<SYM>_timeframe_edge.html, .md, figures/*.png, *.csv}.
"""
import argparse
import base64
import os
import sys
from pathlib import Path

os.environ["MPLBACKEND"] = "Agg"

import matplotlib
matplotlib.use("Agg")  # must precede pyplot import

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO.parent))

IST = "Asia/Kolkata"
UP, DOWN, ACCENT, GOLD, GRAY, PURPLE = ("#1a7f37", "#c62828", "#1565c0", "#e65100", "#607d8b", "#6a1b9a")

MARKET_OPEN_MIN = 9 * 60 + 15          # 09:15 in minutes-from-midnight
MARKET_MINUTES = 375                    # 09:15 -> 15:30
SESSIONS = ("open", "midday", "close")  # open <75m, midday 75-284m, close >=285m
INTRADAY_HORIZONS = (("5m", 5), ("15m", 15), ("1h", 60), ("4h", 240))
DAILY_HORIZONS = (("overnight", 0), ("1d", 1), ("3d", 3), ("5d", 5))  # 0 = special overnight
STOP_LEVELS = (None, 0.01, 0.02, 0.03)


# ---------------------------------------------------------------- pure helpers
def profit_factor(rets) -> float:
    """sum(gains) / |sum(losses)|; inf if no losses, nan if no gains and no losses."""
    r = np.asarray(rets, dtype=float)
    r = r[np.isfinite(r)]
    if len(r) == 0:
        return float("nan")
    gains = r[r > 0].sum()
    losses = abs(r[r < 0].sum())
    if losses == 0:
        return float("inf") if gains > 0 else float("nan")
    return float(gains / losses)


def win_rate(rets) -> float:
    r = np.asarray(rets, dtype=float)
    r = r[np.isfinite(r)]
    return float((r > 0).mean()) * 100 if len(r) else float("nan")


def classify_entry_session(minute_of_day: int) -> str:
    """Classify an entry by minutes since midnight IST (market-hours only)."""
    m = minute_of_day - MARKET_OPEN_MIN
    if m < 0 or m >= MARKET_MINUTES:
        return "offhours"
    if m < 75:
        return "open"
    if m < 285:
        return "midday"
    return "close"


def anchored_resample(df: pd.DataFrame, block_minutes: int) -> pd.DataFrame:
    """Resample intraday bars to blocks anchored at 09:15 IST (pandas rules misalign for 240m).
    Drops anything outside market hours. Returns UTC tz-aware frame like the input."""
    ist = df.index.tz_convert(IST)
    mins = ist.hour * 60 + ist.minute
    mkt = (mins >= MARKET_OPEN_MIN) & (mins < MARKET_OPEN_MIN + MARKET_MINUTES)
    d = df.loc[mkt].copy()
    if d.empty:
        return d
    ist_d = d.index.tz_convert(IST)
    mins_d = ist_d.hour * 60 + ist_d.minute
    block_idx = (mins_d - MARKET_OPEN_MIN) // block_minutes
    key = pd.MultiIndex.from_arrays([ist_d.normalize(), block_idx], names=["day", "blk"])
    agg = d.groupby(key).agg(
        open=("open", "first"), high=("high", "max"), low=("low", "min"),
        close=("close", "last"), volume=("volume", "sum"),
    )
    # bar timestamp = day + MARKET_OPEN_MIN + blk*block_minutes (IST), back to UTC-aware
    ts_ist = [day + pd.Timedelta(minutes=MARKET_OPEN_MIN + int(b) * block_minutes) for day, b in agg.index]
    agg.index = pd.DatetimeIndex(ts_ist).tz_convert("UTC")
    agg.index.name = df.index.name
    return agg


def simulate_trades(bars: pd.DataFrame, n_bars: int, cost_rt: float = 0.0012,
                    stop: float | None = None, tp: float | None = None) -> tuple[np.ndarray, pd.DatetimeIndex]:
    """All long entries: buy next-bar... no — buy THIS bar's open, exit close of bar i+n_bars-1.
    Same-day completion enforced (cross-day holds are covered by daily horizons).
    stop/tp checked intrabar on high/low (SL priority when both hit in one bar;
    gap fills at the worse open). Returns (net returns array, entry timestamps)."""
    o = bars["open"].to_numpy(float)
    h = bars["high"].to_numpy(float)
    l = bars["low"].to_numpy(float)
    c = bars["close"].to_numpy(float)
    days = bars.index.tz_convert(IST).normalize().to_numpy()
    n = len(bars)
    rets, entries = [], []
    for i in range(n - n_bars + 1):
        j_end = i + n_bars - 1
        if not np.array_equal(days[i], days[j_end]):
            continue
        entry = o[i]
        exit_px = c[j_end]
        if stop is not None or tp is not None:
            slp = entry * (1 - stop) if stop is not None else -np.inf
            tpp = entry * (1 + tp) if tp is not None else np.inf
            hit = False
            for j in range(i, j_end + 1):
                if l[j] <= slp and h[j] >= tpp:
                    exit_px = min(slp, o[j])  # conservative: assume SL first
                    hit = True
                    break
                if l[j] <= slp:
                    exit_px = min(slp, o[j])  # gap through stop -> fill at open
                    hit = True
                    break
                if h[j] >= tpp:
                    exit_px = max(tpp, o[j])
                    hit = True
                    break
            if not hit:
                exit_px = c[j_end]
        rets.append(exit_px / entry - 1 - cost_rt)
        entries.append(bars.index[i])
    return np.asarray(rets, dtype=float), pd.DatetimeIndex(entries)


def simulate_daily_trades(daily: pd.DataFrame, h_days: int, cost_rt: float = 0.0012,
                          stop: float | None = None, tp: float | None = None) -> tuple[np.ndarray, pd.DatetimeIndex]:
    """Long at today's open, exit close of day (i+h_days-1). h_days>=1."""
    o = daily["open"].to_numpy(float)
    h = daily["high"].to_numpy(float)
    l = daily["low"].to_numpy(float)
    c = daily["close"].to_numpy(float)
    n = len(daily)
    rets, entries = [], []
    for i in range(n - h_days + 1):
        j_end = i + h_days - 1
        entry = o[i]
        exit_px = c[j_end]
        if stop is not None or tp is not None:
            slp = entry * (1 - stop) if stop is not None else -np.inf
            tpp = entry * (1 + tp) if tp is not None else np.inf
            hit = False
            for j in range(i, j_end + 1):
                if l[j] <= slp and h[j] >= tpp:
                    exit_px = min(slp, o[j]); hit = True; break
                if l[j] <= slp:
                    exit_px = min(slp, o[j]); hit = True; break
                if h[j] >= tpp:
                    exit_px = max(tpp, o[j]); hit = True; break
            if not hit:
                exit_px = c[j_end]
        rets.append(exit_px / entry - 1 - cost_rt)
        entries.append(daily.index[i])
    return np.asarray(rets, dtype=float), pd.DatetimeIndex(entries)


def simulate_overnight_trades(daily: pd.DataFrame, cost_rt: float = 0.0012,
                              stop: float | None = None, tp: float | None = None) -> tuple[np.ndarray, pd.DatetimeIndex]:
    """Buy at today's close, sell tomorrow's open. SL/TP only via the opening gap
    (no intraday info exists between close and open)."""
    c = daily["close"].to_numpy(float)
    o = daily["open"].to_numpy(float)
    rets, entries = [], []
    for i in range(len(daily) - 1):
        entry = c[i]
        exit_px = o[i + 1]
        if stop is not None and exit_px <= entry * (1 - stop):
            exit_px = min(entry * (1 - stop), exit_px)  # gapped through -> fill at open
        elif tp is not None and exit_px >= entry * (1 + tp):
            exit_px = max(entry * (1 + tp), exit_px)
        rets.append(exit_px / entry - 1 - cost_rt)
        entries.append(daily.index[i])
    return np.asarray(rets, dtype=float), pd.DatetimeIndex(entries)


def trade_stats(name: str, rets: np.ndarray, holding_days: float, cost_rt: float = 0.0012) -> dict:
    """Summary metrics for one horizon's trade sample."""
    r = np.asarray(rets, dtype=float)
    r = r[np.isfinite(r)]
    n = len(r)
    if n == 0:
        return {"horizon": name, "n": 0}
    mean, std = float(r.mean()), float(r.std(ddof=1)) if n > 1 else 0.0
    pf = profit_factor(r)
    tpy = 252.0 / holding_days if holding_days > 0 else float("inf")
    ann_sharpe = (mean / std * np.sqrt(tpy)) if std > 0 and np.isfinite(tpy) else float("nan")
    ann_edge = mean * tpy if np.isfinite(tpy) else float("nan")
    se = std / np.sqrt(n) if n > 1 and std > 0 else float("nan")
    return {
        "horizon": name, "n": n,
        "mean_pct": mean * 100, "median_pct": float(np.median(r)) * 100,
        "std_pct": std * 100, "win_pct": win_rate(r),
        "pf": pf, "t_stat": mean / se if se and np.isfinite(se) else float("nan"),
        "ann_sharpe": ann_sharpe, "ann_edge_pct": ann_edge * 100 if np.isfinite(ann_edge) else float("nan"),
        "_rets": r, "_holding_days": holding_days, "_cost_rt": cost_rt,
    }


def bootstrap_pf_ci(rets: np.ndarray, n_boot: int = 1000, seed: int = 42) -> tuple[float, float]:
    """Percentile bootstrap CI for profit factor."""
    r = np.asarray(rets, dtype=float)
    r = r[np.isfinite(r)]
    if len(r) < 5:
        return (float("nan"), float("nan"))
    rng = np.random.default_rng(seed)
    pfs = []
    for _ in range(n_boot):
        s = r[rng.integers(0, len(r), len(r))]
        p = profit_factor(s)
        if np.isfinite(p):
            pfs.append(p)
    if not pfs:
        return (float("nan"), float("nan"))
    lo, hi = np.percentile(pfs, [2.5, 97.5])
    return (float(lo), float(min(hi, 10.0)))


def mc_sample(all_rets: np.ndarray, n_samples: int, seed: int = 42) -> np.ndarray:
    """Seeded random subsample (or everything when fewer entries than samples)."""
    if len(all_rets) <= n_samples:
        return all_rets
    rng = np.random.default_rng(seed)
    idx = rng.choice(len(all_rets), size=n_samples, replace=False)
    return all_rets[idx]


# ---------------------------------------------------------------- data loading
def _today_ist() -> str:
    from datetime import datetime, timezone, timedelta
    return (datetime.now(timezone(timedelta(hours=5, minutes=30))) - timedelta(days=1)).strftime("%Y-%m-%d")


def load_frames(args) -> dict:
    """Load daily + 5-minute frames (CSV cache or Upstox). Daily index = naive IST dates."""
    from market_data.market_data import fetch_candles

    out = {}
    if args.daily_csv:
        daily = pd.read_csv(args.daily_csv, index_col=0, parse_dates=True)
    else:
        daily = fetch_candles(args.symbol, tf=1440, from_date=args.frm, to_date=args.to)
    daily = daily[~daily.index.duplicated(keep="last")].sort_index()
    didx = daily.index
    didx = didx.tz_localize("UTC") if didx.tz is None else didx.tz_convert("UTC")
    daily.index = didx.tz_convert(IST).normalize().tz_localize(None)
    daily.index.name = "date"
    daily = daily[~daily.index.duplicated(keep="last")]
    out["daily"] = daily

    if args.minute_csv:
        frames = [pd.read_csv(p, index_col=0, parse_dates=True) for p in args.minute_csv.split(",")]
        m5 = pd.concat(frames)
    else:
        m5 = fetch_candles(args.symbol, tf=5, from_date=args.frm, to_date=args.to)
    if m5 is None or len(m5) == 0:
        out["m5"] = None
        return out
    m5 = m5[~m5.index.duplicated(keep="first")].sort_index()
    m5.index = m5.index.tz_localize("UTC") if m5.index.tz is None else m5.index.tz_convert("UTC")
    out["m5"] = m5
    return out


# ---------------------------------------------------------------- analysis
def session_daily_table(m5: pd.DataFrame) -> pd.DataFrame:
    """Per-day session returns + volume shares from 5m bars.
    open: 09:15-10:30, midday: 10:30-14:00, close: 14:00-15:30 (price path within day)."""
    ist = m5.index.tz_convert(IST)
    mins = ist.hour * 60 + ist.minute
    mask = (mins >= MARKET_OPEN_MIN) & (mins < MARKET_OPEN_MIN + MARKET_MINUTES)
    d = m5.loc[mask].copy()
    if d.empty:
        return pd.DataFrame()
    ist_d = d.index.tz_convert(IST)
    mins_d = ist_d.hour * 60 + ist_d.minute - MARKET_OPEN_MIN
    day = ist_d.normalize()
    d["_day"], d["_m"] = day.tz_localize(None), mins_d

    rows = []
    for dt, g in d.groupby("_day"):
        g = g.sort_index()
        if len(g) < 12:
            continue
        px_open = g["open"].iloc[0]
        b_open = g[g["_m"] < 75]
        b_mid = g[(g["_m"] >= 75) & (g["_m"] < 285)]
        b_close = g[g["_m"] >= 285]
        vol_total = g["volume"].sum()

        def seg_ret(seg, prev_close):
            if len(seg) == 0 or not prev_close:
                return np.nan
            return seg["close"].iloc[-1] / prev_close - 1

        rows.append({
            "date": dt,
            "open_ret": seg_ret(b_open, px_open),
            "mid_ret": seg_ret(b_mid, b_open["close"].iloc[-1] if len(b_open) else np.nan),
            "close_ret": seg_ret(b_close, b_mid["close"].iloc[-1] if len(b_mid) else np.nan),
            "vol_open": b_open["volume"].sum() / vol_total if vol_total else np.nan,
            "vol_mid": b_mid["volume"].sum() / vol_total if vol_total else np.nan,
            "vol_close": b_close["volume"].sum() / vol_total if vol_total else np.nan,
        })
    t = pd.DataFrame(rows).set_index("date")
    return t


def session_attribution(sess: pd.DataFrame, daily: pd.DataFrame) -> dict:
    """Chain session returns with the overnight gap into cumulative curves +
    log-contribution waterfall. Sanity check vs raw price change included."""
    dd = daily.copy()
    dd["gap"] = dd["open"] / dd["close"].shift(1) - 1
    s = sess.join(dd[["gap"]], how="inner").dropna(subset=["gap"])
    for c in ("open_ret", "mid_ret", "close_ret"):
        s[c] = s[c].fillna(0.0)
    # Minute closes miss the closing-auction print: daily close != last intrabar close.
    # Fold the per-day residual into the close bucket -> chain reproduces the official
    # daily move exactly by construction.
    day_factor = dd["close"] / dd["close"].shift(1)
    chain_day = (1 + s["gap"]) * (1 + s["open_ret"]) * (1 + s["mid_ret"]) * (1 + s["close_ret"])
    resid = day_factor.reindex(s.index) / chain_day - 1
    s["close_ret"] = (1 + s["close_ret"]) * (1 + resid.fillna(0.0)) - 1
    buckets = {"overnight": s["gap"], "open": s["open_ret"], "midday": s["mid_ret"], "close": s["close_ret"]}
    cum = {k: (1 + v).cumprod() - 1 for k, v in buckets.items()}
    total_chain = (1 + s["gap"]).prod() * (1 + s["open_ret"]).prod() * (1 + s["mid_ret"]).prod() * (1 + s["close_ret"]).prod() - 1
    # actual must cover EXACTLY the same session dates as the chained buckets
    # (sessions missing minute data are excluded from both sides)
    day_factor_full = dd["close"] / dd["close"].shift(1)
    actual = float(day_factor_full.reindex(s.index).fillna(1.0).prod() - 1)
    coverage = len(s) / max(len(dd.loc[sess.index.min():sess.index.max()]), 1) * 100
    contrib_log = {k: float(np.log1p(v).sum()) for k, v in buckets.items()}
    denom = sum(contrib_log.values())
    share = {k: (v / denom * 100 if denom else np.nan) for k, v in contrib_log.items()}
    return {
        "sess": s, "cum": cum, "share": share,
        "total_chain": total_chain, "actual": actual, "coverage_pct": coverage,
        "sanity_diff_pct": abs(total_chain - actual) / max(abs(actual), 1e-9) * 100,
        "n_days": len(s),
    }


def regime_series(daily: pd.DataFrame, window: int = 200) -> pd.Series:
    """True when close > SMA(window), evaluated on the PREVIOUS day (no lookahead)."""
    sma = daily["close"].rolling(window, min_periods=window // 2).mean()
    reg = (daily["close"] > sma)
    return reg.shift(1)


def regime_split_pf(reg: pd.Series, rets: np.ndarray, entries: pd.DatetimeIndex) -> tuple[float, float]:
    """PF of trades entered during up-regime vs down-regime (previous-day classification).
    Daily entries use their own date's prior-day regime; intraday entries map to their date."""
    reg_valid = reg.dropna()
    if len(rets) == 0 or reg_valid.empty:
        return (float("nan"), float("nan"))
    idx = pd.DatetimeIndex(entries)
    if getattr(idx, "tz", None) is not None:
        idx = idx.tz_localize(None)
    dates = idx.normalize()
    uniq = pd.DatetimeIndex(sorted(set(dates)))
    mapped = reg_valid.reindex(uniq).ffill().reindex(uniq)
    lookup = pd.Series(mapped.to_numpy(), index=uniq)
    up_mask = lookup.reindex(dates).to_numpy(dtype=float)
    up_mask = np.nan_to_num(up_mask, nan=0.0).astype(bool)
    r = np.asarray(rets, dtype=float)
    up = r[up_mask]
    dn = r[~up_mask]
    return (profit_factor(up) if len(up) else float("nan"),
            profit_factor(dn) if len(dn) else float("nan"))


def fetch_nifty_daily(start: str, end: str) -> pd.DataFrame | None:
    try:
        import yfinance as yf
        nf = yf.download("^NSEI", start=start, end=end, progress=False, auto_adjust=False)
        if nf is None or nf.empty:
            return None
        c = nf["Close"]
        close = c.iloc[:, 0] if getattr(c, "ndim", 2) == 2 else c
        o = nf["Open"]
        opn = o.iloc[:, 0] if getattr(o, "ndim", 2) == 2 else o
        df = pd.DataFrame({"open": opn, "close": close})
        df.index = pd.DatetimeIndex([pd.Timestamp(x) for x in df.index]).normalize()
        return df.dropna()
    except Exception:
        return None


# ---------------------------------------------------------------- figures
def _style():
    plt.rcParams.update({"figure.dpi": 110, "savefig.dpi": 130, "font.size": 10,
                         "axes.titlesize": 12, "axes.titleweight": "bold", "axes.grid": True,
                         "grid.alpha": 0.25, "grid.linewidth": 0.5, "figure.facecolor": "white",
                         "axes.facecolor": "white"})


def fig_session_curves(sym, att, nifty, figdir):
    fig, ax = plt.subplots(figsize=(12, 5.6))
    colors = {"overnight": PURPLE, "open": ACCENT, "midday": GRAY, "close": GOLD}
    for k, cu in att["cum"].items():
        ax.plot(cu.index, cu.values * 100, lw=1.7 if k != "midday" else 1.1,
                color=colors[k], label=f"{k} ({att['share'][k]:+.0f}% of move)")
    ax.plot(att["sess"].index, ((1 + att["sess"]["gap"]) * (1 + att["sess"]["open_ret"]) *
            (1 + att["sess"]["mid_ret"]) * (1 + att["sess"]["close_ret"])).cumprod().sub(1) * 100,
            color="black", lw=1.0, ls=":", label="chained total")
    if nifty is not None:
        ax.plot(nifty.index, nifty["cum_gap"] * 100, color=PURPLE, lw=0.9, alpha=0.45, ls="--", label="NIFTY overnight")
        ax.plot(nifty.index, nifty["cum_intra"] * 100, color=GOLD, lw=0.9, alpha=0.45, ls="--", label="NIFTY intraday")
    ax.axhline(0, color="#90a4ae", lw=0.8)
    ax.set_ylabel("Cumulative return (%)")
    ax.set_title(f"{sym} — where does the money get made? (session attribution)")
    ax.legend(fontsize=8, ncol=2)
    fig.tight_layout(); fig.savefig(figdir / "fig1_session_curves.png", bbox_inches="tight"); plt.close(fig)


def fig_waterfall(sym, att, figdir):
    labels = list(att["share"].keys())
    vals = [att["share"][k] for k in labels]
    cols = [PURPLE, ACCENT, GRAY, GOLD]
    fig, ax = plt.subplots(figsize=(9, 4.6))
    bottom = 0.0
    for lab, v, col in zip(labels, vals, cols):
        ax.bar(lab, v, bottom=bottom if v >= 0 else bottom + v, color=col, width=0.55)
        ax.text(labels.index(lab), bottom + v / 2, f"{v:+.0f}%", ha="center", va="center",
                color="white", fontweight="bold", fontsize=10)
        bottom += v
    ax.axhline(0, color="gray", lw=0.8)
    ax.set_ylabel("Share of total log-move (%)")
    ax.set_title(f"{sym} — contribution to total move by session")
    fig.tight_layout(); fig.savefig(figdir / "fig2_waterfall.png", bbox_inches="tight"); plt.close(fig)


def fig_pf_by_horizon(sym, stats_rows, figdir):
    names = [s["horizon"] for s in stats_rows]
    pfs = [min(s.get("pf", np.nan), 3.0) if np.isfinite(s.get("pf", np.nan)) else 0 for s in stats_rows]
    los = [min(s.get("pf_ci_lo", np.nan), 3.0) if np.isfinite(s.get("pf_ci_lo", np.nan)) else 0 for s in stats_rows]
    his = [min(s.get("pf_ci_hi", np.nan), 3.0) if np.isfinite(s.get("pf_ci_hi", np.nan)) else 0 for s in stats_rows]
    err = np.array([np.array(his) - np.array(pfs), np.array(pfs) - np.array(los)])
    fig, ax = plt.subplots(figsize=(11, 5))
    cols = [UP if lo > 1 else (GRAY if pf >= 1 else DOWN) for pf, lo in zip(pfs, los)]
    ax.bar(names, pfs, yerr=err, color=cols, width=0.6, capsize=4,
           error_kw=dict(alpha=0.6, lw=1.2))
    ax.axhline(1, color="black", ls="--", lw=1, label="PF = 1 (no edge)")
    for x, (pf, n) in enumerate(zip(pfs, [s["n"] for s in stats_rows])):
        ax.text(x, max(pf, 0.05) + 0.08, f"{pf:.2f}\nn={n:,}", ha="center", fontsize=8)
    ax.set_ylim(0, 3.2); ax.set_ylabel("Profit factor (capped at 3)")
    ax.set_title(f"{sym} — profit factor by holding period (95% bootstrap CI)")
    ax.legend(fontsize=9)
    fig.tight_layout(); fig.savefig(figdir / "fig3_pf_by_horizon.png", bbox_inches="tight"); plt.close(fig)


def fig_heatmap(sym, heat_df, figdir):
    fig, ax = plt.subplots(figsize=(8.5, 4.6))
    data = heat_df.values.astype(float)
    im = ax.imshow(data, cmap="RdYlGn", vmin=0.8, vmax=1.4, aspect="auto")
    ax.set_xticks(range(len(heat_df.columns))); ax.set_xticklabels(heat_df.columns, fontsize=9)
    ax.set_yticks(range(len(heat_df.index))); ax.set_yticklabels(heat_df.index, fontsize=9)
    for i in range(data.shape[0]):
        for j in range(data.shape[1]):
            v = data[i, j]
            if np.isfinite(v):
                ax.text(j, i, f"{v:.2f}", ha="center", va="center", fontsize=9,
                        color="white" if v < 0.92 else "black")
    ax.set_title(f"{sym} — PF heatmap: holding period × entry session")
    fig.colorbar(im, ax=ax, label="profit factor")
    fig.tight_layout(); fig.savefig(figdir / "fig4_heatmap.png", bbox_inches="tight"); plt.close(fig)


def fig_equity(sym, curves: dict, figdir):
    fig, axes = plt.subplots(2, 4, figsize=(15, 6), sharex=False)
    for ax, (name, (ts, cum)) in zip(axes.flat, curves.items()):
        ax.plot(ts, cum * 100, color=ACCENT, lw=1.0)
        ax.axhline(0, color="#90a4ae", lw=0.7)
        ax.set_title(name, fontsize=10)
        ax.tick_params(labelsize=7)
    fig.suptitle(f"{sym} — cumulative P&L of ALL sequential entries per horizon (incl. costs)", fontweight="bold")
    fig.tight_layout(); fig.savefig(figdir / "fig5_equity.png", bbox_inches="tight"); plt.close(fig)


def fig_distributions(sym, dist: dict, figdir):
    fig, ax = plt.subplots(figsize=(11, 4.8))
    names = list(dist.keys())
    data = [dist[k] * 100 for k in names]
    parts = ax.violinplot(data, showmedians=True, widths=0.8)
    for pc in parts["bodies"]:
        pc.set_facecolor(ACCENT); pc.set_alpha(0.4)
    ax.axhline(0, color="gray", lw=0.8)
    ax.set_xticks(range(1, len(names) + 1)); ax.set_xticklabels(names)
    ax.set_ylabel("Trade return (%)")
    ax.set_title(f"{sym} — per-trade return distribution by horizon (clipped 1–99 pct)")
    fig.tight_layout(); fig.savefig(figdir / "fig6_distributions.png", bbox_inches="tight"); plt.close(fig)


def fig_stops(sym, stop_tbl: pd.DataFrame, figdir):
    fig, ax = plt.subplots(figsize=(11, 5))
    horizons = stop_tbl.index.tolist()
    levels = ["none", "±1%", "±2%", "±3%"]
    xpos = np.arange(len(horizons)); w = 0.19
    for k, lv in enumerate(levels):
        if lv not in stop_tbl.columns:
            continue
        vals = stop_tbl[lv].values.astype(float)
        ax.bar(xpos + (k - 1.5) * w, np.clip(vals, 0, 2.5), w, label=f"SL/TP {lv}")
    ax.axhline(1, color="black", ls="--", lw=1)
    ax.set_xticks(xpos); ax.set_xticklabels(horizons)
    ax.set_ylabel("Profit factor (capped 2.5)"); ax.set_ylim(0, 2.7)
    ax.set_title(f"{sym} — does the edge survive stops? PF by SL/TP level")
    ax.legend(fontsize=9)
    fig.tight_layout(); fig.savefig(figdir / "fig7_stops.png", bbox_inches="tight"); plt.close(fig)


def fig_efficiency(sym, stats_rows, figdir):
    fig, ax = plt.subplots(figsize=(9.5, 5))
    xs, ys, names = [], [], []
    for s in stats_rows:
        hd = s.get("_holding_days")
        ae = s.get("ann_edge_pct")
        if hd is None or ae is None or not np.isfinite(ae):
            continue
        xs.append(max(hd, 1 / 75))  # 5m ≈ 0.013 trading-days
        ys.append(ae)
        names.append(s["horizon"])
    sc = ax.scatter(xs, ys, s=90, c=[UP if y > 0 else DOWN for y in ys], zorder=3)
    for x, y, nm in zip(xs, ys, names):
        ax.annotate(nm, (x, y), textcoords="offset points", xytext=(6, 4), fontsize=9)
    ax.axhline(0, color="gray", lw=0.8)
    ax.set_xscale("log")
    ax.set_xlabel("Holding period (trading days, log)")
    ax.set_ylabel("Annualized edge (%/yr, arithmetic approx)")
    ax.set_title(f"{sym} — edge efficiency: return earned per unit of time-in-market")
    fig.tight_layout(); fig.savefig(figdir / "fig8_efficiency.png", bbox_inches="tight"); plt.close(fig)


# ---------------------------------------------------------------- report
def _img_b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


def build_html(sym, sections, figdir, footer) -> str:
    parts = [f"<html><head><meta charset='utf-8'><title>{sym} timeframe edge</title>",
             "<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:1080px;margin:24px auto;padding:0 16px;color:#1a1a1a}",
             "h1{border-bottom:2px solid #1565c0;padding-bottom:6px} h2{color:#1565c0;margin-top:32px}",
             "table{border-collapse:collapse;font-size:13px} td,th{border:1px solid #ddd;padding:5px 9px;text-align:right}",
             "th{background:#f5f5f5} img{max-width:100%;border:1px solid #eee;border-radius:6px;margin:8px 0}",
             ".verdict{background:#eef5ee;border-left:4px solid #1a7f37;padding:12px 16px;border-radius:6px;font-size:15px}",
             ".note{color:#607d8b;font-size:12px} .good{color:#1a7f37;font-weight:bold}.bad{color:#c62828;font-weight:bold}</style></head><body>",
             f"<h1>{sym} — Timeframe Edge Report</h1>",
             "<div class='note'>Which holding period pays on this stock? Monte-Carlo random-entry study + session attribution.</div>"]
    for title, body in sections:
        parts.append(f"<h2>{title}</h2>")
        if isinstance(body, str):
            parts.append(body)
        else:  # DataFrame
            parts.append(body.to_html(classes="", border=0, float_format=lambda v: f"{v:.2f}", escape=False))
    parts.append(f"<hr><div class='note'>{footer}</div></body></html>")
    html = "\n".join(parts)
    for png in sorted(figdir.glob("*.png")):
        html = html.replace(png.name, f"<img src='data:image/png;base64,{_img_b64(png)}'/>")
    return html


def verdict_text(sym, stats_rows, best, att, regime_tbl=None, nifty_cmp=None) -> str:
    if best is None:
        return "Not enough data to rank horizons."
    lines = []
    pf, lo = best["pf"], best.get("pf_ci_lo", float("nan"))
    strong = np.isfinite(lo) and lo > 1
    lines.append(f"Best holding period: <b>{best['horizon']}</b> "
                 f"(PF {pf:.2f}, win {best['win_pct']:.0f}%, median {best['median_pct']:+.2f}%/trade, n={best['n']:,}) — "
                 + ("<span class='good'>statistically real</span> (95% CI lower bound above 1)"
                    if strong else "<span class='bad'>not statistically separable from luck</span>"))
    worst = min(stats_rows, key=lambda s: s.get("pf", 9) if np.isfinite(s.get("pf", np.nan)) else 9)
    if worst is not best and np.isfinite(worst.get("pf", np.nan)):
        lines.append(f"Weakest: <b>{worst['horizon']}</b> (PF {worst['pf']:.2f}) — "
                     + ("avoid scalping this name" if worst["horizon"] in ("5m", "15m", "1h") else "short holds decay here"))
    top_share = max(att["share"], key=lambda k: att["share"][k])
    lines.append(f"The stock's move concentrates in the <b>{top_share}</b> session "
                 f"({att['share'][top_share]:+.0f}% of the total log-move over {att['n_days']} sessions).")
    if regime_tbl is not None and best["horizon"] in regime_tbl.index:
        up_pf, dn_pf = regime_tbl.loc[best["horizon"], "pf_up_regime"], regime_tbl.loc[best["horizon"], "pf_down_regime"]
        if np.isfinite(up_pf) and np.isfinite(dn_pf):
            lines.append(("Edge survives both regimes" if min(up_pf, dn_pf) > 1 else
                          f"Regime-dependent: PF {up_pf:.2f} above 200d-MA vs {dn_pf:.2f} below — treat the down-regime number as the honest expectation."))
    if nifty_cmp:
        lines.append(nifty_cmp)
    return "<br>".join("• " + ln for ln in lines)


# ---------------------------------------------------------------- orchestration
def run_analysis(symbol: str, daily: pd.DataFrame, m5: pd.DataFrame | None,
                 samples: int, seed: int, cost_bps: float, nifty: pd.DataFrame | None):
    cost_rt = cost_bps * 2 / 10000.0
    result = {"cost_rt": cost_rt, "stats": [], "curves": {}, "dist": {}, "heat": {}, "stop_tbl": {},
              "regime_tbl": {}, "att": None, "sanity": None}

    reg = regime_series(daily)

    # --- session decomposition (daily fallback even without 5m) ---
    dd = daily.copy()
    dd["gap"] = dd["open"] / dd["close"].shift(1) - 1
    dd["intra"] = dd["close"] / dd["open"] - 1
    if m5 is not None and len(m5) > 500:
        sess = session_daily_table(m5)
        att = session_attribution(sess, daily)
    else:
        s = dd.dropna(subset=["gap"])
        cum = {"overnight": ((1 + s["gap"]).cumprod() - 1),
               "intraday(open->close)": ((1 + s["intra"]).cumprod() - 1)}
        gl, il = np.log1p(s["gap"]).sum(), np.log1p(s["intra"]).sum()
        att = {"sess": s, "cum": cum, "share": {"overnight": gl / (gl + il) * 100, "open": 0, "midday": 0, "close": il / (gl + il) * 100},
               "total_chain": (1 + s["gap"]).prod() * (1 + s["intra"]).prod() - 1,
               "actual": daily.loc[s.index.min():s.index.max(), "close"].iloc[-1] / daily.loc[s.index.min():s.index.max(), "close"].iloc[0] - 1,
               "sanity_diff_pct": np.nan, "n_days": len(s), "coverage_pct": 100.0}
    result["att"] = att
    result["sanity"] = att.get("sanity_diff_pct", np.nan)

    # --- NIFTY comparison series ---
    nifty_cmp_frame = None
    if nifty is not None:
        nd = nifty.copy()
        nd["gap"] = nd["open"] / nd["close"].shift(1) - 1
        nd["intra"] = nd["close"] / nd["open"] - 1
        nd = nd.dropna()
        nifty_cmp_frame = pd.DataFrame({
            "cum_gap": ((1 + nd["gap"]).cumprod() - 1),
            "cum_intra": ((1 + nd["intra"]).cumprod() - 1)})
        nifty_cmp_frame.index = pd.DatetimeIndex(nifty_cmp_frame.index)

    # --- MC per horizon ---
    tf_map = {}
    if m5 is not None and len(m5) > 500:
        tf_map = {"5m": m5, "15m": anchored_resample(m5, 15),
                  "1h": anchored_resample(m5, 60), "4h": anchored_resample(m5, 240)}

    all_rows = []
    heat = {}
    for name, hmin in INTRADAY_HORIZONS:
        bars = tf_map.get(name)
        if bars is None or len(bars) < 50:
            continue
        rets, entries = simulate_trades(bars, 1, cost_rt=cost_rt)
        if len(rets) < 30:
            continue
        sampled = mc_sample(rets, samples, seed)
        st_row = trade_stats(name, sampled, holding_days=hmin / MARKET_MINUTES, cost_rt=cost_rt)
        lo, hi = bootstrap_pf_ci(sampled, seed=seed)
        st_row["pf_ci_lo"], st_row["pf_ci_hi"] = lo, hi
        up_pf, dn_pf = regime_split_pf(reg, rets, entries)
        result["regime_tbl"][name] = (up_pf, dn_pf)
        # heatmap by entry session (all entries, not just sample)
        ses = pd.Series([classify_entry_session(t.hour * 60 + t.minute) for t in entries.tz_convert(IST)], index=entries)
        heat[name] = {ses_name: profit_factor(rets[ses == ses_name]) for ses_name in SESSIONS}
        result["curves"][name] = (entries, pd.Series(rets, index=entries).sort_index().cumsum())
        clipped = np.clip(rets, np.percentile(rets, 1), np.percentile(rets, 99))
        result["dist"][name] = clipped
        # stops overlay on native bars
        row = {}
        for lvl in STOP_LEVELS:
            r_lv, _ = simulate_trades(bars, 1, cost_rt=cost_rt, stop=lvl, tp=lvl)
            row["none" if lvl is None else f"±{int(lvl*100)}%"] = profit_factor(mc_sample(r_lv, samples, seed))
        result["stop_tbl"][name] = row
        all_rows.append(st_row)

    for name, hdays in DAILY_HORIZONS:
        if name == "overnight":
            rets, entries = simulate_overnight_trades(daily, cost_rt=cost_rt)
            hold = 1.0
        else:
            rets, entries = simulate_daily_trades(daily, hdays, cost_rt=cost_rt)
            hold = float(hdays)
        if len(rets) < 20:
            continue
        sampled = mc_sample(rets, samples, seed)
        st_row = trade_stats(name, sampled, holding_days=hold, cost_rt=cost_rt)
        lo, hi = bootstrap_pf_ci(sampled, seed=seed)
        st_row["pf_ci_lo"], st_row["pf_ci_hi"] = lo, hi
        up_pf, dn_pf = regime_split_pf(reg, rets, entries)
        result["regime_tbl"][name] = (up_pf, dn_pf)
        heat[name] = {"all-day": profit_factor(rets)}
        result["curves"][name] = (entries, pd.Series(rets, index=entries).sort_index().cumsum())
        clipped = np.clip(rets, np.percentile(rets, 1), np.percentile(rets, 99))
        result["dist"][name] = clipped
        row = {}
        for lvl in STOP_LEVELS:
            if name == "overnight":
                r_lv, _ = simulate_overnight_trades(daily, cost_rt=cost_rt, stop=lvl, tp=lvl)
            else:
                r_lv, _ = simulate_daily_trades(daily, hdays, cost_rt=cost_rt, stop=lvl, tp=lvl)
            row["none" if lvl is None else f"±{int(lvl*100)}%"] = profit_factor(mc_sample(r_lv, samples, seed))
        result["stop_tbl"][name] = row
        all_rows.append(st_row)

    result["stats"] = all_rows
    result["heat"] = heat
    result["nifty_cmp"] = nifty_cmp_frame
    return result


def main():
    ap = argparse.ArgumentParser(description="Timeframe-edge report for an NSE symbol")
    ap.add_argument("--symbol", required=True)
    ap.add_argument("--frm", default="2024-01-01")
    ap.add_argument("--to", default=_today_ist())
    ap.add_argument("--daily-csv", default=None)
    ap.add_argument("--minute-csv", default=None, help="comma-separated CSV paths")
    ap.add_argument("--samples", type=int, default=2000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--cost-bps", type=float, default=6.0, help="per-side cost in bps (default 6 => 12bps round trip)")
    ap.add_argument("--outdir", default=None)
    ap.add_argument("--no-nifty", action="store_true")
    args = ap.parse_args()

    sym = args.symbol.upper()
    frames = load_frames(args)
    daily, m5 = frames["daily"], frames["m5"]
    if daily is None or len(daily) < 60:
        print("ERROR: need >=60 daily bars; check symbol/creds.", file=sys.stderr)
        sys.exit(2)

    nifty = None
    if not args.no_nifty:
        nifty_raw = fetch_nifty_daily(str(daily.index.min().date()), str(daily.index.max().date()))
        if nifty_raw is not None:
            nifty = nifty_raw

    res = run_analysis(sym, daily, m5, args.samples, args.seed, args.cost_bps, nifty)

    outdir = Path(args.outdir) if args.outdir else REPO / "reports" / f"{sym}_TIMEFRAME_EDGE"
    figdir = outdir / "figures"
    figdir.mkdir(parents=True, exist_ok=True)

    _style()
    att = res["att"]

    # figures
    fig_session_curves(sym, att, res["nifty_cmp"], figdir)
    fig_waterfall(sym, att, figdir)
    stats = res["stats"]
    if stats:
        fig_pf_by_horizon(sym, stats, figdir)
        heat_df = pd.DataFrame(res["heat"]).T.fillna(np.nan)
        heat_df.columns = [c for c in heat_df.columns]
        fig_heatmap(sym, heat_df, figdir)
        fig_equity(sym, res["curves"], figdir)
        fig_distributions(sym, res["dist"], figdir)
        stop_tbl = pd.DataFrame(res["stop_tbl"]).T
        fig_stops(sym, stop_tbl, figdir)
        fig_efficiency(sym, stats, figdir)

    # tables
    tbl = pd.DataFrame([{k: v for k, v in s.items() if not k.startswith("_")} for s in stats])
    if len(tbl):
        tbl = tbl[["horizon", "n", "mean_pct", "median_pct", "win_pct", "pf", "pf_ci_lo", "pf_ci_hi",
                   "t_stat", "ann_sharpe", "ann_edge_pct"]]
    regime_tbl = pd.DataFrame({k: {"pf_up_regime": v[0], "pf_down_regime": v[1]} for k, v in res["regime_tbl"].items()}).T
    best = max(stats, key=lambda s: s.get("pf", -np.inf)) if stats else None

    nifty_cmp_txt = None
    if att is not None and res["nifty_cmp"] is not None and "overnight" in att["share"]:
        ng = res["nifty_cmp"]["cum_gap"].iloc[-1] * 100
        ni = res["nifty_cmp"]["cum_intra"].iloc[-1] * 100
        nifty_cmp_txt = (f"For context, NIFTY itself made {ng:+.0f}% overnight vs {ni:+.0f}% intraday over the same span — "
                         "compare NETWEB's split against that before calling the edge stock-specific.")

    verdict = verdict_text(sym, stats, best, att, regime_tbl, nifty_cmp_txt)
    share_txt = ", ".join(f"{k} {v:+.0f}%" for k, v in att["share"].items() if v)
    sanity = res["sanity"]
    footer = (f"Generated {pd.Timestamp.today():%Y-%m-%d} · lookback {daily.index.min():%Y-%m-%d} → {daily.index.max():%Y-%m-%d} · "
              f"costs {args.cost_bps*2:.0f}bps round-trip · seed {args.seed}. "
              f"Session contributions: {share_txt}. "
              + (f"Bucket-chain sanity: chained {att['total_chain']*100:+.1f}% vs actual {att['actual']*100:+.1f}% "
                 f"(diff {sanity:.2f}%) over {att.get('coverage_pct', 0):.0f}% of sessions with minute data — "
                 "large diff = data problem."
                 if np.isfinite(sanity) else "Sanity check unavailable (no 5m data)."))

    sections = [
        ("Verdict", f"<div class='verdict'>{verdict}</div>"),
        ("How to read this", ("<ul>"
            "<li><b>Profit factor (PF)</b> = gross wins ÷ gross losses. PF &gt; 1 with the CI lower bound above 1 means random long entries made money at that horizon.</li>"
            "<li>This measures the stock's <b>drift structure</b>, not strategy skill — it answers “what timeframe”, not “what setup”.</li>"
            "<li>The heatmap shows <b>when</b> to enter each horizon; the stops chart asks whether intraday noise shakes the trade out before the drift arrives.</li></ul>")),
        ("Monte-Carlo results (random long entries, net of costs)", tbl),
        ("Session attribution — where the move happens", ""),
        ("Contribution to the total move (log-share)", ""),
        ("Profit factor: horizon × entry session", ""),
        ("Equity curves — every sequential entry", ""),
        ("Per-trade distributions", ""),
        ("Does the edge survive stops?", ""),
        ("Edge efficiency (return per time-in-market)", ""),
        ("Regime split (above vs below 200d-MA, previous-day classified)", regime_tbl),
        ("Caveats", ("<ul>"
            "<li>Random-entry sampling measures average drift; real setups can beat these numbers (and bad ones will lose to them).</li>"
            "<li>Same-day completion enforced for intraday horizons — cross-day holds belong to the daily rows.</li>"
            "<li>Overnight SL/TP fills use the opening gap only; intrabar double-hits assume SL first (conservative).</li>"
            "<li>Flat round-trip costs; slippage not modeled. 5m rows are expected to be noise-dominated — check n and CI width.</li>"
            "<li>Upstox minute history depth limits how far back the intraday sessions reach; the daily rows always cover the full window.</li></ul>")),
    ]

    md_lines = [f"# {sym} — Timeframe Edge Report", "", verdict.replace("<br>", "\n").replace("<b>", "**").replace("</b>", "**")
                .replace("<span class='good'>", "").replace("</span>", ""), ""]
    if len(tbl):
        md_lines += ["## Monte-Carlo results", tbl.to_markdown(index=False), ""]
    md_lines += ["## Session share of total move", share_txt, "",
                 f"## Regime split", regime_tbl.to_markdown(), "", "## Caveats", "- See HTML report.", "", footer]

    (outdir / f"{sym}_timeframe_edge.md").write_text("\n".join(md_lines))
    html = build_html(sym, sections, figdir, footer)
    (outdir / f"{sym}_timeframe_edge.html").write_text(html)

    if len(tbl):
        tbl.to_csv(outdir / "mc_summary.csv", index=False)
    sess_out = att["sess"].reset_index()
    sess_out.to_csv(outdir / "session_attribution.csv", index=False)

    print(f"[ok] report → {outdir}")
    print(f"[ok] verdict: best={best['horizon'] if best else 'n/a'}")


if __name__ == "__main__":
    main()
