import json
import numpy as np
import pandas as pd

rng = np.random.default_rng(31337)
S = 86.50
H = 8

def load(n, pre="f_"):
    return pd.read_pickle(f"/tmp/opencode/{pre}{n}.pkl")

irfc, nifty, midcp, bank, psub, rail = (load(n) for n in
                                         ["IRFC", "NIFTY", "MIDCP", "BANK", "PSUBANK", "RAIL"])
# append today's session
irfc.loc[pd.Timestamp("2026-11-11", tz=irfc.index.tz)] = [86.50, 89.93, 83.70, 86.50, 78906085.0]
spots = {n: json.load(open(f"/tmp/opencode/{n.lower()}_chain_20261123.json"))["spot"]
         for n in ["NIFTY", "BANKNIFTY", "MIDCPNIFTY"]}
for nm, px in [("NIFTY", spots["NIFTY"]), ("BANK", spots["BANKNIFTY"]), ("MIDCP", spots["MIDCPNIFTY"])]:
    d = {"NIFTY": nifty, "BANK": bank, "MIDCP": midcp}[nm]
    d.loc[pd.Timestamp("2026-11-11", tz=d.index.tz)] = [px, px, px, px, 0.0]

def feats(df):
    c = df["close"]; d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1/14).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1/14).mean()
    o = pd.DataFrame(index=c.index)
    o["close"] = c
    o["rsi"] = 100 - 100/(1+up/dn)
    for w in (10, 20, 60): o[f"ret{w}"] = c.pct_change(w)
    for w in (20, 50, 100, 200):
        o[f"dma{w}"] = c.rolling(w).mean(); o[f"d{w}"] = c/o[f"dma{w}"] - 1
    o["slope200"] = o["dma200"].pct_change(20)
    o["volr"] = df["volume"]/df["volume"].rolling(60).median()
    o["ret1"] = c.pct_change()
    o["sig60"] = o["ret1"].rolling(60).std()*np.sqrt(252)
    o["hi52"] = c.rolling(252).max(); o["lo52"] = c.rolling(252).min()
    o["pos52"] = (c-o["lo52"])/(o["hi52"]-o["lo52"])
    return o

F = {n: feats(d) for n, d in [("IRFC", irfc), ("NIFTY", nifty), ("MIDCP", midcp),
                              ("BANK", bank), ("PSUBANK", psub), ("RAIL", rail)]}
f = F["IRFC"]; last = f.iloc[-1]

print("=== IRFC MOMENTUM / TREND (Upstox, 11-Nov-2026) ===")
print(f"  close {last['close']:.2f} | RSI14 {last['rsi']:.1f} | 10d {last['ret10']*100:+.1f}% | "
      f"20d {last['ret20']*100:+.1f}% | 60d {last['ret60']*100:+.1f}%")
print(f"  vs 20DMA {last['d20']*100:+.1f}% | 50DMA {last['d50']*100:+.1f}% | 100DMA {last['d100']*100:+.1f}% | "
      f"200DMA {last['d200']*100:+.1f}% (200DMA={last['dma200']:.2f}, slope20 {last['slope200']*100:+.1f}%)")
print(f"  52w pos {last['pos52']*100:.0f}% | vol ratio {last['volr']:.1f}x | 60d vol {last['sig60']*100:.0f}%")

print("\n=== DRIVER TREND CONTEXT ===")
for n in ["NIFTY", "MIDCP", "BANK", "PSUBANK", "RAIL"]:
    x = F[n].iloc[-1]
    print(f"  {n:<8} {x['close']:>10,.2f} RSI {x['rsi']:5.1f} 10d {x['ret10']*100:+6.1f}% "
          f"vs200 {x['d200']*100:+6.1f}% vs50 {x['d50']*100:+6.1f}% slope200 {x['slope200']*100:+5.1f}% "
          f"| {'UP' if x['d200']>0 else 'DOWN'}trend / 200DMA {'rising' if x['slope200']>0 else 'falling'}")

