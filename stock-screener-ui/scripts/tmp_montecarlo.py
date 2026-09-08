"""Monte Carlo on the ORIGINAL (unfiltered) LRL-iFVG strategy.

Trade sample: 308 prime-window trades parsed from /tmp/opencode/full_base.log
(base rules, ~100 cached Dukascopy days, tick-accurate SL-first fills).
Bootstrap B=20000 paths x 308 draws (with replacement) in R multiples.

Outputs (images + stdout stats):
  /tmp/opencode/mc_equity.png    fan chart of equity paths
  /tmp/opencode/mc_terminal.png  histogram of terminal P&L
  /tmp/opencode/mc_rhist.png     histogram of the 308 actual trade Rs
  /tmp/opencode/mc_dd.png        histogram of path max drawdowns
"""
import re

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

LOG = "/tmp/opencode/full_base.log"
OUT = "/tmp/opencode"
B = 20000
SEED = 7

rs = np.array([float(x) for x in re.findall(r"\(([+-][0-9]+\.[0-9]+)R\)", open(LOG).read())])
assert len(rs) == 308, f"expected 308 trades, parsed {len(rs)}"
print(f"sample: n={len(rs)} win={(rs > 0).mean() * 100:.1f}% mean={rs.mean():+.3f}R "
      f"sd={rs.std(ddof=1):.3f}R total={rs.sum():+.1f}R")

rng = np.random.default_rng(SEED)
paths = rng.choice(rs, size=(B, len(rs))).cumsum(axis=1)  # (B, 308) equity in R
term = paths[:, -1]
peak = np.maximum.accumulate(paths, axis=1)
dd = (paths - peak).min(axis=1)  # max drawdown per path (negative)

q = lambda p: np.percentile(term, p)
print(f"terminal R: mean={term.mean():+.1f} median={np.median(term):+.1f} "
      f"p5={q(5):+.1f} p25={q(25):+.1f} p75={q(75):+.1f} p95={q(95):+.1f}")
print(f"P(profit>0)={(term > 0).mean() * 100:.2f}%  P(terminal<-20R)={(term < -20).mean() * 100:.1f}%")
print(f"maxDD: median={np.median(dd):+.1f}R p95={np.percentile(dd, 5):+.1f}R "
      f"(95% of paths draw down at least {abs(np.percentile(dd, 5)):.0f}R at some point)")

xs = np.arange(1, len(rs) + 1)
lo5, lo25, med, hi75, hi95 = (np.percentile(paths, p, axis=0) for p in (5, 25, 50, 75, 95))

plt.figure(figsize=(10, 5.5))
for i in range(150):
    plt.plot(xs, paths[i], color="steelblue", alpha=0.07, lw=0.7)
plt.fill_between(xs, lo5, hi95, color="steelblue", alpha=0.15, label="90% band")
plt.fill_between(xs, lo25, hi75, color="steelblue", alpha=0.25, label="50% band")
plt.plot(xs, med, color="navy", lw=1.8, label="median")
plt.axhline(0, color="black", lw=0.8)
plt.title(f"LRL-iFVG original: {B} bootstrapped equity paths (308 trades each, R multiples)")
plt.xlabel("trades")
plt.ylabel("cumulative R")
plt.legend()
plt.tight_layout()
plt.savefig(f"{OUT}/mc_equity.png", dpi=110)

plt.figure(figsize=(9, 5))
plt.hist(term, bins=80, color="steelblue", edgecolor="white")
plt.axvline(0, color="red", lw=1.5, label="breakeven")
plt.axvline(np.median(term), color="navy", ls="--", label=f"median {np.median(term):+.0f}R")
plt.title("Terminal P&L distribution (20,000 bootstrapped 308-trade runs)")
plt.xlabel("terminal R")
plt.ylabel("paths")
plt.legend()
plt.tight_layout()
plt.savefig(f"{OUT}/mc_terminal.png", dpi=110)

plt.figure(figsize=(9, 5))
plt.hist(rs, bins=40, color="darkorange", edgecolor="white")
plt.axvline(0, color="black", lw=0.8)
plt.title(f"Actual trade outcomes: 308 prime-window trades (win {(rs > 0).mean() * 100:.0f}%, mean {rs.mean():+.2f}R)")
plt.xlabel("trade R multiple")
plt.ylabel("trades")
plt.tight_layout()
plt.savefig(f"{OUT}/mc_rhist.png", dpi=110)

plt.figure(figsize=(9, 5))
plt.hist(-dd, bins=60, color="firebrick", edgecolor="white")
plt.title("Max-drawdown distribution (per path, R)")
plt.xlabel("max drawdown R")
plt.ylabel("paths")
plt.tight_layout()
plt.savefig(f"{OUT}/mc_dd.png", dpi=110)
print("wrote mc_equity.png mc_terminal.png mc_rhist.png mc_dd.png")
