"""SMC strategy evaluation on Dukascopy tick data (US 100 Tech Index CFD — NQ proxy).

Pipeline per random session:
  1. Fetch real ticks via dukascopy-node (installed separately, see DUKA_DIR).
  2. Build 1m OHLC bars from bid ticks → run the REAL SMCSignalGenerator (trading/smc_signals.py)
     bar-by-bar, history-only, identical to /api/poc/smc-trades.
  3. Evaluate each signal on ticks: long fills at next ask tick after signal-bar close,
     exits on bid (conservative) — first tick crossing SL or TP wins, else EOD at last tick.

Usage:
  source .venv/bin/activate && python scripts/smc_tick_eval.py --days 5 --seed 42
"""
import argparse
import json
import os
import random
import subprocess
import sys
from datetime import date as date_cls, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DUKA_DIR = os.environ.get("DUKA_DIR", "/tmp/opencode/duka")
CACHE_DIR = os.path.join("experiments", "data", "duka_cache")
INSTRUMENT = "usatechidxusd"
# Globex-style day replicated from yfinance NQ=F sessions: 04:00 UTC → next-day 04:00 UTC
SESSION_START_UTC = 4 * 3600


def fetch_ticks(day: str) -> list:
    """Fetch ticks for [day 04:00 UTC, next day 04:00 UTC) via dukascopy-node, disk-cached."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache_file = os.path.join(CACHE_DIR, f"{INSTRUMENT}_{day}.json")
    if os.path.exists(cache_file):
        with open(cache_file) as f:
            return json.load(f)

    d = date_cls.fromisoformat(day)
    start = datetime(d.year, d.month, d.day, tzinfo=timezone.utc) + timedelta(seconds=SESSION_START_UTC)
    end = start + timedelta(days=1)
    js = f"""