c = irfc["close"]
base = pd.DataFrame({"fwd": (c.shift(-H)/c - 1), "rsi": f["rsi"], "ret10": f["ret10"],
                     "ret20": f["ret20"], "ret60": f["ret60"], "d200": f["d200"], "d50": f["d50"],
                     "slope": f["slope200"], "volr": f["volr"], "sig60": f["sig60"],
                     "pos52": f["pos52"], "close": c}).dropna()

def episodes(mask, label, gap=H):
    idx, i = [], 0
    d = base.index
    while i < len(d):
        if bool(mask.loc[d[i]]):
            idx.append(d[i]); i += gap
        else:
            i += 1
    v = base.loc[idx, "fwd"]
    print(f"\n{label}: n={len(v)}")
    if len(v):
        print("   ", ", ".join(str(d.date()) for d in idx))
        print(f"    mean {v.mean()*100:+.1f}% | median {v.median()*100:+.1f}% | P(up) {(v>0).mean()*100:.0f}% | "
              f"P(+5%) {(v>0.05).mean()*100:.0f}% | P(+10%) {(v>0.10).mean()*100:.0f}% | "
              f"P(-5%) {(v<-0.05).mean()*100:.0f}% | P(-10%) {(v<-0.10).mean()*100:.0f}% | "
              f"worst {v.min()*100:+.1f}% best {v.max()*100:+.1f}%")
    return v

def pooled(mask, label):
    v = base.loc[mask, "fwd"]
    print(f"{label}: n_days={len(v)} (overlapping) | mean {v.mean()*100:+.1f}% | median {v.median()*100:+.1f}% | "
          f"P(up) {(v>0).mean()*100:.0f}% | P(+5%) {(v>0.05).mean()*100:.0f}% | P(-10%) {(v<-0.10).mean()*100:.0f}%")
    return v

print("\n=== CONDITIONAL FORWARD-8-SESSION DISTRIBUTIONS (IRFC, Upstox full history) ===")
mom_strict = (base.rsi > 70) & (base.ret10 > 0.15)
mom_loose = (base.rsi > 65) & (base.ret10 > 0.12)
S_uncond = episodes(pd.Series(True, index=base.index), "S0 unconditional")
S_strict = episodes(mom_strict, "S1 STRICT momentum RSI>70 & 10d>+15%")
S_loose = episodes(mom_loose, "S2 LOOSE momentum RSI>65 & 10d>+12%")
S_ct = episodes(mom_loose & (base.d200 < 0), "S3 LOOSE momentum + BELOW 200DMA  (counter-trend)")
S_al = episodes(mom_loose & (base.d200 > 0), "S4 LOOSE momentum + ABOVE 200DMA  (trend-aligned)")
S_up = episodes((base.d200 > 0) & (base.slope > 0), "S5 uptrend (>200DMA, 200DMA rising)")
S_dn = episodes((base.d200 < 0) & (base.slope < 0), "S6 downtrend (<200DMA, 200DMA falling)")
print()
pooled(mom_strict, "P1 strict momentum (pooled days)")
pooled(mom_loose, "P2 loose momentum (pooled days)")
pooled((base.d200 < 0) & (base.slope < 0), "P3 downtrend days (pooled)")
pooled((base.d200 > 0) & (base.slope > 0), "P4 uptrend days (pooled)")

# momentum decay: forward returns by "days since momentum peak" (RSI peak)
print("\n=== MOMENTUM DECAY: fwd8 return vs sessions since RSI peak ===")
rsi_peak = f["rsi"].rolling(21, center=True).max()
days_since_peak = (rsi_peak - f["rsi"]).abs()
for lo, hi, lab in [(0, 1, "0-1d after RSI peak"), (1, 3, "1-3d"), (3, 6, "3-6d"),
                    (6, 11, "6-10d"), (11, 21, "11-20d")]:
    m = (days_since_peak >= lo) & (days_since_peak < hi)
    v = base.loc[m, "fwd"]
    if len(v) > 30:
        print(f"  {lab:<22} n={len(v):<5} median {v.median()*100:+6.2f}%  P(up) {(v>0).mean()*100:3.0f}%")

