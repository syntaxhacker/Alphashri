"""52W-high hitters for week Mon 2026-10-05 -> Fri 2026-10-09.

Universe: experiments/target_universe_symbols.json (227 liquid symbols).
Method: chart_patterns.candles 1D frames; prior 52W high = max high of 252
sessions strictly before 2026-10-05; hitter = any session Oct 5-9 with
high >= prior high. Costs via backtest/costs.py:calculate_trading_costs,
Rs 1L per trade (qty = floor(100000/entry)).

Scenarios per hitter:
  (a) buy first-hit close -> sell Friday (Oct 9) close
  (b) breakout proxy: first close above prior high in Oct 5-9 window,
      2% SL (checked on daily lows after entry day), Friday exit
  (c) chaser-style: subset of (a) where first-hit close is within
      week52_chaser entry band [min_breakout 0.5%, entry_threshold 3.0%]
      above prior high.
"""
import json
import math
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backtest.costs import calculate_trading_costs  # noqa: E402
from chart_patterns.candles import fetch_for_timeframe  # noqa: E402

ROOT = Path(__file__).resolve().parent
WEEK = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]
FRIDAY = "2026-10-09"
CUT = "2026-10-05"
CAPITAL = 100_000.0
CHASER_MIN_PCT = 0.5
CHASER_MAX_PCT = 3.0
SL_PCT_B = 2.0


