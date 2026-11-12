import json, sys, os
sys.path.insert(0, os.path.abspath(".."))
sys.path.insert(0, os.path.abspath("."))
import numpy as np
import pandas as pd

from config import UPSTOX_API_KEY, UPSTOX_API_SECRET
from upstox_trader.config_and_utils.upstox_api import UpstoxAPI

api = UpstoxAPI(api_key=UPSTOX_API_KEY, api_secret=UPSTOX_API_SECRET, quiet=True)

# --- fix the 11-Nov row with the real session high/low from Upstox intraday ---
itd = api.fetch_intraday_data_v3("POWERGRID", interval="1")
day = itd[itd.index.date == pd.Timestamp("2026-11-11").date()] if itd is not None else None
pg = pd.read_pickle("/tmp/opencode/g_POWERGRID.pkl")
if day is not None and len(day):
    close = float(day["close"].iloc[-1]); hi = float(day["high"].max()); lo = float(day["low"].min())
    vol = float(day["volume"].sum())
    pg.loc[pd.Timestamp("2026-11-11", tz=pg.index.tz)] = [close, hi, lo, close, vol]
    pg.to_pickle("/tmp/opencode/g_POWERGRID.pkl")
    print(f"POWERGRID 11-Nov: O {close} H {hi} L {lo} C {close} vol {vol:,.0f}")
else:
    print("intraday unavailable")

S = float(pg["close"].iloc[-1])
print(f"\n=== SNAPSHOT (Upstox, 11-Nov-2026) ===\nPOWERGRID close {S:.2f}")
c = pg["close"]
print(f"  52w high {c.tail(252).max():.2f} | 52w low {c.tail(252).min():.2f} | "
      f"pos in range {(S-c.tail(252).min())/(c.tail(252).max()-c.tail(252).min())*100:.0f}%")
print(f"  all-time high {c.max():.2f} ({c.idxmax().date()}) | from ATH {(S/c.max()-1)*100:+.1f}%")

# ---------- momentum / trend ----------
def feats(df):
    cc = df["close"]; d = cc.diff()
    up = d.clip(lower=0).ewm(alpha=1/14).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1/14).mean()
    o = pd.DataFrame(index=cc.index)
    o["close"] = cc; o["rsi"] = 100 - 100/(1+up/dn)
    for w in (5, 10, 20, 60, 120): o[f"ret{w}"] = cc.pct_change(w)
    for w in (20, 50, 100, 200):
        o[f"dma{w}"] = cc.rolling(w).mean(); o[f"d{w}"] = cc/o[f"dma{w}"] - 1
    o["slope200"] = o["dma200"].pct_change(20)
    o["volr"] = df["volume"]/df["volume"].rolling(60).median()
    o["ret1"] = cc.pct_change(); o["sig60"] = o["ret1"].rolling(60).std()*np.sqrt(252)
    o["sig252"] = o["ret1"].rolling(252).std()*np.sqrt(252)
    o["pos52"] = (cc - cc.rolling(252).min())/(cc.rolling(252).max()-cc.rolling(252).min())
    return o

f = feats(pg); last = f.iloc[-1]
print("\n=== MOMENTUM / TREND ===")
print(f"  RSI14 {last['rsi']:.1f} | 5d {last['ret5']*100:+.1f}% | 10d {last['ret10']*100:+.1f}% | "
      f"20d {last['ret20']*100:+.1f}% | 60d {last['ret60']*100:+.1f}% | 120d {last['ret120']*100:+.1f}%")
print(f"  vs 20DMA {last['d20']*100:+.1f}% | 50DMA {last['d50']*100:+.1f}% | 100DMA {last['d100']*100:+.1f}% | "
      f"200DMA {last['d200']*100:+.1f}% (200DMA {last['dma200']:.2f}, slope20 {last['slope200']*100:+.1f}%)")
print(f"  52w pos {last['pos52']*100:.0f}% | vol ratio {last['volr']:.1f}x | vol 60d {last['sig60']*100:.0f}% | "
      f"252d {last['sig252']*100:.0f}%")
print("  RSI last 8:", " ".join(f"{v:.0f}" for v in f['rsi'].iloc[-8:]))
print("  close last 8:", " ".join(f"{v:.0f}" for v in c.iloc[-8:]))

