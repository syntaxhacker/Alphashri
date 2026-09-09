#!/usr/bin/env python3
"""
Generate ONH/ONL trades showcase HTML mimicking ORB_ES_showcase style.
Uses yfinance 5m candles for NY session visualization.
Reads trades from reports/BACKTEST_LEVELS/trades_ES.csv and trades_NQ.csv (recent window)
or trades_ES_recent_17-29.csv if exists.

Output -> reports/BACKTEST_LEVELS/trades_showcase.html
"""
import json, pandas as pd, yfinance as yf
from pathlib import Path
from datetime import timedelta

TZ_ET="America/New_York"
REPO=Path(__file__).resolve().parents[1]
OUT=REPO/"reports"/"BACKTEST_LEVELS"/"trades_showcase.html"
TRADES_DIR=REPO/"reports"/"BACKTEST_LEVELS"

def clean(df):
    if df is None or df.empty: return None
    if isinstance(df.columns, pd.MultiIndex):
        df.columns=df.columns.get_level_values(0)
    df.columns=[str(c).strip() for c in df.columns]
    if df.index.tz is None:
        df.index=df.index.tz_localize("UTC")
    else:
        df.index=df.index.tz_convert("UTC")
    return df.sort_index()

def fetch_5m_for_day(symbol, date_str):
    # date_str like 2026-08-17, fetch 5m for that day (covers NY 09:30 ET = 13:30 UTC)
    start=pd.Timestamp(date_str)
    end=start+pd.Timedelta(days=1)
    df=yf.download(symbol, start=start.strftime("%Y-%m-%d"), end=end.strftime("%Y-%m-%d"), interval="5m", auto_adjust=True, progress=False)
    df=clean(df)
    if df is None or df.empty:
        return None
    # convert to ET for filtering NY
    df["et"]=df.index.tz_convert(TZ_ET)
    # filter NY 09:30-16:00 ET on that date
    d_et=pd.Timestamp(date_str).tz_localize(TZ_ET)
    ny_open=d_et+pd.Timedelta(hours=9, minutes=30)
    ny_close=d_et+pd.Timedelta(hours=16, minutes=0)
    ny=df[(df["et"]>=ny_open) & (df["et"]<ny_close)]
    if len(ny)<10:
        return None
    # keep 5m bars, generate t labels HH:MM ET
    ny=ny.copy()
    ny["t"]=ny["et"].dt.strftime("%H:%M")
    return ny

def build_entry(trade, symbol_label, ny_df):
    # trade is dict from csv
    date=trade["date"]
    side=trade["side"]
    onh=float(trade["onh"]); onl=float(trade["onl"])
    R=float(trade["R"]); entry=float(trade["entry"]); sl=float(trade["sl"]); tp=float(trade["tp"])
    entry_time=trade["entry_time"].replace(" ET","").strip()  # e.g. 10:00
    exit_time=trade["exit_time"].replace(" ET","").strip()
    exit_price=float(trade["exit"])
    pnl_R=float(trade["pnl_R"])
    reason=trade["reason"]
    # ny_df has t, Open/High/Low/Close
    t_list=ny_df["t"].tolist()
    o_list=ny_df["Open"].tolist()
    c_list=ny_df["Close"].tolist()
    l_list=ny_df["Low"].tolist()
    h_list=ny_df["High"].tolist()
    # eff = (onh-onl)/sum(high-low)
    sum_range=sum(h - l for h,l in zip(h_list,l_list))
    eff=(onh-onl)/sum_range if sum_range else 0
    # chop
    is_choppy = eff < 0.45
    chop_label = "CHOPPY" if is_choppy else "CLEAN"
    chop_color = "#f59e0b" if is_choppy else "#22c55e"
    or_width = onh - onl
    # markers: breakout diamond at onh/onl one bar before entry
    # find entry index
    try:
        entry_idx=t_list.index(entry_time)
    except:
        # closest
        entry_idx=0
        for i,t in enumerate(t_list):
            if t >= entry_time:
                entry_idx=i
                break
    breakout_time=t_list[max(0, entry_idx-1)]
    breakout_price=onh if side=="long" else onl
    # colors for exit
    if reason=="TP":
        color="#16a34a"; label=f"TP hit ({pnl_R:+.2f}R)"
    elif reason=="SL":
        color="#dc2626"; label=f"SL hit ({pnl_R:+.2f}R)"
    else:
        # EOD: green if positive else red
        color="#16a34a" if pnl_R>0 else "#dc2626" if pnl_R<0 else "#7a869a"
        label=f"EOD flat ({pnl_R:+.2f}R)"
    markers=[
        {"coord":[breakout_time, breakout_price], "symbol":"diamond","symbolSize":9, "itemStyle":{"color":"transparent","borderColor":"#e6a23c","borderWidth":2}, "label":{"show":True,"formatter":"breakout","position":"top","fontSize":10,"color":"#e6a23c"}},
        {"coord":[entry_time, entry], "symbol":"arrow","symbolSize":13,"symbolRotate":0 if side=="long" else 180, "itemStyle":{"color":"#2563eb"}, "label":{"show":True,"formatter":f"{side.upper()} entry","position":"left","fontSize":11,"fontWeight":"bold","color":"#2563eb"}},
        {"coord":[exit_time, exit_price], "symbol":"circle","symbolSize":10, "itemStyle":{"color":color}, "label":{"show":True,"formatter":label,"position":"top","fontSize":11,"color":color}},
    ]
    # or_highs/lows for extra dashed lines (flat ONH/ONL across NY)
    or_highs=[onh]*3  # just first 3 bars to show level, rest null handled in template via concat
    or_lows=[onl]*3
    return {
        "date": date,
        "title": f"{symbol_label} {pd.Timestamp(date).strftime('%A')}",
        "side": side.upper(),
        "range": [onl, onh],
        "stop": sl,
        "tp": tp,
        "markers": markers,
        "eff": round(float(eff),3),
        "or_width": round(float(or_width),2),
        "chop_label": chop_label,
        "chop_color": chop_color,
        "is_choppy": is_choppy,
        "R_net": round(float(pnl_R),3),
        "or_highs": or_highs,
        "or_lows": or_lows,
        "t": t_list,
        "o": o_list,
        "c": c_list,
        "l": l_list,
        "h": h_list,
    }

