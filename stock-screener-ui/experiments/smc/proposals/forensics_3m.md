# Losing-ENTRY forensics — 3-month full-population (June/July/August 2026)

Method (read-only): `SMCIFVGEngine(sess_start=720, sess_end=1380, atr_min=8.0)` defaults
otherwise (`gap_min=2, sl_buf=6, min_rr=3, min_risk=5, cooldown=3, ttl=30`), run on
Dukascopy `usatechidxusd` ticks for all 66 cached weekdays (22 Jun + 23 Jul + 21 Aug).
Entry context instrumented externally via subclass (engine untouched): zone distance at
signal close AND at fill (pts + R), risk, ATR(14) at signal, BOS age (bars/min), zone age,
touch count (bars overlapping zone form→signal; first-touch = ≤1), prior 3-bar
displacement (|close[i]−close[i−3]| in ATR, aligned vs side), IST hour, so-far range
position + ex-post expansion fraction. MFE/MAE tick-accurate (exit-side prices).
Script: `/tmp/smc_entry_forensics.py` → `/tmp/smc_entry_rows.json`;
analysis: `/tmp/smc_entry_analyze.py`.

**Headline: 1341 trades, net −3737.2 (Jun −1971.1 / Jul +560.5 / Aug −2326.6), PF 0.866,
win 318/1341 = 23.7%, baseline −2.79 pts/trade. 1023 losers (−27869.2) / 318 winners (+24132.0).**

## Loss clusters (MFE partition of the 1023 losers)

| # | cluster | n | net P&L |
|---|---|---|---|
| 1 | Immediate failure (MFE < +0.3R) | 423 | −12813.0 |
| 2 | Mid-fade (MFE +0.3…+1.5R) | 421 | −10622.7 |
| 3 | Round-trip (MFE ≥ +1.5R → loss) | 179 | −4433.4 |

No entry context separates clusters: every candidate below spreads ~evenly across
c1/c2/c3 (e.g. zage>30 → 85/85/42; disp<0.25 → 69/77/31; exp_frac>0.8 → 80/80/49;
atr<10 → 104/104/33). Entry filters trim expectancy-poor contexts; they do NOT
specifically target "never-went-anywhere" trades. (Exits/round-trips are out of scope
per brief — handled elsewhere.)

## Candidate entry filters — both sides shown

Baseline for comparison: cut expectancy −2.79/trade, cut win-rate 23.7%.
A cut whose subset is *better* than baseline kills good trades even when raw net is
positive (the system is net-negative, so almost any cut shows a positive raw net).
`rem PF` = portfolio PF after removing the subset (baseline 0.866).
Month-cut PFs show stability (subset PF per month — lower = consistently bad).

| filter (ex-ante unless noted) | losers n / P&L | winners killed n / P&L | raw net | cut avg/trade | cut WR | rem PF | Jun / Jul / Aug cut-PF |
|---|---|---|---|---|---|---|---|
| **P1 stale zone: zage > 30 bars** | 212 / −4604.8 | 46 / +2370.8 | +2234.0 | −8.66 | 17.8% | 0.935 | 0.58 / 0.54 / 0.38 ✅ |
| **P2 dead micro-tape: prior-3b displacement < 0.25×ATR** | 177 / −4191.4 | 46 / +2950.3 | +1241.2 | −5.57 | 20.6% | 0.895 | 0.74 / 0.77 / 0.54 ✅ |
| **P3 thin volatility: ATR(14) < 10 (raise atr_min 8→10)** | 241 / −3948.5 | 64 / +2559.0 | +1389.6 | −4.56 | 21.0% | 0.902 | 0.81 / 0.49 / 0.64 ✅ |
| tiny risk: risk < 15 (raise min_risk 5→15) | 185 / −2158.6 | 31 / +1378.6 | +780.0 | −3.61 | 14.4% | 0.885 | WR 13 / 14 / 16% ✅ |
| kind = retest | 204 / −3036.7 | 40 / +2014.6 | +1022.0 | −4.19 | 16.4% | 0.891 | 0.73 / 0.42 / 0.88 ⚠️ (Aug ~neutral) |
| any displacement > 1.5×ATR | 220 / −6993.8 | 67 / +5681.2 | +1312.6 | −4.57 | 23.3% | 0.884 | 0.92 / 0.81 / 0.62 ⚠️ (Jun ~neutral) |
| late session hr 20–24 IST | 271 / −9270.2 | 81 / +7227.4 | +2042.8 | −5.80 | 23.0% | 0.909 | 0.72 / **1.01** / 0.56 ❌ (Jul profitable) |
| exp_frac > 0.8 (DIAGNOSTIC ONLY — uses full-day range, lookahead) | 209 / −6877.7 | 54 / +3937.8 | +2939.9 | −11.18 | 20.5% | 0.962 | 0.47 / 0.92 / 0.42 ⚠️ (Jul neutral; not tradeable as-is) |
| touches ≥ 5 | 670 / −18152.2 | 196 / +13946.6 | +4205.6 | −4.86 | 22.6% | 1.048 | 0.77 / **1.10** / 0.38 ❌ (Jul profitable; kills 62% of all winners) |
| R1 chase_r > 1.0 (fill >1R past zone edge) | 105 / −2852.0 | 43 / +2378.4 | +473.7 | −3.20 | **29.1%** | 0.870 | **1.07** / 0.62 / 0.73 ❌ (Jun profitable; winners chase MORE: median 0.70R win vs 0.66R loss inv; retest fills ≈0.11R by construction) |
| BOS age ≤ 10 bars (skip just after flip) | 745 / −20880.0 | 229 / +19588.8 | +1291.2 | −1.33 | 23.5% | 0.650 | cut PF Jul **1.22** ❌ — destroys remainder PF; bias needs no warmup |
| BOS age ≤ 30 bars | 914 / −24884.6 | 278 / +22309.1 | +2575.5 | −2.16 | 23.3% | 0.611 | ❌ same reason, worse |
| momentum-aligned displacement > 1.0×ATR | 289 / −9801.1 | 114 / +9592.4 | +208.7 | −0.52 | 28.3% | 0.805 | ❌ kills the best subset |
| first-touch only (touches ≤ 1) | 40 / −616.2 | 11 / +452.1 | +164.1 | — | — | — | covers 3.8% of pop.; not a filter, just rare |

