#!/usr/bin/env python3
"""Self-contained hourly-bar backtest of the SENSEX range strategy.

Adapts the 1-min RangeStrategy (scripts/paper_sensex.py) to 60-minute bars so
that intraday multi-bar confirmation, trailing and cooldown translate to
bar-counts instead of minutes. No lookahead: day high/low are cumulative up to
the current bar, day trend uses the day open, and options are priced with
Black-Scholes at fixed IV/DTE.

Data: yfinance SENSEX (^BSESN) 60m, cached to experiments/data/sensex_60m_cache.pkl.
Outputs:
  experiments/data/paper_sensex_sweep_hourly_<date>.jsonl
  experiments/data/hourly_sweep_trades_<date>.csv
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

try:
    from scripts.paper_sensex import option_costs
except Exception:  # pragma: no cover - fallback keeps this script self-contained
    OPT_BROKERAGE_PCT, OPT_STT_PCT, OPT_EXCHANGE_PCT = 0.0003, 0.001, 0.0003503
    OPT_SEBI_PCT, OPT_STAMP_PCT, OPT_GST_PCT, OPT_MIN_BROKERAGE = 0.000001, 0.00003, 0.18, 20.0

    def option_costs(entry_premium: float, exit_premium: float, lot: int) -> float:
        buy_val, sell_val = entry_premium * lot, exit_premium * lot
        buy_brk = min(OPT_MIN_BROKERAGE, buy_val * OPT_BROKERAGE_PCT)
        buy_exch = buy_val * OPT_EXCHANGE_PCT
        buy_sebi = buy_val * OPT_SEBI_PCT
        buy_stamp = buy_val * OPT_STAMP_PCT
        buy_gst = OPT_GST_PCT * (buy_brk + buy_exch + buy_sebi)
        buy_total = buy_brk + buy_stamp + buy_exch + buy_sebi + buy_gst
        sell_brk = min(OPT_MIN_BROKERAGE, sell_val * OPT_BROKERAGE_PCT)
        sell_stt = sell_val * OPT_STT_PCT
        sell_exch = sell_val * OPT_EXCHANGE_PCT
        sell_sebi = sell_val * OPT_SEBI_PCT
        sell_gst = OPT_GST_PCT * (sell_brk + sell_exch + sell_sebi)
        sell_total = sell_brk + sell_stt + sell_exch + sell_sebi + sell_gst
        return round(buy_total + sell_total, 2)


DATA = ROOT / "experiments" / "data"
CACHE = DATA / "sensex_60m_cache.pkl"
LOT = 20
EXPIRY = datetime(2026, 8, 6)
IV = 0.19
R = 0.05

OI_SUP, OI_RES = 78500.0, 79000.0

ZONE_PTS, BREAK_BUFFER = 150.0, 40.0
CONFIRM_SAMPLES, COOLDOWN_BARS, MAX_OPEN = 2, 2, 1

ALL_RULES = ["support_bounce", "resistance_reject", "breakdown", "breakout"]
BREAKDOWN_ONLY = ["breakdown"]
BOUNCE_REJECT = ["support_bounce", "resistance_reject"]


def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs_premium(side: str, spot: float, strike: float, t_years: float, iv: float = IV) -> float:
    if t_years <= 1e-6:
        t_years = 1e-6
    d1 = (math.log(spot / strike) + (R + iv * iv / 2) * t_years) / (iv * math.sqrt(t_years))
    d2 = d1 - iv * math.sqrt(t_years)
    if side == "CE":
        bs = spot * norm_cdf(d1) - strike * math.exp(-R * t_years) * norm_cdf(d2)
        intr = max(spot - strike, 0)
    else:
        bs = strike * math.exp(-R * t_years) * norm_cdf(-d2) - spot * norm_cdf(-d1)
        intr = max(strike - spot, 0)
    return max(bs, intr)


def load_hourly() -> dict:
    """Return {date_iso: [bar_dict,...]} bars sorted asc, tz normalized to IST."""
    import yfinance as yf
    if CACHE.exists():
        import pickle
        with open(CACHE, "rb") as f:
            df = pickle.load(f)
    else:
        df = yf.Ticker("^BSESN").history(period="6mo", interval="60m")
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        import pickle
        with open(CACHE, "wb") as f:
            pickle.dump(df, f)
    if df.index.tz is None or str(df.index.tz) != "Asia/Kolkata":
        try:
            df.index = df.index.tz_localize("Asia/Kolkata")
        except Exception:
            df.index = df.index.tz_convert("Asia/Kolkata")
    df = df.rename(columns={c: c.lower() for c in df.columns})
    df = df.drop(columns=[c for c in df.columns if c not in ("open", "high", "low", "close", "volume")],
                 errors="ignore")
    by_day = {}
    for ts, row in df.iterrows():
        d = ts.strftime("%Y-%m-%d")
        by_day.setdefault(d, []).append({
            "ts": ts, "open": float(row["open"]), "high": float(row["high"]),
            "low": float(row["low"]), "close": float(row["close"]),
        })
    return {d: sorted(bars, key=lambda b: b["ts"]) for d, bars in sorted(by_day.items())}


def pivot_levels(prev_ohlc: dict) -> dict:
    o, h, l, c = prev_ohlc["open"], prev_ohlc["high"], prev_ohlc["low"], prev_ohlc["close"]
    pp = (h + l + c) / 3 if c else (h + l + o) / 3
    return {"s1": 2 * pp - h, "r1": 2 * pp - l}


def build_configs():
    cfgs = []
    for rules, tf, tag in [
        (ALL_RULES, True, "all"),
        (BREAKDOWN_ONLY, True, "brk"),
        (BOUNCE_REJECT, True, "bnc"),
        (ALL_RULES, False, "notrend"),
    ]:
        for target in (300.0, 600.0, 900.0):
            for sl in (-200.0, -400.0):
                for trail, t_trig, t_dist in [("off", 1e9, 250.0), ("on", 400.0, 250.0)]:
                    name = f"{tag}-t{target:.0f}-sl{abs(sl):.0f}-{trail}"
                    cfgs.append({
                        "name": name, "target": target, "sl": sl,
                        "trail_trigger": t_trig, "trail_dist": t_dist,
                        "rules": list(rules), "trend_filter": tf,
                    })
    return cfgs


def replay_day(cfg: dict, bars: list, prev_pivots: dict, t_years: float,
               include_costs: bool) -> tuple:
    """Replay one config on one day's hourly bars -> (trades, day_close)."""
    target = cfg["target"]
    sl = cfg["sl"]
    trail_trigger = cfg["trail_trigger"]
    trail_dist = cfg["trail_dist"]
    rules = set(cfg["rules"])
    trend_filter = cfg["trend_filter"]

    day_open = bars[0]["open"]
    cum_low, cum_high = float("inf"), 0.0
    anchor_low, anchor_high = None, None
    recent = []
    cooldown_until = 0
    trades = []
    pos = None

    def momentum() -> float:
        return recent[-1] - recent[-2] if len(recent) >= 2 else 0.0

    def consec_in_zone(zone_check) -> bool:
        if len(recent) < CONFIRM_SAMPLES:
            return False
        return all(zone_check(s) for s in recent[-CONFIRM_SAMPLES:])

    for i, bar in enumerate(bars):
        spot = bar["close"]
        hm = bar["ts"].strftime("%H:%M")
        hour = bar["ts"].hour
        cum_low = min(cum_low, bar["low"])
        cum_high = max(cum_high, bar["high"])
        recent.append(spot)

        down_day = spot < day_open
        up_day = spot > day_open

        # frozen breakdown/breakout anchors (never ratchet)
        if down_day and anchor_low is None:
            anchor_low = cum_low
        if up_day and anchor_high is None:
            anchor_high = cum_high
        sup_anchor = anchor_low if anchor_low is not None else cum_low
        res_anchor = anchor_high if anchor_high is not None else cum_high

        # S/R candidates: OI magnets + cumulative low/high + prior-day pivot S1/R1
        sup_cands = [x for x in [OI_SUP, cum_low, prev_pivots.get("s1")] if x is not None and x < spot]
        res_cands = [x for x in [OI_RES, cum_high, prev_pivots.get("r1")] if x is not None and x > spot]
        cand_sup = max(sup_cands) if sup_cands else cum_low
        cand_res = min(res_cands) if res_cands else cum_high
        sup = sup_anchor if down_day else cand_sup
        res = res_anchor if up_day else cand_res

        # ---- manage open position ----
        if pos:
            pnl_hi = (bs_premium(pos["side"], bar["high"], pos["strike"], t_years) - pos["premium"]) * LOT
            pnl_lo = (bs_premium(pos["side"], bar["low"], pos["strike"], t_years) - pos["premium"]) * LOT
            pos["peak"] = max(pos.get("peak", pnl_lo), pnl_hi, pnl_lo)
            reason = None
            exit_prem = None
            if pnl_lo <= sl:
                reason, gross = "SL", sl
                exit_prem = pos["premium"] + sl / LOT
            elif pos["peak"] >= trail_trigger and pnl_hi <= pos["peak"] - trail_dist:
                reason, gross = "TRAIL", round(pos["peak"] - trail_dist, 2)
                exit_prem = pos["premium"] + gross / LOT
            elif pnl_hi >= target:
                reason, gross = "TARGET", target
                exit_prem = pos["premium"] + target / LOT
            elif hour >= 15:  # EOD on hourly bars (last bar 15:15)
                exit_prem = bs_premium(pos["side"], spot, pos["strike"], t_years)
                reason, gross = "EOD", round((exit_prem - pos["premium"]) * LOT, 2)
            if reason:
                net = gross
                if include_costs and exit_prem is not None:
                    net = round(gross - option_costs(pos["premium"], exit_prem, LOT), 2)
                pos.update(reason=reason, pnl=net)
                trades.append(pos)
                pos = None
                cooldown_until = i + COOLDOWN_BARS
            continue

        if i < cooldown_until or hour >= 15:
            continue

        # ---- entry signals ----
        mom = momentum()
        allow_long = not down_day if trend_filter else True
        allow_short = not up_day if trend_filter else True

        decision = None
        sup_zone = sup + ZONE_PTS
        res_zone = res - ZONE_PTS
        sup_break = sup - BREAK_BUFFER
        res_break = res + BREAK_BUFFER

        if allow_long:
            if ("support_bounce" in rules and spot <= sup_zone and mom >= 0
                    and consec_in_zone(lambda s: s <= sup_zone)):
                decision = ("CE", f"bounce@{sup:.0f}")
            elif ("breakout" in rules and spot >= res_break and mom >= 0
                  and consec_in_zone(lambda s: s >= res_break)):
                decision = ("CE", f"breakout@{res:.0f}")
        if allow_short and decision is None:
            if ("resistance_reject" in rules and spot >= res_zone and mom <= 0
                    and consec_in_zone(lambda s: s >= res_zone)):
                decision = ("PE", f"reject@{res:.0f}")
            elif ("breakdown" in rules and spot <= sup_break and mom <= 0
                  and consec_in_zone(lambda s: s <= sup_break)):
                decision = ("PE", f"breakdown@{sup:.0f}")
        if decision:
            side, sig = decision
            base = round(spot / 100) * 100
            strike = base + (100 if side == "CE" else -100)
            premium = bs_premium(side, spot, strike, t_years)
            pos = {"side": side, "strike": strike, "entry": spot, "premium": premium,
                   "time": hm, "date": bars[0]["ts"].strftime("%Y-%m-%d"),
                   "signal": sig, "peak": 0.0}

    if pos:  # close at last bar if still open (EOD)
        exit_prem = bs_premium(pos["side"], pos and bars[-1]["close"] or spot, pos["strike"], t_years)
        gross = round((exit_prem - pos["premium"]) * LOT, 2)
        net = gross
        if include_costs:
            net = round(gross - option_costs(pos["premium"], exit_prem, LOT), 2)
        pos.update(reason="EOD", pnl=net)
        trades.append(pos)

    day_net = round(sum(t["pnl"] for t in trades), 2)
    return trades, day_net


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=0, help="limit to last N trading days (0=all)")
    ap.add_argument("--no-costs", action="store_true", help="exclude option trading charges")
    ap.add_argument("--trades-csv", action="store_true", help="also write per-trade CSV")
    args = ap.parse_args()

    by_day = load_hourly()
    dates = list(by_day.keys())
    if args.days:
        dates = dates[-args.days:]

    dte = (EXPIRY - datetime(2026, 8, 5)).total_seconds() / 86400.0
    t_years = max(dte, 1) / 365.0

    # prior-day classic pivots (no lookahead)
    pivots = {}
    prev_ohlc = None
    for d in dates:
        if prev_ohlc is None:
            pivots[d] = {}
        else:
            pivots[d] = pivot_levels(prev_ohlc)
        b = by_day[d]
        prev_ohlc = {"open": b[0]["open"], "high": max(x["high"] for x in b),
                     "low": min(x["low"] for x in b), "close": b[-1]["close"]}

    cfgs = build_configs()
    results = []
    all_trades = []

    for cfg in cfgs:
        per_day = []
        trades_all = []
        for d in dates:
            trades, day_net = replay_day(cfg, by_day[d], pivots[d], t_years,
                                         include_costs=not args.no_costs)
            per_day.append(day_net)
            trades_all.extend(trades)
        if args.trades_csv:
            for t in trades_all:
                t["config"] = cfg["name"]
                all_trades.append(t)
        nets = per_day
        wins = [t for t in trades_all if t["pnl"] > 0]
        losses = [t for t in trades_all if t["pnl"] <= 0]
        med = statistics.median(nets)
        pct_pos = round(len([n for n in nets if n > 0]) / len(nets) * 100, 1) if nets else 0.0
        cum, peak, mdd = 0.0, 0.0, 0.0
        for t in trades_all:
            cum += t["pnl"]
            peak = max(peak, cum)
            mdd = min(mdd, cum - peak)
        results.append({
            "config": cfg["name"], "params": cfg,
            "days": len(nets), "median_net": round(med, 2),
            "mean_net": round(statistics.mean(nets), 2),
            "pct_profitable_days": pct_pos,
            "total_net": round(sum(nets), 2),
            "total_trades": len(trades_all),
            "wins": len(wins), "losses": len(losses),
            "win_rate": round(len(wins) / len(trades_all) * 100, 1) if trades_all else 0.0,
            "max_dd": round(mdd, 2),
            "per_day": per_day,
        })

    results.sort(key=lambda r: (r["median_net"], r["pct_profitable_days"], r["total_net"]), reverse=True)

    tag = "NO-COSTS" if args.no_costs else "costs"
    print(f"\n=== SENSEX HOURLY SWEEP ({tag}) — {len(dates)} days ({dates[0]}..{dates[-1]}) ===")
    print(f"Configs: {len(cfgs)} | IV {IV:.0%} | t {t_years:.4f}y | lot {LOT}")
    print(f"{'#':>2} {'config':<26} {'days':>4} {'med':>7} {'mean':>7} {'%pos':>4} {'net':>8} "
          f"{'tr':>4} {'WR%':>5} {'maxDD':>8}")
    for i, r in enumerate(results, 1):
        print(f"{i:>2} {r['config']:<26} {r['days']:>4} {r['median_net']:>7,.0f} "
              f"{r['mean_net']:>7,.0f} {r['pct_profitable_days']:>4.0f} {r['total_net']:>8,.0f} "
              f"{r['total_trades']:>4} {r['win_rate']:>5.1f} {r['max_dd']:>8,.0f}")

    if len(dates) >= 10:
        print("\n=== HOLD-OUT (last 2 weeks = 10 trading days) ===")
        for r in results[:5]:
            ho = sum(r["per_day"][-10:])
            print(f"  {r['config']:<26} last-10-day net {ho:>+9,.0f}")

    today = datetime.now().strftime("%Y-%m-%d")
    out_json = DATA / f"paper_sensex_sweep_hourly_{today}.jsonl"
    with open(out_json, "w") as f:
        for r in results:
            slim = {k: v for k, v in r.items() if k != "per_day"}
            slim["per_day_nets"] = r["per_day"]
            f.write(json.dumps(slim) + "\n")
    print(f"\nsaved: {out_json}")

    if args.trades_csv:
        import csv
        out_csv = DATA / f"hourly_sweep_trades_{today}.csv"
        cols = ["config", "date", "time", "side", "strike", "entry", "premium",
                "signal", "reason", "pnl"]
        with open(out_csv, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            for t in all_trades:
                w.writerow(t)
        print(f"saved: {out_csv}")


if __name__ == "__main__":
    main()
