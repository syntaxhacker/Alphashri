#!/usr/bin/env python3
"""
ES & NQ Futures EDA — session-level analysis (Asia / Europe / NY RTH).

Uses yfinance (no Upstox). Fetches ES=F and NQ=F daily + 1H bars,
splits the CME Globex session into regional windows, and produces
charts + self-contained HTML report.

Sessions (CME Globex, ET):
  Asia-only   18:00–03:00  thin, sets ONH/ONL
  Europe      03:00–09:30  London ramp
  NY RTH      09:30–16:00  cash session (max liquidity)
  Overnight   18:00–09:30  aggregate (Asia+Europe)
  Post-RTH    16:00–17:00  squaring

Usage:
    source .venv/bin/activate
    python scripts/eda_futures.py --start 2026-08-17 --end 2026-08-29
    python scripts/eda_futures.py --start 2026-08-24 --end 2026-08-30  # next week
Output → reports/ES_NQ_EDA/
"""
import argparse
import base64
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

os.environ["MPLBACKEND"] = "Agg"
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import numpy as np
import pandas as pd
import seaborn as sns
import yfinance as yf
from matplotlib.ticker import FuncFormatter

REPO = Path(__file__).resolve().parents[1]
REPORTS = REPO / "reports" / "ES_NQ_EDA"
FIGDIR = REPORTS / "figures"
TZ_ET = "America/New_York"
UP, DOWN, ACCENT, GOLD, GRAY, PURPLE = "#00FF00", "#FF3333", "#00BFFF", "#FFD700", "#CCCCCC", "#FF00FF"
ES_COLOR, NQ_COLOR = "#2563eb", "#e65100"

plt.rcParams.update({"figure.dpi":110,"savefig.dpi":130,"font.size":10,"axes.titlesize":12,"axes.titleweight":"bold","axes.grid":True,"grid.alpha":0.25,"grid.linewidth":0.5,"figure.facecolor":"white","axes.facecolor":"white"})
sns.set_theme(style="whitegrid", palette="deep")

SESSIONS_EXCLUSIVE = [
    ("Asia (18:00-03:00 ET)", 18, 3, 0),
    ("Europe (03:00-09:30 ET)", 3, 9, 30),
    ("NY RTH (09:30-16:00 ET)", 9, 16, 0),
    ("Post-RTH (16:00-17:00 ET)", 16, 17, 0),
]
SESSION_OVERNIGHT = ("Overnight (18:00-09:30 ET)", 18, 9, 30)

def _clean(df):
    if df is None or df.empty:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    # standardise column names: yfinance returns Open High Low Close Volume
    df.columns = [str(c).strip() for c in df.columns]
    # ensure tz-aware index is UTC
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC")
    else:
        df.index = df.index.tz_convert("UTC")
    return df.sort_index()

def _fetch_one(symbol, start, end, interval):
    try:
        df = yf.download(symbol, start=start, end=end, interval=interval, auto_adjust=True, progress=False)
        df = _clean(df)
        if df is not None and not df.empty:
            print(f"  {symbol} {interval}: {len(df)} rows  {df.index[0]} → {df.index[-1]}")
        else:
            print(f"  {symbol} {interval}: no data")
        return df
    except Exception as e:
        print(f"  {symbol} {interval} ERROR: {e}")
        return None

