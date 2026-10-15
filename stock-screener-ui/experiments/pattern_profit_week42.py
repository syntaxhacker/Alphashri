"""Week-42 (Mon 2026-10-05 -> Fri 2026-10-09) pattern/strategy profit backtest.

Universe: nifty500. Daily-bar protocol (LONG only, Rs.1,00,000/trade):
  signal on bar close -> enter next bar open;
  SL = signal SL (or 1xATR where the strategy defines none);
  target = signal TP, else entry + 2x risk;
  exit at target / SL / end-of-week (Fri close).
Costs: EVERY trade through backtest/costs.py:calculate_trading_costs().

Strategies reuse the REAL live signal generators where one exists
(sr_breakout, ema_cross, week52_chaser, week52_target, adx_trend, ORB via
check_breakout). Consolidation-breakout and EMA-stack are documented custom
proxies (no live generator exists for them).

Intraday deviation: ORB is an intraday (opening-range) strategy. No intraday
fetch is done here (Upstox budget); ORB runs as a documented DAILY PROXY:
prior session high/low stands in for the opening range, close-breakoutChecked
via the real ORBSignalGenerator.check_breakout(). See DEVIATIONS in the report.
"""

from __future__ import annotations

import json
import math
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

WEEK = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]
NOTIONAL = 100_000

STRATEGY_ORDER = [
    "sr_breakout",
    "orb_proxy",
    "ema_cross",
    "week52_chaser",
    "week52_target",
    "consolidation",
    "adx_trend",
    "ema_stack",
]


# ---------------------------------------------------------------- data
def verify_sessions():
    from trading.calendar import is_trading_day

    return {d: bool(is_trading_day(datetime.strptime(d, "%Y-%m-%d").date())) for d in WEEK}


def fetch_all(symbols):
    from chart_patterns.candles import fetch_for_timeframe, frame_last_date

    out, failed = {}, {}

    def one(sym):
        try:
            df = fetch_for_timeframe(sym, "1D")
            if df is None or df.empty:
                return sym, None, "empty"
            return sym, df, frame_last_date(df)
        except Exception as e:  # noqa: BLE001
            return sym, None, str(e)[:120]

    workers = min(max(1, (os.cpu_count() or 8) - 2), 6)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for sym, df, info in ex.map(one, symbols):
            if df is None:
                failed[sym] = info
            else:
                out[sym] = (df, info)
    return out, failed


def bars_ist(df):
    """Return list of dicts {date, o,h,l,c,v} with IST session dates, sorted."""
    import pandas as pd

    idx = df.index
    try:
        ist = idx.tz_convert("Asia/Kolkata") if idx.tz is not None else idx.tz_localize("UTC").tz_convert("Asia/Kolkata")
    except Exception:  # noqa: BLE001
        ist = idx
    rows = []
    for ts, (_, row) in zip(ist, df.iterrows()):
        try:
            rows.append({
                "date": ts.strftime("%Y-%m-%d"),
                "o": float(row["open"]), "h": float(row["high"]),
                "l": float(row["low"]), "c": float(row["close"]),
                "v": float(row.get("volume", 0) or 0),
            })
        except Exception:  # noqa: BLE001
            continue
    rows.sort(key=lambda r: r["date"])
    return rows


# ---------------------------------------------------------------- indicators (pure-python, no lookahead)
def ema_series(vals, period):
    k = 2 / (period + 1)
    out, e = [], None
    for v in vals:
        e = v if e is None else v * k + e * (1 - k)
        out.append(e)
    return out


def rsi_series(closes, period=14):
    out = [None] * len(closes)
    if len(closes) <= period:
        return out
    gains, losses = [], []
    for i in range(1, len(closes)):
        ch = closes[i] - closes[i - 1]
        gains.append(max(ch, 0))
        losses.append(max(-ch, 0))
    ag = sum(gains[:period]) / period
    al = sum(losses[:period]) / period
    for i in range(period, len(closes)):
        if i > period:
            ag = (ag * (period - 1) + gains[i - 1]) / period
            al = (al * (period - 1) + losses[i - 1]) / period
        rs = ag / al if al > 0 else (math.inf if ag > 0 else 0)
        out[i] = 100 - 100 / (1 + rs) if rs != math.inf else 100.0
    return out


