import json
import numpy as np
import pandas as pd

rng = np.random.default_rng(9090)
S = 263.75
H = 8

pg = pd.read_pickle("/tmp/opencode/g_POWERGRID.pkl")
nifty = pd.read_pickle("/tmp/opencode/g_NIFTY.pkl")
midcp = pd.read_pickle("/tmp/opencode/g_MIDCP.pkl")
c = pg["close"]

# quarterly BVPS (stockanalysis, S&P Global) for the P/B cycle
bvps = pd.Series({
    "2026-09-30": 114.86, "2026-06-30": 108.05, "2026-03-31": 108.05, "2025-12-31": 106.53,
    "2025-09-30": 106.53, "2025-06-30": 99.76, "2025-03-31": 99.63, "2024-12-31": 99.03,
    "2024-09-30": 99.03, "2024-06-30": 93.71, "2024-03-31": 93.29, "2023-12-31": 93.42,
    "2023-09-30": 89.20, "2023-06-30": 89.27, "2023-03-31": 88.34, "2022-12-31": 88.34,
    "2022-09-30": 81.98, "2022-06-30": 83.40,
})
bvps.index = pd.to_datetime(bvps.index)
bv = bvps.sort_index()
def pb_on(date):
    d = pd.Timestamp(date)
    d = d.tz_localize(c.index.tz) if d.tzinfo is None else d.tz_convert(c.index.tz)
    prior = bv[bv.index <= d.tz_localize(None)]
    return c.loc[:d].iloc[-1]/prior.iloc[-1] if len(prior) else None

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

print("=== POWERGRID CYCLE LEGS (zigzag 20% / 25%) with P/B at each pivot ===")
for thr in (20, 25):
    print(f"-- {thr}% --")
    piv = zigzag(c, thr)
    for (i0, v0, t0), (i1, v1, t1) in zip(piv, piv[1:]):
        typ = "RALLY" if t1 == 'H' else "DROP "
        d0, d1 = c.index[i0].date(), c.index[i1].date()
        p0, p1 = pb_on(d0), pb_on(d1)
        print(f"   {typ} {d0} -> {d1}  {v0:7.2f} -> {v1:7.2f}  {(v1/v0-1)*100:+6.1f}%  "
              f"{(c.index[i1]-c.index[i0]).days:>4}d   P/B {p0:.2f} -> {p1:.2f}")

print("\n=== CALENDAR YEAR ===")
yc = c.resample("YE").last()
for i in range(1, len(yc)):
    y = yc.index[i].year
    pbs = pb_on(yc.index[i]); pbs = f"{pbs:.2f}" if pbs else "n/a"
    print(f"  {y}: {yc.iloc[i]:7.2f}  ({(yc.iloc[i]/yc.iloc[i-1]-1)*100:+6.1f}%)   P/B ~{pbs}")

# ---------- momentum / trend matched analog ----------
def feats(df):
    cc = df["close"]; d = cc.diff()
    up = d.clip(lower=0).ewm(alpha=1/14).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1/14).mean()
    o = pd.DataFrame(index=cc.index)
    o["close"] = cc; o["rsi"] = 100 - 100/(1+up/dn)
    for w in (10, 20, 60): o[f"ret{w}"] = cc.pct_change(w)
    for w in (20, 50, 200): o[f"dma{w}"] = cc.rolling(w).mean(); o[f"d{w}"] = cc/o[f"dma{w}"] - 1
    o["slope200"] = o["dma200"].pct_change(20)
    o["ret1"] = cc.pct_change(); o["sig60"] = o["ret1"].rolling(60).std()*np.sqrt(252)
    o["volr"] = df["volume"]/df["volume"].rolling(60).median()
    return o

f = feats(pg)
fwd = (c.shift(-H)/c - 1)
base = pd.DataFrame({"fwd": fwd, "rsi": f["rsi"], "ret10": f["ret10"], "d200": f["d200"],
                     "slope": f["slope200"], "sig60": f["sig60"], "d50": f["d50"]}).dropna()

