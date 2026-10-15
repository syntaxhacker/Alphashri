"""Overnight gap play: buy (or sell) the ATM straddle at EOD, exit at next open.

The market already prices an expected move into the ATM straddle. Buying it
overnight only pays if the *realised* gap beats that implied move — otherwise
theta + IV crush + spread hand the edge to the seller.

Runs in real-premium and synthetic modes. Also reports realised gap vs the
straddle-implied move, and the variance-risk-premium view (short straddle).
"""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fyers_data as fd  # noqa: E402
import runner as R  # noqa: E402
import stats as st  # noqa: E402
from engine import (EngineConfig, ExpiryResolver, RealOptionSource, SyntheticOptionSource,
                    build_legdicts)  # noqa: E402
from costs import ExecutionModel, round_trip_costs  # noqa: E402

LOT = 65
EX = ExecutionModel()


def _leg_prices(source, legdicts, ts, spot, field="close"):
    out = []
    for l in legdicts:
        p = source.leg_price(ts, l, spot, field=field)
        if p is None:
            return None
        out.append(p)
    return out


def run(mode, start, end, action="buy", entry_time="15:25", exit_time="09:20"):
    capital = 300_000.0
    if mode == "real":
        source = RealOptionSource()
        import json
        man = json.loads((fd.CACHE_DIR / "option_manifest.json").read_text())
        by_exp = {date.fromisoformat(c["expiry"]): c["weekly"] for c in man["contracts"]}
        resolver = ExpiryResolver(list(by_exp.keys()), by_exp)
        spot = pd.read_parquet(fd.CANDLE_DIR / "NSE_NIFTY50-INDEX__1.parquet").set_index("ts").sort_index()
    else:
        source = SyntheticOptionSource.from_cached()
        resolver = R.build_weekly_resolver(start, end)
        spot = pd.read_parquet(fd.CANDLE_DIR / "NSE_NIFTY50-INDEX__1.parquet").set_index("ts").sort_index()

    days = sorted({d for d in spot.index.date if start <= d <= end})
    by_day = {d: g for d, g in spot.groupby(spot.index.date)}
    trades = []
    for k, d in enumerate(days[:-1]):
        nd = days[k + 1]
        exp = resolver.front(d)
        if exp is None:
            continue
        weekly = resolver.is_weekly(exp)
        ent_bars = by_day.get(d)
        ext_bars = by_day.get(nd)
        if ent_bars is None or ext_bars is None or ent_bars.empty or ext_bars.empty:
            continue
        ec = ent_bars.index[ent_bars.index.time <= pd.Timestamp(entry_time).time()]
        ent_ts = ec[-1] if len(ec) else ent_bars.index[-1]
        xc = ext_bars.index[ext_bars.index.time >= pd.Timestamp(exit_time).time()]
        if len(xc) == 0:
            continue
        ext_ts = xc[0]

        ent_spot = float(spot.at[ent_ts, "close"])
        ext_spot = float(spot.at[ext_ts, "close"])
        atm = int(round(ent_spot / 50) * 50)
        from engine import Leg
        legs = build_legdicts([Leg("CE", "BUY", 0), Leg("PE", "BUY", 0)], exp, ent_spot, 50, weekly)
        # force the same strike for both legs
        for l in legs:
            l["strike"] = atm
            l["symbol"] = fd.nifty_symbol(exp, atm, l["opt"], weekly=weekly)

        pe_in = _leg_prices(source, legs, ent_ts, ent_spot, "close")
        px_in = _leg_prices(source, legs, ext_ts, ext_spot, "close")
        if pe_in is None or px_in is None:
            continue
        # fills
        bid = [p * (1 - EX.half_spread_pct - EX.slippage_pct) for p in pe_in]
        ask = [p * (1 + EX.half_spread_pct + EX.slippage_pct) for p in pe_in]
        bid_x = [p * (1 - EX.half_spread_pct - EX.slippage_pct) for p in px_in]
        ask_x = [p * (1 + EX.half_spread_pct + EX.slippage_pct) for p in px_in]

        if action == "buy":
            entry = sum(ask); exit_ = sum(bid_x)
            gross = (exit_ - entry) * LOT
        else:
            entry = sum(bid); exit_ = sum(ask_x)
            gross = (entry - exit_) * LOT
        fees = sum(round_trip_costs(e, x, LOT, "BUY" if action == "buy" else "SELL")
                   for e, x in zip(pe_in, px_in))
        vol_ratio = entry / ent_spot if action == "buy" else entry / ent_spot
        trades.append({
            "date": str(d), "expiry": exp.isoformat(), "strike": atm,
            "straddle_in": entry, "straddle_out": exit_,
            "spot_in": ent_spot, "spot_open": ext_spot,
            "gap_pts": exit_spot_gap(ent_spot, ext_spot, ext_bars),
            "implied_move_pct": 100 * (entry / ent_spot),
            "gross": gross, "fees": fees, "net": gross - fees,
        })
    return pd.DataFrame(trades)


def exit_spot_gap(prev_close, next_open, ext_bars):
    o = float(ext_bars["open"].iloc[0])
    return o - prev_close


def report(df, label):
    if df.empty:
        print(f"{label}: no trades")
        return
    net = df["net"].to_numpy()
    gross = df["gross"].to_numpy()
    s = st.summarize(net)
    realized = df["gap_pts"].abs()
    implied = df["straddle_in"] / df["spot_in"] * df["spot_in"]  # points
    print(f"\n=== {label} ===  n={len(df)}")
    print(f"  net/trade=₹{net.mean():+.0f}  PF={s['profit_factor']:.2f}  win={s['win_rate']*100:.0f}%  "
          f"total=₹{net.sum():,.0f}  maxDD=₹{s['max_drawdown']:,.0f}")
    print(f"  gross/trade=₹{gross.mean():+.0f}  fees/trade=₹{df['fees'].mean():.0f}")
    print(f"  avg |realised gap|={realized.mean():.1f} pts  avg ATM straddle={df['straddle_in'].mean():.1f} pts  "
          f"gap/straddle={realized.mean()/df['straddle_in'].mean():.2f}")
    print(f"  gap>implied (realised beats priced): {(realized > df['straddle_in']).mean()*100:.0f}% of nights")
    print(f"  by gap bucket:")
    b = pd.cut(realized, [0, 50, 100, 200, 400, 10000])
    print(df.assign(bucket=b).groupby("bucket", observed=True)["net"].agg(["size", "mean"]).round(0).to_string())


def main():
    start, end = date(2026, 7, 1), date(2026, 9, 25)
    print("REAL PREMIUMS (listed monthlies)")
    report(run("real", start, end, "buy"), "REAL buy straddle EOD->open")
    report(run("real", start, end, "sell"), "REAL sell straddle EOD->open")
    print("\nSYNTHETIC (real spot path, BS premiums)")
    report(run("synthetic", date(2018, 1, 1), date(2026, 9, 25), "buy"), "SYNTH buy straddle EOD->open")
    report(run("synthetic", date(2018, 1, 1), date(2026, 9, 25), "sell"), "SYNTH sell straddle EOD->open")


if __name__ == "__main__":
    main()
