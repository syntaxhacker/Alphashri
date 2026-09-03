"""HTF daily bias from yfinance NQ=F daily bars — history-only swing structure.

Bias per session date uses ONLY swings confirmed before that date (3-bar fractal
needs 2 bars to confirm, so swings with index > date_idx - 2 are invisible).
+1 = HH+HL (bull), -1 = LH+LL (bear), 0 = mixed/neutral.
"""
import os
import pickle

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "yfinance_cache.pkl")


def fetch_daily(force=False):
    if not force and os.path.exists(CACHE):
        with open(CACHE, "rb") as f:
            return pickle.load(f)
    import yfinance as yf
    df = yf.download("NQ=F", period="5y", interval="1d", progress=False, auto_adjust=True)
    if hasattr(df.columns, "levels") and df.columns.nlevels > 1:
        df.columns = df.columns.droplevel(1)
    with open(CACHE, "wb") as f:
        pickle.dump(df, f)
    return df


def swings(df):
    """Confirmed 3-bar fractal swings: list of (idx, 'H'/'L', price)."""
    hi, lo = df["High"].values, df["Low"].values
    out = []
    for j in range(2, len(df) - 2):
        if hi[j] > hi[j-1] and hi[j] > hi[j-2] and hi[j] > hi[j+1] and hi[j] > hi[j+2]:
            out.append((j, "H", float(hi[j])))
        if lo[j] < lo[j-1] and lo[j] < lo[j-2] and lo[j] < lo[j+1] and lo[j] < lo[j+2]:
            out.append((j, "L", float(lo[j])))
    return out


def bias_for(df, date_str):
    """+1/-1/0 using only information available before date_str (confirmation lag respected)."""
    import pandas as pd
    dates = [d.date().isoformat() for d in df.index]
    try:
        di = dates.index(date_str)
    except ValueError:
        return 0
    confirmed = [(j, t, p) for (j, t, p) in swings(df) if j + 2 < di]
    hs = [p for (_, t, p) in confirmed if t == "H"][-2:]
    ls = [p for (_, t, p) in confirmed if t == "L"][-2:]
    if len(hs) < 2 or len(ls) < 2:
        return 0
    if hs[-1] > hs[-2] and ls[-1] > ls[-2]:
        return 1
    if hs[-1] < hs[-2] and ls[-1] < ls[-2]:
        return -1
    return 0


def bias_map(dates):
    df = fetch_daily()
    return {d: bias_for(df, d) for d in dates}