def atr_series(h, l, c, period=14):
    trs = []
    for i in range(len(c)):
        if i == 0:
            trs.append(h[0] - l[0])
        else:
            trs.append(max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])))
    out, a = [], None
    for t in trs:
        a = t if a is None else (a * (period - 1) + t) / period
        out.append(a)
    return out


def sma(vals, period, end):
    w = vals[max(0, end - period):end]
    return sum(w) / len(w) if w else 0.0


# ---------------------------------------------------------------- trade simulation
def simulate_entry_exit(symbol, entry_date, entry_open, qty, sl, tp, week_bars, start_idx):
    """Walk holding sessions from start_idx; SL-first on ambiguous days; EOW exit Fri close."""
    from backtest.costs import calculate_trading_costs

    def costs(x):
        return calculate_trading_costs(entry_open, x, qty)["total_costs"]

    for j in range(start_idx, len(week_bars)):
        b = week_bars[j]
        hit_sl = b["l"] <= sl
        hit_tp = b["h"] >= tp
        if hit_sl and hit_tp:
            px, reason = sl, "SL"  # conservative: SL first
        elif hit_sl:
            px, reason = sl, "SL"
        elif hit_tp:
            px, reason = tp, "TARGET"
        elif j == len(week_bars) - 1:
            px, reason = b["c"], "EOW"
        else:
            continue
        gross = (px - entry_open) * qty
        c = costs(px)
        return {"exit_date": b["date"], "exit_price": round(px, 2), "exit_reason": reason,
                "gross": round(gross, 2), "costs": round(c, 2), "net": round(gross - c, 2)}
    return None


