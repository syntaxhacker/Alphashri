"""Track B analysis: trade attribution, monthly/regime split, directional spot
returns by skew regime, and skew/smile-residual economics vs cost.

Run: python tracks/skew_analyze.py
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

_HERE = Path(__file__).resolve().parent
_RESEARCH = _HERE.parent
sys.path.insert(0, str(_RESEARCH)); sys.path.insert(0, str(_HERE))

import fyers_data as fd  # noqa: E402
import mispricing  # noqa: E402
import pricing  # noqa: E402
import runner as R  # noqa: E402
import stats as st  # noqa: E402
import skew_lib as SL  # noqa: E402
import skew_trades as ST  # noqa: E402
from costs import ExecutionModel, round_trip_costs  # noqa: E402

START, END = date(2026, 7, 1), date(2026, 9, 25)
OUT = {}


def trades_df(trades):
    rows = []
    for t in trades:
        rows.append({"date": t.date, "tag": t.tag, "dir": t.direction, "lots": t.lots,
                     "net": t.net_pnl, "gross": t.gross_pnl, "fees": t.fees,
                     "spot_in": t.spot_entry, "spot_out": t.spot_exit,
                     "exit": t.exit_reason, "entry_ts": str(t.entry_ts)})
    return pd.DataFrame(rows)


def main():
    source, resolv, spot = ST.real_setup()
    day_meta = R.load_daily_meta()
    p = ST.signal_table()
    flags = ST.flags_for_expiry(p, "2026-09-29")
    _, resid = SL.build_skew_panel()

    # ---- directional spot behaviour by regime (pure, no options) ----------
    days = sorted({d for d in spot.index.date if START <= d <= END})
    by_day = {d: g for d, g in spot.groupby(spot.index.date)}
    direction = {"steep": [], "flat": [], "normal": []}
    for d in days:
        f = flags.get(d)
        if f is None or d not in by_day:
            continue
        b = by_day[d]
        # entry ~10:00, exit EOD
        tgt = b.index[0].normalize().replace(hour=10, minute=0)
        sub = b[b.index >= tgt]
        if len(sub) < 3:
            continue
        r = float(sub["close"].iloc[-1] / sub["open"].iloc[0] - 1.0)
        pct = f["sig_pct"]
        key = "steep" if pct >= 0.8 else ("flat" if pct <= 0.2 else "normal")
        direction[key].append(r)
    for k in direction:
        a = np.array(direction[k])
        OUT.setdefault("intraday_spot_return_by_regime", {})[k] = {
            "n": int(len(a)),
            "mean_pct": float(a.mean() * 100) if len(a) else None,
            "median_pct": float(np.median(a) * 100) if len(a) else None,
            "frac_up": float((a > 0).mean()) if len(a) else None,
        }

    # ---- key engine trades -----------------------------------------------
    specs = {
        "rr_skew_k3": ST.make_rr(flags, k=3, mode="skew"),
        "rr_steep_k3": ST.make_rr(flags, k=3, mode="steep"),
        "rr_flat_k3": ST.make_rr(flags, k=3, mode="flat"),
        "fear_steep_CE": ST.make_fear(flags, opt="CE", mode="steep"),
        "fear_steep_PE": ST.make_fear(flags, opt="PE", mode="steep"),
        "fear_flat_CE": ST.make_fear(flags, opt="CE", mode="flat"),
        "fear_flat_PE": ST.make_fear(flags, opt="PE", mode="flat"),
        "smile_vert": ST.make_smile(resid),
    }
    all_trades = {}
    for name, strat in specs.items():
        s, tr = ST.run_exp(name, strat, START, END, source, resolv, spot, day_meta)
        all_trades[name] = tr
        df = trades_df(tr)
        if len(df):
            df["month"] = pd.to_datetime(df["date"]).dt.to_period("M").astype(str)
            OUT.setdefault("monthly", {})[name] = df.groupby("month")["net"].agg(
                ["count", "sum"]).round(0).to_dict("index")
            OUT.setdefault("trade_list", {})[name] = df[["date", "tag", "dir", "net",
                                                          "spot_in", "spot_out", "exit"]].to_dict("records")
        OUT.setdefault("walk_forward", {})[name] = s.get("walk_forward", [])

    # ---- skew reversion economics vs cost --------------------------------
    panel = SL.add_causal_percentiles(SL.build_skew_panel()[0])
    g = panel[panel["expiry"] == pd.Timestamp("2026-09-29")].sort_values("date").copy()
    rr = g["rr25"].to_numpy()
    d = np.diff(rr)
    pc = g["pct_prior"].to_numpy()[:-1]
    m = np.isfinite(d) & np.isfinite(pc)
    steep_chg = d[m & (pc >= 0.8)]
    flat_chg = d[m & (pc <= 0.2)]
    # vega of a 25d option (per lot) and round-trip cost of the wing
    S = 24000.0
    T = 20 / 365.25
    sigma = 0.15
    vega = S * np.sqrt(T) * 0.3989 * np.exp(-0.5 * 0.674 ** 2) * 65  # per 1.0 vol, per lot
    atm_prem = pricing.bs_price(S, S, T, sigma, "CE")
    k_put = S * 0.97
    k_call = S * 1.03
    put_prem = pricing.bs_price(S, k_put, T, sigma + 0.01, "PE")
    call_prem = pricing.bs_price(S, k_call, T, sigma - 0.01, "CE")
    ex = ExecutionModel()
    cost_rt = (round_trip_costs(put_prem, put_prem, 65, "SELL") +
               round_trip_costs(call_prem, call_prem, 65, "BUY"))
    skew_edge_steep = abs(steep_chg.mean()) * vega if len(steep_chg) else np.nan
    skew_edge_flat = abs(flat_chg.mean()) * vega if len(flat_chg) else np.nan
    OUT["skew_reversion_economics"] = {
        "n_steep_next": int(len(steep_chg)), "n_flat_next": int(len(flat_chg)),
        "mean_next_chg_after_steep": float(steep_chg.mean()) if len(steep_chg) else None,
        "mean_next_chg_after_flat": float(flat_chg.mean()) if len(flat_chg) else None,
        "vega_per_lot_25d": float(vega),
        "implied_skew_edge_inr_steep": float(skew_edge_steep),
        "implied_skew_edge_inr_flat": float(skew_edge_flat),
        "wing_premiums": {"put": float(put_prem), "call": float(call_prem), "atm": float(atm_prem)},
        "round_trip_cost_2legs_inr": float(cost_rt),
        "edge_over_cost_steep": float(skew_edge_steep / cost_rt) if cost_rt else None,
    }

    # ---- smile residual magnitude vs cost --------------------------------
    resid_all = SL.build_skew_panel()[1]
    rr_front = resid_all[resid_all["expiry"] == pd.Timestamp("2026-09-29")].copy()
    rr_front = rr_front[rr_front["moneyness"].abs() <= 400]
    within = rr_front.groupby(["date", "opt"])["resid"]
    spread = (rr_front.groupby(["date", "opt"])["resid"].apply(lambda s: s.max() - s.min()))
    OUT["smile_residual"] = {
        "n_obs": int(len(rr_front)),
        "resid_abs_mean_volpts": float(rr_front["resid"].abs().mean()),
        "resid_abs_p90_volpts": float(rr_front["resid"].abs().quantile(0.90)),
        "within_date_opt_gap_mean_volpts": float(spread.mean()),
        "within_date_opt_gap_p90_volpts": float(spread.quantile(0.90)),
        "note": "gap = max-min residual across strikes of one type on one day (the tradeable spread)",
    }
    # implied ₹ edge of the mean residual gap on a typical 20d ATM-ish strike
    gap = float(spread.mean())
    OUT["smile_residual"]["implied_edge_inr_per_lot"] = float(gap * vega)
    OUT["smile_residual"]["round_trip_cost_2leg_vertical_inr"] = float(
        2 * round_trip_costs(atm_prem, atm_prem, 65, "SELL"))
    OUT["smile_residual"]["edge_over_cost"] = float(
        gap * vega / (2 * round_trip_costs(atm_prem, atm_prem, 65, "SELL")))

    (_HERE / "skew_analysis.json").write_text(json.dumps(OUT, indent=2, default=str))
    print(json.dumps({k: v for k, v in OUT.items()
                      if k not in ("trade_list", "walk_forward")}, indent=2, default=str))
    print("\nsaved -> tracks/skew_analysis.json")


if __name__ == "__main__":
    main()
