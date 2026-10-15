"""Statistics for trade lists: distribution, drawdown, walk-forward, risk of ruin.

Everything is computed from realised per-trade net P&L (₹). Annualisation uses
the actual trade count, so a strategy with few trades is not flattered.
"""

from __future__ import annotations

import math
from datetime import date

import numpy as np
import pandas as pd


def summarize(net: np.ndarray, capital: float = 300_000.0) -> dict:
    net = np.asarray([x for x in net if x == x], dtype=float)
    n = len(net)
    if n == 0:
        return {"n": 0}
    wins = net[net > 0]
    losses = net[net < 0]
    gp, gl = wins.sum(), -losses.sum()
    cum = np.cumsum(net)
    peak = np.maximum.accumulate(cum)
    dd = cum - peak
    mean, sd = float(net.mean()), float(net.std(ddof=1)) if n > 1 else 0.0
    downside = net[net < 0]
    dsd = float(downside.std(ddof=1)) if len(downside) > 1 else 0.0
    # consecutive losses
    mc = cur = 0
    for x in net:
        cur = cur + 1 if x < 0 else 0
        mc = max(mc, cur)
    return {
        "n": n,
        "win_rate": float(len(wins) / n),
        "total_net": float(net.sum()),
        "avg_net": mean,
        "median_net": float(np.median(net)),
        "std_net": sd,
        "expectancy": mean,
        "profit_factor": float(gp / gl) if gl > 0 else float("inf"),
        "avg_win": float(wins.mean()) if len(wins) else 0.0,
        "avg_loss": float(losses.mean()) if len(losses) else 0.0,
        "payoff_ratio": (float(wins.mean() / -losses.mean()) if len(wins) and len(losses) else float("nan")),
        "best": float(net.max()),
        "worst": float(net.min()),
        "p05": float(np.percentile(net, 5)),
        "p95": float(np.percentile(net, 95)),
        "sharpe_per_trade": float(mean / sd) if sd > 0 else float("nan"),
        "sortino_per_trade": float(mean / dsd) if dsd > 0 else float("nan"),
        "max_drawdown": float(dd.min()) if len(dd) else 0.0,
        "max_consecutive_losses": mc,
        "return_on_capital": float(net.sum() / capital),
    }


def bootstrap(net: np.ndarray, capital: float = 300_000.0, n_boot: int = 5000,
              seed: int = 7) -> dict:
    """Bootstrap 90% CI for per-trade expectancy and total P&L."""
    net = np.asarray(net, dtype=float)
    if len(net) < 5:
        return {"ci_low_mean": float("nan"), "ci_high_mean": float("nan"),
                "p_positive_total": float("nan")}
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(net), size=(n_boot, len(net)))
    means = net[idx].mean(axis=1)
    totals = net[idx].sum(axis=1)
    return {
        "ci_low_mean": float(np.percentile(means, 5)),
        "ci_high_mean": float(np.percentile(means, 95)),
        "p_positive_total": float((totals > 0).mean()),
        "ci_low_total": float(np.percentile(totals, 5)),
        "ci_high_total": float(np.percentile(totals, 95)),
    }


def weekly(net: np.ndarray, dates: list, capital: float = 300_000.0) -> dict:
    """Weekly aggregation (ISO week) of net P&L."""
    if not len(net):
        return {"n_weeks": 0}
    df = pd.DataFrame({"date": pd.to_datetime(dates), "net": net})
    df["week"] = df["date"].dt.isocalendar().week.astype(int)
    df["year"] = df["date"].dt.isocalendar().year.astype(int)
    g = df.groupby(["year", "week"])["net"].sum()
    return {
        "n_weeks": int(len(g)),
        "avg_week": float(g.mean()),
        "median_week": float(g.median()),
        "std_week": float(g.std(ddof=1)) if len(g) > 1 else 0.0,
        "best_week": float(g.max()),
        "worst_week": float(g.min()),
        "prob_positive_week": float((g > 0).mean()),
        "prob_negative_week": float((g < 0).mean()),
        "weeks_to_target_15k": float((g >= 15_000).mean()),
        "target_15k_avg_capital": _capital_for_target(g, 15_000),
    }


def _capital_for_target(weekly_pnl: pd.Series, target: float, base_capital: float = 300_000.0) -> float:
    """Scale capital linearly so the *mean* week hits the target (risk unchanged)."""
    m = float(weekly_pnl.mean())
    if m <= 0:
        return float("inf")
    return base_capital * target / m


def risk_of_ruin(net: np.ndarray, capital: float, ruin_frac: float = 0.5,
                 horizon_days: int = 250, n_sims: int = 10_000, seed: int = 11) -> float:
    """Monte-Carlo: P(equity falls below ruin_frac×capital at any point)."""
    net = np.asarray(net, dtype=float)
    if len(net) == 0:
        return float("nan")
    rng = np.random.default_rng(seed)
    ruin_level = capital * (1 - ruin_frac)
    hits = 0
    draws = net[rng.integers(0, len(net), size=(n_sims, horizon_days))]
    eq = capital + np.cumsum(draws, axis=1)
    hits = int((eq.min(axis=1) <= ruin_level).sum())
    return hits / n_sims


def walk_forward(trades: list, n_folds: int = 5) -> list[dict]:
    """Chronological folds: report each fold's stats (test = unseen fold)."""
    if len(trades) < 20:
        return []
    ordered = sorted(trades, key=lambda t: t.entry_ts)
    size = len(ordered) // n_folds
    out = []
    for k in range(n_folds):
        seg = ordered[k * size:(k + 1) * size] if k < n_folds - 1 else ordered[k * size:]
        net = np.array([t.net_pnl for t in seg])
        s = summarize(net)
        out.append({"fold": k + 1,
                    "period": f"{seg[0].entry_ts.date()}..{seg[-1].entry_ts.date()}",
                    "n": len(net), "total": float(net.sum()),
                    "expectancy": s.get("avg_net", 0.0),
                    "win_rate": s.get("win_rate", 0.0),
                    "profit_factor": s.get("profit_factor", float("nan"))})
    return out
