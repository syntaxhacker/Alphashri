import numpy as np
import pandas as pd

rng = np.random.default_rng(4242)
S = 86.50
H = 8

irfc = pd.read_pickle("/tmp/opencode/f_IRFC.pkl")
irfc.loc[pd.Timestamp("2026-11-11", tz=irfc.index.tz)] = [86.50, 89.93, 83.70, 86.50, 78906085.0]
c = irfc["close"]
d = c.diff()
up = d.clip(lower=0).ewm(alpha=1/14).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1/14).mean()
rsi = 100 - 100/(1+up/dn)
fwd = (c.shift(-H)/c - 1)

peak21 = rsi.rolling(21, center=True).max()
since_peak = (peak21 - rsi)
now_since = since_peak.iloc[-1]
print(f"IRFC RSI now {rsi.iloc[-1]:.1f} | 21d centred RSI peak {peak21.iloc[-1]:.1f} | "
      f"gap to peak {now_since:.2f} RSI pts -> RSI is AT its peak (0-1 day bucket)")
print("last 8 RSI:", " ".join(f"{v:.0f}" for v in rsi.iloc[-8:]))
print("last 8 close:", " ".join(f"{v:.0f}" for v in c.iloc[-8:]))

# post-RSI-peak analog pool (0-6 sessions after a 21d RSI peak) -> forward 8-session returns
pool = pd.DataFrame({"since": since_peak, "fwd": fwd}).dropna()
post_peak = pool[(pool["since"] >= 0) & (pool["since"] <= 3)]["fwd"]
post_peak_all = pool[(pool["since"] >= 0) & (pool["since"] <= 6)]["fwd"]
downtrend = pool[(pool["since"] >= 0) & (pool["since"] <= 6)]
print(f"\npost-RSI-peak analog pool (0-3 sessions after peak): n={len(post_peak)} "
      f"mean {post_peak.mean()*100:+.1f}% median {post_peak.median()*100:+.1f}% "
      f"P(up) {(post_peak>0).mean()*100:.0f}% P(+10%) {(post_peak>0.10).mean()*100:.0f}% "
      f"P(-5%) {(post_peak<-0.05).mean()*100:.0f}%")

# also restrict to downtrend-regime days (price<200DMA and 200DMA falling) at the peak
dma200 = c.rolling(200).mean(); slope = dma200.pct_change(20)
reg = pd.DataFrame({"since": since_peak, "fwd": fwd, "d200": c/dma200 - 1, "slope": slope}).dropna()
cnt = reg[(reg.since >= 0) & (reg.since <= 6) & (reg.d200 < 0) & (reg.slope < 0)]
print(f"post-peak AND downtrend regime: n={len(cnt)} mean {cnt['fwd'].mean()*100:+.1f}% "
      f"median {cnt['fwd'].median()*100:+.1f}% P(up) {(cnt['fwd']>0).mean()*100:.0f}%")
cnt2 = reg[(reg.since >= 0) & (reg.since <= 6) & (reg.d200 > 0)]
print(f"post-peak AND uptrend regime:   n={len(cnt2)} mean {cnt2['fwd'].mean()*100:+.1f}% "
      f"median {cnt2['fwd'].median()*100:+.1f}% P(up) {(cnt2['fwd']>0).mean()*100:.0f}%")

# ---------- final distributions ----------
r_i = c.pct_change().dropna()
sig252 = r_i.tail(252).std()*np.sqrt(252)
sig60 = r_i.tail(60).std()*np.sqrt(252)

def mc_ln(sig, mu_total, n=400_000):
    dt = 1/252
    z = rng.standard_normal((n, H))
    mu_d = mu_total/H
    return S * np.exp(np.cumsum((mu_d - .5*sig**2)*dt + sig*np.sqrt(dt)*z, axis=1))[:, -1]

def mc_boot(returns, n=400_000):
    p = rng.choice(np.asarray(returns), size=(n, H), replace=True)
    return S * np.cumprod(1+p, axis=1)[:, -1]

mu_post = float(post_peak.median())          # -3 to -4% over 8 sessions
print(f"\nused post-peak drift (median of analog pool) = {mu_post*100:+.2f}% over {H} sessions")

vol_only = np.concatenate([mc_boot(r_i.values), mc_boot(r_i.tail(60).values),
                           mc_ln(sig252, 0.0), mc_ln(sig252, 0.055-0.0266)])
mom_adj = np.concatenate([
    mc_ln(sig252, mu_post),                                   # drift-shifted
    S * (1 + rng.choice(np.asarray(post_peak.values), size=(400_000,))),  # empirical analog bootstrap
    mc_ln(sig60, mu_post*0.7),                                # lower-vol variant
    mc_ln(sig252, mu_post*1.3),                               # slower-decay variant
])
blend = np.concatenate([mom_adj, vol_only])   # 50/50

buckets = [(0, 78, "<78"), (78, 82, "78-82"), (82, 86.5, "82-86.5"), (86.5, 90, "86.5-90"),
           (90, 95, "90-95"), (95, 100, "95-100"), (100, 999, ">100")]
def table(term, title):
    print(f"\n{title}")
    print(f"{'':<12}" + "".join(f"{lab:>9}" for _, _, lab in buckets))
    print(f"{'ensemble':<12}" + "".join(f"{np.mean((term>a)&(term<=b))*100:8.1f}%" for a, b, _ in buckets))
table(vol_only, "VOL-ONLY (no momentum/trend)")
table(mom_adj, "MOMENTUM/TREND-ADJUSTED (post-RSI-peak drift)")
table(blend, "BLENDED 50/50")

print("\n=== KEY LEVELS ===")
print(f"{'level':>8}{'vol-only':>11}{'mom-adj':>11}{'blended':>11}")
for l in [73.19, 78, 80, 82, 85, 88, 92, 95.2, 100]:
    g = (lambda t: np.mean(t > l)) if l > S else (lambda t: np.mean(t < l))
    print(f"{l:>8.2f}{g(vol_only)*100:10.1f}%{g(mom_adj)*100:10.1f}%{g(blend)*100:10.1f}%")
for nm, t in [("vol-only", vol_only), ("mom-adj", mom_adj), ("blended", blend)]:
    print(f"  {nm:<9} median {np.median(t):6.1f} | p10 {np.percentile(t,10):6.1f} | p25 {np.percentile(t,25):6.1f} "
          f"| p75 {np.percentile(t,75):6.1f} | p90 {np.percentile(t,90):6.1f}")