# ---------- correlation / beta vs indices ----------
idx = {n: pd.read_pickle(f"/tmp/opencode/g_{n}.pkl") for n in ["NIFTY", "MIDCP", "BANK", "PSUBANK", "INFRA", "PSE", "RAIL"]}
r_pg = c.pct_change().dropna()
print("\n=== CORRELATION / BETA vs INDICES (Upstox) ===")
for n, d in idx.items():
    rr = d["close"].pct_change().dropna()
    for w in (60, 252):
        df_ = pd.concat([r_pg, rr], axis=1).dropna().tail(w)
        if len(df_) < 30:
            continue
        b = df_.iloc[:, 0].cov(df_.iloc[:, 1])/df_.iloc[:, 1].var()
        cc = df_.corr().iloc[0, 1]
        if w == 60:
            line = f"  {n:<8} 60d: beta {b:5.2f} corr {cc:+.2f} (n={len(df_)})"
        else:
            line += f" | 252d: beta {b:5.2f} corr {cc:+.2f} (n={len(df_)})"
    print(line)

# ---------- cycle analysis ----------
def zigzag(s, thr_pct):
    thr = thr_pct/100.0; piv = []; direction = 1; last_i, last_v = 0, s.iloc[0]
    for i in range(1, len(s)):
        v = s.iloc[i]
        if direction == 1:
            if v > last_v: last_i, last_v = i, v
            elif v <= last_v*(1-thr):
                piv.append((last_i, last_v, 'H')); direction = -1; last_i, last_v = i, v
        else:
            if v < last_v: last_i, last_v = i, v
            elif v >= last_v*(1+thr):
                piv.append((last_i, last_v, 'L')); direction = 1; last_i, last_v = i, v
    piv.append((last_i, last_v, 'H' if direction == 1 else 'L'))
    return piv

print("\n=== CYCLE LEGS (zigzag 30% / 40%) ===")
for thr in (30, 40):
    piv = zigzag(c, thr)
    print(f"-- {thr}% --")
    for (i0, v0, t0), (i1, v1, t1) in zip(piv, piv[1:]):
        typ = "RALLY" if t1 == 'H' else "DD"
        print(f"   {typ:<6} {c.index[i0].date()} -> {c.index[i1].date()}  {v0:8.2f} -> {v1:8.2f}  "
              f"{(v1/v0-1)*100:+7.1f}%  {(c.index[i1]-c.index[i0]).days:>4}d")

def episodes(s, thr):
    peak = s.cummax(); dd = s/peak - 1; out = []; ti = None
    for i in range(len(s)):
        if dd.iloc[i] <= -thr:
            if ti is None or dd.iloc[i] < dd.iloc[ti]: ti = i
        elif ti is not None:
            out.append((s.index[ti], s.iloc[ti], dd.iloc[ti])); ti = None
    if ti is not None: out.append((s.index[ti], s.iloc[ti], dd.iloc[ti]))
    return out

print("\n=== FORWARD RETURNS AFTER DRAWDOWNS ===")
for thr in (0.20, 0.30, 0.40):
    eps = episodes(c, thr)
    rows = []
    for td, tv, d in eps:
        idx_ = c.index.get_loc(td)
        for h, lab in [(63, '3M'), (126, '6M'), (252, '12M')]:
            j = idx_ + h
            if j < len(c): rows.append((lab, (c.iloc[j]/tv-1)*100))
    if not rows: continue
    df_ = pd.DataFrame(rows, columns=['h', 'ret'])
    agg = df_.groupby('h')['ret'].agg(['count', 'median', 'mean', 'min', 'max']).round(1)
    print(f"\n-- trough after >= {thr*100:.0f}% drawdown (n={len(eps)}) --")
    print(agg.to_string())

# ---------- momentum decay analog for POWERGRID ----------
H = 8
fwd = (c.shift(-H)/c - 1)
rsi_peak = f["rsi"].rolling(21, center=True).max()
since = (rsi_peak - f["rsi"])
print("\n=== RSI-PEAK DECAY (POWERGRID): fwd 8-session return by sessions since 21d RSI peak ===")
base = pd.DataFrame({"since": since, "fwd": fwd, "d200": f["d200"], "slope": f["slope200"]}).dropna()
for lo, hi, lab in [(0, 1, "0-1d"), (1, 3, "1-3d"), (3, 6, "3-6d"), (6, 11, "6-10d"), (11, 21, "11-20d")]:
    m = (base.since >= lo) & (base.since < hi)
    v = base.loc[m, "fwd"]
    if len(v) > 20:
        print(f"  {lab:<7} n={len(v):<5} median {v.median()*100:+6.2f}%  P(up) {(v>0).mean()*100:3.0f}%  "
              f"P(+10%) {(v>0.10).mean()*100:3.0f}%")
pool = base[(base.since >= 0) & (base.since <= 3)]["fwd"]
print(f"  post-peak pool (0-3d): n={len(pool)} mean {pool.mean()*100:+.1f}% median {pool.median()*100:+.1f}% "
      f"P(up) {(pool>0).mean()*100:.0f}%")
