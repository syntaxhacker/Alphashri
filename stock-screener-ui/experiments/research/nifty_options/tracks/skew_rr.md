# Track B — Skew / risk-reversal mispricing

**Hypothesis.** Put skew (rr25 = 25d put IV − 25d call IV) is rich; extreme skew mean-reverts (risk reversal) and steep skew ("fear") predicts the next move.

**Data / method.** Real FYERS premiums, front listed monthly (exp 2026‑09‑29), 5‑min causal replay **2026‑07‑01→09‑25** (60 sessions; June has no usable smile). Quadratic smile per (date,expiry) → 25Δ rr25 (mean **+1.4 vol pts**, σ 0.5). Signal = causal prior-only rolling‑20 percentile (`shift(1)`); fills next bar open; spread 0.5%/side + NSE fees on every leg.

**Skew reversion (causal).**
| prior regime | n | next-day Δrr25 | prior‑EOD→10:00 | 10:00→EOD |
|---|---|---|---|---|
| steep (top 20%) | 10 | **−0.54 vp** | **−0.36 vp** | +0.07 vp |
| flat (bottom 20%) | 15 | **+0.20 vp** | +0.28 vp | — |

Skew **does** mean-revert, but it is an **overnight** effect: most is gone by 10:00 IST and the tradeable 10:00→EOD leg is ≈0. This kernel force-closes intraday, so it cannot harvest the reversion.

**Engine trades** (₹3L, 1% risk, hold‑to‑EOD; exp₹, PF, win, total₹, DD% of 3L, train/test exp, 90% CI, rawΔ-acc, mean net Δ):
| config | n | exp | PF | win | total | DD% | train/test | CI | rawacc | Δ |
|---|---|---|---|---|---|---|---|---|---|---|
| rr skew k3 | 22 | 442 | 1.52 | 55% | 9,730 | 3.2 | +1571/−84 | [−525,1393] | 0.45 | −0.21 |
| **rr steep k3 (sell rich put)** | 8 | **−268** | 0.80 | 50% | −2,147 | 3.6 | +1932/−1589 | [−2121,1695] | 0.38 | +0.84 |
| rr flat k3 (buy put) | 14 | 848 | 2.49 | 57% | 11,877 | 1.4 | +1299/+668 | [−149,1868] | 0.50 | −0.81 |
| rr uncond short put | 52 | −718 | 0.65 | 48% | −37,322 | 9.2 | −829/−629 | [−1822,321] | 0.44 | +0.84 |
| fear steep→CE | 10 | −925 | 0.36 | 10% | −9,247 | 3.9 | −605/−1244 | [−2032,406] | 0.50 | +0.59 |
| fear steep→PE | 10 | −571 | 0.40 | 30% | −5,715 | 2.3 | −562/−581 | [−1351,196] | 0.50 | −0.42 |
| fear flat→PE | 15 | 1,352 | 3.99 | 73% | 20,276 | 0.7 | +1741/+1157 | [196,2634] | 0.60 | −0.43 |
| smile vertical | 42 | −868 | 0.31 | 31% | −36,477 | 13.3 | −1153/−610 | [−1372,−371] | 0.50 | −0.01 |

**Smile residual.** Median within-day max−min residual = **0.64 vol pt** → gross ≈ **₹740/lot** (vega ≈ ₹1,160/vp) vs ≈ **₹650** round-trip on a 2-leg vertical → edge/cost ≈ **1.1 before adverse selection**; the delta-neutral engine vertical (n=42) loses in all three months → residual sits inside the spread.

**Overnight (not engine-verifiable).** A hypothetical hold from prior close to next close, short the rich 25Δ put / long the cheap call, gives gross **₹515** vs exec **₹221** → **net ₹293/lot/event**, CI90 [44,589], n=10. But this is n=10, not verifiable in this intraday kernel, and is confounded by overnight **delta** (the RR is long Δ) and by close-quote bounce.

**Red team.** (1) n tiny (≤22; steep side n=8) — below the n≥100 bar. (2) rr25 uses closing quotes, so part of the "reversion" is bid-ask bounce; the intraday engine confirms no harvestable edge. (3) The literal RR is **not** delta-neutral (sell put + buy call = long Δ) — true neutrality needs a futures hedge the kernel lacks (a delta-hedged P&L is reported instead). (4) The only train+test-positive bucket (flat→PE) is a short-delta **directional** bet on low-skew days in one declining regime. (5) One regime only (Jul–Sep 2026).

**Verdict: `reject`.** Nothing is exploitable **intraday**: the steep-side "sell rich put" trade loses, the smile residual is inside the spread, and every config fails the n≥100 / held-out / CI-excludes-0 bar. The only hint of edge is an unverifiable, delta-confounded, n=10 overnight skew reversion → `defer` to a daily-hold design with a futures hedge.