Union of P1+P2+P3(+diagnostic exp_frac): 619 losers (−15200) at the cost of 168 winners
(+9827). Filters overlap little (zage∩exp 35, zage∩disp 37, exp∩disp 36 losers) —
they catch different bad contexts.

## Ranked ENTRY-side proposals (exact thresholds)

**P1 — `max_zone_age = 30` (skip arming off zones formed >30 bars ago).**
Most consistent signal in the study: subset PF 0.58/0.54/0.38 across Jun/Jul/Aug, WR
17.8% vs 23.7% base, cut expectancy −8.66 vs −2.79. Removes 212 losers (−4604.8),
kills 46 winners (+2370.8). Remainder PF 0.866 → 0.935. Rationale: a 30-bar-old
unmitigated zone has been probed and ignored; its edge decays. Implement next to
`max_zone_dist` (applies to both inv zone and retest zone via `zone["form"]`).

**P2 — `min_displacement_r = 0.25` (require |close[i]−close[i−3]| ≥ 0.25×ATR(14) at arming).**
Dead-tape entries with no micro-impulse never go anywhere: subset PF 0.74/0.77/0.54
all three months, WR 20.6%. Removes 177 losers (−4191.4), kills 46 winners (+2950.3).
Remainder PF → 0.895. Direction-agnostic (any displacement, not aligned) — the
aligned variant is REJECTED below.

**P3 — `atr_min` 8.0 → 10.0 (widen the existing volatility gate).**
Trades taken with ATR(14) in [8,10) lose in all three months (subset PF 0.81/0.49/0.64,
241 losers −3948.5 vs 64 winners +2559.0 killed). Remainder PF → 0.902. Cheapest to
implement (one constant). Companion: `min_risk` 5 → 15 targets the lowest-WR bucket
in the study (14.4% WR; 185 losers −2158.6 vs 31 winners +1378.6) — consider together
as the "stop-in-noise" package.

## Explicit REJECTIONS (tested, do not implement)

- **Chase filters (`chase_r > 1.0`, `chase_fill > N`):** winners chase slightly more
  than losers (median 0.70R vs 0.66R); June chase_r>1 subset is profitable (PF 1.07,
  WR 34%). Cutting chase collapses remainder PF (0.5-gate → 0.671).
- **Post-BOS-flip cooldowns (`bos_age ≤ 10/30`):** July ≤10-bar subset PF 1.22;
  remainder PF collapses to 0.61–0.65. The bias works immediately; recency carries no signal.
- **Momentum-extension fade (`aligned displacement > 1.0×ATR`):** cut expectancy −0.52,
  WR 28.3% — this is where the winners live. Do not fade strength.
- **Touch-count / late-touch rules:** 96% of population is late-touch; touches≥5 cut is
  profitable in July (PF 1.10) and kills 62% of all winners. Zone-touch count is
  population, not signal.
- **Session-hour cuts (hr 20–24) and `exp_frac > 0.8`:** look tempting in Jun/Aug but
  July-neutral/profitable (trend days extend range late and win). exp_frac additionally
  uses full-day range (lookahead) — diagnostic only, not a rule.
