import numpy as np
import pandas as pd
import yfinance as yf

px = yf.download(["IRFC.NS", "^NSEI"], start="2020-01-01", end="2026-11-12",
                 auto_adjust=True, progress=False)
close = px["Close"].copy()
if isinstance(close.columns, pd.MultiIndex):
    close.columns = close.columns.get_level_values(0)
close = close.dropna()
c, n = close["IRFC.NS"], close["^NSEI"]

def zigzag(s, thr_pct):
    thr = thr_pct / 100.0
    piv = []
    direction = 1
    last_i, last_v = 0, s.iloc[0]
    for i in range(1, len(s)):
        v = s.iloc[i]
        if direction == 1:            # tracking a high
            if v > last_v:
                last_i, last_v = i, v
            elif v <= last_v * (1 - thr):
                piv.append((last_i, last_v, 'H'))
                direction = -1
                last_i, last_v = i, v
        else:                          # tracking a low
            if v < last_v:
                last_i, last_v = i, v
            elif v >= last_v * (1 + thr):
                piv.append((last_i, last_v, 'L'))
                direction = 1
                last_i, last_v = i, v
    piv.append((last_i, last_v, 'H' if direction == 1 else 'L'))
    return piv

def legs(piv, s):
    out = []
    for (i0, v0, t0), (i1, v1, t1) in zip(piv, piv[1:]):
        out.append({'type': 'RALLY' if t1 == 'H' else 'DD', 'start': s.index[i0], 'end': s.index[i1],
                    'from': v0, 'to': v1, 'pct': (v1 / v0 - 1) * 100,
                    'days': (s.index[i1] - s.index[i0]).days, 'sess': i1 - i0})
    return out

for thr in (30, 40, 50):
    L = legs(zigzag(c, thr), c)
    print(f"\n===== ZIGZAG {thr}% =====")
    for l in L:
        ann = (1 + l['pct'] / 100) ** (252 / l['sess']) - 1 if l['sess'] else 0
        print(f"  {l['type']:<6} {l['start'].date()} -> {l['end'].date()}  {l['from']:7.2f} -> {l['to']:7.2f}  "
              f"{l['pct']:+7.1f}%  {l['days']:>4}d ({l['sess']} sess)  {ann:+.0%} ann.")

# how far each rally ran AFTER the previous peak (i.e. peak-to-peak extension)
print("\n=== PEAK-TO-PEAK EXTENSIONS (40% zigzag) ===")
L40 = legs(zigzag(c, 40), c)
peaks = [(l['start'], l['to']) for l in L40 if l['type'] == 'RALLY']
for (s0, p0), (s1, p1) in zip(peaks, peaks[1:]):
    print(f"  peak {s0.date()} {p0:7.2f} -> peak {s1.date()} {p1:7.2f}   {(p1/p0-1)*100:+7.1f}%   "
          f"({(s1-s0).days}d)")

# ---- drawdown episodes & forward returns ----
def episodes(s, thr):
    peak = s.cummax()
    dd = s / peak - 1
    out = []
    trough_i = None
    for i in range(len(s)):
        if dd.iloc[i] <= -thr:
            if trough_i is None or dd.iloc[i] < dd.iloc[trough_i]:
                trough_i = i
        elif trough_i is not None:
            out.append((s.index[trough_i], s.iloc[trough_i], dd.iloc[trough_i]))
            trough_i = None
    if trough_i is not None:
        out.append((s.index[trough_i], s.iloc[trough_i], dd.iloc[trough_i]))
    return out

print("\n=== FORWARD RETURNS FROM TROUGH AFTER >=X% DRAWDOWN ===")
for thr in (0.20, 0.30, 0.40, 0.50):
    eps = episodes(c, thr)
    rows = []
    for td, tv, d in eps:
        idx = c.index.get_loc(td)
        for h, lab in [(63, '3M'), (126, '6M'), (252, '12M'), (504, '24M')]:
            j = idx + h
            if j < len(c):
                rows.append((lab, td.date(), (c.iloc[j] / tv - 1) * 100))
    if not rows:
        continue
    df = pd.DataFrame(rows, columns=['h', 'date', 'ret'])
    print(f"\n-- >= {thr*100:.0f}% drawdown: {len(eps)} troughs --")
    print(df.groupby('h')['ret'].agg(['count', 'median', 'mean', 'min', 'max']).round(1).to_string())
    print("   12M cases:", ", ".join(f"{r['date']}:{r['ret']:+.0f}%" for _, r in df[df.h == '12M'].iterrows()))

# ---- current bounce stats ----
low52 = c.tail(252).min()
low_i = c.tail(252).idxmin()
print(f"\n=== NOW ===")
print(f"price {c.iloc[-1]:.2f} | 52w low {low52:.2f} ({low_i.date()}) -> +{(c.iloc[-1]/low52-1)*100:.1f}% in {(c.index[-1]-low_i).days}d")
print(f"ATH {c.max():.2f} ({c.idxmax().date()}) -> price is {(c.iloc[-1]/c.max()-1)*100:+.1f}% from ATH")
# past bounces of >=18% off a 52w low: what next
print("\n=== PAST EPISODES: +15%+ bounce off a 1-year low -> forward returns ===")
res = []
for i in range(252, len(c)):
    if c.iloc[i] < c.iloc[i-252].min():     # new 52w low
        # find next day where price is +15% above this low, then measure forward
        lo = c.iloc[i]
        j = i
        while j < len(c) and c.iloc[j] < lo * 1.15:
            j += 1
        if j >= len(c):
            continue
        entry = c.iloc[j]
        for h, lab in [(63, '3M'), (126, '6M'), (252, '12M')]:
            k = j + h
            if k < len(c):
                res.append((c.index[i].date(), c.index[j].date(), lab, (c.iloc[k] / entry - 1) * 100))
        i = j  # avoid overlapping
if res:
    df = pd.DataFrame(res, columns=['low_date', 'bounce_date', 'h', 'ret'])
    print(df.groupby('h')['ret'].agg(['count', 'median', 'mean', 'min', 'max']).round(1).to_string())
    print(df[df.h == '6M'].to_string(index=False))