# ---------- final blended distribution ----------
def mc_boot(returns, n=300_000):
    p = rng.choice(np.asarray(returns), size=(n, H), replace=True)
    return S * np.cumprod(1 + p, axis=1)[:, -1]

def mc_ln(sig, mu, n=300_000):
    dt = 1/252
    z = rng.standard_normal((n, H))
    return S * np.exp(np.cumsum((mu - .5*sig**2)*dt + sig*np.sqrt(dt)*z, axis=1))[:, -1]

r_i = irfc["close"].pct_change().dropna()
sig252 = r_i.tail(252).std()*np.sqrt(252); sig60 = r_i.tail(60).std()*np.sqrt(252)

vol_models = {"V1 boot 2Y": mc_boot(r_i.values), "V2 boot 60d": mc_boot(r_i.tail(60).values),
              "V3 lognorm 30% mu0": mc_ln(sig252, 0.0),
              "V4 lognorm RN 2.84%": mc_ln(sig252, 0.055-0.0266)}
vol_term = np.concatenate(list(vol_models.values()))

pool = S_loose if len(S_loose) >= 5 else S_strict
mu_adj = float(pool.mean())
print(f"\n=== MOMENTUM/TREND DRIFT ===")
print(f"  analog pool n={len(pool)} mean {mu_adj*100:+.2f}% median {pool.median()*100:+.2f}% "
      f"(unconditional mean {S_uncond.mean()*100:+.2f}%, median {S_uncond.median()*100:+.2f}%)")
mom_models = {
    "M1 drift-shifted lognormal": mc_ln(sig252, mu_adj),
    "M2 empirical analog bootstrap": S * (1 + rng.choice(np.asarray(pool.values), size=(300_000,))),  # FIXED
    "M3 low-vol half-drift": mc_ln(sig60, mu_adj * 0.5),
    "M4 trend-conditional (downtrend drift)": mc_ln(sig252, float(S_dn.mean()) if len(S_dn) else -0.01),
}
mom_term = np.concatenate(list(mom_models.values()))
blend = np.concatenate([mom_term, vol_term, vol_term])   # 50% momentum / 50% vol

buckets = [(0, 78, "<78"), (78, 82, "78-82"), (82, 86.5, "82-86.5"), (86.5, 90, "86.5-90"),
           (90, 95, "90-95"), (95, 100, "95-100"), (100, 999, ">100")]
def table(term, title):
    print(f"\n{title}")
    print(f"{'ensemble':<14}" + "".join(f"{lab:>9}" for _, _, lab in buckets))
    print(f"{'':<14}" + "".join(f"{np.mean((term>a)&(term<=b))*100:8.1f}%" for a, b, _ in buckets))
table(vol_term, "VOL-ONLY ensemble (my earlier answer)")
table(mom_term, "MOMENTUM/TREND-ADJUSTED ensemble")
table(blend, "BLENDED 50/50")

print("\n=== KEY LEVELS ===")
print(f"{'level':>8}{'vol-only':>11}{'mom-adj':>11}{'blended':>11}")
for l in [73.19, 78, 80, 82, 88, 92, 95.2, 100]:
    g = (lambda t: np.mean(t > l)) if l > S else (lambda t: np.mean(t < l))
    print(f"{l:>8.2f}{g(vol_term)*100:10.1f}%{g(mom_term)*100:10.1f}%{g(blend)*100:10.1f}%")
for nm, t in [("vol-only", vol_term), ("mom-adj", mom_term), ("blended", blend)]:
    print(f"  {nm:<10} median {np.median(t):.1f} | p10 {np.percentile(t,10):.1f} | p25 {np.percentile(t,25):.1f} "
          f"| p75 {np.percentile(t,75):.1f} | p90 {np.percentile(t,90):.1f}")