const {{ getHistoricalRates }} = require('dukascopy-node');
(async () => {{
  try {{
    const data = await getHistoricalRates({{
      instrument: '{INSTRUMENT}',
      dates: {{ from: new Date('{start.isoformat()}'), to: new Date('{end.isoformat()}') }},
      timeframe: 'tick',
      format: 'json',
    }});
    console.log(JSON.stringify(data));
  }} catch (e) {{ console.log(JSON.stringify({{ error: e.message }})); }}
}})();
"""
    out = subprocess.run(["node", "-e", js], cwd=DUKA_DIR, capture_output=True, text=True, timeout=600)
    try:
        data = json.loads(out.stdout.strip())
    except Exception:
        raise RuntimeError(f"dukascopy-node failed for {day}: {out.stdout[:200]} {out.stderr[:200]}")
    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(f"dukascopy-node error for {day}: {data['error']}")
    with open(cache_file, "w") as f:
        json.dump(data, f)
    return data


def build_1m_bars(ticks: list) -> list:
    """1m OHLC from bid ticks (dukascopy candles convention). time = minute-start unix sec UTC."""
    bars = {}
    for t in ticks:
        ts = t["timestamp"] / 1000.0
        minute = int(ts // 60) * 60
        bid = t["bidPrice"]
        b = bars.get(minute)
        if b is None:
            bars[minute] = {"time": minute, "open": bid, "high": bid, "low": bid, "close": bid}
        else:
            b["high"] = max(b["high"], bid)
            b["low"] = min(b["low"], bid)
            b["close"] = bid
    return [bars[k] for k in sorted(bars)]


def evaluate_on_ticks(signals: list, ticks: list, bars: list) -> list:
    """Fill at next ask tick after signal bar close; exits on bid — SL/TP first tick wins, else EOD."""
    trades = []
    sig_iter = iter(signals)
    next_sig = next(sig_iter, None)
    open_trade = None
    for t in ticks:
        ts = t["timestamp"]
        sec = ts / 1000.0
        if open_trade is None and next_sig is not None:
            sig_end_sec = next_sig["time"] + 60  # signal bar close (unix sec)
            if sec >= sig_end_sec:
                open_trade = dict(next_sig)
                open_trade["fill"] = t["askPrice"]  # buy at ask
                next_sig = next(sig_iter, None)
            continue
        if open_trade is None:
            continue
        bid = t["bidPrice"]
        is_long = open_trade["side"] == "LONG"
        hit_sl = bid <= open_trade["sl"] if is_long else bid >= open_trade["sl"]
        hit_tp = bid >= open_trade["tp"] if is_long else bid <= open_trade["tp"]
        if hit_sl:  # conservative: SL checked first on the same tick
            open_trade.update(result="SL", exit_time=int(ts // 1000), pnl=round(open_trade["sl"] - open_trade["fill"], 2))
            trades.append(open_trade); open_trade = None
        elif hit_tp:
            open_trade.update(result="TP", exit_time=int(ts // 1000), pnl=round(open_trade["tp"] - open_trade["fill"], 2))
            trades.append(open_trade); open_trade = None
    if open_trade is not None:  # EOD — exit at last bid of the session
        last_tick = ticks[-1]
        open_trade.update(result="EOD", exit_time=int(last_tick["timestamp"] // 1000), pnl=round(last_tick["bidPrice"] - open_trade["fill"], 2))
        trades.append(open_trade)
    for tr in trades:
        entry_sec = (tr["time"] + 60)
        tr["held_min"] = max(0, int((tr["exit_time"] - entry_sec) / 60))
        del tr["entry_idx"]
    return trades


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=5)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--window-start", default="2026-07-01")
    ap.add_argument("--window-end", default="2026-09-01")
    args = ap.parse_args()

    random.seed(args.seed)
    start_d = date_cls.fromisoformat(args.window_start)
    end_d = date_cls.fromisoformat(args.window_end)
    weekdays = []
    d = start_d
    while d <= end_d:
        if d.weekday() < 5:  # Mon–Fri (Fri session ends early at market close — handled naturally)
            weekdays.append(d.isoformat())
        d += timedelta(days=1)
    sessions = sorted(random.sample(weekdays, args.days))

    from api.poc_nq import detect_smc_signals

    all_trades = []
    for day in sessions:
        try:
            ticks = fetch_ticks(day)
        except Exception as e:
            print(f"\n=== {day} — SKIPPED: {e}")
            continue
        bars = build_1m_bars(ticks)
        if len(bars) < 60:
            print(f"\n=== {day} — SKIPPED: only {len(bars)} 1m bars from ticks")
            continue
        signals = detect_smc_signals(bars)
        trades = evaluate_on_ticks(signals, ticks, bars)
        net = sum(t["pnl"] for t in trades)
        wins = [t for t in trades if t["pnl"] > 0]
        losses = [t for t in trades if t["pnl"] <= 0]
        gp = sum(t["pnl"] for t in wins)
        gl = abs(sum(t["pnl"] for t in losses))
        pf = gp / gl if gl else float("inf")
        print(f"\n=== {day} — {len(ticks):,} ticks → {len(bars)} 1m bars — {len(trades)} signals — net {net:+.2f} pts — PF {pf:.2f}")
        for tr in trades:
            ts = datetime.fromtimestamp(tr["time"], tz=timezone.utc).astimezone()
            print(f"  {ts:%d %b %H:%M} {tr['side']:<5} fill {tr['fill']:.2f} SL {tr['sl']:.2f} TP {tr['tp']:.2f} "
                  f"→ {tr['result']:<3} {tr['pnl']:+.2f} pts ({tr['held_min']}m) | {tr['note']}")
        all_trades.extend(trades)

    print(f"\n========== SUMMARY — {len(sessions)} random sessions ==========")
    if not all_trades:
        print("no trades")
        return
    wins = [t for t in all_trades if t["pnl"] > 0]
    losses = [t for t in all_trades if t["pnl"] <= 0]
    gp = sum(t["pnl"] for t in wins)
    gl = abs(sum(t["pnl"] for t in losses))
    net = sum(t["pnl"] for t in all_trades)
    print(f"trades: {len(all_trades)}  TP: {sum(1 for t in all_trades if t['result']=='TP')}  "
          f"SL: {sum(1 for t in all_trades if t['result']=='SL')}  EOD: {sum(1 for t in all_trades if t['result']=='EOD')}")
    print(f"win rate: {len(wins)}/{len(all_trades)} = {100*len(wins)/len(all_trades):.0f}%")
    print(f"net: {net:+.2f} pts   PF: {gp/gl if gl else float('inf'):.2f}   avg hold: {sum(t['held_min'] for t in all_trades)/len(all_trades):.0f} min")


if __name__ == "__main__":
    main()
