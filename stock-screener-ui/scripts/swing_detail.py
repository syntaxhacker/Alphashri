import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pandas as pd
import stock_autoresearch as sa

c, v, nifty = sa.load_panel()

def detail(cost):
    sa.COST = cost
    pf = sa.csm(c, nifty, 120, 10, "M", True, False, v)
    rec = pf.trades.records_readable
    ts = pd.to_datetime(rec["Entry Timestamp"])
    pnl = rec["PnL"].astype(float)
    fees = rec["Entry Fees"].astype(float) + rec["Exit Fees"].astype(float)
    for lab, m in (("train", ts < "2025-10-01"), ("test", ts >= "2025-10-01")):
        x = pnl[m]; f = fees[m]; g = x + f
        w = x[x > 0]; l = -x[x < 0]
        eq = x.cumsum(); dd = (eq - eq.cummax()).min()
        print(f"  {cost*100:.2f}% {lab}: n={len(x)} win={len(w)/max(1,len(x))*100:.0f}% "
              f"gross={g.sum():+.0f} fees={f.sum():.0f} net={x.sum():+.0f} "
              f"PF={(w.sum()/l.sum() if l.sum() else 0):.2f} DD={dd:+.0f}")

for cost in (0.001, 0.0025, 0.005):
    detail(cost)

sa.COST = 0.0025
pf = sa.csm(c, nifty, 120, 10, "M", True, False, v)
rec = pf.trades.records_readable
rec["m"] = pd.to_datetime(rec["Exit Timestamp"]).dt.strftime("%Y-%m")
print("\nmonthly net:")
print(rec.groupby("m")["PnL"].sum().round(0).to_string())
print("\nlast-month top10 by 120d return:")
print(c.pct_change(120).iloc[-1].sort_values(ascending=False).head(10).round(3).to_string())
print("nifty above 200dma:", bool(nifty.iloc[-1] > nifty.rolling(200).mean().iloc[-1]))
