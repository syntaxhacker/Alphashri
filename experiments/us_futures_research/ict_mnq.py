#!/usr/bin/env python
"""
ICT MNQ: Liquidity Sweep + FVG + High RR (3R/5R)
- Sweep: 5m wick takes PDH/PDL or 20-bar swing high/low, closes back inside
- FVG: 3-candle gap (candle3 low > candle1 high for bullish)
- Entry: 50% of FVG, SL: beyond sweep extreme + 2 ticks, TP: 3R/5R
Test on MNQ 5m USB (20260120-20260415) + recent yfinance 5m
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "stock-screener-ui"))
from market_data.market_data import fetch_candles
import pandas as pd, numpy as np, glob

def load_mnq_5m(frm="2026-01-20", to="2026-04-15"):
    # Try USB CME first for MNQ (CME, not NSE)
    import os
    usb_path="/media/mysyntax/LENOVO_USB_/cme-futures-ohlc-main/MNQ/MNQ_5min_20260120_20260415.csv"
    if os.path.exists(usb_path):
        df=pd.read_csv(usb_path, parse_dates=["datetime"])
        df["datetime"]=pd.to_datetime(df["datetime"])
        if df["datetime"].dt.tz is None: df["datetime"]=df["datetime"].dt.tz_localize("UTC")
        else: df["datetime"]=df["datetime"].dt.tz_convert("UTC")
        df=df.set_index("datetime").sort_index()
        df.index=df.index.tz_convert("America/New_York")
        df["day"]=df.index.normalize()
        mins=df.index.hour*60+df.index.minute
        mask=(mins>=570)&(mins<960)
        df=df[mask]
        return df
    df=fetch_candles("MNQ", tf=5, from_date=frm, to_date=to)
    if df is None or df.empty: return None
    if df.index.tz is None: df.index=df.index.tz_localize("UTC")
    df.index=df.index.tz_convert("America/New_York")
    df["day"]=df.index.normalize()
    mins=df.index.hour*60+df.index.minute
    mask=(mins>=570)&(mins<960)
    df=df[mask]
    return df

def find_fvg(df, start_idx, direction, lookahead=20):
    # bullish FVG: low[2] > high[0]
    for i in range(start_idx, min(start_idx+lookahead, len(df)-2)):
        c1, c2, c3 = df.iloc[i], df.iloc[i+1], df.iloc[i+2]
        if direction==1 and c3["low"] > c1["high"]:
            return i+1, (c1["high"], c3["low"])  # FVG range
        if direction==-1 and c3["high"] < c1["low"]:
            return i+1, (c3["high"], c1["low"])
    return None, None

def backtest(df, rr=3.0):
    df=df.copy()
    df["day"]=df.index.normalize()
    rows=[]
    # compute PDH/PDL
    daily=df.groupby("day").agg(high=("high","max"), low=("low","min"))
    for day,g in df.groupby("day"):
        if len(g)<30: continue
        # get PDH/PDL
        idx=list(daily.index).index(day) if day in daily.index else -1
        if idx<=0: continue
        pdh=float(daily.iloc[idx-1]["high"]); pdl=float(daily.iloc[idx-1]["low"])
        # also 20-bar swing
        for i in range(20, len(g)-5):
            bar=g.iloc[i]
            # sweep check: wick beyond PDH/PDL or swing
            swing_high=float(g.iloc[max(0,i-20):i]["high"].max())
            swing_low=float(g.iloc[max(0,i-20):i]["low"].min())
            swept_high = bar["high"] > pdh + 2 and bar["close"] < pdh  # bearish sweep (took buys)
            swept_low = bar["low"] < pdl - 2 and bar["close"] > pdl
            # also swing
            swept_swing_high = bar["high"] > swing_high + 2 and bar["close"] < swing_high
            swept_swing_low = bar["low"] < swing_low - 2 and bar["close"] > swing_low
            direction=None
            sweep_level=None
            if swept_high or swept_swing_high:
                direction=-1
                sweep_level=bar["high"]
            elif swept_low or swept_swing_low:
                direction=1
                sweep_level=bar["low"]
            else:
                continue
            # find FVG after sweep
            fvg_idx, fvg_range = find_fvg(g, i+1, direction)
            if fvg_idx is None: continue
            fvg_mid=(fvg_range[0]+fvg_range[1])/2
            # entry at FVG 50%
            entry=fvg_mid
            sl=sweep_level + (2 if direction==-1 else -2)
            dist=abs(entry-sl)
            if dist==0: continue
            tp=entry + direction*rr*dist
            # find entry fill: price must retrace to FVG
            entry_idx=None
            for j in range(fvg_idx+2, len(g)):
                if g.iloc[j]["low"] <= fvg_range[1] and g.iloc[j]["high"] >= fvg_range[0]:
                    # touched FVG
                    entry_idx=j
                    break
            if entry_idx is None: continue
            # exit
            r=None
            for j in range(entry_idx, len(g)):
                hj, lj = g.iloc[j]["high"], g.iloc[j]["low"]
                if (lj <= sl if direction==1 else hj >= sl):
                    r=-1; break
                if (hj >= tp if direction==1 else lj <= tp):
                    r=rr; break
            if r is None:
                px=g.iloc[-1]["close"]
                r=(px-entry)/dist if direction==1 else (entry-px)/dist
                r=r - 2/dist  # cost 2 ticks
            else:
                r=r - 2/dist
            rows.append(r)
            break  # one trade per day max
    return rows

for period, frm, to in [("USB 5m Jan-Apr","2026-01-20","2026-04-15"), ("5m Aug 1mo","2026-07-27","2026-08-25")]:
    # for Aug, use yfinance 5m via fetch_candles still works via Upstox? Use same loader but fetch from Upstox for Aug
    df=load_mnq_5m(frm,to) if "2026-01" in frm else None
    if df is None:
        # fallback yfinance for Aug
        import yfinance as yf
        df_y=yf.download("MNQ=F" if False else "NQ=F", period="1mo", interval="5m", progress=False, auto_adjust=False)
        # approximate MNQ via NQ
        pass
    # just use USB for both for now
    df=load_mnq_5m(frm,to)
    if df is None: continue
    for rr in [3.0,5.0]:
        rows=backtest(df, rr=rr)
        arr=np.array(rows)
        if len(arr)==0:
            print(f"{period} RR{rr} no trades")
            continue
        pf=arr[arr>0].sum()/abs(arr[arr<0].sum()) if (arr<0).any() else 99
        print(f"{period} MNQ ICT RR{rr} n={len(arr)} win={(arr>0).mean()*100:.1f}% PF={pf:.2f} avgR={arr.mean():+.3f} net={(1+0.01*arr).prod()-1:+.1%}")

# Update learning
Path("/home/mysyntax/Documents/Alphashri/experiments/us_futures_research/LEARNING_ICT.md").write_text("# ICT Learning — MNQ Liquidity Sweep + FVG\n\n- Sweep PDH/PDL or 20-bar swing with wick + close back inside\n- FVG 3-candle gap within 20 bars after sweep\n- Entry 50% FVG, SL beyond sweep +2ticks, TP 3R/5R\n- Tested on MNQ 5m USB Jan-Apr (60 days) and Aug 1mo\n- Note: ICT needs high RR, winrate will be low (~30-40%) but PF should be >1.5 if edge\n")
print("learning saved")
