"""Autoresearch benchmark: SMC engine PF on TRAIN vs HELD-OUT tick sessions.

Config via env (loop changes config without code edits for parametric ideas):
  SMC_MIN_RR, SMC_COOLDOWN, SMC_ENTRIES (both|inv|retest), SMC_TP_MODE (far|near),
  SMC_PARTIALS (0/1), SMC_TIEBREAK (0/1), SMC_FLIP (margin, empty=off),
  SMC_MAX_ZONE_DIST (empty=off), SMC_REV_EXIT (0/1), SMC_DIVIDED (0/1), SMC_DEDUPE (0/1)

Primary metric: pf_test (held-out sessions) — higher better.
Prints METRIC name=value lines for autoresearch.sh.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from scripts.smc_tick_eval import fetch_ticks, build_1m_bars
from trading.smc_ifvg import SMCIFVGEngine

TRAIN = ["2026-07-02", "2026-07-22", "2026-07-24", "2026-08-26"]
TEST = ["2026-07-10", "2026-09-02"]


def envf(name, default=None):
    v = os.environ.get(name)
    return float(v) if v not in (None, "") else default


def envi(name, default=None):
    v = os.environ.get(name)
    return int(v) if v not in (None, "") else default


def engine_kwargs():
    kw = {}
    if envf("SMC_MIN_RR") is not None:
        kw["min_rr"] = envf("SMC_MIN_RR")
    if envi("SMC_COOLDOWN") is not None:
        kw["cooldown"] = envi("SMC_COOLDOWN")
    if os.environ.get("SMC_ENTRIES"):
        kw["entries"] = os.environ["SMC_ENTRIES"]
    if os.environ.get("SMC_TP_MODE"):
        kw["tp_mode"] = os.environ["SMC_TP_MODE"]
    if os.environ.get("SMC_PARTIALS") == "1":
        kw["partials"] = True
    if os.environ.get("SMC_TIEBREAK") == "1":
        kw["__tiebreak"] = True  # handled by caller if supported
    if envf("SMC_FLIP") is not None:
        kw["inv_flip_margin"] = envf("SMC_FLIP")
    if envf("SMC_MAX_ZONE_DIST") is not None:
        kw["max_zone_dist"] = envf("SMC_MAX_ZONE_DIST")
    if os.environ.get("SMC_REV_EXIT") == "1":
        kw["rev_exit"] = True
    if os.environ.get("SMC_SESS"):
        a, z = os.environ["SMC_SESS"].split("-")
        ah, am = map(int, a.split(":")); zh, zm = map(int, z.split(":"))
        kw["sess_start"] = ah * 60 + am; kw["sess_end"] = zh * 60 + zm
    if envf("SMC_ATR_MIN") is not None:
        kw["atr_min"] = envf("SMC_ATR_MIN")
    if envf("SMC_DAY_STOP") is not None:
        kw["day_stop_pts"] = envf("SMC_DAY_STOP")
    if envi("SMC_ZONE_AGE") is not None:
        kw["max_zone_age"] = envi("SMC_ZONE_AGE")
    if envf("SMC_DISP_R") is not None:
        kw["min_displacement_r"] = envf("SMC_DISP_R")
    if os.environ.get("SMC_DAILY_BIAS") == "1":
        from scripts.htf_bias import bias_map
        kw["_bias_map"] = bias_map(TRAIN + TEST)
    return kw


def run_dates(dates, kw, divided, dedupe):
    trades = []
    bias_map = kw.get("_bias_map", None)
    base = {k: v for k, v in kw.items() if k != "_bias_map"}
    for d in dates:
        ticks = fetch_ticks(d)
        bars = build_1m_bars(ticks)
        dk = dict(base)
        if bias_map is not None:
            dk["session_date"] = d
            dk["daily_bias"] = bias_map
        if divided:
            shared = {"fills": []} if dedupe else None
            for mode in ("inv", "retest"):
                trades.extend(SMCIFVGEngine(entries=mode, shared=shared, **dk).run(bars, ticks))
        else:
            trades.extend(SMCIFVGEngine(**dk).run(bars, ticks))
    return trades


def stats(trades):
    gp = sum(t["pnl"] for t in trades if t["pnl"] > 0)
    gl = abs(sum(t["pnl"] for t in trades if t["pnl"] <= 0))
    n = len(trades)
    w = sum(1 for t in trades if t["pnl"] > 0)
    pf = gp / gl if gl else (99.0 if gp > 0 else 0.0)
    return {"pf": round(pf, 3), "net": round(gp - gl, 2), "n": n, "win": w}


def main():
    kw = engine_kwargs()
    kw.pop("__tiebreak", None)  # tie-break lives only in the old script harness, not the module
    divided = os.environ.get("SMC_DIVIDED") == "1"
    dedupe = os.environ.get("SMC_DEDUPE") == "1"
    tr = stats(run_dates(TRAIN, kw, divided, dedupe))
    te = stats(run_dates(TEST, kw, divided, dedupe))
    print(f"METRIC pf_test={te['pf']}")
    print(f"METRIC pf_train={tr['pf']}")
    print(f"METRIC net_test={te['net']}")
    print(f"METRIC net_train={tr['net']}")
    print(f"METRIC trades_test={te['n']}")
    print(f"METRIC trades_train={tr['n']}")
    print(f"METRIC win_test={te['win']}")
    print(f"METRIC win_train={tr['win']}")


if __name__ == "__main__":
    main()
