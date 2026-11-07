#!/usr/bin/env python3
"""What precedes a NIFTY momentum burst? Empirical study on the recorded tape.

Read-only research over ``experiments/data/nifty_tape/<date>.jsonl`` (1 row/min:
spot, cumulative option volume/OI, PCR, walls, max pain, GEX). No lookahead:
every feature at minute *t* uses data available at *t*; targets use only
``t+1 .. t+H``.

Targets
-------
* ``fwd15_rng``  — max-min of spot over the next 15 minutes (tradeable range).
* ``fwd15_abs``  — |spot(t+15) - spot(t)| (net displacement).
* ``fwd15_eff``  — displacement / range (1 = clean trend, 0 = round trip).
* ``burst``      — ``fwd15_rng >= 25`` pts (the headline event).
* ``trend``      — ``fwd15_rng >= 20`` and ``eff >= 0.6`` (clean, tradeable).

Features
--------
expansion5/15, volume ratio (per-minute option volume vs its 20-min median),
5/10-min displacement, ATR14, distance from the 30-min TWAP, distance to the
nearest OI wall, PCR change, GEX sign, RSI14, time of day.

Run:
    .venv/bin/python scripts/market/nifty_momentum_study.py
    .venv/bin/python scripts/market/nifty_momentum_study.py --horizon 15 --event-rng 25
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

ROOT = pathlib.Path(__file__).resolve().parents[2]
TAPE_DIR = ROOT / "experiments" / "data" / "nifty_tape"
OUT_DIR = ROOT / "reports" / "momentum_study"
IST = "Asia/Kolkata"


def load_day(path: pathlib.Path) -> pd.DataFrame:
    rows = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    df = pd.DataFrame(rows)
    if df.empty or "spot" not in df:
        return pd.DataFrame()
    df["t"] = pd.to_datetime(df["t"], utc=True).dt.tz_convert(IST)
    df = df.sort_values("t").drop_duplicates("t").set_index("t")
    # The recorder polls at ~60s but with sub-second jitter; snap to the minute
    # so the reindexed grid actually matches the rows.
    df.index = df.index.floor("min")
    df = df[~df.index.duplicated(keep="last")]
    keep = [
        c
        for c in (
            "spot", "ce_vol", "pe_vol", "ce_oi", "pe_oi", "pcr_oi",
            "net_gex", "max_pain", "walls", "atm_strike",
            "atm_ce_ltp", "atm_pe_ltp",
        )
        if c in df.columns
    ]
    df = df[keep]
    # One row per minute; keep gaps visible so we can reject gappy forward windows.
    full = pd.date_range(df.index.min(), df.index.max(), freq="1min")
    df = df.reindex(full)
    df.index.name = "t"
    df["missing"] = df["spot"].isna().astype(int)
    df["spot"] = df["spot"].ffill(limit=3)
    for col in ("ce_vol", "pe_vol", "ce_oi", "pe_oi", "pcr_oi", "net_gex"):
        if col in df:
            df[col] = df[col].ffill(limit=5)
    df["date"] = df.index.date
    # Session filter.
    mins = df.index.hour * 60 + df.index.minute
    return df[(mins >= 9 * 60 + 15) & (mins <= 15 * 60 + 29)].copy()


def wall_distances(df: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    up, dn = [], []
    for walls, spot in zip(df.get("walls"), df["spot"]):
        u = d = np.nan
        if isinstance(walls, dict) and spot and np.isfinite(spot):
            calls = [w for w in walls.get("calls") or [] if w.get("distance") is not None]
            puts = [w for w in walls.get("puts") or [] if w.get("distance") is not None]
            ups = [float(w["distance"]) for w in calls if float(w["distance"]) >= 0]
            dns = [abs(float(w["distance"])) for w in puts if float(w["distance"]) <= 0]
            u = min(ups) if ups else np.nan
            d = min(dns) if dns else np.nan
        up.append(u)
        dn.append(d)
    return pd.Series(up, index=df.index), pd.Series(dn, index=df.index)


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    diff = close.diff()
    gain = diff.clip(lower=0).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    loss = (-diff.clip(upper=0)).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def add_features(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    spot = out["spot"]
    out["ret"] = spot.diff()
    out["absret"] = out["ret"].abs()
    out["atr14"] = out["absret"].rolling(14, min_periods=10).mean()
    out["rng5"] = spot.rolling(5, min_periods=3).max() - spot.rolling(5, min_periods=3).min()
    out["rng15"] = spot.rolling(15, min_periods=8).max() - spot.rolling(15, min_periods=8).min()
    # Expansion vs the *prior* 30 minutes only (shift(1) kills lookahead).
    out["expansion5"] = out["rng5"] / out["rng5"].shift(1).rolling(30, min_periods=10).median()
    out["expansion15"] = out["rng15"] / out["rng15"].shift(1).rolling(30, min_periods=10).median()
    out["move5"] = (spot - spot.shift(5)).abs()
    out["move10"] = (spot - spot.shift(10)).abs()
    out["move5_atr"] = out["move5"] / out["atr14"]
    out["move10_atr"] = out["move10"] / out["atr14"]
    out["twap30"] = spot.rolling(30, min_periods=10).mean()
    out["twap_dist"] = spot - out["twap30"]
    out["twap_dist_atr"] = out["twap_dist"].abs() / out["atr14"]
    out["rsi14"] = rsi(spot)
    out["tod"] = out.index.hour * 60 + out.index.minute - (9 * 60 + 15)

    vol = out.get("ce_vol", pd.Series(index=out.index, dtype=float)) + out.get(
        "pe_vol", pd.Series(index=out.index, dtype=float)
    )
    out["vol_min"] = vol.diff().clip(lower=0)
    out["vol_ratio"] = out["vol_min"] / out["vol_min"].shift(1).rolling(20, min_periods=8).median()
    oi = out.get("ce_oi", pd.Series(index=out.index, dtype=float)) + out.get(
        "pe_oi", pd.Series(index=out.index, dtype=float)
    )
    out["oi_chg5"] = (oi - oi.shift(5)).abs() / 1e6
    out["pcr_chg5"] = out.get("pcr_oi", pd.Series(index=out.index, dtype=float)).diff(5)
    out["gex_neg"] = (out.get("net_gex", pd.Series(index=out.index, dtype=float)) < 0).astype(float)

    up, dn = wall_distances(out)
    out["wall_up_atr"] = up / out["atr14"]
    out["wall_dn_atr"] = dn / out["atr14"]
    return out


def add_targets(df: pd.DataFrame, horizon: int) -> pd.DataFrame:
    out = df.copy()
    spot = out["spot"]
    fwd = spot.shift(-1)
    out["fwd_rng"] = fwd.rolling(horizon, min_periods=horizon).max() - fwd.rolling(
        horizon, min_periods=horizon
    ).min()
    out["fwd_abs"] = (spot.shift(-horizon) - spot).abs()
    out["fwd_eff"] = out["fwd_abs"] / out["fwd_rng"].replace(0, np.nan)
    # Reject rows whose forward window has too many missing minutes.
    out["fwd_gap"] = out["missing"].shift(-1).rolling(horizon, min_periods=horizon).sum()
    return out


def decile_table(df: pd.DataFrame, feature: str, target: str, bins: int = 5) -> pd.DataFrame:
    d = df[[feature, target]].dropna()
    if len(d) < 50:
        return pd.DataFrame()
    try:
        d["bucket"] = pd.qcut(d[feature], bins, duplicates="drop")
    except ValueError:
        return pd.DataFrame()
    g = d.groupby("bucket", observed=True)[target].agg(["count", "mean"])
    g["event_rate"] = g["mean"]
    return g


def rule_stats(df: pd.DataFrame, mask: pd.Series, event: str) -> dict:
    d = df.dropna(subset=[event])
    sel = d[mask.reindex(d.index).fillna(False)]
    base = float(d[event].mean())
    if len(sel) == 0:
        return {"n": 0, "precision": 0.0, "recall": 0.0, "lift": 0.0, "base": base}
    precision = float(sel[event].mean())
    recall = float(sel[event].sum() / max(d[event].sum(), 1))
    return {
        "n": int(len(sel)),
        "precision": precision,
        "recall": recall,
        "lift": precision / base if base else 0.0,
        "base": base,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", type=int, default=15)
    ap.add_argument("--event-rng", type=float, default=25.0)
    ap.add_argument("--trend-rng", type=float, default=20.0)
    ap.add_argument("--trend-eff", type=float, default=0.6)
    ap.add_argument("--min-date", default="2026-10-14")
    ap.add_argument("--out", type=pathlib.Path, default=OUT_DIR)
    args = ap.parse_args(argv)

    frames = []
    for path in sorted(TAPE_DIR.glob("2026-*.jsonl")):
        if ".gaps." in path.name:
            continue
        if path.stem < args.min_date:
            continue
        day = load_day(path)
        if day.empty:
            continue
        frames.append(day)
    if not frames:
        print("no tape data found")
        return 1
    raw = pd.concat(frames).sort_index()
    raw = raw[~raw.index.duplicated(keep="first")]
    df = add_features(raw)
    df = df.replace([np.inf, -np.inf], np.nan)
    df = add_targets(df, args.horizon)
    df = df[(df["fwd_gap"] <= 2) & df["fwd_rng"].notna()].copy()
    df["burst"] = (df["fwd_rng"] >= args.event_rng).astype(float)
    df["trend"] = ((df["fwd_rng"] >= args.trend_rng) & (df["fwd_eff"] >= args.trend_eff)).astype(float)

    print(f"days={df['date'].nunique()}  rows={len(df)}  horizon={args.horizon}m")
    print(f"burst = fwd{args.horizon}m range >= {args.event_rng:g} pts: base rate {df['burst'].mean():.1%}")
    print(f"trend = range >= {args.trend_rng:g} and eff >= {args.trend_eff:g}: base rate {df['trend'].mean():.1%}")
    print("\nforward range quantiles: " + ", ".join(
        f"p{q}={df['fwd_rng'].quantile(q/100):.0f}" for q in (10, 25, 50, 75, 90)
    ))

    features = [
        "expansion5", "expansion15", "vol_ratio", "move5_atr", "move10_atr",
        "atr14", "twap_dist_atr", "wall_up_atr", "wall_dn_atr", "oi_chg5",
        "pcr_chg5", "rsi14", "tod", "gex_neg",
    ]
    print("\nAUC (predicting burst) / AUC (predicting trend):")
    aucs = {}
    for f in features:
        d = df[[f, "burst", "trend"]].dropna()
        if len(d) < 100 or d[f].nunique() < 5:
            continue
        a_burst = roc_auc_score(d["burst"], d[f])
        a_trend = roc_auc_score(d["trend"], d[f])
        aucs[f] = (a_burst, a_trend)
    for f, (ab, at) in sorted(aucs.items(), key=lambda kv: -abs(kv[1][0] - 0.5)):
        print(f"  {f:<16} burst {ab:.3f}   trend {at:.3f}")

    for f in ("expansion5", "vol_ratio", "move5_atr", "wall_up_atr", "tod"):
        g = decile_table(df, f, "burst")
        if g.empty:
            continue
        print(f"\n{f}: forward burst rate by quintile")
        for idx, row in g.iterrows():
            print(f"  {str(idx):<28} n={int(row['count']):>4}  burst={row['event_rate']:.1%}")

    # Simple, tradeable rules (no fitted weights).
    print("\nrules (burst):")
    rules = {
        "expansion5>=1.5": df["expansion5"] >= 1.5,
        "vol_ratio>=1.5": df["vol_ratio"] >= 1.5,
        "move5>=0.8*ATR": df["move5_atr"] >= 0.8,
        "exp>=1.5 & vol>=1.5": (df["expansion5"] >= 1.5) & (df["vol_ratio"] >= 1.5),
        "exp>=1.3 & move5>=0.7ATR": (df["expansion5"] >= 1.3) & (df["move5_atr"] >= 0.7),
        "exp>=1.5 & vol>=1.5 & near wall<=1ATR": (
            (df["expansion5"] >= 1.5)
            & (df["vol_ratio"] >= 1.5)
            & (df[["wall_up_atr", "wall_dn_atr"]].min(axis=1) <= 1.0)
        ),
        "exp<1.0 & vol<1.0 (quiet)": (df["expansion5"] < 1.0) & (df["vol_ratio"] < 1.0),
    }
    for name, mask in rules.items():
        s = rule_stats(df, mask, "burst")
        print(
            f"  {name:<40} n={s['n']:>4}  P={s['precision']:.1%}  "
            f"R={s['recall']:.1%}  lift={s['lift']:.2f}x"
        )

    # Day-by-day stability of the best simple rule.
    best_mask = (df["expansion5"] >= 1.5) & (df["vol_ratio"] >= 1.5)
    print("\nper-day base vs rule (burst):")
    for day, g in df.groupby("date"):
        m = best_mask.reindex(g.index).fillna(False)
        sel = g[m]
        rule_p = f"{sel['burst'].mean():.1%}" if len(sel) else "n/a"
        print(
            f"  {day}  rows={len(g):>3}  base={g['burst'].mean():.1%}  "
            f"rule_n={len(sel):>3}  rule_P={rule_p:>6}  "
            f"range_med={g['fwd_rng'].median():.0f}"
        )

    # Does expansion add anything beyond "the tape is already volatile"?
    print("\nexpansion5 >= 1.5, split by ATR quintile (burst rate):")
    atr_bucket = pd.qcut(df["atr14"], 5, duplicates="drop")
    for bucket, g in df.groupby(atr_bucket, observed=True):
        hot = g[g["expansion5"] >= 1.5]
        cold = g[g["expansion5"] < 1.5]
        print(
            f"  ATR {str(bucket):<18} n={len(g):>4}  "
            f"exp<1.5 {cold['burst'].mean():.1%} (n={len(cold)})  "
            f"exp>=1.5 {hot['burst'].mean():.1%} (n={len(hot)})"
        )

    # Direction: does a move continue? (This is what makes a burst tradeable.)
    spot = df["spot"]
    sig5 = np.sign(spot - spot.shift(5))
    fwd_dir = np.sign(spot.shift(-args.horizon) - spot)
    d = pd.DataFrame({"sig5": sig5, "fwd_dir": fwd_dir, "move5_atr": df["move5_atr"],
                      "expansion5": df["expansion5"]}).dropna()
    d = d[d["fwd_dir"] != 0]
    d["cont"] = (d["sig5"] == d["fwd_dir"]).astype(float)
    print(f"\ndirection: P(next {args.horizon}m direction == last 5m direction)")
    print(f"  all rows            n={len(d):>4}  continuation={d['cont'].mean():.1%}")
    for label, mask in (
        ("move5 >= 1 ATR", d["move5_atr"] >= 1.0),
        ("move5 >= 2 ATR", d["move5_atr"] >= 2.0),
        ("expansion5 >= 1.5", d["expansion5"] >= 1.5),
        ("move5>=1ATR & exp>=1.5", (d["move5_atr"] >= 1.0) & (d["expansion5"] >= 1.5)),
    ):
        sub = d[mask]
        print(f"  {label:<28} n={len(sub):>4}  continuation={sub['cont'].mean():.1%}" if len(sub) else f"  {label:<28} n=0")


    args.out.mkdir(parents=True, exist_ok=True)
    cols = ["spot", "atr14", "expansion5", "vol_ratio", "move5_atr", "wall_up_atr",
            "wall_dn_atr", "fwd_rng", "fwd_abs", "fwd_eff", "burst", "trend"]
    df[cols].to_csv(args.out / f"momentum_study_h{args.horizon}.csv")
    print(f"\nsaved -> {args.out / f'momentum_study_h{args.horizon}.csv'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
