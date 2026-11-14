"""Trend-strength battery: ATR, ADX/DI, efficiency ratio, regression R², ATR expansion
and move-in-ATR units — the test for "is this momentum or is it drift?".

    .venv/bin/python .prime/agent/skills/position-probability/scripts/trend_strength.py
    .venv/bin/python .../trend_strength.py --names SBIN,ICICIBANK,IRFC

Why it exists: ADX alone lies. It is a 14-day read of the *previous* leg, so a
stock that just reversed still prints ADX 25-40 (IRFC printed ADX 29 while
sitting below a falling 200-DMA with ER 0.20). Read ADX together with:
  • DI spread  (who is in control right now)
  • ER20       (Kaufman efficiency: 1 = perfectly directional path)
  • R2_40d     (is there a trend at all, or just noise around a level)
  • move_ATR   (today's net displacement in ATR units — the honest "did it move?")

The question: is today's move a real trend or a low-energy drift? A long-option
position only pays if the underlying can travel far enough to beat theta + vega.
"""
import sys, math, os
sys.path.insert(0, ".prime/agent/skills/position-probability/scripts")
sys.path.insert(0, ".")
import numpy as np
import pandas as pd
import fetch_market_data as fmd

client = fmd.upstox_client()
import argparse
_ap = argparse.ArgumentParser(description=__doc__)
_ap.add_argument("--names", default="SBIN,SBILIFE,HDFCLIFE,BAJAJFINSV,ICICIBANK,TITAN,AXISBANK,"
                                  "HDFCBANK,IRFC,INFY,TCS,GRASIM,POWERGRID,NIFTY")
NAMES = [x.strip().upper() for x in _ap.parse_args().names.split(",") if x.strip()]


def wilder(s, n):
    return s.ewm(alpha=1 / n, adjust=False).mean()


def adx(df: pd.DataFrame, n: int = 14) -> pd.DataFrame:
    h, l, c = df["high"], df["low"], df["close"]
    prev_c = c.shift(1)
    tr = pd.concat([h - l, (h - prev_c).abs(), (l - prev_c).abs()], axis=1).max(axis=1)
    up = h.diff()
    dn = -l.diff()
    plus_dm = np.where((up > dn) & (up > 0), up, 0.0)
    minus_dm = np.where((dn > up) & (dn > 0), dn, 0.0)
    atr = wilder(tr, n)
    pdi = 100 * wilder(pd.Series(plus_dm, index=df.index), n) / atr
    mdi = 100 * wilder(pd.Series(minus_dm, index=df.index), n) / atr
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)
    adx_ = wilder(dx, n)
    return pd.DataFrame({"atr": atr, "pdi": pdi, "mdi": mdi, "adx": adx_})


def efficiency(close: pd.Series, n: int = 20) -> pd.Series:
    change = (close - close.shift(n)).abs()
    path = close.diff().abs().rolling(n).sum()
    return (change / path.replace(0, np.nan))


def reg_r2_slope(logp: pd.Series, n: int = 40):
    x = np.arange(n)
    out_r2 = np.full(len(logp), np.nan)
    out_slope = np.full(len(logp), np.nan)
    for i in range(n - 1, len(logp)):
        y = logp.iloc[i - n + 1:i + 1].values
        if np.isnan(y).any():
            continue
        b, a = np.polyfit(x, y, 1)
        yhat = a + b * x
        ss_res = float(((y - yhat) ** 2).sum())
        ss_tot = float(((y - y.mean()) ** 2).sum())
        out_r2[i] = 1 - ss_res / ss_tot if ss_tot else np.nan
        out_slope[i] = b * 252
    return pd.Series(out_r2, index=logp.index), pd.Series(out_slope, index=logp.index)


rows = []
for sym in NAMES:
    is_idx = sym == "NIFTY"
    df = fmd.upstox_daily(sym, is_index=is_idx, from_date="2023-06-01", client=client)
    if df is None or df.empty:
        continue
    sess = fmd.upstox_intraday_session(sym, client=client)
    prev_close = float(df["close"].iloc[-1])
    prev_atr_ref = float(df["close"].iloc[-1])
    if sess:
        ts = pd.Timestamp(sess["date"], tz=df.index.tz)
        df.loc[ts] = [sess["close"], sess["high"], sess["low"], sess["close"], sess["volume"]]
    a = adx(df, 14)
    atr = a["atr"]
    last_atr = float(atr.iloc[-1])
    atr_pct = last_atr / float(df["close"].iloc[-1]) * 100
    atr_pct_60 = float((atr / df["close"] * 100).tail(60).median())
    net_move = float(df["close"].iloc[-1] - prev_close)
    day_range = float(df["high"].iloc[-1] - df["low"].iloc[-1])
    er = efficiency(df["close"], 20)
    r2, slope = reg_r2_slope(np.log(df["close"]), 40)
    c = df["close"]
    dma50, dma200 = c.rolling(50).mean(), c.rolling(200).mean()
    rows.append({
        "symbol": sym,
        "price": float(c.iloc[-1]),
        "chg%": (float(c.iloc[-1]) / prev_close - 1) * 100,
        "ATR": last_atr,
        "ATR%": atr_pct,
        "ATR%_60med": atr_pct_60,
        "ATR_exp": atr_pct / atr_pct_60 if atr_pct_60 else np.nan,
        "move_ATR": net_move / last_atr,
        "range_ATR": day_range / last_atr,
        "ADX": float(a["adx"].iloc[-1]),
        "+DI": float(a["pdi"].iloc[-1]),
        "-DI": float(a["mdi"].iloc[-1]),
        "DI_spread": float(a["pdi"].iloc[-1] - a["mdi"].iloc[-1]),
        "ER20": float(er.iloc[-1]),
        "R2_40d": float(r2.iloc[-1]),
        "slope40_ann%": float(slope.iloc[-1]) * 100,
        "ma_align": "50>200" if float(dma50.iloc[-1]) > float(dma200.iloc[-1]) else "50<200",
        "vs200%": (float(c.iloc[-1]) / float(dma200.iloc[-1]) - 1) * 100,
        "vol_pace": (float(df["volume"].iloc[-1]) / float(df["volume"].iloc[-61:-1].median())
                     * 375 / max((df.index[-1] - df.index[0]).total_seconds() / 60, 1)
                     if df.index[-1] == df.index[0] else np.nan),
    })

df = pd.DataFrame(rows).set_index("symbol")
pd.set_option("display.width", 250)
print("\n=== TREND-STRENGTH BATTERY (12-Nov-2026, live) ===")
print(df[["chg%", "ATR", "ATR%", "ATR_exp", "move_ATR", "range_ATR", "ADX", "+DI", "-DI",
           "DI_spread", "ER20", "R2_40d", "slope40_ann%", "ma_align", "vs200%"]]
      .to_string(float_format=lambda v: f"{v:,.2f}"))
from datetime import datetime
_out = f"reports/fno_scan/{datetime.now().strftime('%Y-%m-%d')}"
os.makedirs(_out, exist_ok=True)
df.to_csv(f"{_out}/trend_strength.csv")
print(f"\ncsv -> {_out}/trend_strength.csv")
print("\nlegend: move_ATR = net day move in ATR units • range_ATR = day range in ATR units •")
print("        ATR_exp = today's ATR% vs 60d median ATR% (>1 = volatility expanding)")
print("        ER20 = Kaufman efficiency ratio (1 = perfectly directional) • R2_40d = trend fit")
print("        DI_spread = +DI - -DI (>0 = bulls in control)")
