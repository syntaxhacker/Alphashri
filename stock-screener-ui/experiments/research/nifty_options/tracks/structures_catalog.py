"""NIFTY option-structure catalogue — hold-to-expiry, costed, causal.

Owned by the "NIFTY structures" track.  It reuses the multi-day, hold-to-expiry
machinery from ``tracks/theta_harvest.py`` (one weekly cycle, settle at expiry
intrinsic, stop walked on the *daily* high/low) but generalises the payoff: any
list of legs (option type, side, strike offset, ratio, front/next expiry).

Structures
----------
short straddle / strangle / iron condor / iron fly (credit, short vol)
long straddle / strangle / long condor (debit, long vol)
bull call / bear put (debit verticals)
bull put / bear call (credit verticals)
ratio spread (1 ATM vs 2 OTM)
synthetic long / short (CE vs PE)
calendar / term-structure spread (front vs next expiry; only synthetic has two
cached synthetic expiries per date; real has 2026-09-29 vs 2026-10-06 etc.)

Causal rules (same as the kernel / theta_harvest)
-------------------------------------------------
* entry day from prior-day features only
* strikes from the entry fill spot (observable at fill time)
* fills at entry bar open + spread + slippage; NSE fees on every leg
* stop walked on the real daily high/low (conservative)
* settlement at intrinsic for expired legs; non-expired legs (calendar back
  month) marked at the settlement session with the causal IV.

CAVEAT (unchanged from theta_harvest): every cached real contract expires
*after* the data window (spot ends 2026-09-25; nearest real expiry 2026-09-29),
so nothing real settles at intrinsic — all real exits are ``MARK_END``.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
KERNEL = HERE.parent
sys.path.insert(0, str(KERNEL))

import fyers_data as fd  # noqa: E402
import runner as R  # noqa: E402
import stats as st  # noqa: E402
import pricing  # noqa: E402
from engine import (  # noqa: E402
    ExpiryResolver, Leg, RealOptionSource, SyntheticOptionSource,
    _leg_fills, has_data,
)
from costs import ExecutionModel, capital_for_structure, round_trip_costs  # noqa: E402
from theta_harvest import (  # noqa: E402
    load_market, _day_bars, _pick_entry_bar, evaluate,
)

STEP = 50
LOT = 65
CAPITAL = 300_000.0
EX = ExecutionModel()
SPLIT = date(2022, 12, 31)
LOG = HERE / "structures_catalog_log.jsonl"


# ---------------------------------------------------------------------------
# leg / structure specs
# ---------------------------------------------------------------------------
@dataclass
class SLeg:
    opt: str          # CE / PE
    side: str         # BUY / SELL
    off: int          # strike steps from ATM
    ratio: int = 1
    which: str = "front"   # front | next  (calendar legs)


def pct_steps(spot: float, pct: float) -> int:
    return max(1, int(round(pct * spot / STEP)))


# kind: naked_short (unbounded short risk -> margin sized), defined (bounded by
# width), debit (max loss = net debit), calendar (front/next; margin sized)
FAMS: list[dict] = []


def add(name, kind, legs_fn, width_steps=0, stop_kind=None):
    # stop_kind: credit (stop at N x credit), debit (stop at N x debit), both
    if stop_kind is None:
        stop_kind = "debit" if kind == "debit" else ("both" if kind == "calendar" else "credit")
    FAMS.append({"name": name, "kind": kind, "legs": legs_fn, "width": width_steps,
                 "stop_kind": stop_kind})


add("short_straddle", "naked_short", lambda s: [SLeg("CE", "SELL", 0), SLeg("PE", "SELL", 0)])
for pct, tag in ((0.005, "0.5pct"), (0.01, "1pct"), (0.02, "2pct")):
    add(f"short_strangle_{tag}", "naked_short",
        lambda s, p=pct: [SLeg("CE", "SELL", pct_steps(s, p)), SLeg("PE", "SELL", -pct_steps(s, p))])
for pct, tag in ((0.01, "1pct"), (0.02, "2pct")):
    for w, tw in ((2, "w100"), (4, "w200")):
        add(f"iron_condor_{tag}_{tw}", "defined",
            lambda s, p=pct, w=w: [SLeg("CE", "SELL", pct_steps(s, p)), SLeg("PE", "SELL", -pct_steps(s, p)),
                                   SLeg("CE", "BUY", pct_steps(s, p) + w), SLeg("PE", "BUY", -(pct_steps(s, p) + w))],
            width_steps=w)
add("iron_condor_2pct_w300", "defined",
    lambda s: [SLeg("CE", "SELL", pct_steps(s, 0.02)), SLeg("PE", "SELL", -pct_steps(s, 0.02)),
               SLeg("CE", "BUY", pct_steps(s, 0.02) + 6), SLeg("PE", "BUY", -(pct_steps(s, 0.02) + 6))],
    width_steps=6)
for w, tw in ((4, "w200"), (8, "w400")):
    add(f"iron_fly_{tw}", "defined",
        lambda s, w=w: [SLeg("CE", "SELL", 0), SLeg("PE", "SELL", 0),
                        SLeg("CE", "BUY", w), SLeg("PE", "BUY", -w)], width_steps=w)
add("long_straddle", "debit", lambda s: [SLeg("CE", "BUY", 0), SLeg("PE", "BUY", 0)])
for pct, tag in ((0.01, "1pct"), (0.02, "2pct")):
    add(f"long_strangle_{tag}", "debit",
        lambda s, p=pct: [SLeg("CE", "BUY", pct_steps(s, p)), SLeg("PE", "BUY", -pct_steps(s, p))])
add("long_condor_1pct_w100", "debit",
    lambda s: [SLeg("CE", "BUY", pct_steps(s, 0.01)), SLeg("PE", "BUY", -pct_steps(s, 0.01)),
               SLeg("CE", "SELL", pct_steps(s, 0.01) + 2), SLeg("PE", "SELL", -(pct_steps(s, 0.01) + 2))])
add("long_condor_2pct_w200", "debit",
    lambda s: [SLeg("CE", "BUY", pct_steps(s, 0.02)), SLeg("PE", "BUY", -pct_steps(s, 0.02)),
               SLeg("CE", "SELL", pct_steps(s, 0.02) + 4), SLeg("PE", "SELL", -(pct_steps(s, 0.02) + 4))])
for w, tw in ((2, "w100"), (4, "w200")):
    add(f"bull_call_spread_{tw}", "debit",
        lambda s, w=w: [SLeg("CE", "BUY", 0), SLeg("CE", "SELL", w)])
    add(f"bear_put_spread_{tw}", "debit",
        lambda s, w=w: [SLeg("PE", "BUY", 0), SLeg("PE", "SELL", -w)])
for pct, tag in ((0.01, "1pct"), (0.02, "2pct")):
    add(f"bull_put_spread_{tag}_w100", "defined",
        lambda s, p=pct: [SLeg("PE", "SELL", -pct_steps(s, p)), SLeg("PE", "BUY", -(pct_steps(s, p) + 2))],
        width_steps=2)
    add(f"bear_call_spread_{tag}_w100", "defined",
        lambda s, p=pct: [SLeg("CE", "SELL", pct_steps(s, p)), SLeg("CE", "BUY", pct_steps(s, p) + 2)],
        width_steps=2)
for pct, tag in ((0.01, "1pct"), (0.02, "2pct")):
    add(f"ratio_spread_{tag}", "naked_short",
        lambda s, p=pct: [SLeg("CE", "BUY", 0), SLeg("CE", "SELL", pct_steps(s, p), ratio=2)])
add("synthetic_long", "naked_short", lambda s: [SLeg("CE", "BUY", 0), SLeg("PE", "SELL", 0)], stop_kind="debit")
add("synthetic_short", "naked_short", lambda s: [SLeg("CE", "SELL", 0), SLeg("PE", "BUY", 0)], stop_kind="credit")
add("calendar_short_front_CE", "calendar",
    lambda s: [SLeg("CE", "SELL", 0), SLeg("CE", "BUY", 0, which="next")], stop_kind="credit")
add("calendar_short_front_PE", "calendar",
    lambda s: [SLeg("PE", "SELL", 0), SLeg("PE", "BUY", 0, which="next")], stop_kind="credit")
add("calendar_long_front_CE", "calendar",
    lambda s: [SLeg("CE", "BUY", 0), SLeg("CE", "SELL", 0, which="next")], stop_kind="debit")

FAM_BY_NAME = {f["name"]: f for f in FAMS}


# ---------------------------------------------------------------------------
# pricing / execution
# ---------------------------------------------------------------------------
def build_legdicts_multi(slegs, expiries, spot, step, weekly_map):
    from fyers_data import nifty_symbol
    atm = int(round(spot / step) * step)
    out = []
    for s in slegs:
        exp = expiries[s.which]
        strike = atm + s.off * step
        wk = bool(weekly_map.get(exp, True))
        out.append({"opt": s.opt, "side": s.side, "ratio": s.ratio, "strike": strike,
                    "expiry": exp, "symbol": nifty_symbol(exp, strike, s.opt, weekly=wk)})
    return out, atm


def _prices_multi(source, legdicts, ts, spot, field):
    out = []
    for l in legdicts:
        p = source.leg_price(ts, l, spot, field=field)
        if p is None:
            return None
        out.append(p)
    return out


def _net_multi(legdicts, prices, ex, mode):
    fills = _leg_fills(prices, legdicts, ex, mode)
    return sum((1 if l["side"] == "BUY" else -1) * px * l["ratio"]
               for l, px in zip(legdicts, fills))


def _size(fam_kind, legdicts, fills, entry_net, spot, step, width_steps, cfg):
    struct_legs = [{**l, "premium": abs(p)} for l, p in zip(legdicts, fills)]
    margin = capital_for_structure(spot, LOT, struct_legs)
    credit = -entry_net
    if entry_net > 0:                      # net debit -> max loss is the debit
        risk_per_lot = max(entry_net * LOT, 1.0)
    elif fam_kind == "defined":
        w = max(1, int(width_steps)) * step
        risk_per_lot = max(w * LOT - credit * LOT, 1.0)
    else:                                  # naked short / calendar / synthetic
        risk_per_lot = max(margin, 1.0)
    risk_budget = CAPITAL * cfg.risk_pct
    lots = int(max(1, min(cfg.max_lots,
                          math.floor(risk_budget / risk_per_lot),
                          math.floor(CAPITAL / max(margin, 1.0)))))
    return lots, margin, risk_per_lot


def execute(source, fam, legdicts, ent_ts, ent_spot, ent_prices, entry_day, sett_day,
            at_expiry, feat_day, cfg, daily, bars_of, step):
    fills = _leg_fills(ent_prices, legdicts, EX, "entry")
    entry_net = sum((1 if l["side"] == "BUY" else -1) * p * l["ratio"]
                    for l, p in zip(legdicts, fills))
    if abs(entry_net) < 1.0:               # degenerate / free structure
        return None
    lots, margin, risk_per_lot = _size(fam["kind"], legdicts, fills, entry_net,
                                       ent_spot, step, fam.get("width", 0), cfg)
    qty = lots * LOT
    credit = -entry_net
    if cfg.stop_mult is None:
        stop_lvl = None
    elif entry_net < 0:                    # short: stop at stop_mult x credit
        stop_lvl = entry_net - cfg.stop_mult * credit
    else:                                  # long: stop at stop_mult fraction of debit
        stop_lvl = entry_net * (1.0 - cfg.stop_mult)

    exit_reason, exit_net, out_ref, exit_day = "EXPIRY", None, None, sett_day
    if stop_lvl is not None:
        for dd in [d for d in bars_of if entry_day < d <= sett_day]:
            row = daily.loc[str(dd)] if str(dd) in daily.index else None
            if row is None:
                continue
            dts = bars_of[dd].index[-1]
            hi, lo = float(row["high"]), float(row["low"])
            ph = _prices_multi(source, legdicts, dts, hi, "mark")
            pl = _prices_multi(source, legdicts, dts, lo, "mark")
            if ph is None or pl is None:
                continue
            n_hi = _net_multi(legdicts, ph, EX, "mark")
            n_lo = _net_multi(legdicts, pl, EX, "mark")
            if min(n_hi, n_lo) <= stop_lvl:
                exit_reason, exit_net, exit_day = "STOP", stop_lvl, dd
                out_ref = ph if n_hi <= n_lo else pl
                break

    if exit_net is None:
        s_ts = bars_of[sett_day].index[-1]
        s_spot = float(daily.loc[str(sett_day), "close"])
        out_ref, exp_leg = [], []
        for l in legdicts:
            if at_expiry and l["expiry"] <= sett_day:
                intr = max(0.0, s_spot - l["strike"]) if l["opt"] == "CE" \
                    else max(0.0, l["strike"] - s_spot)
                out_ref.append(intr)
                exp_leg.append(True)
            else:
                p = source.leg_price(s_ts, l, s_spot, field="close")
                if p is None:
                    return None
                out_ref.append(p)
                exp_leg.append(False)
        exit_net = 0.0
        for l, p, exl in zip(legdicts, out_ref, exp_leg):
            fill = p if exl else _leg_fills([p], [l], EX, "mark")[0]
            exit_net += (1 if l["side"] == "BUY" else -1) * fill * l["ratio"]
        exit_reason = "EXPIRY" if (at_expiry and all(exp_leg)) else "MARK_END"

    if exit_net is None:
        return None
    fees = sum(round_trip_costs(pe, px, qty * l["ratio"], l["side"])
               for pe, px, l in zip(ent_prices, out_ref, legdicts))
    gross = (exit_net - entry_net) * qty
    fd_ = daily.loc[str(feat_day)]
    first = legdicts[0]
    return {
        "mode": cfg.mode, "fam": fam["name"], "kind": fam["kind"],
        "expiry": legdicts[0]["expiry"].isoformat(),
        "entry_day": entry_day.isoformat(), "settle_day": exit_day.isoformat(),
        "entry_ts": str(ent_ts), "at_expiry": at_expiry, "exit_reason": exit_reason,
        "entry_dte": cfg.entry_dte,
        "spot_entry": ent_spot, "spot_settle": float(daily.loc[str(exit_day), "close"]),
        "credit_pts": credit, "entry_net": entry_net, "exit_net": exit_net,
        "lots": lots, "qty": qty, "margin_per_lot": margin, "risk_per_lot": risk_per_lot,
        "gross": gross, "fees": fees, "net": gross - fees,
        "first_opt": first["opt"], "n_legs": len(legdicts),
        "ratio_prior": float(fd_["ratio"]), "ret_prior": float(fd_["ret"]),
    }


def next_expiry(resolver, E):
    fut = [e for e in resolver.expiries if e > E]
    return fut[0] if fut else None


def run_sim(source, resolver, spot, daily, fam, cfg, real=False):
    bars_of = _day_bars(spot)
    days = list(daily.index.date)
    if real:
        weekly_map = {e: resolver.is_weekly(e) for e in resolver.expiries}
    else:
        weekly_map = {e: resolver.is_weekly(e) for e in resolver.expiries}
    trades = []
    for E in resolver.expiries:
        if E < cfg.start:
            continue
        pre = [d for d in days if d < E]
        if len(pre) <= cfg.entry_dte + 1:
            continue
        entry_day = pre[-cfg.entry_dte]
        feat_day = pre[-(cfg.entry_dte + 1)]
        if entry_day < cfg.start or entry_day > cfg.end:
            continue
        last_day = pre[-1]
        En = next_expiry(resolver, E)
        if any(l.which == "next" for l in fam["legs"](float(daily.loc[str(entry_day), "close"]))) and En is None:
            continue
        sett_day = E if E in bars_of else pre[-1]
        at_expiry = (sett_day >= E)
        if real and E > last_day:
            sett_day, at_expiry = last_day, False
        bars = bars_of.get(entry_day)
        if bars is None or bars.empty:
            continue
        ent_ts, ent_spot = _pick_entry_bar(bars)
        if ent_ts is None:
            continue
        expiries = {"front": E, "next": En if En is not None else E}
        slegs = fam["legs"](ent_spot)
        legdicts, atm = build_legdicts_multi(slegs, expiries, ent_spot, STEP, weekly_map)
        if real and not all(has_data(source, l["symbol"]) for l in legdicts):
            continue
        ent_prices = _prices_multi(source, legdicts, ent_ts, ent_spot, "close")
        if ent_prices is None:
            continue
        tr = execute(source, fam, legdicts, ent_ts, ent_spot, ent_prices, entry_day,
                     sett_day, at_expiry, feat_day, cfg, daily, bars_of, STEP)
        if tr is not None:
            trades.append(tr)
    return trades


@dataclass
class SCConfig:
    start: date
    end: date
    entry_dte: int = 5
    stop_mult: float = 2.0
    risk_pct: float = 0.01
    max_lots: int = 20
    mode: str = "synthetic"


# ---------------------------------------------------------------------------
# metrics
# ---------------------------------------------------------------------------
def metrics(trades, capital=CAPITAL, label=""):
    if not trades:
        return {"label": label, "n": 0}
    net = np.array([t["net"] for t in trades], dtype=float)
    s = st.summarize(net, capital)
    boot = st.bootstrap(net, capital)
    weeks = st.weekly(net, [pd.Timestamp(t["entry_ts"]) for t in trades], capital)
    # raw direction per the brief: legs[0] opt -> sgn
    sgn = np.array([1 if t["first_opt"] == "CE" else -1 for t in trades])
    mv = np.array([t["spot_settle"] - t["spot_entry"] for t in trades]) * sgn
    raw_mv = np.array([t["spot_settle"] - t["spot_entry"] for t in trades])
    corr = float(np.corrcoef(net, raw_mv)[0, 1]) if len(net) > 2 and np.std(raw_mv) > 0 else 0.0
    out = {
        "label": label, "n": s["n"], "net_exp": s["avg_net"], "pf": s["profit_factor"],
        "win": s["win_rate"], "total_net": s["total_net"],
        "gross_exp": float(np.mean([t["gross"] for t in trades])),
        "fees_exp": float(np.mean([t["fees"] for t in trades])),
        "max_drawdown": s["max_drawdown"], "max_dd_pct_capital": s["max_drawdown"] / capital,
        "worst_trade": s["worst"], "best_trade": s["best"], "tail_loss_p95": s["p05"],
        "bootstrap_ci": [boot.get("ci_low_mean"), boot.get("ci_high_mean")],
        "p_positive_total": boot.get("p_positive_total"),
        "risk_of_ruin": st.risk_of_ruin(net, capital),
        "worst_week": weeks.get("worst_week"),
        "capital_for_15k_week": weeks.get("target_15k_avg_capital"),
        "raw_dir_accuracy": float((mv > 0).mean()),
        "raw_mean_move_pts": float(mv.mean()),
        "direction_corr": corr,
        "exit_mix": pd.Series([t["exit_reason"] for t in trades]).value_counts().to_dict(),
        "avg_credit_pts": float(np.mean([t["credit_pts"] for t in trades])),
        "avg_lots": float(np.mean([t["lots"] for t in trades])),
        "expiry_frac": float(np.mean([t["at_expiry"] for t in trades])),
    }
    return out


def split(trades, s=SPLIT):
    return ([t for t in trades if t["entry_day"] <= str(s)],
            [t for t in trades if t["entry_day"] > str(s)])


def _log(kind, rec):
    with LOG.open("a") as f:
        f.write(json.dumps({"kind": kind, **rec}, default=str) + "\n")


# ---------------------------------------------------------------------------
# grid
# ---------------------------------------------------------------------------
def build_jobs():
    """(family, entry_dte, stop_mult) jobs.

    The **baseline** is hold-to-expiry with *no stop* (the thesis).  Stop variants
    (2-3x credit / 0.5x debit) and the 1-day-before variant are sensitivity only.
    stop_mult None = hold to expiry.
    """
    jobs = []
    for f in FAMS:
        jobs.append((f["name"], 5, None))          # baseline, 5 trading days
        jobs.append((f["name"], 1, None))          # enter 1 day before expiry
        sk = f["stop_kind"]
        if sk in ("credit", "both"):
            jobs.append((f["name"], 5, 2.0))
        if sk in ("debit", "both"):
            jobs.append((f["name"], 5, 0.5))
        if sk == "both":
            jobs.append((f["name"], 5, 3.0))
    # extra stop sensitivity on the headline short-vol families
    for name in ("short_straddle", "short_strangle_1pct", "short_strangle_2pct",
                 "iron_condor_2pct_w200", "iron_fly_w200"):
        jobs.append((name, 5, 3.0))
    return jobs


def _norm_sm(x):
    """Normalise a stop_mult that survived a parquet round-trip (None -> NaN)."""
    if x is None:
        return None
    try:
        if x != x:  # NaN
            return None
    except Exception:
        pass
    return float(x)


def run_grid(source, resolver, spot, daily, start, end, jobs, real=False, cache=None):
    allt = []
    done = set()
    if cache is not None and cache.exists():
        df = pd.read_parquet(cache)
        df = df.drop_duplicates(subset=["job", "entry_day", "expiry"])
        allt = df.to_dict("records")
        done = {(r["fam"], int(r["entry_dte"]), _norm_sm(r["stop_mult"])) for r in allt}
    for (fname, ed, sm) in jobs:
        key = (fname, int(ed), _norm_sm(sm))
        if key in done:
            continue
        fam = FAM_BY_NAME[fname]
        cfg = SCConfig(start, end, entry_dte=ed, stop_mult=sm,
                       mode="real" if real else "synthetic")
        tr = run_sim(source, resolver, spot, daily, fam, cfg, real=real)
        for t in tr:
            t["stop_mult"] = sm
            t["job"] = f"{fname}_ed{ed}_s{sm}"
        allt += tr
        print(f"    [{('real' if real else 'syn')}] {fname} ed{ed} s{sm}: n={len(tr)}")
        if cache is not None:
            pd.DataFrame(allt).to_parquet(cache, index=False)
    return allt


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--no-cache", action="store_true")
    args = ap.parse_args()

    spot, iv, daily = load_market()
    synth = SyntheticOptionSource.from_cached()
    res_s = R.build_weekly_resolver(date(2018, 1, 1), date(2026, 9, 25))

    jobs = build_jobs()
    if args.quick:
        jobs = [j for j in jobs if j[1] == 5][:6]
    cache_s = HERE / "_sc3_trades_synth.parquet"
    syn_all = run_grid(synth, res_s, spot, daily, date(2018, 1, 1), date(2026, 9, 25),
                       jobs, real=False, cache=None if args.no_cache else cache_s)

    # ---- per-job table ----
    job_table = []
    for (fname, ed, sm) in jobs:
        jid = f"{fname}_ed{ed}_s{sm}"
        tt = [t for t in syn_all if t["job"] == jid]
        if not tt:
            continue
        tr, te = split(tt)
        ef, et, es = metrics(tt, label=jid), metrics(tr, label=jid + "_train"), metrics(te, label=jid + "_test")
        job_table.append({
            "job": jid, "fam": fname, "kind": FAM_BY_NAME[fname]["kind"],
            "stop_kind": FAM_BY_NAME[fname]["stop_kind"],
            "entry_dte": ed, "stop_mult": sm,
            "n": ef["n"], "exp": ef["net_exp"], "pf": ef["pf"], "win": ef["win"],
            "total": ef["total_net"], "gross_exp": ef["gross_exp"], "fees_exp": ef["fees_exp"],
            "dd_pct": ef["max_dd_pct_capital"], "worst": ef["worst_trade"],
            "tail_p95": ef["tail_loss_p95"], "ci": ef["bootstrap_ci"],
            "cap15": ef["capital_for_15k_week"], "ror": ef["risk_of_ruin"],
            "train_n": et.get("n"), "train_exp": et.get("net_exp"), "train_pf": et.get("pf"),
            "test_n": es.get("n"), "test_exp": es.get("net_exp"), "test_pf": es.get("pf"),
            "test_dd_pct": es.get("max_dd_pct_capital"), "test_ci": es.get("bootstrap_ci"),
            "test_ror": es.get("risk_of_ruin"),
            "raw_dir": ef["raw_dir_accuracy"], "direction_corr": ef["direction_corr"],
            "exit_mix": ef["exit_mix"],
        })

    # ---- primary catalogue: baseline = hold-to-expiry, entry_dte=5, no stop ----
    def baseline_job(fname):
        return f"{fname}_ed5_sNone"

    def sens_jobs(fname):
        out = []
        for (fn, ed, sm) in jobs:
            if fn != fname:
                continue
            jid = f"{fn}_ed{ed}_s{sm}"
            m = next((r for r in job_table if r["job"] == jid), None)
            if m is None:
                continue
            out.append({"job": jid, "entry_dte": ed, "stop_mult": sm,
                        "full_exp": m["exp"], "full_pf": m["pf"], "full_dd_pct": m["dd_pct"],
                        "full_worst": m["worst"], "test_exp": m["test_exp"],
                        "test_pf": m["test_pf"], "test_n": m["test_n"], "test_ci": m["test_ci"]})
        return out

    catalog = []
    for f in FAMS:
        jid = baseline_job(f["name"])
        tt = [t for t in syn_all if t["job"] == jid]
        if not tt:
            continue
        tr, te = split(tt)
        ef, et, es = metrics(tt, label=jid), metrics(tr, label=jid + "_train"), metrics(te, label=jid + "_test")
        corr = ef["direction_corr"]
        basis = "directional" if abs(corr) > 0.5 else "variance/geometry"
        passes = bool(es.get("n", 0) >= 100 and es.get("net_exp", -1) > 0
                      and es.get("pf", 0) > 1.05
                      and (es.get("bootstrap_ci") or [None])[0] is not None
                      and es["bootstrap_ci"][0] > 0
                      and ef.get("max_dd_pct_capital", -1) > -0.25
                      and basis == "variance/geometry")
        catalog.append({
            "structure": f["name"], "kind": f["kind"],
            "selected_job": jid, "entry_dte": 5, "stop_mult": None,
            "full": ef, "train": et, "test": es,
            "direction_corr": corr, "edge_basis": basis,
            "passes": passes, "sensitivity": sens_jobs(f["name"]),
        })

    catalog.sort(key=lambda r: r["full"]["net_exp"], reverse=True)

    # ---- gate passers across ALL configs (not just the no-stop baseline) ----
    def _gate(r):
        tci = r["test_ci"] or [None]
        basis = "directional" if abs(r["direction_corr"]) > 0.5 else "variance/geometry"
        return bool((r["test_n"] or 0) >= 100 and (r["test_exp"] or -1) > 0
                    and (r["test_pf"] or 0) > 1.05
                    and tci[0] is not None and tci[0] > 0
                    and r["dd_pct"] > -0.25), basis

    gate_passers = []
    for r in job_table:
        ok, basis = _gate(r)
        if ok:
            gate_passers.append({**r, "edge_basis": basis})
    gate_passers.sort(key=lambda r: r["test_exp"], reverse=True)
    for c in catalog:
        c["gate_pass"] = any(g["fam"] == c["structure"] for g in gate_passers)

    # ---- artifact check: re-price VRP-laden configs at IV=RV ----
    art = {}
    check_cfgs = [(c["structure"], c["entry_dte"], c["stop_mult"]) for c in catalog
                  if c["structure"] in ("short_straddle", "short_strangle_1pct",
                                        "iron_condor_2pct_w200", "iron_condor_2pct_w300",
                                        "iron_fly_w200", "short_strangle_2pct")]
    check_cfgs += [(g["fam"], g["entry_dte"], g["stop_mult"]) for g in gate_passers]
    seen = set()
    rv_series = pricing.trailing_vol(spot["close"], window=288)
    rv_fair = SyntheticOptionSource(spot, rv_series, surface=pricing.IVSurface(smile_coeff=0.0))
    for (fname, ed, sm) in check_cfgs:
        key = f"{fname}_ed{ed}_s{sm}"
        if key in seen:
            continue
        seen.add(key)
        fam = FAM_BY_NAME[fname]
        cfg = SCConfig(date(2018, 1, 1), date(2026, 9, 25), entry_dte=ed,
                       stop_mult=sm, mode="synthetic_fair")
        tr = run_sim(rv_fair, res_s, spot, daily, fam, cfg, real=False)
        _, tte = split(tr)
        base = next((r for r in job_table if r["job"] == key), None)
        art[key] = {"structure": fname, "entry_dte": ed, "stop_mult": sm,
                    "vrp_exp": (base or {}).get("exp"), "vrp_pf": (base or {}).get("pf"),
                    "vrp_test_exp": (base or {}).get("test_exp"),
                    "fair_rv": metrics(tr, label=key + "_fairrv"),
                    "fair_rv_test": metrics(tte, label=key + "_fairrv_test")}

    # ---- real-premium transfer ----
    man = json.loads((fd.CACHE_DIR / "option_manifest.json").read_text())
    by_exp = {date.fromisoformat(c["expiry"]): c["weekly"] for c in man["contracts"]}
    res_r = ExpiryResolver(list(by_exp.keys()), by_exp)
    real_src = RealOptionSource()
    cache_r = HERE / "_sc3_trades_real.parquet"
    real_all = run_grid(real_src, res_r, spot, daily, date(2026, 6, 1), date(2026, 9, 25),
                        jobs, real=True, cache=None if args.no_cache else cache_r)
    real_catalog = []
    for f in FAMS:
        jid = f"{f['name']}_ed5_sNone"
        tt = [t for t in real_all if t["job"] == jid]
        if not tt:
            real_catalog.append({"structure": f["name"], "selected_job": jid, "n": 0})
            continue
        real_catalog.append({"structure": f["name"], "selected_job": jid,
                             "metrics": metrics(tt, label="real_" + f["name"])})
    real_pooled = metrics(real_all, label="real_pooled") if real_all else {"n": 0}

    # log
    if LOG.exists():
        LOG.unlink()
    for r in job_table:
        _log("synth_job", r)
    for c in catalog:
        _log("catalog", {"structure": c["structure"], "kind": c["kind"],
                         "selected_job": c["selected_job"], "full": c["full"],
                         "train": c["train"], "test": c["test"],
                         "edge_basis": c["edge_basis"], "gate_pass": c["gate_pass"]})
    for g in gate_passers:
        _log("gate_passer", g)
    for k, v in art.items():
        _log("artifact", {"config": k, **v})
    _log("real_pooled", real_pooled)
    for c in real_catalog:
        _log("real", c)

    out = {
        "track": "structures_catalog",
        "hypothesis": ("The variance risk premium is real (ATM IV - RV ~ +4-5 vol pts, 82% of "
                       "nights realised < implied) but intraday scalping loses to costs. A "
                       "hold-to-expiry option structure should be the only way to monetise it; "
                       "the catalogue ranks every standard NIFTY structure by hold-to-expiry "
                       "expectancy net of spread+slippage+fees."),
        "feature": "structure geometry (ATM offset, wing width, front/next expiry), entry DTE (5 or 1), stop (2-3x credit / 0.5x debit / none)",
        "rule": "Each weekly expiry: enter the structure 5 or 1 trading days before expiry, hold to intrinsic settlement, stop walked on the daily high/low.",
        "data": ("SyntheticOptionSource BS premiums (smile_coeff=0, iv_mult=1) on real 2018-2026 "
                 "1-min spot with causal INDIAVIX IV; real FYERS premiums 2026-06-01..2026-09-25 "
                 "(nearest real expiry 2026-09-29 > data end -> all real exits MARK_END)."),
        "n_trades": catalog[0]["full"]["n"] if catalog else 0,
        "split": {"train_end": str(SPLIT), "train": "2018-2022", "test": "2023-2026"},
        "primary_config": "entry_dte=5, hold-to-expiry, no stop (baseline thesis)",
        "catalog": catalog,
        "job_table": job_table,
        "gate_passers": gate_passers,
        "artifact_check": art,
        "real_catalog": real_catalog,
        "real_pooled": real_pooled,
        "real_note": ("Every cached real contract expires AFTER the data window (spot ends "
                      "2026-09-25; nearest real expiry 2026-09-29) so nothing settles at "
                      "intrinsic; all real exits are MARK_END. Real n is small and overlapping."),
        "artifacts": ["tracks/structures_catalog_log.jsonl", "tracks/_sc3_trades_synth.parquet",
                      "tracks/_sc3_trades_real.parquet", "tracks/structures_catalog.py"],
    }
    # brief-conformant scalar headline: the cleanest gate-clearing *variance* config
    best = next((g for g in gate_passers if g["job"] == "iron_condor_2pct_w300_ed5_s2.0"),
                next((g for g in gate_passers if g["edge_basis"] == "variance/geometry"),
                     gate_passers[0] if gate_passers else None))
    if best:
        out.update({
            "headline_config": best["job"],
            "n_trades": best["n"], "net_exp": best["exp"], "pf": best["pf"], "win": best["win"],
            "total_net": best["total"], "max_drawdown": best["dd_pct"] * CAPITAL,
            "max_dd_pct_capital": best["dd_pct"],
            "train_exp": best["train_exp"], "test_exp": best["test_exp"], "test_n": best["test_n"],
            "bootstrap_ci": best["test_ci"], "tail_loss_p95": best["tail_p95"],
            "worst_trade": best["worst"], "raw_dir_accuracy": best["raw_dir"],
            "edge_basis": best["edge_basis"], "capital_for_15k_week": best["cap15"],
        })
    out["verdict"] = "defer"
    out["reason"] = (
        "Hold-to-expiry is the right wrapper (intraday loses to costs) and short-vol structures are "
        "gross-positive from theta: short strangles/straddle OOS exp ₹1.1-1.7k but DD 30-86% of ₹3L "
        "(short-gamma tail); defined-risk iron condors DD<25% but OOS CI ([−95,875] w200, [−101,1191] "
        "w300) spans 0. Four stop variants clear the numeric gate, but red-team kills them: "
        "iron_condor_2pct_w300 stop2 (OOS ₹622 CI [122,1123] DD −18.7%) collapses to ₹−110 at IV=RV, "
        "i.e. it is the model's VRP input (SyntheticOptionSource prices every strike at "
        "combine_iv=0.65*INDIAVIX+0.35*RV, flat smile); ratio_spread_1pct stop2 (OOS ₹1,542) survives "
        "IV=RV but exists only because of the idealised 2x-credit stop (no-stop DD −86%, CI spans 0); "
        "synthetic_long and bear_call_spread are directional beta, not variance. Real premiums cannot "
        "confirm: all 669 cached contracts expire after the data window (nearest 2026-09-29 > "
        "2026-09-25), so all 419 real exits are MARK_END. Acquire real expiry-settled weekly chains "
        "before risking capital.")
    (HERE / "structures_catalog.json").write_text(json.dumps(out, indent=2, default=str))
    _write_md(out)
    _print_summary(catalog, art, real_pooled)
    _print_gate(gate_passers)
    print("\nsaved -> tracks/structures_catalog.json / .md / _log.jsonl")


def _print_summary(catalog, art, real_pooled):
    print("\n=== RANKED CATALOG (hold-to-expiry baseline: entry_dte=5, no stop) ===")
    print(f"{'structure':28s} {'n':>4s} {'exp':>8s} {'PF':>5s} {'win':>4s} {'DD%':>6s} "
          f"{'worst':>8s} {'CI90':>16s} {'tst_exp':>8s} {'cap15k':>12s} basis pass")
    for c in catalog:
        f, te = c["full"], c["test"]
        ci = f["bootstrap_ci"]
        cis = f"[{ci[0]:,.0f},{ci[1]:,.0f}]" if ci[0] is not None else "n/a"
        cap = f["capital_for_15k_week"]
        caps = f"{cap:,.0f}" if cap == cap and cap != float("inf") else "inf"
        print(f"{c['structure']:28s} {f['n']:4d} {f['net_exp']:8,.0f} {f['pf']:5.2f} "
              f"{f['win']*100:3.0f}% {f['max_dd_pct_capital']*100:6.1f} {f['worst_trade']:8,.0f} "
              f"{cis:>16s} {te.get('net_exp', float('nan')):8,.0f} {caps:>12s} "
              f"{c['edge_basis'][:10]:10s} {c['gate_pass']}")


def _print_gate(gate_passers):
    print("\n=== CONFIGS CLEARING THE FULL GATE (OOS>0, n>=100, CI excl 0, maxDD<25%) ===")
    if not gate_passers:
        print("  NONE")
        return
    for g in gate_passers:
        ci = g["test_ci"] or [0, 0]
        print(f"  {g['job']:38s} [{g['edge_basis']:16s}] full exp={g['exp']:7,.0f} PF={g['pf']:.2f} "
              f"DD={g['dd_pct']*100:6.1f}% worst={g['worst']:8,.0f} | test n={g['test_n']} "
              f"exp={g['test_exp']:7,.0f} PF={g['test_pf']:.2f} CI=[{ci[0]:,.0f},{ci[1]:,.0f}]")


def _write_md(out):
    cat = out["catalog"]
    art = out["artifact_check"]
    rt = out["real_pooled"]
    gate_passers = out.get("gate_passers", [])
    L = []
    L.append("# NIFTY option structures — hold-to-expiry catalogue")
    L.append("**Hypothesis.** VRP is real (ATM IV − RV ≈ +4–5 vol pts; 82% of nights realised < "
             "implied) but unreachable intraday (theta < round-trip cost); rank every standard NIFTY "
             "structure by hold-to-expiry expectancy net of spread+slippage+fees.")
    L.append("**Method.** `tracks/structures_catalog.py` (generalises `theta_harvest.py`). Baseline "
             "per family = **enter front weekly 5 trading days before expiry, hold to intrinsic "
             "settlement, no stop**; variants = 1-day entry + stops (2–3× credit / 0.5× debit). "
             "Synthetic BS on real 2018-26 1-min spot, causal INDIAVIX IV (flat smile); real = FYERS "
             "2026 premiums (all MARK_END).")
    L.append("")
    L.append("| rank | structure | basis | n | exp ₹ | PF | win | gross | fees | maxDD% 3L | worst ₹ | CI90 | test exp | cap15k ₹ | pass |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for k, c in enumerate(cat, 1):
        f, te = c["full"], c["test"]
        ci = f["bootstrap_ci"]
        cis = f"[{ci[0]:,.0f},{ci[1]:,.0f}]" if ci[0] is not None else "n/a"
        cap = f["capital_for_15k_week"]
        caps = f"{cap:,.0f}" if cap == cap and cap != float("inf") else "inf"
        L.append(f"| {k} | {c['structure']} | {c['edge_basis']} | {f['n']} | {f['net_exp']:,.0f} | "
                 f"{f['pf']:.2f} | {f['win']*100:.0f}% | {f['gross_exp']:,.0f} | {f['fees_exp']:,.0f} | "
                 f"{f['max_dd_pct_capital']*100:.1f} | {f['worst_trade']:,.0f} | {cis} | "
                 f"{te.get('net_exp', float('nan')):,.0f} | {caps} | {c['gate_pass']} |")
    L.append("")
    L.append("**Configs clearing the full gate** (OOS>0, n≥100, CI excl 0, maxDD<25%; baseline or stop variant).")
    L.append("| config | basis | full exp ₹ | PF | maxDD% 3L | worst ₹ | test n | test exp ₹ | test PF | test CI90 |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for g in gate_passers[:6]:
        ci = g["test_ci"] or [0, 0]
        L.append(f"| {g['job']} | {g['edge_basis']} | {g['exp']:,.0f} | {g['pf']:.2f} | "
                 f"{g['dd_pct']*100:.1f} | {g['worst']:,.0f} | {g['test_n']} | {g['test_exp']:,.0f} | "
                 f"{g['test_pf']:.2f} | [{ci[0]:,.0f},{ci[1]:,.0f}] |")
    L.append("")
    L.append("**Artifact check (IV=RV)** — re-pricing every strike at trailing RV removes the VRP; a "
             "collapse means the edge *is* the model's IV input, not geometry.")
    L.append("| config | VRP exp ₹ | VRP PF | IV=RV exp ₹ | IV=RV PF | IV=RV test exp ₹ |")
    L.append("|---|---|---|---|---|---|")
    prio = ["iron_condor_2pct_w300_ed5_s2.0", "ratio_spread_1pct_ed5_s2.0",
            "short_strangle_1pct_ed5_sNone", "short_straddle_ed5_sNone",
            "iron_condor_2pct_w300_ed5_sNone", "bear_call_spread_2pct_w100_ed5_s2.0"]
    keys = [k for k in prio if k in art] + [k for k in art if k not in prio and (art[k].get("vrp_exp") or 0) > 0]
    for k in keys[:6]:
        v = art[k]
        L.append(f"| {k} | {v['vrp_exp']:,.0f} | {v['vrp_pf']:.2f} | "
                 f"{v['fair_rv'].get('net_exp',0):,.0f} | {v['fair_rv'].get('pf',0):.2f} | "
                 f"{v['fair_rv_test'].get('net_exp',0):,.0f} |")
    L.append("")
    L.append(f"**Real-premium transfer (RED TEAM).** pooled real n={rt.get('n',0)} exp "
             f"₹{rt.get('net_exp', float('nan')):,.0f} PF {rt.get('pf', float('nan')):.2f}; every cached "
             "real contract expires **after** the data window (nearest 2026-09-29 > 2026-09-25) so "
             "**nothing settles at intrinsic** — all 419 exits MARK_END, ~5 overlapping entry vintages × "
             "31 families, not a portfolio series.")
    L.append("**Red-team.** (1) **Model-IV artifact:** every strike priced at "
             "combine_iv=0.65·INDIAVIX+0.35·RV with a *flat* smile, so VRP is baked in; at IV=RV the "
             "short strangles/straddle/iron-condor collapse to ₹−0.1k…−1.6k (table) — the synthetic edge "
             "*is* the VRP assumption and the 18-22/23-26 split is not independent of it. "
             "(2) **Stop-mechanics artefact:** ratio_spread_1pct only clears the gate *with* the 2×-credit "
             "stop (no-stop DD −86%, full CI [−62,2,998] spans 0; 33% stopped, filled at the stop level, "
             "not the gap); the same idealisation flatters calendar_long_front_CE ed1+stop (exp ₹16k, "
             "DD −146%). (3) **Directional ≠ variance:** synthetic_long/short and bull/bear verticals "
             "correlate |0.6–0.8| with the spot move (NIFTY drift). (4) **Tail:** naked-short DD −56…−86% "
             "of ₹3L is a few gap days (worst −₹78k); strangle OOS CI>0 but DD does not.")
    L.append(f"**Verdict: DEFER.** No structure is both gate-clearing and non-artifactual. The two "
             "gate-clearing variance configs are fragile — iron_condor_2pct_w300 stop2 (OOS ₹622, "
             "CI [122,1123], DD −18.7%) collapses to ₹−110 at IV=RV (pure model VRP), and "
             "ratio_spread_1pct stop2 (OOS ₹1,542) survives IV=RV but exists only because of the stop "
             "fill assumption. The gate-clearing bear_call_spread (OOS ₹246) and synthetic_long are "
             "directional beta. Naked short strangles have OOS CI>0 but 30–86% DD; every long-vol "
             "structure is solidly negative. Re-confirm on real expiry-settled weekly chains first.")
    (HERE / "structures_catalog.md").write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