def main():
    # prefer recent window files if exist
    es_file=TRADES_DIR/"trades_ES_recent_17-29.csv"
    nq_file=TRADES_DIR/"trades_NQ_recent_17-29.csv"
    if not es_file.exists():
        es_file=TRADES_DIR/"trades_ES.csv"
    if not nq_file.exists():
        nq_file=TRADES_DIR/"trades_NQ.csv"
    import pandas as pd
    es_trades=pd.read_csv(es_file) if es_file.exists() else pd.DataFrame()
    nq_trades=pd.read_csv(nq_file) if nq_file.exists() else pd.DataFrame()
    print(f"ES trades file {es_file} {len(es_trades)} rows")
    print(f"NQ trades file {nq_file} {len(nq_trades)} rows")
    DATA=[]
    for _, row in es_trades.iterrows():
        ny=fetch_5m_for_day("ES=F", row["date"])
        if ny is None:
            print(f"ES {row['date']} no 5m NY data, skip")
            continue
        entry=build_entry(row, "ES", ny)
        DATA.append(entry)
    for _, row in nq_trades.iterrows():
        ny=fetch_5m_for_day("NQ=F", row["date"])
        if ny is None:
            print(f"NQ {row['date']} no 5m NY data, skip")
            continue
        entry=build_entry(row, "NQ", ny)
        DATA.append(entry)
    # sort by date then symbol
    DATA=sorted(DATA, key=lambda x: (x["date"], x["title"]))
    # compute summary
    wins=[d for d in DATA if d["R_net"]>0]
    losses=[d for d in DATA if d["R_net"]<0]
    sum_R=sum(d["R_net"] for d in DATA)
    avg_eff_w=sum(d["eff"] for d in wins)/len(wins) if wins else 0
    avg_eff_l=sum(d["eff"] for d in losses)/len(losses) if losses else 0
    SUMMARY={
        "instrument": "ES & NQ (ONH/ONL breakout, yfinance 1h levels, 5m showcase)",
        "strategy": "ONH/ONL 18:00→09:30 ET · first NY break · SL opposite band · TP 1.0R · EOD flat",
        "window": "2026-08-17 → 2026-08-29 (recent, 16 trades)",
        "n_shown": len(DATA),
        "sum_R_shown": round(sum_R,2)
    }
    # build html by copying template from orb_es_showcase but adapting title
    template_path=REPO/"reports"/"ORB_ES_showcase"/"orb_es_showcase.html"
    html=Path(template_path).read_text()
    # replace title/h1
    html=html.replace("<title>ES ORB Backtest Showcase</title>", "<title>ES/NQ ONH/ONL Showcase</title>")
    html=html.replace("ORB Backtest Trades — ES (E-mini S&amp;P 500)", "ONH/ONL Backtest Trades — ES & NQ (yfinance)")
    # inject DATA and SUMMARY
    import json as js
    data_js=js.dumps(DATA)
    summary_js=js.dumps(SUMMARY)
    # replace the const DATA = [...] and const SUMMARY = {...}
    # find via simple replace: locate "const DATA ="
    # use split
    start_data=html.find("const DATA =")
    start_summary=html.find("const SUMMARY =")
    if start_data!=-1 and start_summary!=-1:
        end_data=html.find("];", start_data)+2
        end_summary=html.find("};", start_summary)+2
        html = html[:start_data] + f"const DATA = {data_js};" + html[end_data:start_summary] + f"const SUMMARY = {summary_js};" + html[end_summary:]
    else:
        print("Could not find DATA/SUMMARY placeholders, abort")
        return
    # also update summary text generation to handle wins vs losses with eff
    # keep original JS; no change needed
    OUT.write_text(html)
    print(f"Wrote {OUT} with {len(DATA)} trades sum_R {sum_R:.2f}")

if __name__=="__main__":
    main()
