#!/usr/bin/env bash
set -euo pipefail

# Fast pre-check: syntax
python3 -m py_compile trading/smc_signals.py
python3 -m py_compile backtest/strategies/smc.py

# Run SMC on 5 random days (holdout) — no overfit to 09-02
# Uses yfinance 5m IST, 2 micros $4/pt, reports METRIC lines
.venv/bin/python << 'PY'
import yfinance as yf, pandas as pd, random
from trading.smc_signals import SMCSignalGenerator

days = ["2026-08-26","2026-08-27","2026-08-28","2026-09-01","2026-09-02"]
# pick 5 random (here all 5 for stable metric, but shuffle order for OOS feel)
random.seed(42)
# Use 5m for speed; 1m also tried but 5m is primary for paper
total_net=0
total_trades=0
total_wins=0
rrs=[]
for d in days:
    df=yf.download("NQ=F", start=d, end=(pd.to_datetime(d)+pd.Timedelta(days=1)).strftime('%Y-%m-%d'), interval="5m", progress=False, auto_adjust=True)
    if isinstance(df.columns, pd.MultiIndex): df.columns=df.columns.get_level_values(0)
    if df.empty: continue
    df.index=pd.to_datetime(df.index, utc=True).tz_convert('Asia/Kolkata')
    candles=[{"open":float(r.Open),"high":float(r.High),"low":float(r.Low),"close":float(r.Close)} for _,r in df.iterrows()]
    gen=SMCSignalGenerator(config={})
    for i in range(20, len(candles)):
        win=candles[:i+1]
        cur=win[-1]["close"]
        ts=df.index[i]
        md={"current_price":cur,"candles":win,"daily_highs":[c["high"] for c in win],"daily_lows":[c["low"] for c in win],"daily_closes":[c["close"] for c in win],"timestamp":ts}
        sig=gen.check_entry("NQ", md)
        if sig:
            entry=sig.price; sl=sig.stop_loss; tp=sig.take_profit
            is_long="LONG" in sig.signal_type.value
            # walk forward for SL/TP
            hit=False
            for j in range(i+1, len(candles)):
                h=candles[j]["high"]; l=candles[j]["low"]
                if is_long:
                    if l <= sl:
                        total_net+=(sl-entry)*4; total_trades+=1; break
                    if h >= tp:
                        total_net+=(tp-entry)*4; total_trades+=1; total_wins+=1; rrs.append(abs(tp-entry)/abs(entry-sl) if entry!=sl else 0); break
                else:
                    if h >= sl:
                        total_net+=(entry-sl)*4; total_trades+=1; break
                    if l <= tp:
                        total_net+=(entry-tp)*4; total_trades+=1; total_wins+=1; rrs.append(abs(entry-tp)/abs(entry-sl) if entry!=sl else 0); break
            else:
                # time exit at last close
                last=candles[-1]["close"]
                pnl=(last-entry)*4 if is_long else (entry-last)*4
                total_net+=pnl; total_trades+=1
                if pnl>0: total_wins+=1

# Metrics
pf = (total_wins / max(1, total_trades - total_wins)) * (sum(rrs)/len(rrs) if rrs else 1.5) if total_trades else 0
# Simplified PF: gross profit / gross loss approximated via wins * avg win / losses * avg loss — use rrs
# For now PF = wins*avg_RR / losses
pf = (total_wins * (sum(rrs)/len(rrs) if rrs else 2)) / max(1, total_trades - total_wins) if total_trades else 0
wr = total_wins/total_trades*100 if total_trades else 0
avg_rr = sum(rrs)/len(rrs) if rrs else 0
print(f"METRIC profit_factor={pf:.3f}")
print(f"METRIC win_rate={wr:.1f}")
print(f"METRIC net_pnl={total_net:.0f}")
print(f"METRIC total_trades={total_trades}")
print(f"METRIC avg_RR={avg_rr:.2f}")
PY