last = f.iloc[-1]
match = ((base.d200 < 0) & (base.rsi.between(50, 65)) & (base.ret10.between(0, 0.08)) &
         (base.slope.between(-0.02, 0.02)))
pool = base.loc[match, "fwd"]
print(f"\n=== MATCHED-STATE ANALOG (below 200DMA, RSI 50-65, 10d 0..+8%, flat 200DMA) ===")
print(f"  n_days={len(pool)} | mean {pool.mean()*100:+.2f}% | median {pool.median()*100:+.2f}% | "
      f"P(up) {(pool>0).mean()*100:.0f}% | P(+5%) {(pool>0.05).mean()*100:.0f}% | "
      f"P(-5%) {(pool<-0.05).mean()*100:.0f}% | sd {pool.std()*100:.2f}%")

def episodes(mask, label, gap=H):
    idx, i = [], 0
    d = base.index
    while i < len(d):
        if bool(mask.loc[d[i]]): idx.append(d[i]); i += gap
        else: i += 1
    v = base.loc[idx, "fwd"]
    print(f"  {label}: n_ep={len(v)} mean {v.mean()*100:+.1f}% median {v.median()*100:+.1f}% "
          f"P(up) {(v>0).mean()*100:.0f}% P(+5%) {(v>0.05).mean()*100:.0f}% P(-5%) {(v<-0.05).mean()*100:.0f}%")
    return v

print("\n=== CONDITIONAL SETS ===")
episodes(pd.Series(True, index=base.index), "unconditional")
episodes((base.d200 < 0), "below 200DMA")
episodes((base.d200 > 0), "above 200DMA")
episodes((base.rsi > 70), "RSI>70 (overbought)")
episodes((base.rsi.between(45, 65)) & (base.d200 < 0), "RSI 45-65 & below 200DMA")

# ---------- probability for 23-Nov ----------
r_i = c.pct_change().dropna()
sig252 = r_i.tail(252).std()*np.sqrt(252); sig60 = r_i.tail(60).std()*np.sqrt(252)

def mc_boot(returns, n=400_000):
    p = rng.choice(np.asarray(returns), size=(n, H), replace=True)
    return S * np.cumprod(1+p, axis=1)[:, -1]

def mc_ln(sig, mu_total, n=400_000):
    dt = 1/252; z = rng.standard_normal((n, H)); mu_d = mu_total/H
    return S * np.exp(np.cumsum((mu_d - .5*sig**2)*dt + sig*np.sqrt(dt)*z, axis=1))[:, -1]

# market-implied leg: map NIFTY/MIDCP chain-implied moves through POWERGRID's betas
def chain_sigma(name):
    d = json.load(open(f"/tmp/opencode/{name.lower()}_chain_20261123.json"))
    rows = []
    for rr in d["chain"]:
        ce, pe = rr.get("ce") or {}, rr.get("pe") or {}
        cl = (ce.get("market_data") or {}).get("ltp"); pl = (pe.get("market_data") or {}).get("ltp")
        if cl is not None and pl is not None: rows.append((rr["strike"], cl, pl))
    t = pd.DataFrame(rows, columns=["k", "ce", "pe"]).dropna()
    t = t[(t.k > d["spot"]*0.9) & (t.k < d["spot"]*1.1)]
    atm = t.iloc[(t.k - d["spot"]).abs().argmin()]
    return (atm["ce"]+atm["pe"])/(0.7979*d["spot"])

sig_n_mkt = chain_sigma("NIFTY"); sig_m_mkt = chain_sigma("MIDCPNIFTY")
def ols_beta(y, x, w=252):
    df_ = pd.concat([y, x], axis=1).dropna().tail(w)
    return df_.iloc[:, 0].cov(df_.iloc[:, 1])/df_.iloc[:, 1].var(), df_.corr().iloc[0, 1]
