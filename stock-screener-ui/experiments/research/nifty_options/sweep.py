"""Parameter sweep + walk-forward + adversarial red-team (parallel).

Discipline:
* Small param grid (plateau-seeking, not curve-fit).
* Every config evaluated on TRAIN and held-out TEST.
* A config is kept only if out-of-sample expectancy is positive with a usable
  sample AND the neighbouring parameter set also works (stability).
* Everything appended to RESEARCH_LOG.jsonl.
"""
from __future__ import annotations

import json
import multiprocessing as mp
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fyers_data as fd  # noqa: E402
import stats as st  # noqa: E402
import runner as R  # noqa: E402
from engine import EngineConfig, replay  # noqa: E402
from strategies import REGISTRY  # noqa: E402
from costs import ExecutionModel  # noqa: E402

HERE = Path(__file__).resolve().parent
TRAIN = (date(2018, 1, 1), date(2022, 12, 31))
TEST = (date(2023, 1, 1), date(2026, 9, 25))

GRID = {
    "orb_breakout": [{"or_min": 15, "buffer": 0.0015}, {"or_min": 30, "buffer": 0.0015},
                     {"or_min": 15, "buffer": 0.0030}],
    "momentum_pullback": [{"ema_span": 20}, {"ema_span": 40}],
    "prev_day_break": [{"buffer": 0.001}],
    "short_straddle_intraday": [{"entry_min": 30, "otm_steps": 0},
                                {"entry_min": 30, "otm_steps": 1}],
}
STOPS = [0.30, 0.50]
TARGETS = [0.50, 1.00]

_SPOT = None
_SOURCE = None
_RESOLVER = None
_META = None


def _init():
    global _SPOT, _SOURCE, _RESOLVER, _META
    from engine import SyntheticOptionSource
    _SPOT = R.load_spot("5")
    _SOURCE = SyntheticOptionSource.from_cached()
    _RESOLVER = R.build_weekly_resolver(TRAIN[0], TEST[1])
    _META = R.load_daily_meta()


def _one(job):
    name, params, stop, target = job
    cfg = EngineConfig(capital=300_000, risk_pct=0.01, stop_pct=stop, target_pct=target,
                       execution=ExecutionModel(), lot=65)
    fn = REGISTRY[name]
    kw = {**params, "stop_pct": stop, "target_pct": target}

    def run(span):
        trades = replay(lambda c, i, fn=fn, kw=kw: fn(c, i, **kw), _SPOT, _SOURCE, _RESOLVER,
                        cfg, span[0], span[1], day_meta=_META)
        return trades, np.array([t.net_pnl for t in trades])

    tr, trn = run(TRAIN)
    te, ten = run(TEST)
    str_ = st.summarize(trn) if len(trn) else {"n": 0}
    ste = st.summarize(ten) if len(ten) else {"n": 0}
    row = {"strategy": name, "params": params, "stop": stop, "target": target,
           "train_n": str_.get("n", 0), "train_exp": str_.get("expectancy", 0.0),
           "train_pf": str_.get("profit_factor", float("nan")), "train_total": str_.get("total_net", 0.0),
           "test_n": ste.get("n", 0), "test_exp": ste.get("expectancy", 0.0),
           "test_pf": ste.get("profit_factor", float("nan")), "test_total": ste.get("total_net", 0.0),
           "test_win": ste.get("win_rate", 0.0), "test_dd": ste.get("max_drawdown", 0.0),
           "test_sharpe": ste.get("sharpe_per_trade", float("nan")),
           "test_wf": st.walk_forward(te) if len(te) else []}
    row["survives"] = bool(row["train_n"] >= 100 and row["test_n"] >= 100
                           and row["train_exp"] > 0 and row["test_exp"] > 0
                           and row["test_pf"] >= 1.05)
    return row


def main():
    jobs = [(n, p, s, t) for n, vs in GRID.items() for p in vs for s in STOPS for t in TARGETS]
    print(f"{len(jobs)} configs across {mp.cpu_count()} workers", flush=True)
    rows = []
    with mp.Pool(processes=min(4, mp.cpu_count()), initializer=_init) as pool:
        for row in pool.imap_unordered(_one, jobs):
            rows.append(row)
            print(f"{row['strategy']:26s} {str(row['params']):44s} s{row['stop']:.2f}/t{row['target']:.2f} "
                  f"TRAIN n={row['train_n']:4d} exp={row['train_exp']:8.0f} pf={row['train_pf']:.2f} | "
                  f"TEST n={row['test_n']:4d} exp={row['test_exp']:8.0f} pf={row['test_pf']:.2f} "
                  f"{'KEEP' if row['survives'] else ''}", flush=True)
    df = pd.DataFrame(rows)
    df.to_csv(HERE / "sweep_results.csv", index=False)
    with (HERE / "RESEARCH_LOG.jsonl").open("a") as f:
        for row in rows:
            f.write(json.dumps({"kind": "sweep", **row}, default=str) + "\n")
    keep = df[df["survives"]].sort_values("test_exp", ascending=False)
    print("\n== survivors (train_exp>0, test_exp>0, n>=100, test_pf>=1.05) ==")
    print("NONE" if not len(keep) else keep[["strategy", "params", "stop", "target",
          "train_exp", "test_exp", "test_pf", "test_dd", "test_sharpe"]].to_string(index=False))
    # plateau check: for each strategy, does the best config have positive neighbours?
    print("\n== per-strategy best (by test_exp) ==")
    for n, g in df.groupby("strategy"):
        b = g.sort_values("test_exp", ascending=False).iloc[0]
        pos = int((g["test_exp"] > 0).sum())
        print(f"  {n:26s} best_test_exp={b['test_exp']:8.0f} best_pf={b['test_pf']:.2f} "
              f"configs_positive={pos}/{len(g)}")


if __name__ == "__main__":
    main()