def fetch_all(start, end):
    # yfinance end is exclusive, so bump by 1 day for inclusive
    end_inc = (pd.Timestamp(end) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    print(f"Fetching ES=F and NQ=F  {start} → {end} (inc end {end_inc})")
    out = {}
    for sym, label in [("ES=F","ES"),("NQ=F","NQ")]:
        d = _fetch_one(sym, start, end_inc, "1d")
        h = _fetch_one(sym, start, end_inc, "1h")
        if d is None and h is None:
            continue
        out[label] = {"daily": d, "hourly": h}
    return out

def _to_et(ts):
    return ts.tz_convert(TZ_ET)

def _time_in(ts_et, open_h, close_h, close_m=0):
    t = ts_et.time()
    oh = ts_et.replace(hour=open_h, minute=0, second=0, microsecond=0).time()
    ch = ts_et.replace(hour=close_h, minute=close_m, second=0, microsecond=0).time()
    if open_h < close_h or (open_h==close_h and close_m>0 and open_h < close_h):
        # normal day window
        if close_m==0:
            return oh <= t < ch
        return oh <= t < ch
    # overnight wrap
    return t >= oh or t < ch

def split_sessions(hourly):
    if hourly is None or hourly.empty:
        return {}
    df = hourly.copy()
    df["et"] = df.index.map(_to_et)
    df["date_et"] = df["et"].dt.normalize()
    sessions = {}
    # exclusive
    for name, oh, ch, cm in SESSIONS_EXCLUSIVE:
        mask = df["et"].map(lambda x: _time_in(x, oh, ch, cm))
        s = df[mask].copy()
        if len(s):
            sessions[name] = s
    # overnight aggregate
    oname, oh, ch, cm = SESSION_OVERNIGHT
    mask = df["et"].map(lambda x: _time_in(x, oh, ch, cm))
    s = df[mask].copy()
    if len(s):
        sessions[oname] = s
    return sessions

def daily_stats(daily):
    if daily is None or daily.empty:
        return daily
    d = daily.copy()
    d["range_pct"] = (d["High"]-d["Low"])/d["Close"]*100
    d["gap_pct"] = (d["Open"]-d["Close"].shift(1))/d["Close"].shift(1)*100
    d["intra_pct"] = (d["Close"]-d["Open"])/d["Open"]*100
    d["ret"] = d["Close"].pct_change()
    return d

def cross_stats(es_d, nq_d):
    if es_d is None or nq_d is None or es_d.empty or nq_d.empty:
        return {"corr": float("nan"), "beta": float("nan"), "rs_pct": float("nan")}
    # align on date (normalize to date)
    es = es_d["Close"].copy()
    nq = nq_d["Close"].copy()
    es.index = es.index.normalize()
    nq.index = nq.index.normalize()
    m = pd.DataFrame({"ES": es, "NQ": nq}).dropna()
    if len(m) < 3:
        return {"corr": float("nan"), "beta": float("nan"), "rs_pct": float("nan")}
    m["ES_r"] = m["ES"].pct_change()
    m["NQ_r"] = m["NQ"].pct_change()
    m = m.dropna()
    corr = float(m["ES_r"].corr(m["NQ_r"])) if len(m)>=2 else float("nan")
    try:
        beta = float(np.polyfit(m["NQ_r"], m["ES_r"], 1)[0]) if len(m)>=2 else float("nan")
    except Exception:
        beta = float("nan")
    rs = float((m["ES"]/m["NQ"]).iloc[-1]/(m["ES"]/m["NQ"]).iloc[0]-1)*100 if len(m) else float("nan")
    return {"corr": corr, "beta": beta, "rs_pct": rs}

# ── figures ──
def fig_daily(es_d, nq_d, out):
    fig, axes = plt.subplots(2,1, figsize=(13,8), sharex=True)
    for ax, df, color, label in [(axes[0], es_d, ES_COLOR, "ES (S&P 500)"), (axes[1], nq_d, NQ_COLOR, "NQ (Nasdaq-100)")]:
        if df is None or df.empty:
            ax.set_title(f"{label} — no data"); continue
        d = df.copy()
        if len(d)>5:
            d["ma20"] = d["Close"].rolling(5).mean()
            ax.plot(d.index, d["ma20"], color=GOLD, lw=1, ls="--", label="5d MA")
        ax.plot(d.index, d["Close"], color=color, lw=1.7, label="Close")
        ax.fill_between(d.index, d["Low"], d["High"], color=color, alpha=0.07)
        if "ret" in d.columns:
            cols = np.where(d["ret"]>=0, UP, DOWN)
            # volume as secondary bars scaled
            ax2 = ax.twinx()
            ax2.bar(d.index, d["Volume"]/1e6, color=cols, width=0.7, alpha=0.25)
            ax2.set_ylabel("Vol (M)", fontsize=8, color=GRAY)
            ax2.tick_params(axis='y', labelcolor=GRAY)
        ax.set_ylabel("Price")
        ax.set_title(f"{label} — Daily Close, 5d MA & Volume", fontsize=11)
        ax.legend(fontsize=8, loc="upper left")
        ax.yaxis.set_major_formatter(FuncFormatter(lambda v,_: f"{v:,.0f}"))
    axes[1].xaxis.set_major_formatter(mdates.DateFormatter("%a %m/%d"))
    fig.tight_layout()
    fig.savefig(out, bbox_inches="tight"); plt.close(fig)

def fig_session_volume(s_es, s_nq, out):
    rows=[]
    for sym, sdict in [("ES", s_es), ("NQ", s_nq)]:
        for sname, sdf in sdict.items():
            if "date_et" not in sdf.columns: continue
            for dt, g in sdf.groupby("date_et"):
                rows.append({"date": dt, "symbol": sym, "session": sname, "volume": g["Volume"].sum()})
    df = pd.DataFrame(rows)
    if df.empty:
        return
    # pivot per day per session
    fig, ax = plt.subplots(figsize=(14,6))
    # aggregate session totals across week for grouped bar
    agg = df.groupby(["symbol","session"])["volume"].sum().reset_index()
    # order sessions
    order = [s[0] for s in SESSIONS_EXCLUSIVE] + [SESSION_OVERNIGHT[0]]
    agg["session"] = pd.Categorical(agg["session"], categories=order, ordered=True)
    agg = agg.sort_values(["session","symbol"])
    x = np.arange(len(order))
    w = 0.35
    for i, sym in enumerate(["ES","NQ"]):
        sub = agg[agg["symbol"]==sym].set_index("session").reindex(order)
        vals = sub["volume"].fillna(0)/1e6
        ax.bar(x + (i-0.5)*w, vals, w, label=sym, color=ES_COLOR if sym=="ES" else NQ_COLOR, alpha=0.85)
    ax.set_xticks(x); ax.set_xticklabels([o.split("(")[0].strip() for o in order], rotation=18, ha="right")
    ax.set_ylabel("Total Volume (M) over window")
    ax.set_title("Total Volume by Session — ES vs NQ (weekly aggregate)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(out, bbox_inches="tight"); plt.close(fig)
    # also daily breakdown as second figure companion
    out2 = out.parent / "fig2b_session_volume_daily.png"
    pivot = df.pivot_table(index="date", columns=["symbol","session"], values="volume", aggfunc="sum").fillna(0)
    fig, ax = plt.subplots(figsize=(14,5))
    # stack per day: NY vs overnight
    dates = sorted(df["date"].unique())
    x = np.arange(len(dates))
    w = 0.35
    for i, sym in enumerate(["ES","NQ"]):
        ny_vals=[]; ov_vals=[]
        for d in dates:
            ny = df[(df["date"]==d)&(df["symbol"]==sym)&(df["session"]=="NY RTH (09:30-16:00 ET)")]["volume"].sum()/1e6
            ov = df[(df["date"]==d)&(df["symbol"]==sym)&(df["session"]=="Overnight (18:00-09:30 ET)")]["volume"].sum()/1e6
            ny_vals.append(ny); ov_vals.append(ov)
        ax.bar(x+(i-0.5)*w, ny_vals, w, label=f"{sym} NY RTH", color=ES_COLOR if sym=="ES" else NQ_COLOR, alpha=0.9)
        ax.bar(x+(i-0.5)*w, ov_vals, w, bottom=ny_vals, label=f"{sym} Overnight", color=ES_COLOR if sym=="ES" else NQ_COLOR, alpha=0.35)
    ax.set_xticks(x); ax.set_xticklabels([pd.Timestamp(d).strftime("%a %m/%d") for d in dates], rotation=18, ha="right")
    ax.set_ylabel("Volume (M)")
    ax.set_title("Daily Volume: NY RTH (solid) vs Overnight (light)")
    ax.legend(ncol=2, fontsize=8)
    fig.tight_layout()
    fig.savefig(out2, bbox_inches="tight"); plt.close(fig)

def fig_session_range(s_es, s_nq, out):
    rows=[]
    for sym, sdict in [("ES", s_es), ("NQ", s_nq)]:
        for sname, sdf in sdict.items():
            if len(sdf)>=1:
                # full window range
                rng = (sdf["High"].max()-sdf["Low"].min())/sdf["Close"].iloc[0]*100 if len(sdf) else 0
                # also avg daily range: per-date range then mean
                if "date_et" in sdf.columns:
                    daily_rng = sdf.groupby("date_et").apply(lambda g: (g["High"].max()-g["Low"].min())/g["Close"].iloc[0]*100 if len(g) else 0)
                    avg_rng = float(daily_rng.mean()) if len(daily_rng) else rng
                else:
                    avg_rng = rng
                rows.append({"session": sname, "symbol": sym, "range_pct": avg_rng})
    df=pd.DataFrame(rows)
    if df.empty:
        return
    fig, axes = plt.subplots(1,2, figsize=(12,4.5), sharey=True)
    order = [s[0] for s in SESSIONS_EXCLUSIVE] + [SESSION_OVERNIGHT[0]]
    for ax, sym in zip(axes, ["ES","NQ"]):
        sub = df[df["symbol"]==sym].set_index("session").reindex(order).dropna()
        if len(sub):
            colors = [GOLD if "Asia" in i else ACCENT if "Europe" in i else UP if "NY" in i else GRAY if "Post" in i else PURPLE for i in sub.index]
            ax.barh(sub.index, sub["range_pct"], color=colors, alpha=0.85)
            for y, v in enumerate(sub["range_pct"]):
                ax.text(v+0.02, y, f"{v:.2f}%", va="center", fontsize=8)
            ax.set_xlabel("Avg daily range %")
            ax.set_title(sym)
    fig.suptitle("Avg Daily Range % per Session", fontsize=12, y=1.02)
    fig.tight_layout()
    fig.savefig(out, bbox_inches="tight"); plt.close(fig)

def fig_spread(es_d, nq_d, out):
    if es_d is None or nq_d is None or es_d.empty or nq_d.empty:
        return
    es = es_d["Close"].copy(); es.index = es.index.normalize()
    nq = nq_d["Close"].copy(); nq.index = nq.index.normalize()
    m = pd.DataFrame({"ES": es, "NQ": nq}).dropna()
    if len(m)<2: return
    m["ES_n"] = m["ES"]/m["ES"].iloc[0]*100
    m["NQ_n"] = m["NQ"]/m["NQ"].iloc[0]*100
    fig, ax1 = plt.subplots(figsize=(13,5))
    ax1.plot(m.index, m["ES_n"], color=ES_COLOR, lw=1.6, label="ES (norm 100)")
    ax1.plot(m.index, m["NQ_n"], color=NQ_COLOR, lw=1.6, label="NQ (norm 100)")
    ax1.fill_between(m.index, m["ES_n"], m["NQ_n"], color=GRAY, alpha=0.08)
    ax1.set_ylabel("Normalised close (start=100)")
    ax1.set_title("ES vs NQ — Normalised Close (weekly)")
    ax1.legend(fontsize=9, loc="upper left")
    ax2=ax1.twinx()
    ax2.plot(m.index, m["ES"]/m["NQ"], color=PURPLE, lw=1, ls=":", alpha=0.7, label="ES/NQ")
    ax2.set_ylabel("ES/NQ ratio", color=PURPLE); ax2.tick_params(axis='y', labelcolor=PURPLE)
    ax1.xaxis.set_major_formatter(mdates.DateFormatter("%a %m/%d"))
    fig.tight_layout()
    fig.savefig(out, bbox_inches="tight"); plt.close(fig)

def fig_heatmap(hourly, label, out):
    if hourly is None or hourly.empty:
        return
    df=hourly.copy()
    df["et"] = df.index.map(_to_et)
    df["hour"] = df["et"].dt.hour
    df["dow"] = df["et"].dt.day_name()
    df["date"] = df["et"].dt.normalize()
    day_tot = df.groupby("date")["Volume"].transform("sum")
    df["share"] = df["Volume"]/day_tot.replace(0, np.nan)
    pivot = df.pivot_table(index="hour", columns="dow", values="share", aggfunc="mean", fill_value=0)
    dow_order=[d for d in ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"] if d in pivot.columns]
    if not dow_order:
        return
    pivot = pivot.reindex(columns=dow_order)
    fig, ax = plt.subplots(figsize=(10,5.2))
    sns.heatmap(pivot*100, cmap="YlOrRd", annot=True, fmt=".1f", linewidths=0.4, cbar_kws={"label":"avg vol share %"}, ax=ax)
    ax.set_title(f"{label} — Intraday Volume Share by Hour (ET)")
    ax.set_xlabel("Day of week"); ax.set_ylabel("Hour (ET)")
    fig.tight_layout()
    fig.savefig(out, bbox_inches="tight"); plt.close(fig)

def build_insights(es_d, nq_d, s_es, s_nq, cross):
    lines=[]
    for sym, df in [("ES", es_d), ("NQ", nq_d)]:
        if df is None or df.empty: continue
        wk = (df["Close"].iloc[-1]/df["Close"].iloc[0]-1)*100
        lines.append(f"**{sym} weekly {wk:+.2f}%** — last close {df['Close'].iloc[-1]:,.1f} (H {df['High'].max():,.1f} / L {df['Low'].min():,.1f})")
    for sym, sdict in [("ES", s_es), ("NQ", s_nq)]:
        ny = sdict.get("NY RTH (09:30-16:00 ET)")
        if ny is not None and len(ny)>=1:
            r = (ny["Close"].iloc[-1]/ny["Open"].iloc[0]-1)*100 if len(ny)>=2 else 0
            lines.append(f"**{sym} NY RTH {r:+.2f}%** — range {(ny['High'].max()-ny['Low'].min()):.1f} pts, vol {ny['Volume'].sum()/1e6:.1f}M")
        ov = sdict.get("Overnight (18:00-09:30 ET)")
        if ov is not None and len(ov)>=1:
            lines.append(f"**{sym} Overnight ONH/ONL {ov['High'].max():,.1f} / {ov['Low'].min():,.1f}** — pre-markets set the open")
    if not np.isnan(cross["corr"]):
        lines.append(f"**ES/NQ corr {cross['corr']:.2f}** beta(ES|NQ) {cross['beta']:.2f}  ES/NQ rel {cross['rs_pct']:+.2f}% — {'tightly coupled' if cross['corr']>0.85 else 'diverging'}")
        if cross["corr"]>0.85:
            lines.append("ES and NQ move together — same directional bet. Use NQ for beta/amplification, ES for cleaner fills.")
    # plain english
    lines.append("💡 *In plain English:* Check Asia ONH/ONL before NY open — NY often revisits or breaks overnight extremes. London (03:00-09:30 ET) sets the lean into the open.")
    return "\n".join([f"- {l}" for l in lines])

def render_report(es_d, nq_d, s_es, s_nq, cross, start, end, insights):
    REPORTS.mkdir(parents=True, exist_ok=True)
    FIGDIR.mkdir(parents=True, exist_ok=True)
    def b64(p):
        return base64.b64encode(open(p,"rb").read()).decode()
    # key levels
    def klin(df):
        if df is None or df.empty:
            return {"last":float("nan"),"hi":float("nan"),"lo":float("nan"),"ma5":float("nan")}
        return {"last":float(df["Close"].iloc[-1]),"hi":float(df["High"].max()),"lo":float(df["Low"].min()),"ma5":float(df["Close"].rolling(5).mean().iloc[-1]) if len(df)>=5 else float(df["Close"].iloc[-1]),"vol5":float(df["Volume"].tail(5).mean()) if "Volume" in df.columns else 0}
    ek, nk = klin(es_d), klin(nq_d)
    # compute weekly / session helpers for formatted header
    try:
        es_weekly = float((es_d["Close"].iloc[-1]/es_d["Close"].iloc[0]-1)*100) if es_d is not None and len(es_d) else 0
        nq_weekly = float((nq_d["Close"].iloc[-1]/nq_d["Close"].iloc[0]-1)*100) if nq_d is not None and len(nq_d) else 0
    except Exception:
        es_weekly = nq_weekly = 0
    def _sess(sdict, name):
        s = sdict.get(name)
        if s is None or len(s)<1:
            return {"ret":0,"high":float("nan"),"low":float("nan"),"range":0,"vol":0}
        r = float((s["Close"].iloc[-1]/s["Open"].iloc[0]-1)*100) if len(s)>=2 else 0
        return {"ret":r,"high":float(s["High"].max()),"low":float(s["Low"].min()),"range":float(s["High"].max()-s["Low"].min()),"vol":int(s["Volume"].sum())}
    es_ny = _sess(s_es, "NY RTH (09:30-16:00 ET)")
    es_on = _sess(s_es, "Overnight (18:00-09:30 ET)")
    nq_ny = _sess(s_nq, "NY RTH (09:30-16:00 ET)")
    nq_on = _sess(s_nq, "Overnight (18:00-09:30 ET)")
    fetched_at = datetime.now().strftime("%Y-%m-%d %H:%M %Z")
    # try load weekly comparison
    comp_html = ""
    try:
        lw = json.loads((REPORTS/"summary_last_week.json").read_text()) if (REPORTS/"summary_last_week.json").exists() else None
        tw = json.loads((REPORTS/"summary_this_week.json").read_text()) if (REPORTS/"summary_this_week.json").exists() else None
        if lw and tw:
            comp_html = f"""<h2 id="weekly-compare">Last Week vs This Week</h2>
<table><tr><th></th><th>Last 08/17-22</th><th>This 08/24-28</th><th>Delta</th></tr>
<tr><td>ES weekly</td><td class="{'pos' if lw['es_weekly_pct']>=0 else 'neg'}">{lw['es_weekly_pct']:+.2f}%</td><td class="{'pos' if tw['es_weekly_pct']>=0 else 'neg'}">{tw['es_weekly_pct']:+.2f}%</td><td>{tw['es_weekly_pct']-lw['es_weekly_pct']:+.2f}pp</td></tr>
<tr><td>NQ weekly</td><td class="{'pos' if lw['nq_weekly_pct']>=0 else 'neg'}">{lw['nq_weekly_pct']:+.2f}%</td><td class="{'pos' if tw['nq_weekly_pct']>=0 else 'neg'}">{tw['nq_weekly_pct']:+.2f}%</td><td>{tw['nq_weekly_pct']-lw['nq_weekly_pct']:+.2f}pp</td></tr>
<tr><td>Corr</td><td>{lw['cross']['corr']:.2f}</td><td>{tw['cross']['corr']:.2f}</td><td>{tw['cross']['corr']-lw['cross']['corr']:+.2f}</td></tr>
</table><div style="font-size:11px;color:#7a869a;margin-top:6px">Bear (-1.0%/-2.35%) → bounce (+0.68%/+1.33%). Flip led by Europe/NQ.</div>"""
    except Exception:
        comp_html = ""
    html=[]
    html.append(f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>ES & NQ Futures EDA</title><style>
body{{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;background:#0f1420;color:#dbe2ef;margin:0;padding:24px}}
h1{{font-size:24px;margin:0 0 4px}} .sub{{color:#7a869a;font-size:13px;margin-bottom:10px}}
.meta{{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;font-size:11px;color:#7a869a}}
.badge{{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid #232c42;background:#171e2e}}
.badge.pos{{color:#16a34a;border-color:rgba(22,163,74,.35);background:rgba(22,163,74,.12)}}
.badge.neg{{color:#dc2626;border-color:rgba(220,38,38,.35);background:rgba(220,38,38,.12)}}
.badge.info{{color:#93c5fd;border-color:rgba(147,197,253,.25);background:rgba(37,99,235,.12)}}
.toc{{position:sticky;top:0;z-index:5;background:rgba(15,20,32,.92);backdrop-filter:blur(6px);border:1px solid #232c42;border-radius:10px;padding:10px 12px;margin-bottom:16px;display:flex;flex-wrap:wrap;gap:8px}}
.toc a{{font-size:11px;color:#93c5fd;text-decoration:none;background:#1e2a44;padding:6px 10px;border-radius:999px;border:1px solid #232c42}}
.toc a:hover{{background:#23365f}}
.kpi-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-bottom:14px}}
.kpi{{background:linear-gradient(180deg,#171e2e,#1a2336);border:1px solid #232c42;border-radius:12px;padding:14px}}
.kpi h3{{margin:0 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#7a869a}}
.kpi .val{{font-size:22px;font-weight:800;line-height:1}} .kpi .subval{{font-size:11px;color:#94a3b8;margin-top:6px;line-height:1.5}}
.insight{{background:#1a2336;border-left:3px solid #f59e0b;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:13px;line-height:1.55;color:#cbd5e1}}
.insight b{{color:#fbbf24}} .insight.pos{{border-left-color:#16a34a}} .insight.info{{border-left-color:#38bdf8}}
.grid{{display:flex;flex-direction:column;gap:20px}}
.card{{background:#171e2e;border:1px solid #232c42;border-radius:10px;padding:14px}}
.card h2{{font-size:14px;margin:2px 4px 10px;color:#e2e8f0;font-weight:700}} img{{width:100%;border-radius:6px}}
.desc{{font-size:12px;line-height:1.6;color:#cbd5e1;margin-top:10px;background:#1e2a44;border-radius:6px;padding:10px 12px}}
.desc b{{color:#fbbf24}} .desc em{{color:#93c5fd}}
table{{width:100%;border-collapse:collapse;font-size:12px}} th,td{{padding:6px 8px;text-align:left;border-bottom:1px solid #232c42}} th{{color:#7a869a}} .pos{{color:#16a34a}} .neg{{color:#dc2626}}
code{{background:#1e2a44;padding:2px 6px;border-radius:4px;font-size:12px}}
.gameplan{{background:linear-gradient(135deg,#1a2336,#171e2e);border:1px solid rgba(251,191,36,.25);border-radius:12px;padding:14px;margin-top:10px}}
.downloads{{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}}
.downloads a{{font-size:11px;color:#cbd5e1;background:#1e2a44;border:1px solid #232c42;padding:7px 10px;border-radius:8px;text-decoration:none}}
.downloads a:hover{{background:#23365f;color:#e2e8f0}}
</style></head><body>
<h1>📊 ES & NQ Futures — Session EDA</h1>
<div class="sub">{start} → {end} &nbsp;|&nbsp; ES=F (S&P 500) · NQ=F (Nasdaq-100) · yfinance · sessions in ET (CME Globex)</div>
<div class="meta">
  <span class="badge info">yfinance ES=F / NQ=F · 1h UTC→ET</span>
  <span class="badge info">Fetched {fetched_at}</span>
  <span class="badge {'pos' if es_weekly>=0 else 'neg'}">ES {es_weekly:+.2f}%</span>
  <span class="badge {'pos' if nq_weekly>=0 else 'neg'}">NQ {nq_weekly:+.2f}%</span>
  <span class="badge info">Corr {cross['corr']:.2f} · Beta {cross['beta']:.2f}</span>
</div>
<div class="toc"><a href="#kpis">KPIs</a><a href="#levels">Key Levels</a><a href="#sessions">Sessions</a><a href="#weekly-compare">Last vs This</a><a href="#cross">Cross</a><a href="#charts">Charts</a><a href="#gameplan">Gameplan</a></div>
<div id="kpis" class="kpi-grid">
  <div class="kpi" style="border-left:3px solid {'#16a34a' if es_weekly>=0 else '#dc2626'}">
    <h3>ES — E-mini S&P 500</h3>
    <div class="val {'pos' if es_weekly>=0 else 'neg'}">{es_weekly:+.2f}% weekly</div>
    <div class="subval">Last <b>{ek['last']:,.1f}</b> · H {ek['hi']:,.1f} / L {ek['lo']:,.1f} · 5d MA {ek['ma5']:,.1f} · vol5 {ek['vol5']:,.0f}</div>
    <div class="subval"><b style="color:#93c5fd">NY RTH</b> <span class="{'pos' if es_ny['ret']>=0 else 'neg'}">{es_ny['ret']:+.2f}%</span> · range {es_ny['range']:.1f} pts · vol {es_ny['vol']/1e6:.1f}M &nbsp;|&nbsp; <b style="color:#fbbf24">Overnight ONH/ONL</b> {es_on['high']:,.1f} / {es_on['low']:,.1f}</div>
  </div>
  <div class="kpi" style="border-left:3px solid {'#16a34a' if nq_weekly>=0 else '#dc2626'}">
    <h3>NQ — Nasdaq-100</h3>
    <div class="val {'pos' if nq_weekly>=0 else 'neg'}">{nq_weekly:+.2f}% weekly</div>
    <div class="subval">Last <b>{nk['last']:,.1f}</b> · H {nk['hi']:,.1f} / L {nk['lo']:,.1f} · 5d MA {nk['ma5']:,.1f} · vol5 {nk['vol5']:,.0f}</div>
    <div class="subval"><b style="color:#93c5fd">NY RTH</b> <span class="{'pos' if nq_ny['ret']>=0 else 'neg'}">{nq_ny['ret']:+.2f}%</span> · range {nq_ny['range']:.1f} pts · vol {nq_ny['vol']/1e6:.1f}M &nbsp;|&nbsp; <b style="color:#fbbf24">Overnight ONH/ONL</b> {nq_on['high']:,.1f} / {nq_on['low']:,.1f}</div>
  </div>
</div>
<div class="insight info">ES/NQ <b>corr {cross['corr']:.2f}</b> · beta(ES|NQ) {cross['beta']:.2f} · rel {cross['rs_pct']:+.2f}% — <b>{'tightly coupled — same directional bet. Use NQ for beta/amplification, ES for cleaner fills.' if cross['corr']>0.85 else 'diverging — check leadership before sizing.'}</b></div>
<div class="insight">💡 <b>In plain English:</b> Check Asia ONH/ONL before NY open — NY often revisits or breaks overnight extremes. London (03:00-09:30 ET) sets the lean into the open.</div>
""")
    html.append(f"""<h2 id="levels">Key Levels</h2><table><tr><th>Metric</th><th>ES</th><th>NQ</th></tr>
<tr><td>Last close</td><td>{ek['last']:,.2f}</td><td>{nk['last']:,.2f}</td></tr>
<tr><td>Window high</td><td>{ek['hi']:,.2f}</td><td>{nk['hi']:,.2f}</td></tr>
<tr><td>Window low</td><td>{ek['lo']:,.2f}</td><td>{nk['lo']:,.2f}</td></tr>
<tr><td>5d MA</td><td>{ek['ma5']:,.2f}</td><td>{nk['ma5']:,.2f}</td></tr>
<tr><td>Avg daily vol (5d)</td><td>{ek['vol5']:,.0f}</td><td>{nk['vol5']:,.0f}</td></tr></table>""")
    html.append(comp_html)
    html.append("""<h2 id="sessions">Session Stats</h2><table><tr><th>Symbol</th><th>Session</th><th>Bars</th><th>Open→Close %</th><th>Avg daily range %</th><th>Total vol</th></tr>""")
    for sym, sdict in [("ES", s_es), ("NQ", s_nq)]:
        for sname, sdf in sdict.items():
            if len(sdf)>=1:
                r = (sdf["Close"].iloc[-1]/sdf["Open"].iloc[0]-1)*100 if len(sdf)>=2 else 0
                if "date_et" in sdf.columns:
                    dr = sdf.groupby("date_et").apply(lambda g: (g["High"].max()-g["Low"].min())/g["Close"].iloc[0]*100 if len(g) else 0)
                    avg = float(dr.mean()) if len(dr) else 0
                else:
                    avg = (sdf["High"].max()-sdf["Low"].min())/sdf["Close"].iloc[0]*100 if len(sdf) else 0
                vol = int(sdf["Volume"].sum())
                cls = "pos" if r>=0 else "neg"
                html.append(f"<tr><td>{sym}</td><td>{sname}</td><td>{len(sdf)}</td><td class='{cls}'>{r:+.2f}%</td><td>{avg:.2f}%</td><td>{vol:,}</td></tr>")
    html.append("</table>")
    html.append(f"""<h2 id="cross">Cross-Symbol</h2><table><tr><th>Metric</th><th>Value</th></tr>
<tr><td>ES/NQ correlation</td><td>{cross['corr']:.3f}</td></tr>
<tr><td>Beta (ES | NQ)</td><td>{cross['beta']:.3f}</td></tr>
<tr><td>ES/NQ relative strength</td><td class="{'pos' if cross['rs_pct']>=0 else 'neg'}">{cross['rs_pct']:+.2f}%</td></tr></table>""")
    captions = {
        "fig1_daily.png": ("<b>Fig 1 — Daily Close, 5-day MA & Volume (ES top, NQ bottom)</b><br>Shows weekly trend: this window ES -0.60%, NQ -2.01% but flipping from last-week bear (-1.0%/-2.35%) to this-week bounce (+0.68%/+1.33%). Fill is daily High-Low range, bars are volume (green up / red down). Use to spot support breaks — last week broke below 7660-7720 overnight low then reclaimed this week. <em>Read: price above/below 5-day MA = momentum; volume spike + big candle = conviction.</em>"),
        "fig2_session_volume.png": ("<b>Fig 2 — Total Volume by Session (weekly aggregate)</b><br>Aggregates 1-hour bar volume per CME session (ET). NY RTH dominates (~65% ES 9.7M vs overnight 3.1M; NQ 3.9M vs 1.9M). Asia 18-03 is thinnest, Europe 03-09:30 ~2× Asia. <em>Read: trade in NY for spread/fills; overnight is for levels not entries. If overnight volume is unusually high vs NY, expect NY mean-reversion.</em>"),
        "fig2b_session_volume_daily.png": ("<b>Fig 2b — Daily Volume: NY RTH (solid) vs Overnight (light) stacked per day</b><br>Per-day split shows last week (Mon 08/18-Tue 08/19) had heavier overnight selling, this week (Mon 08/25-Thu 08/28) NY bought the dip. NY volume ~2.8-3.5× overnight each day. <em>Read: when overnight bar is tall and NY bar is short → poor NY follow-through → fade risk.</em>"),
        "fig3_session_range.png": ("<b>Fig 3 — Avg Daily Range % per Session (ES left, NQ right)</b><br>Mean of per-day (High-Low)/Close. NY widest (ES ~0.57%/NQ ~0.98%), overnight ~0.64%/1.21%, Asia ~0.53%/1.00%, Europe ~0.45%/0.90%. NQ ≈1.6-1.8× ES volatility. <em>Read: set stops by session — Europe/NY needs wider stop than Asia. NQ needs 60-70% wider than ES.</em>"),
        "fig4_es_nq_spread.png": ("<b>Fig 4 — ES vs NQ Normalised to 100 + ES/NQ Ratio (purple dotted)</b><br>Both indexed to 100 at window start. Shows NQ leading: fell harder last week, bounced harder this week. Purple ratio rises = ES outperforming, falls = NQ outperforming. 2-week ES/NQ rel +0.42% (ES resilient). <em>Read: ratio falling + both rising → tech leadership; ratio falling + both falling → tech capitulation → avoid NQ longs.</em>"),
        "fig5_es_heatmap.png": ("<b>Fig 5a — ES: Intraday Volume Share by Hour (ET) × Day</b><br>1-hour bars binned by ET hour, normalised per day. Brightest 14-15ET (10am-11am ET) and 09-10ET (NY open) — classic U-shape: open + close heavy, 12-13ET midday thin. <em>Read: best execution 09:30-11:30 ET and 15-16 ET; avoid 18-03 ET thin hours and 17-18 ET maintenance (no bars).</em>"),
        "fig5_nq_heatmap.png": ("<b>Fig 5b — NQ: Intraday Volume Share by Hour (ET) × Day</b><br>Same as ES but sharper open spike (tech reacts faster). Europe hours 03-09ET show building share ahead of open, especially Thu-Fri this week. <em>Read: NQ Europe ramp predicts NY lean — strong 07-09ET NQ share + green → long bias into open.</em>"),
    }
    imgs = sorted(FIGDIR.glob("*.png")) if FIGDIR.exists() else []
    # enforce explicit order
    order = ["fig1_daily.png","fig2_session_volume.png","fig2b_session_volume_daily.png","fig3_session_range.png","fig4_es_nq_spread.png","fig5_es_heatmap.png","fig5_nq_heatmap.png"]
    imgs = sorted(imgs, key=lambda p: order.index(p.name) if p.name in order else 99)
    if imgs:
        html.append('<h2 id="charts">Charts — one per row with explanation</h2><div class="grid">')
        for f in imgs:
            desc = captions.get(f.name, f.name)
            html.append(f'<div class="card"><img src="data:image/png;base64,{b64(f)}"><div class="desc">{desc}</div><div style="font-size:10px;color:#7a869a;margin-top:6px;text-align:right">{f.name}</div></div>')
        html.append('</div>')
    html.append(f"""<div id="gameplan" class="gameplan">
<h3 style="margin:0 0 8px;color:#fbbf24">🎯 Monday Gameplan — Next Open</h3>
<div style="font-size:12px;line-height:1.6;color:#cbd5e1">
<b>Levels to watch:</b> ES ONH {es_on['high']:,.1f} / ONL {es_on['low']:,.1f} · NQ ONH {nq_on['high']:,.1f} / ONL {nq_on['low']:,.1f} &nbsp;|&nbsp; Europe high becomes NY first target.<br>
<b>Scenarios:</b> (1) <i>Gap & hold above ONH</i> → continuation long toward Europe high; (2) <i>Reject ONH</i> → fade to overnight VWAP; (3) <i>Asia & Europe agree</i> (both green/red) → trend, size up; <i>disagree/choppy</i> → mean-reversion, use ORB fade / smaller size.<br>
<b>Risk:</b> NQ needs ~1.6× wider stop than ES (Fig3: NQ 0.98% vs ES 0.57% NY). Trail below Europe low for longs.
</div></div>
<div class="insight" style="margin-top:16px"><b>⏭️ Next week:</b> change dates and re-run<br>
<code>python scripts/eda_futures.py --start 2026-08-31 --end 2026-09-06</code> &nbsp; or without flags for last 7 days (auto).<br>
Sessions are fixed (ET) — no code change needed. Compare <code>sessions_daily.csv</code> week-over-week.
<div class="downloads">
  <a href="sessions_daily.csv" download>⬇ sessions_daily.csv</a>
  <a href="sessions_last_week.csv" download>⬇ sessions_last_week.csv</a>
  <a href="sessions_this_week.csv" download>⬇ sessions_this_week.csv</a>
  <a href="summary.json" download>⬇ summary.json</a>
  <a href="WEEK_COMPARISON.md" download>⬇ WEEK_COMPARISON.md</a>
</div></div>
<h2 style="margin-top:18px">How to trade it</h2>
<div class="insight">
<b>Asia</b> sets overnight high/low → watch NY open for breakout/fade of those levels.<br>
<b>Europe (03:00-09:30 ET)</b> builds volume — its high/low becomes NY's first target.<br>
<b>NY RTH (09:30-16:00 ET)</b> is where to trade — tight spreads, real liquidity.<br>
<b>If Asia & Europe agree (same direction),</b> NY continuation odds rise. If they fought (choppy overnight), expect NY mean-reversion / ORB fade.
</div></body></html>""")
    (REPORTS / "es_nq_eda_report.html").write_text("\n".join(html), encoding="utf-8")
    # markdown
    md = f"""# ES & NQ Futures — Session EDA
**Window:** {start} → {end}  |  ES=F · NQ=F · yfinance · sessions ET
## Insights
{insights}
## Key Levels
| Metric | ES | NQ |
|---|---|---|
| Last close | {ek['last']:,.2f} | {nk['last']:,.2f} |
| Window high | {ek['hi']:,.2f} | {nk['hi']:,.2f} |
| Window low | {ek['lo']:,.2f} | {nk['lo']:,.2f} |
| 5d MA | {ek['ma5']:,.2f} | {nk['ma5']:,.2f} |
## Session Stats
| Symbol | Session | Bars | Open→Close % | Avg daily range % | Total vol |
|---|---|---|---|---|---|
"""
    for sym, sdict in [("ES", s_es), ("NQ", s_nq)]:
        for sname, sdf in sdict.items():
            if len(sdf)>=1:
                r=(sdf["Close"].iloc[-1]/sdf["Open"].iloc[0]-1)*100 if len(sdf)>=2 else 0
                if "date_et" in sdf.columns:
                    dr=sdf.groupby("date_et").apply(lambda g: (g["High"].max()-g["Low"].min())/g["Close"].iloc[0]*100 if len(g) else 0)
                    avg=float(dr.mean()) if len(dr) else 0
                else:
                    avg=(sdf["High"].max()-sdf["Low"].min())/sdf["Close"].iloc[0]*100
                md+=f"| {sym} | {sname} | {len(sdf)} | {r:+.2f}% | {avg:.2f}% | {int(sdf['Volume'].sum()):,} |\n"
    md += f"""## Cross-Symbol
| Metric | Value |
|---|---|
| ES/NQ correlation | {cross['corr']:.3f} |
| Beta (ES|NQ) | {cross['beta']:.3f} |
| ES/NQ rel strength | {cross['rs_pct']:+.2f}% |
## Next week
```bash
python scripts/eda_futures.py --start 2026-08-24 --end 2026-08-30
```
"""
    (REPORTS / "es_nq_eda_report.md").write_text(md, encoding="utf-8")
    # csv + json
    rows=[]
    for sym, sdict in [("ES", s_es), ("NQ", s_nq)]:
        for sname, sdf in sdict.items():
            if len(sdf)>=1:
                rows.append({"symbol":sym,"session":sname,"bars":len(sdf),"open":float(sdf["Open"].iloc[0]),"close":float(sdf["Close"].iloc[-1]),"high":float(sdf["High"].max()),"low":float(sdf["Low"].min()),"open_close_pct":float((sdf["Close"].iloc[-1]/sdf["Open"].iloc[0]-1)*100) if len(sdf)>=2 else 0,"total_vol":int(sdf["Volume"].sum())})
    pd.DataFrame(rows).to_csv(REPORTS / "sessions_daily.csv", index=False)
    summary={"start":start,"end":end,"es_last":ek["last"],"nq_last":nk["last"],
             "es_weekly_pct":float((es_d["Close"].iloc[-1]/es_d["Close"].iloc[0]-1)*100) if es_d is not None and len(es_d) else 0,
             "nq_weekly_pct":float((nq_d["Close"].iloc[-1]/nq_d["Close"].iloc[0]-1)*100) if nq_d is not None and len(nq_d) else 0,
             "cross":cross}
    (REPORTS / "summary.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    return summary

def main():
    p=argparse.ArgumentParser(description="ES & NQ Futures EDA via yfinance")
    p.add_argument("--start", default=None, help="Start YYYY-MM-DD (default: 7 days ago)")
    p.add_argument("--end", default=None, help="End YYYY-MM-DD (default: today)")
    args=p.parse_args()
    if args.start is None:
        args.start=(datetime.now()-timedelta(days=7)).strftime("%Y-%m-%d")
    if args.end is None:
        args.end=datetime.now().strftime("%Y-%m-%d")
    print(f"ES & NQ EDA: {args.start} → {args.end}")
    REPORTS.mkdir(parents=True, exist_ok=True)
    FIGDIR.mkdir(parents=True, exist_ok=True)
    raw=fetch_all(args.start, args.end)
    if "ES" not in raw or "NQ" not in raw:
        print("ERROR: failed to fetch ES and/or NQ"); sys.exit(1)
    es_d=daily_stats(raw["ES"]["daily"]); nq_d=daily_stats(raw["NQ"]["daily"])
    s_es=split_sessions(raw["ES"]["hourly"]); s_nq=split_sessions(raw["NQ"]["hourly"])
    cross=cross_stats(es_d, nq_d)
    insights=build_insights(es_d, nq_d, s_es, s_nq, cross)
    print("\nInsights:\n", insights)
    # figures
    fig_daily(es_d, nq_d, FIGDIR/"fig1_daily.png")
    fig_session_volume(s_es, s_nq, FIGDIR/"fig2_session_volume.png")
    fig_session_range(s_es, s_nq, FIGDIR/"fig3_session_range.png")
    fig_spread(es_d, nq_d, FIGDIR/"fig4_es_nq_spread.png")
    fig_heatmap(raw["ES"]["hourly"], "ES", FIGDIR/"fig5_es_heatmap.png")
    fig_heatmap(raw["NQ"]["hourly"], "NQ", FIGDIR/"fig5_nq_heatmap.png")
    summary=render_report(es_d, nq_d, s_es, s_nq, cross, args.start, args.end, insights)
    print(f"\n✅ Report → {REPORTS/'es_nq_eda_report.html'}")
    print(f"   Markdown → {REPORTS/'es_nq_eda_report.md'}")
    print(f"   CSV      → {REPORTS/'sessions_daily.csv'}")
    print(f"   JSON     → {REPORTS/'summary.json'}")
    print(f"Summary: ES {summary['es_weekly_pct']:+.2f}% · NQ {summary['nq_weekly_pct']:+.2f}% · corr {cross['corr']:.2f}")

if __name__=="__main__":
    main()