def finalize_signal(strategy, symbol, notes, sig_price, sl, tp, week_bars, entry_idx, risk_fallback_atr=None):
    """Common: enter next-bar open, fix TP if invalid, simulate, build record."""
    if entry_idx >= len(week_bars):
        return None
    entry = week_bars[entry_idx]
    entry_open = entry["o"]
    if not entry_open or entry_open <= 0:
        return None
    if sl is None or sl <= 0 or sl >= entry_open:
        if risk_fallback_atr:
            sl = entry_open - risk_fallback_atr
        else:
            return None
    risk = entry_open - sl
    if risk <= 0:
        return None
    if tp is None or tp <= entry_open:
        tp = entry_open + 2 * risk
    qty = max(1, int(NOTIONAL // entry_open))
    res = simulate_entry_exit(symbol, entry["date"], entry_open, qty, sl, tp, week_bars, entry_idx)
    if res is None:
        return None
    return {
        "strategy": strategy, "symbol": symbol,
        "signal_date": week_bars[entry_idx - 1]["date"],
        "signal_price": round(float(sig_price), 2),
        "entry_date": entry["date"], "entry_price": round(entry_open, 2),
        "qty": qty, "sl": round(sl, 2), "tp": round(tp, 2),
        "notes": (notes or "")[:220],
        **res,
    }


# ---------------------------------------------------------------- per-strategy signal passes
def run_strategy(strategy, prepared):
    """prepared: {sym: (week_bars, hist)} ; hist = bars strictly before week."""
    from trading.orb_signals import SignalType

    trades = []

    if strategy == "sr_breakout":
        from trading.sr_breakout_signals import SRBreakoutSignalGenerator

        gen = SRBreakoutSignalGenerator({})
        for sym, (wb, hist) in prepared.items():
            allb = hist + wb
            base = len(hist)
            for k in range(len(wb) - 1):  # Mon..Thu signals
                i = base + k
                prev = allb[i - 1]
                piv = gen.calculate_pivot_points(prev["h"], prev["l"], prev["c"])
                sig = gen.check_entry(sym, {"current_price": allb[i]["c"], "pivot_points": piv})
                if sig is None or sig.signal_type != SignalType.LONG_ENTRY:
                    continue
                t = finalize_signal(strategy, sym, sig.notes, sig.price, sig.stop_loss,
                                    sig.take_profit, wb, k + 1)
                if t:
                    trades.append(t)

    elif strategy == "orb_proxy":
        from trading.orb_signals import ORBSignalGenerator

        gen = ORBSignalGenerator(sl_pct=1.0, tp_pct=1.5)
        for sym, (wb, hist) in prepared.items():
            allb = hist + wb
            base = len(hist)
            for k in range(len(wb) - 1):
                i = base + k
                prev = allb[i - 1]
                rng = prev["h"] - prev["l"]
                rng_pct = (rng / prev["c"] * 100) if prev["c"] else 0
                or_levels = {"or_high": prev["h"], "or_low": prev["l"],
                             "or_range": rng, "or_range_pct": rng_pct}
                sig = gen.check_breakout(sym, allb[i]["c"], or_levels)
                if sig is None or sig.signal_type != SignalType.LONG_ENTRY:
                    continue
                t = finalize_signal(strategy, sym, sig.notes, sig.price, sig.stop_loss,
                                    sig.take_profit, wb, k + 1)
                if t:
                    trades.append(t)

    elif strategy == "ema_cross":
        from trading.ema_cross_signals import EMACrossSignalGenerator

        for sym, (wb, hist) in prepared.items():
            allb = hist + wb
            base = len(hist)
            closes = [b["c"] for b in allb]
            e9, e21 = ema_series(closes, 9), ema_series(closes, 21)
            gen = EMACrossSignalGenerator({"enable_shorts": False})
            for k in range(len(wb) - 1):
                i = base + k
                if i < 22:
                    continue
                sig = gen.check_entry(sym, {"current_price": allb[i]["c"],
                                            "ema_fast_current": e9[i], "ema_fast_prev": e9[i - 1],
                                            "ema_slow_current": e21[i], "ema_slow_prev": e21[i - 1]})
                if sig is None or sig.signal_type != SignalType.LONG_ENTRY:
                    continue
                t = finalize_signal(strategy, sym, sig.notes, sig.price, sig.stop_loss,
                                    sig.take_profit, wb, k + 1)
                if t:
                    trades.append(t)

    elif strategy in ("week52_chaser", "week52_target"):
        from trading.week52_utils import calculate_52w_high
        if strategy == "week52_chaser":
            from trading.week52_chaser_signals import Week52ChaserSignalGenerator as Gen
        else:
            from trading.week52_target_signals import Week52TargetSignalGenerator as Gen

        gen = Gen({"enable_filters": False})
        for sym, (wb, hist) in prepared.items():
            allb = hist + wb
            base = len(hist)
            for k in range(len(wb) - 1):
                i = base + k
                highs = [b["h"] for b in allb[: i + 1]]
                if len(highs) < 30:
                    continue
                h52 = calculate_52w_high(highs, exclude_current=True)
                if not h52:
                    continue
                # days since the 52w high was touched
                ds = 99
                for back, b in enumerate(reversed(allb[:i])):
                    if b["h"] >= h52 * 0.999:
                        ds = back
                        break
                vols = [b["v"] for b in allb[max(0, i - 20): i]]
                avg20 = sum(vols) / len(vols) if vols else 0
                md = {"current_price": allb[i]["c"], "high_52w": h52,
                      "daily_highs": highs, "days_since_52w_high": ds,
                      "volume": allb[i]["v"], "avg_volume_20d": avg20,
                      "today_intraday_high": allb[i]["h"]}
                sig = gen.check_entry(sym, md)
                if sig is None or sig.signal_type != SignalType.LONG_ENTRY:
                    continue
                t = finalize_signal(strategy, sym, sig.notes, sig.price, sig.stop_loss,
                                    sig.take_profit, wb, k + 1)
                if t:
                    trades.append(t)

    elif strategy == "consolidation":
        for sym, (wb, hist) in prepared.items():
            allb = hist + wb
            base = len(hist)
            closes = [b["c"] for b in allb]
            a14 = atr_series([b["h"] for b in allb], [b["l"] for b in allb], closes)
            for k in range(len(wb) - 1):
                i = base + k
                if i < 21:
                    continue
                window = allb[i - 20:i]
                rh, rl = max(b["h"] for b in window), min(b["l"] for b in window)
                tight = ((rh - rl) / allb[i]["c"] * 100) if allb[i]["c"] else 999
                if tight > 10.0 or allb[i]["c"] <= rh:
                    continue
                notes = f"20d tight-range ({tight:.1f}%) breakout above ₹{rh:.2f} | SL=range-low/ATR TP=2R"
                sl = rl if rl < allb[i]["c"] else allb[i]["c"] - a14[i]
                t = finalize_signal(strategy, sym, notes, allb[i]["c"], sl, None, wb, k + 1)
                if t:
                    trades.append(t)

    elif strategy == "adx_trend":
        from trading.adx_trend_signals import ADXTrendSignalGenerator

        gen = ADXTrendSignalGenerator({"enable_shorts": False})
        for sym, (wb, hist) in prepared.items():
            allb = hist + wb
            base = len(hist)
            for k in range(len(wb) - 1):
                i = base + k
                if i < 30:
                    continue
                seg = allb[: i + 1]
                md = {"current_price": allb[i]["c"],
                      "daily_highs": [b["h"] for b in seg],
                      "daily_lows": [b["l"] for b in seg],
                      "daily_closes": [b["c"] for b in seg]}
                sig = gen.check_entry(sym, md)
                if sig is None or sig.signal_type != SignalType.LONG_ENTRY:
                    continue
                t = finalize_signal(strategy, sym, sig.notes, sig.price, sig.stop_loss,
                                    sig.take_profit, wb, k + 1)
                if t:
                    trades.append(t)

    elif strategy == "ema_stack":
        for sym, (wb, hist) in prepared.items():
            allb = hist + wb
            base = len(hist)
            closes = [b["c"] for b in allb]
            e20, e50 = ema_series(closes, 20), ema_series(closes, 50)
            a14 = atr_series([b["h"] for b in allb], [b["l"] for b in allb], closes)
            for k in range(len(wb) - 1):
                i = base + k
                if i < 51:
                    continue
                rh20 = max(b["h"] for b in allb[i - 20:i])
                if not (allb[i]["c"] > e20[i] > e50[i] and allb[i]["c"] > rh20):
                    continue
                notes = (f"EMA-stack close ₹{allb[i]['c']:.2f} > 20EMA ₹{e20[i]:.2f} > 50EMA ₹{e50[i]:.2f} "
                         f"+ 20d-high ₹{rh20:.2f} break | SL=1xATR TP=2R")
                t = finalize_signal(strategy, sym, notes, allb[i]["c"],
                                    allb[i]["c"] - a14[i], None, wb, k + 1)
                if t:
                    trades.append(t)

    return trades


# ---------------------------------------------------------------- metrics
def metrics(trades):
    n = len(trades)
    if n == 0:
        return {"trades": 0, "wins": 0, "win_rate": 0.0, "gross_pnl": 0.0,
                "costs": 0.0, "net_pnl": 0.0, "max_drawdown": 0.0,
                "profit_factor": 0.0, "expectancy": 0.0}
    wins = sum(1 for t in trades if t["net"] > 0)
    gross = round(sum(t["gross"] for t in trades), 2)
    costs = round(sum(t["costs"] for t in trades), 2)
    net = round(sum(t["net"] for t in trades), 2)
    gp = sum(t["gross"] for t in trades if t["gross"] > 0)
    gl = abs(sum(t["gross"] for t in trades if t["gross"] < 0))
    eq, peak, mdd = 0.0, 0.0, 0.0
    for t in sorted(trades, key=lambda x: (x["exit_date"], x["symbol"])):
        eq += t["net"]
        peak = max(peak, eq)
        mdd = max(mdd, peak - eq)
    return {"trades": n, "wins": wins, "win_rate": round(wins / n * 100, 1),
            "gross_pnl": gross, "costs": costs, "net_pnl": net,
            "max_drawdown": round(mdd, 2),
            "profit_factor": round(gp / gl, 2) if gl > 0 else (round(gp, 2) if gp > 0 else 0.0),
            "expectancy": round(net / n, 2)}


def spot_check(all_trades, data):
    """Independently recompute 3 trades from raw candles (no generators)."""
    from backtest.costs import calculate_trading_costs

    picks = []
    for s in STRATEGY_ORDER:
        for t in all_trades:
            if t["strategy"] == s:
                picks.append(t)
                break
        if len(picks) == 3:
            break
    out = []
    for t in picks:
        df, _ = data[t["symbol"]]
        rows = {r["date"]: r for r in bars_ist(df)}
        e = rows[t["entry_date"]]
        qty = max(1, int(NOTIONAL // e["o"]))
        assert qty == t["qty"], f"qty mismatch {t}"
        assert abs(e["o"] - t["entry_price"]) < 0.01, f"entry mismatch {t}"
        # independent walk: first-hit wins from entry day onward, SL-first
        rpx, rreason, rdate = None, None, None
        days = WEEK[WEEK.index(t["entry_date"]):]
        for di, d in enumerate(days):
            b = rows[d]
            sl_hit, tp_hit = b["l"] <= t["sl"], b["h"] >= t["tp"]
            if sl_hit:
                rpx, rreason, rdate = t["sl"], "SL", d
                break
            if tp_hit:
                rpx, rreason, rdate = t["tp"], "TARGET", d
                break
            if di == len(days) - 1:
                rpx, rreason, rdate = b["c"], "EOW", d
        gross = (rpx - e["o"]) * qty
        c = calculate_trading_costs(e["o"], rpx, qty)["total_costs"]
        ok = (abs(gross - t["gross"]) < 0.01 and abs(c - t["costs"]) < 0.01
              and abs(gross - c - t["net"]) < 0.01
              and rreason == t["exit_reason"] and rdate == t["exit_date"]
              and abs(rpx - t["exit_price"]) < 0.01)
        out.append({"symbol": t["symbol"], "strategy": t["strategy"],
                    "entry": f"{t['entry_date']}@{t['entry_price']}x{t['qty']}",
                    "exit": f"{t['exit_date']}@{t['exit_price']} {t['exit_reason']}",
                    "gross": t["gross"], "costs": t["costs"], "net": t["net"],
                    "recomputed_exit": f"{rdate}@{round(rpx, 2)} {rreason}",
                    "recomputed_gross": round(gross, 2), "recomputed_costs": round(c, 2),
                    "recomputed_net": round(gross - c, 2),
                    "match": bool(ok)})
    return out


def main():
    from chart_patterns.universes import get_universe

    t0 = datetime.now()
    sessions_ok = verify_sessions()
    assert all(sessions_ok.values()), f"non-trading day in week: {sessions_ok}"
    universe = get_universe("nifty500")
    print(f"universe nifty500: {len(universe)} symbols", flush=True)

    data, failed = fetch_all(universe)
    print(f"fetched {len(data)}, failed {len(failed)}", flush=True)

    # slice week bars + history; track data-through + skips
    prepared, skipped, through = {}, {}, {}
    for sym, (df, last) in data.items():
        rows = bars_ist(df)
        bydate = {r["date"]: r for r in rows}
        if not all(d in bydate for d in WEEK):
            missing = [d for d in WEEK if d not in bydate]
            skipped[sym] = f"missing week bars {missing} (through {last})"
            continue
        wb = [bydate[d] for d in WEEK]
        hist = [r for r in rows if r["date"] < WEEK[0]]
        if len(hist) < 60:
            skipped[sym] = f"only {len(hist)} pre-week bars (through {last})"
            continue
        prepared[sym] = (wb, hist)
        through[sym] = last
    print(f"usable {len(prepared)}, skipped {len(skipped)}", flush=True)

    all_trades = []
    per_strategy = {}
    for s in STRATEGY_ORDER:
        tr = run_strategy(s, prepared)
        per_strategy[s] = {"metrics": metrics(tr), "trades": tr}
        all_trades.extend(tr)
        m = per_strategy[s]["metrics"]
        print(f"{s}: {m['trades']} trades net {m['net_pnl']}", flush=True)

    # per-symbol aggregate incl. all strategies
    by_sym = {}
    for t in all_trades:
        by_sym.setdefault(t["symbol"], []).append(t)
    sym_rows = [{"symbol": s, "trades": len(v), "net": round(sum(t["net"] for t in v), 2),
                 "gross": round(sum(t["gross"] for t in v), 2)}
                for s, v in by_sym.items()]
    sym_rows.sort(key=lambda r: r["net"], reverse=True)

    checks = spot_check(all_trades, data)

    exp_dir = Path(__file__).resolve().parent
    payload = {
        "week": WEEK, "universe": "nifty500", "universe_size": len(universe),
        "notional_per_trade": NOTIONAL, "protocol": "signal-on-close, enter-next-open, LONG-only",
        "sessions_verified_trading_days": sessions_ok,
        "data_through": {"min": min(through.values()) if through else None,
                         "max": max(through.values()) if through else None},
        "symbols_used": len(prepared), "symbols_skipped": skipped,
        "fetch_failed": failed,
        "per_strategy": {s: per_strategy[s]["metrics"] for s in STRATEGY_ORDER},
        "signals": sorted(all_trades, key=lambda t: (t["strategy"], t["entry_date"], t["symbol"])),
        "per_symbol": sym_rows,
        "spot_check": checks,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "elapsed_sec": round((datetime.now() - t0).total_seconds()),
    }
    (exp_dir / "pattern_profit_week42.json").write_text(json.dumps(payload, indent=1))

    lines = ["# Week-42 pattern/strategy backtest (2026-10-05 → 2026-10-09)",
             "",
             f"Universe nifty500 ({len(universe)}); used {len(prepared)}, "
             f"skipped {len(skipped)}, fetch-failed {len(failed)}. "
             f"Data through {payload['data_through']['min']}…{payload['data_through']['max']}.",
             "Protocol: signal on bar close → enter next bar open; SL = signal SL (1×ATR fallback); "
             "target = signal TP else 2×risk; exit target/SL/EOW; LONG only; ₹1,00,000/trade; "
             "costs via backtest/costs.py on every trade.",
             "",
             "| strategy | trades | win% | gross | costs | NET | maxDD | PF | exp/trade |",
             "|---|---|---|---|---|---|---|---|---|"]
    for s in STRATEGY_ORDER:
        m = per_strategy[s]["metrics"]
        lines.append(f"| {s} | {m['trades']} | {m['win_rate']} | {m['gross_pnl']} | "
                     f"{m['costs']} | {m['net_pnl']} | {m['max_drawdown']} | "
                     f"{m['profit_factor']} | {m['expectancy']} |")
    tot = metrics(all_trades)
    lines += ["",
              f"TOTAL {tot['trades']} trades, NET ₹{tot['net_pnl']} "
              f"(gross {tot['gross_pnl']}, costs {tot['costs']}), win {tot['win_rate']}% PF {tot['profit_factor']}.",
              "",
              "## Top-20 winners",
              "| symbol | trades | net |", "|---|---|---|"]
    lines += [f"| {r['symbol']} | {r['trades']} | {r['net']} |" for r in sym_rows[:20]]
    lines += ["", "## Top-20 losers", "| symbol | trades | net |", "|---|---|---|"]
    lines += [f"| {r['symbol']} | {r['trades']} | {r['net']} |" for r in sym_rows[-20:][::-1]]
    lines += ["", "## DEVIATIONS",
              "- ORB is `orb_proxy`: prior-session high/low stands in for the intraday opening range "
              "(no intraday fetch; Upstox budget). Real ORB needs 5-min bars.",
              "- SR breakout uses prior-session pivots + close-break confirmation (daily adaptation).",
              "- week52_target TP=0 from generator → replaced with entry+2×risk per protocol.",
              "- Same-day SL+TP ambiguity resolved SL-first (conservative).",
              "- Consolidation + EMA-stack are custom proxies (no live generator exists).",
              "", "## Spot-check (independent recompute from raw candles)"]
    for c in checks:
        lines.append(f"- {c['strategy']} {c['symbol']} {c['entry']} → {c['exit']}: "
                     f"net {c['net']} recomputed {round(c['recomputed_gross'] - c['recomputed_costs'], 2)} "
                     f"match={c['match']}")
    lines += ["", "## Skipped symbols (missing data)",
              f"{len(skipped)} skipped, {len(failed)} fetch-failed. Full lists in JSON."]
    (exp_dir / "pattern_profit_week42.md").write_text("\n".join(lines) + "\n")
    print("wrote pattern_profit_week42.md + .json", flush=True)


if __name__ == "__main__":
    main()