b_n, c_n = ols_beta(r_i, nifty["close"].pct_change().dropna())
b_m, c_m = ols_beta(r_i, midcp["close"].pct_change().dropna())
sig_i = r_i.tail(252).std()*np.sqrt(252)
sig_n = nifty["close"].pct_change().dropna().tail(252).std()*np.sqrt(252)
sig_m = midcp["close"].pct_change().dropna().tail(252).std()*np.sqrt(252)

def mc_mkt(n=400_000):
    # draw NIFTY and MIDCP 8-session moves with market-implied vol, scaled by historical corr
    z = rng.standard_normal((n, 2))
    rho = 0.75
    z2 = np.column_stack([z[:, 0], rho*z[:, 1] + np.sqrt(1-rho**2)*rng.standard_normal(n)])
    idx_ret = np.column_stack([z[:, 0]*sig_n_mkt, z2[:, 1]*sig_m_mkt])
    resid_var = max(sig_i**2 - (b_n**2*sig_n**2 + b_m**2*sig_m**2), 1e-8)
    sig_u = np.sqrt(resid_var)
    r_pg = (b_n*idx_ret[:, 0] + b_m*idx_ret[:, 1] + rng.standard_normal(n)*sig_u*np.sqrt(H/252)
            + (0.055 - 0.0465)*H/252)
    return S*np.exp(r_pg)

vol_only = np.concatenate([mc_boot(r_i.values), mc_boot(r_i.tail(60).values),
                           mc_ln(sig252, 0.0), mc_ln(sig252, 0.055-0.0465), mc_mkt()])
mom_adj = np.concatenate([
    mc_ln(sig252, float(pool.median())),
    S*(1 + rng.choice(np.asarray(pool.values), size=(400_000,))),
    mc_ln(sig60, float(pool.median())*0.8),
])
blend = np.concatenate([mom_adj, vol_only])

buckets = [(0, 250, "<250"), (250, 256, "250-256"), (256, 262, "256-262"), (262, 266, "262-266"),
           (266, 272, "266-272"), (272, 280, "272-280"), (280, 999, ">280")]
def table(term, title):
    print(f"\n{title}")
    print(f"{'':<12}" + "".join(f"{lab:>9}" for _, _, lab in buckets))
    print(f"{'ensemble':<12}" + "".join(f"{np.mean((term>a)&(term<=b))*100:8.1f}%" for a, b, _ in buckets))
table(vol_only, "VOL-ONLY + market-implied (Upstox chains)")
table(mom_adj, "MOMENTUM/TREND-ADJUSTED (matched analog)")
table(blend, "BLENDED 50/50")

print("\n=== KEY LEVELS ===")
print(f"{'level':>8}{'vol-only':>11}{'mom-adj':>11}{'blended':>11}")
for l in [244.65, 250, 255, 258, 263.75, 270, 282.74, 290, 300, 320.9]:
    g = (lambda t: np.mean(t > l)) if l > S else (lambda t: np.mean(t < l))
    print(f"{l:>8.2f}{g(vol_only)*100:10.1f}%{g(mom_adj)*100:10.1f}%{g(blend)*100:10.1f}%")
for nm, t in [("vol-only", vol_only), ("mom-adj", mom_adj), ("blended", blend)]:
    print(f"  {nm:<9} median {np.median(t):7.2f} | p10 {np.percentile(t,10):7.2f} | p25 {np.percentile(t,25):7.2f} "
          f"| p75 {np.percentile(t,75):7.2f} | p90 {np.percentile(t,90):7.2f}")
print(f"\n  market-implied leg: NIFTY 1sig {sig_n_mkt*100:.2f}%, MIDCP {sig_m_mkt*100:.2f}% | "
      f"PG beta NIFTY {b_n:.2f} (corr {c_n:+.2f}), MIDCP {b_m:.2f} (corr {c_m:+.2f}) | "
      f"PG vol 252d {sig252*100:.1f}% 60d {sig60*100:.1f}%")
