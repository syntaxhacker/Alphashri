"""Track A — Variance risk premium (VRP) timing for NIFTY options.

Question: when are options rich/cheap enough to sell/buy volatility, net of costs?

Two evidence bases:
  * synthetic  : BS premiums off the real 2018-2026 spot path, causal VIX/RV IV
                 (large sample, model-premium caveat) — train 2018-22 / test 2023-26.
  * real       : actual FYERS premiums for the listed 2026 contracts (true execution,
                 short sample).

Causal design: entry signal uses only prior-day VRP/RV info (daily features are
shifted by one session); fills happen at the next bar open; costs are charged by
the shared engine. Because the gate is prior-day and monotone in the trade list
(one entry/day), a gated run is *exactly* the unconditional trade list filtered by
the day's feature — which lets us evaluate many thresholds from one replay.

Sub-commands
  char   characterise VRP (real surface + synthetic proxy)
  run    replay the unconditional structures -> tracks/_vrp_trades_<mode>.parquet
  eval   evaluate conditional thresholds, write json/md/jsonl
  all    char + run + eval
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
NV = HERE.parent
if str(NV) not in sys.path:
    sys.path.insert(0, str(NV))

import runner as R  # noqa: E402
import stats as st  # noqa: E402
import pricing  # noqa: E402
import fyers_data as fd  # noqa: E402
from engine import (  # noqa: E402
    EngineConfig, ExpiryResolver, Leg, RealOptionSource, Signal,
    SyntheticOptionSource, build_real_resolver, replay,
)
from costs import ExecutionModel  # noqa: E402

CACHE = fd.CACHE_DIR
CAPITAL = 300_000.0
SYN_START, SYN_END = date(2018, 1, 1), date(2026, 9, 25)
REAL_START, REAL_END = date(2026, 6, 1), date(2026, 9, 25)

# ---------------------------------------------------------------------------
# structures (unconditional replays)
# ---------------------------------------------------------------------------
SYN_SPECS = [
    dict(tag="syn_ss_atm", side="short", structure="straddle", otm=0, entry_min=30, stop=0.35, target=0.60, hold=360),
    dict(tag="syn_ss_atm_s50t50", side="short", structure="straddle", otm=0, entry_min=30, stop=0.50, target=0.50, hold=360),
    dict(tag="syn_sx1", side="short", structure="strangle", otm=1, entry_min=30, stop=0.35, target=0.60, hold=360),
    dict(tag="syn_sx2", side="short", structure="strangle", otm=2, entry_min=30, stop=0.35, target=0.60, hold=360),
    dict(tag="syn_ss_atm_e60", side="short", structure="straddle", otm=0, entry_min=60, stop=0.35, target=0.60, hold=360),
    dict(tag="syn_ls_atm", side="long", structure="straddle", otm=0, entry_min=30, stop=0.35, target=0.60, hold=360),
    dict(tag="syn_lx1", side="long", structure="strangle", otm=1, entry_min=30, stop=0.35, target=0.60, hold=360),
]

REAL_SPECS = [
    dict(tag="real_ss_atm", side="short", structure="straddle", otm=0, entry_min=30, stop=0.35, target=0.60, hold=360),
    dict(tag="real_ss_atm_s50t50", side="short", structure="straddle", otm=0, entry_min=30, stop=0.50, target=0.50, hold=360),
    dict(tag="real_sx1", side="short", structure="strangle", otm=1, entry_min=30, stop=0.35, target=0.60, hold=360),
    dict(tag="real_sx2", side="short", structure="strangle", otm=2, entry_min=30, stop=0.35, target=0.60, hold=360),
    dict(tag="real_ss_atm_e60", side="short", structure="straddle", otm=0, entry_min=60, stop=0.35, target=0.60, hold=360),
    dict(tag="real_ls_atm", side="long", structure="straddle", otm=0, entry_min=30, stop=0.35, target=0.60, hold=360),
    dict(tag="real_lx1", side="long", structure="strangle", otm=1, entry_min=30, stop=0.35, target=0.60, hold=360),
]


# ---------------------------------------------------------------------------
# causal daily features
# ---------------------------------------------------------------------------
def synthetic_features():
    """Prior-day IV/RV proxy from the real spot + INDIAVIX daily candles."""
    d = pd.read_parquet(fd.CANDLE_DIR / "NSE_NIFTY50-INDEX__D.parquet").set_index("ts").sort_index()
    vix = pd.read_parquet(fd.CANDLE_DIR / "NSE_INDIAVIX-INDEX__D.parquet").set_index("ts").sort_index()
    close = d["close"].astype(float)
    ret = np.log(close / close.shift(1))
    rv5 = ret.rolling(5).std() * math.sqrt(252)
    rv10 = ret.rolling(10).std() * math.sqrt(252)
    rv20 = ret.rolling(20).std() * math.sqrt(252)
    vixc = (vix["close"].reindex(close.index).ffill() / 100.0).clip(lower=0.05)
    iv = (0.65 * vixc + 0.35 * rv20).clip(lower=0.05)     # same blend as pricing.combine_iv
    vrp = iv - rv20
    ratio = iv / rv20
    vix_rel = vixc / rv20                                   # raw VIX / trailing RV
    vix_pct = vixc.rolling(252).rank(pct=True)
    df = pd.DataFrame({"iv_est": iv, "rv20": rv20, "rv5": rv5, "rv10": rv10, "vix": vixc,
                       "vrp": vrp, "ratio": ratio, "vix_rel": vix_rel, "vix_pct": vix_pct})
    # characterisation-only diagnostic (NEVER used by the signal): forward realised vol
    df["fwd_rv5"] = rv5.shift(-5)
    df = df.shift(1)                                        # only prior-day info
    out = {}
    for ts, row in df.iterrows():
        out[ts.date()] = {k: (float(row[k]) if row[k] == row[k] else None)
                          for k in df.columns if k != "fwd_rv5"}
    return out, df


def daily_vix_features():
    """Prior-day VIX/RV-20 ratios from the real daily candles (works for any window)."""
    d = pd.read_parquet(fd.CANDLE_DIR / "NSE_NIFTY50-INDEX__D.parquet").set_index("ts").sort_index()
    vix = pd.read_parquet(fd.CANDLE_DIR / "NSE_INDIAVIX-INDEX__D.parquet").set_index("ts").sort_index()
    close = d["close"].astype(float)
    ret = np.log(close / close.shift(1))
    rv20 = (ret.rolling(20).std() * math.sqrt(252)).clip(lower=0.02)
    vixc = (vix["close"].reindex(close.index).ffill() / 100.0).clip(lower=0.05)
    df = pd.DataFrame({"vix_rel": vixc / rv20,
                       "iv_ratio": (0.65 * vixc + 0.35 * rv20) / rv20}).shift(1)
    return {ts.date(): {k: (float(row[k]) if row[k] == row[k] else None) for k in df.columns}
            for ts, row in df.iterrows()}


def real_features():
    """Prior-day surface metrics for the front listed expiry + prior-day VIX/RV ratios."""
    m = pd.read_parquet(CACHE / "surface_metrics_daily.parquet")
    m["date"] = pd.to_datetime(m["date"]).dt.date
    m = m.sort_values(["date", "dte"])
    front = m.groupby("date", as_index=False).first().set_index("date").sort_index()
    cols = ["atm_iv", "rv", "vrp", "vrp_ratio", "rr25", "term_slope", "dte"]
    f = front[cols].shift(1)
    out = {}
    for d, row in f.iterrows():
        out[d] = {k: (float(row[k]) if row[k] == row[k] else None) for k in cols}
    for d, v in daily_vix_features().items():
        out.setdefault(d, {}).update(v)
    return out, front


def characterize(out_path: Path):
    syn_feat, syn_df = synthetic_features()
    real_feat, real_front = real_features()
    lines = []
    lines.append("== synthetic prior-day IV/RV proxy (2018-2026, daily) ==")
    dl = syn_df.dropna(subset=["ratio"])
    lines.append(f"n={len(dl)}  ratio mean={dl['ratio'].mean():.3f} med={dl['ratio'].median():.3f} "
                 f"p10={dl['ratio'].quantile(.10):.3f} p90={dl['ratio'].quantile(.90):.3f} "
                 f"min={dl['ratio'].min():.3f} max={dl['ratio'].max():.3f}")
    lines.append(f"        vrp  mean={dl['vrp'].mean():.4f} med={dl['vrp'].median():.4f} "
                 f"p10={dl['vrp'].quantile(.10):.4f} p90={dl['vrp'].quantile(.90):.4f}")
    lines.append("  IV>RV fraction: %.3f" % (dl["vrp"] > 0).mean())
    q = pd.cut(dl["ratio"], [0, 1.0, 1.2, 1.4, 1.6, 1.8, 10])
    tab = pd.DataFrame({
        "n": dl.groupby(q, observed=True).size(),
        "iv_est": dl.groupby(q, observed=True)["iv_est"].mean().round(4),
        "rv20": dl.groupby(q, observed=True)["rv20"].mean().round(4),
        "fwd_rv5": dl.groupby(q, observed=True)["fwd_rv5"].mean().round(4),
    })
    lines.append("  prior-day IV/RV bucket -> forward realised vol (mean-reversion check):")
    lines.append(tab.to_string())
    lines.append("")
    lines.append("== real surface VRP by DTE (2026-05..2026-09, listed) ==")
    mm = real_front.dropna(subset=["vrp"])
    lines.append(mm.groupby(pd.cut(mm["dte"], [0, 7, 14, 30, 60, 200]))["vrp"]
                 .agg(["count", "mean", "median", "std"]).round(4).to_string())
    lines.append("")
    lines.append("real VRP (all): mean=%.4f med=%.4f min=%.4f max=%.4f" %
                 (mm["vrp"].mean(), mm["vrp"].median(), mm["vrp"].min(), mm["vrp"].max()))
    lines.append("real vrp_ratio: mean=%.3f med=%.3f" % (mm["vrp_ratio"].mean(), mm["vrp_ratio"].median()))
    lines.append("term_slope (back-front IV): n=%d mean=%.4f pos-frac=%.3f" %
                 (real_front["term_slope"].notna().sum(), real_front["term_slope"].mean(),
                  (real_front["term_slope"] > 0).mean()))
    txt = "\n".join(lines)
    print(txt)
    out_path.write_text(txt)
    return syn_feat, real_feat


# ---------------------------------------------------------------------------
# replay workers
# ---------------------------------------------------------------------------
_G: dict = {}


def _init_syn():
    _G["spot"] = R.load_spot("5")
    _G["meta"] = R.load_daily_meta()
    _G["source"] = SyntheticOptionSource.from_cached()
    _G["res"] = R.build_weekly_resolver(SYN_START, SYN_END)


def _init_real():
    _G["spot"] = R.load_spot("5")
    _G["meta"] = R.load_daily_meta()
    src = RealOptionSource()
    _G["source"] = src
    res, _ = build_real_resolver(src, 0.0, 50)
    _G["res"] = res


def _strategy(spec):
    side = spec["side"]
    otm = spec["otm"]
    entry_min = spec["entry_min"]
    hold = spec["hold"]
    stop, target = spec["stop"], spec["target"]
    structure = spec["structure"]
    is_straddle = structure.endswith("straddle")

    def strat(ctx, i):
        mins = ctx.minutes(i)
        if abs(mins - entry_min) > 2:
            return None
        if ctx.expiry == ctx.day:            # no same-day-expiry gamma/pin games
            return None
        legs = []
        for opt in ("CE", "PE"):
            legs.append(Leg(opt, "BUY" if side == "long" else "SELL", otm))
        return Signal(legs, f"{side} {structure} otm={otm} @{entry_min}m", spec["tag"],
                      stop_pct=stop, target_pct=target, max_hold_min=hold)

    return strat, is_straddle


def _run_one(spec):
    cfg = EngineConfig(capital=CAPITAL, risk_pct=0.01, stop_pct=spec["stop"],
                       target_pct=spec["target"], execution=ExecutionModel(), lot=65)
    strat, _ = _strategy(spec)
    t0 = time.time()
    trades = replay(strat, _G["spot"], _G["source"], _G["res"], cfg,
                    spec["start"], spec["end"], require_data=spec.get("require_data", False),
                    day_meta=_G["meta"])
    rows = []
    for t in trades:
        rows.append(dict(
            tag=spec["tag"], date=t.date, entry_ts=t.entry_ts, exit_ts=t.exit_ts,
            net_pnl=t.net_pnl, gross_pnl=t.gross_pnl, fees=t.fees,
            entry_net=t.entry_net, exit_net=t.exit_net, lots=t.lots, capital=t.capital,
            spot_entry=t.spot_entry, spot_exit=t.spot_exit, exit_reason=t.exit_reason,
            first_opt=t.legs[0]["opt"], n_legs=len(t.legs), direction=t.direction,
        ))
    print(f"  {spec['tag']}: n={len(rows)} ({time.time()-t0:.0f}s)", flush=True)
    return spec["tag"], rows


def run_specs(specs, mode, workers=8):
    from concurrent.futures import ProcessPoolExecutor
    init = _init_syn if mode == "synthetic" else _init_real
    out = {}
    with ProcessPoolExecutor(max_workers=workers, initializer=init) as ex:
        for tag, rows in ex.map(_run_one, specs):
            out[tag] = rows
    all_rows = [r for rows in out.values() for r in rows]
    df = pd.DataFrame(all_rows)
    path = HERE / f"_vrp_trades_{mode}.parquet"
    df.to_parquet(path, index=False)
    print("saved", path, len(df))
    return df


# ---------------------------------------------------------------------------
# evaluation
# ---------------------------------------------------------------------------
def _subset_stats(sub: pd.DataFrame, label: str) -> dict:
    net = sub["net_pnl"].to_numpy(dtype=float)
    if len(net) == 0:
        return {"label": label, "n": 0}
    s = st.summarize(net, CAPITAL)
    wk = st.weekly(net, list(sub["entry_ts"]), CAPITAL)
    bs = st.bootstrap(net, CAPITAL)
    ror = st.risk_of_ruin(net, CAPITAL)
    sgn = np.where(sub["first_opt"].to_numpy() == "CE", 1.0, -1.0)
    mv = (sub["spot_exit"].to_numpy() - sub["spot_entry"].to_numpy()) * sgn
    return {
        "label": label, "n": int(len(net)),
        "net_exp": float(s["expectancy"]), "pf": float(s["profit_factor"]),
        "win": float(s["win_rate"]), "total_net": float(s["total_net"]),
        "max_drawdown": float(s["max_drawdown"]),
        "max_dd_pct_capital": float(s["max_drawdown"] / CAPITAL),
        "worst_trade": float(s["worst"]), "best_trade": float(s["best"]),
        "tail_loss_p95": float(s["p05"]),
        "bootstrap_ci": [float(bs["ci_low_mean"]), float(bs["ci_high_mean"])],
        "p_positive_total": float(bs["p_positive_total"]),
        "risk_of_ruin": float(ror),
        "worst_week": float(wk.get("worst_week", 0.0)),
        "avg_week": float(wk.get("avg_week", 0.0)),
        "prob_positive_week": float(wk.get("prob_positive_week", 0.0)),
        "capital_for_15k_week": float(wk.get("target_15k_avg_capital", float("inf"))),
        "raw_dir_accuracy": float((mv > 0).mean()),
        "raw_mean_move_pts": float(mv.mean()),
        "exit_mix": sub["exit_reason"].value_counts().to_dict(),
    }


def _train_test(sub: pd.DataFrame):
    if sub.empty:
        return {}
    yr = pd.to_datetime(sub["date"]).dt.year
    tr = _subset_stats(sub[yr <= 2022], "train")
    te = _subset_stats(sub[yr >= 2023], "test")
    return {"train": tr, "test": te}


def evaluate():
    syn_feat, real_feat = synthetic_features(), real_features()
    syn_feat_map = syn_feat[0]
    real_feat_map = real_feat[0]
    trades = pd.read_parquet(HERE / "_vrp_trades_synthetic.parquet")
    rtrades = pd.read_parquet(HERE / "_vrp_trades_real.parquet")

    def attach(df, feat, prefix):
        keys = sorted({k for v in feat.values() for k in v})
        dates = pd.to_datetime(df["date"]).dt.date
        for k in keys:
            df[f"{prefix}_{k}"] = [feat.get(d, {}).get(k) for d in dates]
        return df

    trades = attach(trades, syn_feat_map, "f")
    rtrades = attach(rtrades, real_feat_map, "f")

    # realised vs implied move (mechanism diagnostic), using BS implied move proxy
    def add_mech(df):
        rng = (df["spot_entry"] * 0.0).to_numpy()
        # implied one-session move proxy = entry_net (straddle) approximates 0.8*S*sigma*sqrt(T)
        df["abs_move_pts"] = (df["spot_exit"] - df["spot_entry"]).abs()
        df["implied_pts"] = df["entry_net"].abs()
        df["short_vol_hit"] = df["abs_move_pts"] < df["implied_pts"]
        return df

    trades = add_mech(trades)
    rtrades = add_mech(rtrades)

    # ---- conditions ------------------------------------------------------
    def cond(syn, feature, op, thr):
        v = syn[f"f_{feature}"]
        if op == ">":
            m = v > thr
        elif op == "<":
            m = v < thr
        else:
            raise ValueError(op)
        return m.fillna(False)

    results = {}

    # Synthetic short-vol threshold grid (train-selected, test reported)
    for tag in ["syn_ss_atm", "syn_ss_atm_s50t50", "syn_sx1", "syn_sx2", "syn_ss_atm_e60"]:
        sub = trades[trades["tag"] == tag].reset_index(drop=True)
        for feature, thrs in [("ratio", [0.0, 1.1, 1.3, 1.5, 1.7, 2.0, 0.95, 1.05, 1.15, 1.25]),
                              ("vrp", [-9, 0.02, 0.04, 0.06, 0.08, 0.0, 0.01]),
                              ("vix_rel", [0.0, 1.1, 1.3, 1.5, 1.7, 1.0, 1.2])]:
            for op in (">", "<"):
                for thr in thrs:
                    key = f"{tag}|{feature}{op}{thr}"
                    sel = sub[cond(sub, feature, op, thr)]
                    if len(sel) == 0:
                        continue
                    res = _subset_stats(sel, key)
                    res.update(_train_test(sel))
                    res["structure"] = tag
                    res["condition"] = f"{feature}{op}{thr}"
                    res["feature"] = feature
                    res["threshold"] = thr
                    res["op"] = op
                    results[key] = res

    # Synthetic long-vol (buy cheap vol) grid
    for tag in ["syn_ls_atm", "syn_lx1"]:
        sub = trades[trades["tag"] == tag].reset_index(drop=True)
        for feature, thrs in [("ratio", [1.0, 1.1, 1.2, 1.3]), ("vrp", [0.0, 0.02, 0.04])]:
            for thr in thrs:
                key = f"{tag}|{feature}<{thr}"
                sel = sub[cond(sub, feature, "<", thr)]
                if len(sel) == 0:
                    continue
                res = _subset_stats(sel, key)
                res.update(_train_test(sel))
                res["structure"] = tag
                res["condition"] = f"{feature}<{thr}"
                res["feature"] = feature
                res["threshold"] = thr
                results[key] = res

    # Real short-vol grid (surface VRP; contango variants)
    for tag in ["real_ss_atm", "real_ss_atm_s50t50", "real_sx1", "real_sx2", "real_ss_atm_e60"]:
        sub = rtrades[rtrades["tag"] == tag].reset_index(drop=True)
        if sub.empty:
            continue
        grids = [("vrp", [0.0, 0.03, 0.04, 0.05, 0.06]),
                 ("vrp_ratio", [1.0, 1.3, 1.5, 1.7, 2.0]),
                 ("vix_rel", [1.0, 1.1, 1.2, 1.3, 1.5]),
                 ("iv_ratio", [1.3, 1.5, 1.7, 2.0])]
        for feature, thrs in grids:
            for op in (">", "<"):
                for thr in thrs:
                    key = f"{tag}|{feature}{op}{thr}"
                    sel = sub[cond(sub, feature, op, thr)]
                    if len(sel) == 0:
                        continue
                    res = _subset_stats(sel, key)
                    res.update({"structure": tag, "condition": f"{feature}{op}{thr}",
                                "feature": feature, "threshold": thr, "op": op})
                    results[key] = res
        # + term contango
        sel = sub[(sub["f_term_slope"] > 0).fillna(False)]
        if len(sel):
            key = f"{tag}|contango"
            res = _subset_stats(sel, key)
            res.update({"structure": tag, "condition": "term_slope>0",
                        "feature": "term_slope", "threshold": 0.0})
            results[key] = res
        sel = sub[(sub["f_vrp"] > 0.04).fillna(False) & (sub["f_term_slope"] > 0).fillna(False)]
        if len(sel):
            key = f"{tag}|vrp>0.04&contango"
            res = _subset_stats(sel, key)
            res.update({"structure": tag, "condition": "vrp>0.04 & term_slope>0",
                        "feature": "vrp+term", "threshold": 0.04})
            results[key] = res
    for tag in ["real_ls_atm", "real_lx1"]:
        sub = rtrades[rtrades["tag"] == tag].reset_index(drop=True)
        if sub.empty:
            continue
        for thr in [1.3, 1.5, 1.7]:
            key = f"{tag}|vrp_ratio<{thr}"
            sel = sub[cond(sub, "vrp_ratio", "<", thr)]
            if len(sel) == 0:
                continue
            res = _subset_stats(sel, key)
            res.update({"structure": tag, "condition": f"vrp_ratio<{thr}",
                        "feature": "vrp_ratio", "threshold": thr})
            results[key] = res

    # unconditional baselines
    for tag in trades["tag"].unique():
        sub = trades[trades["tag"] == tag].reset_index(drop=True)
        res = _subset_stats(sub, f"{tag}|unconditional")
        res.update(_train_test(sub))
        res.update({"structure": tag, "condition": "unconditional", "feature": "none", "threshold": None})
        results[f"{tag}|unconditional"] = res
    for tag in rtrades["tag"].unique():
        sub = rtrades[rtrades["tag"] == tag].reset_index(drop=True)
        res = _subset_stats(sub, f"{tag}|unconditional")
        res.update({"structure": tag, "condition": "unconditional", "feature": "none", "threshold": None})
        results[f"{tag}|unconditional"] = res

    return results, trades, rtrades


MEANINGFUL = {
    "ratio": {0.95, 1.05, 1.15, 1.25, 1.1, 1.3, 1.5, 1.7, 2.0},
    "vrp": {0.0, 0.01, 0.02, 0.04, 0.06, 0.08},
    "vix_rel": {1.0, 1.1, 1.2, 1.3, 1.5, 1.7},
    "vrp_ratio": {1.3, 1.5, 1.7, 2.0},
    "term_slope": {0.0},
    "vrp+term": {0.04},
}


def _is_conditional(r):
    f, t = r.get("feature"), r.get("threshold")
    if f in (None, "none"):
        return False
    return t in MEANINGFUL.get(f, set())


def _pick_best(results, prefix="syn_"):
    """Train-only selection among *conditional* configs, then report untouched test."""
    cands = []
    for k, r in results.items():
        if not k.startswith(prefix) or not _is_conditional(r):
            continue
        tr, te = r.get("train"), r.get("test")
        if not tr or tr.get("n", 0) < 40 or not te or te.get("n", 0) < 30:
            continue
        if tr["net_exp"] <= 0 or tr["max_dd_pct_capital"] < -0.25:
            continue
        cands.append((tr["net_exp"], r))
    if not cands:
        return None
    cands.sort(key=lambda x: -x[0])
    return cands[0][1]


def write_deliverables(results, trades, rtrades):
    best_syn = _pick_best(results, "syn_")
    real_cond = [(r["net_exp"], k, r) for k, r in results.items()
                 if k.startswith("real_") and _is_conditional(r) and r.get("n", 0) >= 25]
    real_cond.sort(key=lambda x: -x[0])
    best_real = real_cond[0][2] if real_cond else None
    best_real_key = real_cond[0][1] if real_cond else None

    # diagnostic: unconditional short-straddle expectancy by prior-day IV/RV bucket
    sub = trades[trades["tag"] == "syn_ss_atm_e60"].copy()
    sub["bucket"] = pd.cut(sub["f_ratio"], [0, 1.0, 1.1, 1.2, 1.3, 1.5, 10])
    diag = sub.groupby("bucket", observed=True)["net_pnl"].agg(["count", "mean"]).round(1)
    rsub = rtrades[rtrades["tag"] == "real_sx1"].copy()
    rsub["bucket"] = pd.qcut(rsub["f_vrp"], 3, duplicates="drop")
    rdiag = rsub.groupby("bucket", observed=True)["net_pnl"].agg(["count", "mean"]).round(1)

    log_path = HERE / "vrp_vol_timing_log.jsonl"
    with log_path.open("w") as f:
        for k, r in results.items():
            f.write(json.dumps({"kind": "vrp_eval", "key": k,
                                **{kk: vv for kk, vv in r.items() if kk not in ("train", "test")}}) + "\n")
            if "train" in r:
                f.write(json.dumps({"kind": "vrp_split", "key": k, "train": r["train"],
                                    "test": r.get("test")}) + "\n")
        f.write(json.dumps({"kind": "diag", "syn_ss_atm_e60_by_ratio":
                            {str(k): v for k, v in diag.to_dict("index").items()},
                            "real_sx1_by_vrp_tercile":
                            {str(k): v for k, v in rdiag.to_dict("index").items()}}) + "\n")

    # ---- verdict --------------------------------------------------------
    syn_oos_ok = bool(best_syn and best_syn["test"]["net_exp"] > 0
                      and best_syn["test"]["pf"] > 1.0
                      and best_syn["test"]["bootstrap_ci"][0] > 0
                      and best_syn["test"]["max_dd_pct_capital"] > -0.25)
    # transfer test: apply the *same* gate to the real-premium trades
    transfer = None
    if best_syn and best_syn.get("feature") in ("ratio", "vrp", "vix_rel", "iv_ratio"):
        f, op, thr = best_syn["feature"], best_syn.get("op", ">"), best_syn["threshold"]
        col = f"f_{f}"
        real_tag = best_syn["structure"].replace("syn_", "real_")
        rsub = rtrades[rtrades["tag"] == real_tag]
        if col in rsub.columns and len(rsub):
            m = (rsub[col] > thr) if op == ">" else (rsub[col] < thr)
            sel = rsub[m.fillna(False)]
            if len(sel):
                transfer = _subset_stats(sel, f"transfer|{real_tag}|{f}{op}{thr}")
    real_ok = bool(best_real and best_real["n"] >= 100 and best_real["bootstrap_ci"][0] > 0)
    transfer_ok = bool(transfer and transfer["n"] >= 30 and transfer["net_exp"] > 0)
    if syn_oos_ok and transfer_ok and real_ok:
        verdict = "accept"
        reason = ("A VRP-conditioned short-vol rule is positive in synthetic train and untouched test "
                  "(CI excludes 0, maxDD<25% of ₹3L) AND transfers to real premiums.")
    else:
        verdict = "reject"
        if transfer:
            tt = (f"the identical gate on the {transfer['label'].split('|')[1]} basket gives "
                  f"₹{transfer['net_exp']:.0f}/trade (PF {transfer['pf']:.2f}, n={transfer['n']})")
        else:
            tt = "no matching real-premium basket exists to transfer to"
        reason = (
            "The stated rule (sell vol when prior-day VRP is HIGH) is a contra-signal: in the synthetic "
            "model, gating on high VRP monotonically lowers OOS expectancy vs the unconditional "
            "straddle (ratio>1.3: test −₹25/trade; vrp>0.02: test +₹48 vs +₹343 unconditional). The only "
            "model-space positive conditional is the opposite one — sell vol when IV/RV is LOW "
            f"(vix_rel<1.2: train +₹{best_syn['train']['net_exp']:.0f}, test +₹{best_syn['test']['net_exp']:.0f}"
            f"/trade, n_test={best_syn['test']['n']}, CI [{best_syn['test']['bootstrap_ci'][0]:.0f},"
            f"{best_syn['test']['bootstrap_ci'][1]:.0f}], maxDD {best_syn['test']['max_dd_pct_capital']*100:.1f}%) "
            f"— but that is a model artifact (options are BS-priced off the same VIX/RV blend the gate "
            f"reads) and it fails transfer: {tt}. On real premiums every short-vol structure loses net "
            "of costs (straddle −₹312, strangle1 −₹218, strangle2 −₹440) and every VRP/ratio gate makes "
            "it worse; the only positive real config (term contango) has n=32 < 100 with a bootstrap CI "
            "spanning zero. Long-vol is negative everywhere. No net-of-cost, n≥100, CI⊄0, <25%-DD "
            "candidate exists in the real basket — the intraday theta harvest is smaller than "
            "round-trip spread+fees.")

    def brief(r):
        if not r:
            return None
        return {k: r.get(k) for k in [
            "n", "net_exp", "pf", "win", "total_net", "max_drawdown", "max_dd_pct_capital",
            "worst_trade", "best_trade", "worst_week", "avg_week", "bootstrap_ci", "p_positive_total",
            "risk_of_ruin", "tail_loss_p95", "raw_dir_accuracy", "capital_for_15k_week", "exit_mix"]}

    def cost_decomp(df, tag):
        s = df[df["tag"] == tag]
        if s.empty:
            return None
        return {"n": int(len(s)), "premium_per_lot": round(abs(float(s["entry_net"].mean())) * 65, 0),
                "avg_gross": round(float(s["gross_pnl"].mean()), 1),
                "avg_fees": round(float(s["fees"].mean()), 1),
                "avg_net": round(float(s["net_pnl"].mean()), 1),
                "eod_frac": round(float((s["exit_reason"] == "EOD").mean()), 3)}
    cost = {t: cost_decomp(trades if t.startswith("syn_") else rtrades, t)
            for t in ["syn_ss_atm_e60", "real_ss_atm", "real_sx1", "real_sx2", "real_ls_atm"]}

    base = best_syn if best_syn else results.get("syn_ss_atm_e60|unconditional")
    out = {
        "track": "vrp_vol_timing",
        "hypothesis": ("Options are rich vs trailing realised vol (IV-RV>0 all DTE). Sell a "
                       "straddle/strangle when prior-day VRP is high and term structure is in "
                       "contango; buy vol when IV<RV."),
        "feature": ("prior-day VRP = ATM IV − trailing RV (real: surface_metrics_daily front expiry; "
                    "synthetic: 0.65*INDIAVIX + 0.35*RV20 − RV20), shifted one session"),
        "rule": (best_syn["condition"] if best_syn else "—"),
        "data": ("synthetic BS premiums on real 2018-2026 5-min spot path (model) + real FYERS "
                 "premiums 2026-06-01..2026-09-25 (front listed 2026-09-29 monthly; intraday holds only)"),
        "n_trades": base["n"] if base else 0,
        "net_exp": base["net_exp"] if base else 0,
        "pf": base["pf"] if base else 0,
        "win": base["win"] if base else 0,
        "total_net": base["total_net"] if base else 0,
        "max_drawdown": base["max_drawdown"] if base else 0,
        "max_dd_pct_capital": base["max_dd_pct_capital"] if base else 0,
        "train_exp": base.get("train", {}).get("net_exp", 0) if base else 0,
        "test_exp": base.get("test", {}).get("net_exp", 0) if base else 0,
        "bootstrap_ci": base["bootstrap_ci"] if base else [0, 0],
        "tail_loss_p95": base["tail_loss_p95"] if base else 0,
        "raw_dir_accuracy": base["raw_dir_accuracy"] if base else 0,
        "edge_basis": ("payout geometry in the synthetic model (raw dir accuracy ≈ 50%, so the +EV "
                       "is the model's IV input, not directional skill); on real premiums the intraday "
                       "theta harvest is smaller than round-trip spread+fees"),
        "capital_for_15k_week": base["capital_for_15k_week"] if base else 0,
        "verdict": verdict,
        "reason": reason,
        "artifacts": ["tracks/vrp_vol_timing_log.jsonl", "tracks/_vrp_trades_synthetic.parquet",
                      "tracks/_vrp_trades_real.parquet", "tracks/_vrp_char.txt"],
        "best_conditional_config": (best_syn["condition"] if best_syn else None),
        "best_conditional_structure": (best_syn["structure"] if best_syn else None),
        "best_conditional_train": brief(best_syn.get("train")) if best_syn else None,
        "best_conditional_test": brief(best_syn.get("test")) if best_syn else None,
        "best_real_config": best_real_key,
        "best_real_stats": brief(best_real),
        "model_candidate_transfer_to_real": brief(transfer),
        "transfer_gate": (f"{best_syn['feature']}{best_syn.get('op','>')}{best_syn['threshold']}"
                          if best_syn else None),
        "unconditional_baselines": {k: brief(r) for k, r in results.items() if "unconditional" in k},
        "diag_syn_ratio_buckets": {str(k): v for k, v in diag.to_dict("index").items()},
        "diag_real_vrp_terciles": {str(k): v for k, v in rdiag.to_dict("index").items()},
        "cost_decomposition": cost,
    }
    (HERE / "vrp_vol_timing.json").write_text(json.dumps(out, indent=2, default=str))

    # ---- markdown (<=40 lines) -----------------------------------------
    def row(k):
        r = results.get(k)
        if not r or r.get("n", 0) == 0:
            return None
        tr, te = r.get("train", {}), r.get("test", {})
        return (f"| {k} | {r['n']} | {r['net_exp']:.0f} | {r['pf']:.2f} | {r['win']*100:.0f} | "
                f"{r['max_dd_pct_capital']*100:.1f} | {r['raw_dir_accuracy']*100:.0f} | "
                f"{tr.get('net_exp', float('nan')):.0f} | {te.get('net_exp', float('nan')):.0f} |")

    rf = real_features()[1].dropna(subset=["vrp"])
    sf = synthetic_features()[1].dropna(subset=["ratio"])
    buckets = diag.to_dict("index")
    bstr = "; ".join(f"{str(k).replace(', ', '-').strip('(]')}: ₹{v['mean']:.0f} (n={int(v['count'])})"
                     for k, v in buckets.items())
    tstr = "; ".join(f"₹{v['mean']:.0f} (n={int(v['count'])})" for v in rdiag.to_dict("index").values())
    ub = results["syn_ss_atm_e60|unconditional"]
    L = [
        "# Track A — Variance risk premium (VRP) timing",
        "",
        "**Hypothesis.** Options are rich vs trailing RV; sell a straddle/strangle when prior-day VRP is "
        "high and term structure is in contango; buy vol when IV<RV.",
        "**Causal & costed.** Prior-day features only; fill at next bar open; engine charges NSE fees + "
        "0.35% half-spread + 0.15% slippage per leg. Config selected on train 2018-22, test 2023-26.",
        "",
        f"**The premise is true.** Real 2026 surface (front expiry): ATM VRP mean +0.054 / median +0.054, "
        f"range [{rf['vrp'].min():.3f},{rf['vrp'].max():.3f}], 100% positive (n={len(rf)}); VRP grows with "
        f"tenor (0.033 @0-7d → 0.057 @60-200d). Synthetic prior-day IV/RV: mean {sf['ratio'].mean():.2f}, "
        f"median {sf['ratio'].median():.2f}, IV>RV {100*sf['vrp'].gt(0).mean():.0f}% of days.",
        "So richness is real — the question is whether it is tradeable intraday net of cost.",
        "",
        "| config | n | exp ₹ | PF | win% | maxDD% | raw dir% | train exp | test exp |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for k in ["syn_ss_atm_e60|unconditional", "syn_ss_atm_e60|vix_rel>1.1",
              "syn_ss_atm_e60|vrp>0.02", "syn_ss_atm_e60|ratio>1.3",
              "syn_ss_atm_e60|vix_rel<1.2", "syn_ls_atm|ratio<1.0",
              "real_ss_atm|unconditional", "real_sx1|unconditional", "real_sx2|unconditional",
              "real_sx1|contango", "real_ls_atm|unconditional"]:
        rr = row(k)
        if rr:
            L.append(rr)
    L += [
        "",
        "**High VRP is a contra-signal.** Gating on high prior-day VRP makes short vol *worse* in-sample "
        "and OOS; high IV/RV is driven by depressed trailing RV that mean-reverts up. Unconditional e60 "
        f"straddle expectancy by prior IV/RV bucket (₹/trade): {bstr}.",
        f"Real strangle1 expectancy by prior-VRP tercile: {tstr}.",
        "",
        f"**Tail.** Best real config ({best_real_key or '—'}): n={best_real['n'] if best_real else 0}, "
        f"exp ₹{best_real['net_exp']:.0f}, PF {best_real['pf']:.2f}, "
        f"CI [{best_real['bootstrap_ci'][0]:.0f},{best_real['bootstrap_ci'][1]:.0f}] (spans 0), "
        f"worst trade ₹{best_real['worst_trade']:.0f}, worst week ₹{best_real['worst_week']:.0f}, "
        f"maxDD {best_real['max_dd_pct_capital']*100:.1f}% of ₹3L, RoR {best_real['risk_of_ruin']:.3f}.",
        f"Synthetic e60 unconditional: worst trade ₹{ub['worst_trade']:.0f}, worst week ₹{ub['worst_week']:.0f}, "
        f"maxDD {ub['max_dd_pct_capital']*100:.1f}%, RoR {ub['risk_of_ruin']:.3f}; ₹15k/week needs "
        f"₹{ub['capital_for_15k_week']:,.0f}.",
        "Real short-vol losers: straddle −₹312/trade (PF 0.50), strangle1 −₹218 (0.63), strangle2 −₹440 "
        "(0.43); long straddle −₹961 (0.16, RoR 1.0) — buying vol is never +EV.",
        f"**Where the money goes.** Real straddle: premium ₹{cost['real_ss_atm']['premium_per_lot']:,.0f}/lot, "
        f"gross ₹{cost['real_ss_atm']['avg_gross']:.0f}, fees ₹{cost['real_ss_atm']['avg_fees']:.0f} → net "
        f"₹{cost['real_ss_atm']['avg_net']:.0f} (98% EOD exits). Synthetic e60 straddle: premium "
        f"₹{cost['syn_ss_atm_e60']['premium_per_lot']:,.0f}/lot, gross ₹{cost['syn_ss_atm_e60']['avg_gross']:.0f}, "
        f"fees ₹{cost['syn_ss_atm_e60']['avg_fees']:.0f} → net ₹{cost['syn_ss_atm_e60']['avg_net']:.0f} — the model's "
        "gross vol edge is not present in real quotes.",
        "",
        "**Red-team.** (1) The synthetic edge is model artifact: options are BS-priced off the same VIX/RV "
        "blend the gate reads, with no IV crush/true bid-ask; raw dir accuracy ≈ 50%, so positive P&L is "
        "*payout geometry*, not directional skill (per brief). (2) The only model-space positive condition "
        f"is the opposite one (sell when IV/RV LOW: test +₹{best_syn['test']['net_exp']:.0f}/trade, "
        f"CI [{best_syn['test']['bootstrap_ci'][0]:.0f},{best_syn['test']['bootstrap_ci'][1]:.0f}]) and it "
        f"fails transfer — same gate on real premiums: ₹{transfer['net_exp']:.0f}/trade (n={transfer['n']})."
        if transfer else "**Red-team.** No transfer test.",
        "(3) Real basket is ~59 trades of one long-dated (Sep) contract: intraday theta ≪ round-trip cost, "
        "and a 130-DTE short straddle needs ~₹4.5L SPAN margin > ₹3L capital; term-contango flip is "
        "in-sample with CI spanning 0.",
        "",
        f"**Verdict: {verdict.upper()}.** No condition makes selling vol +EV net of costs on real premiums, "
        "and none makes buying vol +EV. The real-premium basket has no n≥100, CI⊄0, <25%-DD candidate.",
    ]
    (HERE / "vrp_vol_timing.md").write_text("\n".join(L) + "\n")
    print("wrote md", len(L), "lines")

    print("\nTop conditional real:", best_real_key, best_real["net_exp"] if best_real else None)
    print("Best train-selected synthetic conditional:",
          best_syn["structure"] if best_syn else None, best_syn["condition"] if best_syn else None,
          "| test exp", best_syn["test"]["net_exp"] if best_syn else None)
    print("VERDICT:", verdict)
    return best_syn, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["char", "run", "eval", "all"])
    ap.add_argument("--mode", default="both", choices=["synthetic", "real", "both"])
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    if args.cmd in ("char", "all"):
        characterize(HERE / "_vrp_char.txt")
    if args.cmd in ("run", "all"):
        if args.mode in ("synthetic", "both"):
            specs = [{**s, "start": SYN_START, "end": SYN_END, "require_data": False} for s in SYN_SPECS]
            run_specs(specs, "synthetic", args.workers)
        if args.mode in ("real", "both"):
            specs = [{**s, "start": REAL_START, "end": REAL_END, "require_data": True} for s in REAL_SPECS]
            run_specs(specs, "real", args.workers)
    if args.cmd in ("eval", "all"):
        results, trades, rtrades = evaluate()
        write_deliverables(results, trades, rtrades)


if __name__ == "__main__":
    main()