def to_ist_daily(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    try:
        if out.index.tz is None:
            ist = out.index.tz_localize("UTC").tz_convert("Asia/Kolkata")
        else:
            ist = out.index.tz_convert("Asia/Kolkata")
    except Exception:
        ist = out.index
    out.index = ist
    out["session"] = ist.strftime("%Y-%m-%d")
    # one row per session (last bar wins)
    out = out.groupby("session", as_index=False).last()
    out = out.set_index("session").sort_index()
    return out


def trade_gross_net(entry: float, exit_: float):
    qty = int(CAPITAL // entry) if entry and entry > 0 else 0
    if qty <= 0:
        return None
    gross = (exit_ - entry) * qty
    costs = calculate_trading_costs(entry, exit_, qty)["total_costs"]
    return {"qty": qty, "entry": entry, "exit": exit_,
            "gross": round(gross, 2), "costs": costs,
            "net": round(gross - costs, 2)}


def main():
    uni = json.loads((ROOT / "target_universe_symbols.json").read_text())
    symbols = uni["symbols"]
    print(f"universe={len(symbols)} week={WEEK[0]}..{WEEK[-1]}", flush=True)

    hitters = []
    no_data = []
    friday_missing = []
    for i, sym in enumerate(symbols):
        try:
            df = fetch_for_timeframe(sym, "1D")
        except Exception as e:
            no_data.append({"symbol": sym, "err": str(e)[:80]})
            continue
        if df is None or df.empty:
            no_data.append({"symbol": sym, "err": "empty"})
            continue
        d = to_ist_daily(df)
        prior = d[d.index < CUT]
        if len(prior) < 60:
            no_data.append({"symbol": sym, "err": f"only {len(prior)} prior bars"})
            continue
        prior_high = float(prior["high"].tail(252).max())
        week_rows = {s: d.loc[s] for s in WEEK if s in d.index}
        if FRIDAY not in d.index:
            friday_missing.append(sym)
            continue
        fri_close = float(d.loc[FRIDAY]["close"])
        hits = [s for s in WEEK if s in week_rows and float(week_rows[s]["high"]) >= prior_high]
        if not hits:
            continue
        first = hits[0]
        fh_close = float(week_rows[first]["close"])
        fh = {s: {"o": float(week_rows[s]["open"]), "h": float(week_rows[s]["high"]),
                  "l": float(week_rows[s]["low"]), "c": float(week_rows[s]["close"]),
                  "v": int(week_rows[s]["volume"])} for s in hits}
        # Monday gap flag: gapped over prior high (open >= prior high) on Monday
        # with previous session (Oct 1, since Oct 2 holiday) close below prior high
        monday_gap = False
        if first == "2026-10-05":
            prev_close = float(prior.iloc[-1]["close"])  # Oct 1 close
            monday_gap = bool(float(week_rows[first]["open"]) >= prior_high
                              and prev_close < prior_high)
        # scenario (a)
        ta = trade_gross_net(fh_close, fri_close)
        # scenario (b): first close above prior high in window
        b_entry_day, b_entry = None, None
        for s in WEEK:
            if s in week_rows and float(week_rows[s]["close"]) > prior_high:
                b_entry_day, b_entry = s, float(week_rows[s]["close"])
                break
        tb, b_exit_day, b_exit, b_stopped = None, None, None, False
        if b_entry is not None:
            sl = b_entry * (1 - SL_PCT_B / 100)
            b_exit, b_exit_day = fri_close, FRIDAY
            for s in WEEK:
                if s <= b_entry_day:
                    continue
                if s in week_rows and float(week_rows[s]["low"]) <= sl:
                    b_exit, b_exit_day, b_stopped = sl, s, True
                    break
            tb = trade_gross_net(b_entry, b_exit)
        # scenario (c): chaser band on first-hit close
        pct_above = (fh_close - prior_high) / prior_high * 100
        chaser_ok = CHASER_MIN_PCT <= pct_above <= CHASER_MAX_PCT
        hitters.append({
            "symbol": sym, "prior_52w_high": round(prior_high, 2),
            "prior_bars": int(min(252, len(prior))),
            "first_hit_day": first, "hit_days": hits,
            "first_hit_close": round(fh_close, 2),
            "pct_above_prior_at_first_close": round(pct_above, 3),
            "friday_close": round(fri_close, 2),
            "week_highs": fh, "monday_gap": monday_gap,
            "scenario_a": ta,
            "scenario_b": {"entry_day": b_entry_day,
                           "entry": round(b_entry, 2) if b_entry else None,
                           "exit_day": b_exit_day,
                           "exit": round(b_exit, 2) if b_exit else None,
                           "stopped": b_stopped,
                           "trade": tb},
            "scenario_c_eligible": chaser_ok,
            "scenario_c": ta if chaser_ok else None,
        })
        print(f"[{i+1}/{len(symbols)}] HIT {sym} first={first} "
              f"prior={prior_high:.2f} fhc={fh_close:.2f} fri={fri_close:.2f}", flush=True)

    hitters.sort(key=lambda r: r["symbol"])
    print(f"\nhitters={len(hitters)} no_data={len(no_data)} "
          f"friday_missing={len(friday_missing)}", flush=True)

    def tot(key):
        ts = [h[key] for h in hitters
              if isinstance(h[key], dict) and h[key] and h[key].get("qty")]
        if key == "scenario_b":
            ts = [h[key]["trade"] for h in hitters
                  if h[key].get("trade") and h[key]["trade"].get("qty")]
        return {"n": len(ts),
                "gross": round(sum(t["gross"] for t in ts), 2),
                "costs": round(sum(t["costs"] for t in ts), 2),
                "net": round(sum(t["net"] for t in ts), 2),
                "wins": sum(1 for t in ts if t["net"] > 0),
                "losses": sum(1 for t in ts if t["net"] <= 0)}

    totals = {"scenario_a": tot("scenario_a"), "scenario_b": tot("scenario_b"),
              "scenario_c": tot("scenario_c")}
    day_dist = {s: sum(1 for h in hitters if h["first_hit_day"] == s) for s in WEEK}
    gaps = sorted(h["symbol"] for h in hitters if h["monday_gap"])
    b_stops = sorted(h["symbol"] for h in hitters
                     if h["scenario_b"].get("stopped"))
    b_noentry = sorted(h["symbol"] for h in hitters
                       if h["scenario_b"].get("entry_day") is None)
    print("totals=" + json.dumps(totals), flush=True)
    print("day_dist=" + json.dumps(day_dist), flush=True)
    print(f"monday_gaps({len(gaps)})={gaps}", flush=True)
    print(f"b_stopped({len(b_stops)})={b_stops}", flush=True)
    print(f"b_no_entry_close_above({len(b_noentry)})={b_noentry}", flush=True)

    out = {"meta": {
        "week": WEEK, "universe": "target_universe_symbols.json",
        "universe_n": len(symbols), "capital_per_trade": CAPITAL,
        "costs": "backtest/costs.py:calculate_trading_costs",
        "prior_52w": "max high of 252 sessions before 2026-10-05",
        "hitter": "any Oct5-9 session high >= prior high",
        "scenario_a": "buy first-hit close -> sell Oct9 close",
        "scenario_b": "first Oct5-9 close>prior high, 2% SL on daily lows, Oct9 exit",
        "scenario_c": "subset of (a) with first-hit close +0.5..+3.0% above prior "
                      "(week52_chaser entry band)",
        "note_oct2": "2026-10-02 Gandhi Jayanti NSE holiday; pre-week close = Oct 1",
        "no_data": no_data, "friday_missing": friday_missing},
        "day_distribution": day_dist, "monday_gaps": gaps,
        "scenario_b_stopped": b_stops,
        "scenario_b_no_close_above": b_noentry,
        "totals": totals, "hitters": hitters}
    (ROOT / "chaser_outcome.json").write_text(json.dumps(out, indent=1))
    print("wrote experiments/chaser_outcome.json", flush=True)


if __name__ == "__main__":
    main()
