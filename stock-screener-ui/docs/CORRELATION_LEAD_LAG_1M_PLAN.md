# 1-minute lead/lag of correlated stocks vs NIFTY / BankNifty — methodology design and adversarial audit

**Question under review:** do 1-minute moves in correlated stocks lead the NIFTY (`^NSEI`) / BankNifty (`^NSEBANK`) index move in the *following* minute?

**Verdict up front:** **the cached data cannot answer this question.** No cached artifact contains a lagged statistic at 1-minute resolution, no raw 1-minute series was persisted, and no 1-minute BankNifty data was ever fetched. The three JSON files that mention "1 minute" / "lead lag" / "quiet" each measure something different from the asked question:

| Artifact | Bar size | Statistic | Does it test stock<sub>t</sub> → index<sub>t+1</sub>? |
|---|---|---|---|
| `lead_lag.json` | 5m | lagged cross-correlation, k = −3…+3 | No — resolution is 5m, not 1m |
| `one_minute.json` | 1m | **contemporaneous** Pearson r only | No — no lag key anywhere in the file |
| `quiet_rank.json` | 5m | contemporaneous r on calmest half of minutes | No — no lag, no 1m |

Do not upgrade any of these into a lead claim. `build_corr_eda_report.py:708` already states the correct limitation: a high 5-minute correlation "does not mean the stock leads the index, nor that it is a good trade."

> **Ephemeral sources:** every `run.py` and `LEDGER.md` citation below refers to files under `/tmp/opencode/nasdaq_corr_loop` — ephemeral scratch that is no longer present locally. They are retained as provenance for how the cached numbers were produced only; re-derive before trusting any quoted value.

---

## 1. Data contract

### 1.1 Exact fields required

A study row is one aligned minute bin. Minimum schema (all fields mandatory, no silent defaults):

| Field | Type | Definition |
|---|---|---|
| `session_date` | `YYYY-MM-DD` | IST *session* date, not the UTC date of the stored timestamp |
| `bar_start_ist` | ISO-8601 with `+05:30` | bin starts at `HH:MM:00` IST |
| `symbol` | str | e.g. `HDFCBANK.NS`, `^NSEI`, `^NSEBANK` |
| `close` | float > 0, finite | last traded price in the bin |
| `volume` | int ≥ 0 | needed to detect stale bars; `one_minute.json`'s generator (`run.py:37-54`) kept **Close only**, so this field is absent from all cached 1m work |
| `stock_ret_t` | float | within-session return of the stock over bin `t` |
| `index_ret_t` | float | within-session return of the index over bin `t` |
| `index_ret_t1` | float | index return over bin `t+1` — the target |
| `valid_pair` | bool | all four returns finite and both legs printed in both bins |

JSON keys that already exist and must be reused, not renamed: `window.start`, `window.end`, `n_1m`, `n_5m`, `r_1m`, `r_5m`, `r_resampled_1m_to_5m`, `delta`, `granularity_sensitive` (`one_minute.json`); `r_by_lag`, `r_lag0`, `best_lag`, `r_best`, `placebo_r`, `n`, `verdict` (`lead_lag.json`); `r_all`, `r_quiet`, `n_quiet`, `quiet_robust` (`quiet_rank.json`).

### 1.2 Session pinning

- Trading window **09:15:00–15:30:00 IST**, i.e. `config.IST = timezone(timedelta(hours=5, minutes=30))` (`config.py:7`). Continuous trading ends **15:15 IST**; **15:15–15:30 is the NSE closing auction**. The cached 5m series run to `15:25` (`nifty_intraday.json:window.end = 2026-11-23T15:25:00+05:30`, 4,495 bars), so they *include auction bars*. A 1m study must either exclude 15:15–15:30 and the 09:15–09:16 opening bin, or tag them and report them separately — an "edge" that exists only in the auction is a mechanism artifact, not information.
- Every return and every lag shift is computed **within one session**. Never pair `t` of session D with `t+1` of session D+1. This is already the rule in `lead_lag.json:method` ("shifts applied WITHIN each session only (no cross-session pairing)") and `one_minute.json:summary[1]` ("Returns are within-session only … first bar dropped").
- First return of each session is dropped; the last incomplete bin is dropped. Holiday/weekend exclusion must come from the union of observed session dates, never from a hardcoded calendar.
- US and Indian series must never be pooled: `one_minute.json` mixes `^IXIC` and `^NSEI` pairs in one file, but each pair is correlated independently and the answer asked here is India-only.

### 1.3 UTC vs IST warning

`yfinance` returns tz-aware indices in the exchange's local zone (`Asia/Kolkata` for `^NSEI`/`^NSEBANK`/`.NS`; `America/New_York` for US). Two concrete hazards observed in the cache:

- `nifty_intraday.json:window.start/end` carry `+05:30`; `banknifty_intraday.json:window.start/end` carry **no offset at all** (`"2026-08-26T09:15:00"`, `"2026-11-23T15:25:00"`) while describing the same 4,495 IST bars. Same data, two contracts. Normalise to `config.IST` before anything else.
- Never derive a session date from the UTC calendar date of a stored bar. The repo's documented daily-bar convention is that a session is stamped **18:30 UTC of the previous calendar day**; applying that kind of UTC-date formatting to intraday data silently names the wrong session. Convert to IST first, then take `.date()`.

### 1.4 What is a valid 1m bar, and how to reject stale/partial bars

A bin is valid only if **both** legs have a finite, positive Close and a non-zero volume print inside the same IST minute, and the previous bin in the *same session* also has a valid print (otherwise no return can be formed).

Reject, with an explicit counter rather than a fill:

1. **Stale quote:** ≥2 consecutive bins with stock Close unchanged *and* volume 0 (or stock return exactly 0 while `|index_ret| > 0` for that bin). `one_minute.json` already documents the consequence: asynchronous/stale quotes "bias r toward zero relative to the 5m read"; a lead statistic built on the same bars inherits that bias and can manufacture an apparent ±1-minute lag.
2. **Partial session:** session has <80% of the expected continuous-session bins, or <200 aligned pairs after filtering. Report `n` per session.
3. **Auction bins:** 09:15–09:16 and 15:15–15:30 (see §1.2) — exclude by default.
4. **Corporate actions / bad prints:** non-finite, ≤0, or a >20% single-minute jump with no matching index move gets quarantined and listed, not smoothed.
5. **Vendor disagreement:** if two vendors' Close for the same bin disagree beyond tick size, drop the bin and log it.

Honesty rule carried over from `docs/AGRI_DATA_USAGE.md` (agri-specific, but the principle transfers): **never invent a price or OHLC bar, never present a partial day as complete, and keep a missing value missing rather than zero.** Every rejection must be counted in the output JSON.

---

## 2. Statistical test

### 2.1 Lag convention — get the sign right

For session `d`, minutes `t`, stock return `s[d,t]`, index return `i[d,t]`:

- **Stock leads index by one minute** (the asked question): `ρ₊₁ = corr(s[d,t], i[d,t+1])`, pooled over all `(d,t)` with `t+1` still in session `d`.
- **Index leads stock by one minute**: `ρ₋₁ = corr(i[d,t], s[d,t+1])`.

`lead_lag.json:sign_convention` says **"positive lag = index leads stock"** and its `method` defines `r(lag) = corr(index_ret[t], stock_ret[t+lag])`. Under that convention, **the asked question corresponds to `r_by_lag["-1"]`, not `r_by_lag["1"]`** (because `corr(i[t], s[t−1]) = corr(s[t−1], i[t])`). Any implementation that reports `r_by_lag["1"]` as "stock leads" has the direction inverted and must be rejected. Prefer the explicit `ρ₊₁` / `ρ₋₁` notation above over signed-lag shorthand.

### 2.2 Naive vs contemporaneous-controlled

The naive `ρ₊₁` is confounded: the same stock and index share a strong contemporaneous factor (`r_1m` 0.573–0.762 in `one_minute.json`; `r_lag0` 0.512–0.758 in `lead_lag.json`) and both series have their own short-lag autocorrelation from stale quotes and bid-ask bounce. A nonzero naive `ρ₊₁` therefore does **not** establish a lead. The estimand of interest is the *partial* correlation of `s[d,t]` with `i[d,t+1]` after removing what is already in the current and recent index/stock state.

### 2.3 Partial-correlation formula

Let `x = s[d,t]`, `y = i[d,t+1]`, control vector `Z = (i[d,t], s[d,t−1], i[d,t−1], s[d,t−2], i[d,t−2])`.

- Residual form: regress `x` on `Z` → `eₓ`; regress `y` on `Z` → `e_y`; `ρ_partial = corr(eₓ, e_y)`.
- Equivalent precision-matrix form: with `R` the correlation matrix of `(x, y, Z)` and `Φ = R⁻¹`,
  `ρ_{xy·Z} = −Φ_xy / sqrt(Φ_xx · Φ_yy)`.
- Under iid observations, `t = ρ_partial · sqrt((n − dim(Z) − 3)/(1 − ρ_partial²))`. **Do not use this iid t-stat for significance here**: minute returns are serially correlated and clustered by session. Use session-clustered (cluster = `session_date`) or Newey–West HAC standard errors, or a block bootstrap that resamples whole sessions (the precedent is `bootstrap_rank.json`, 500 whole-session resamples).

Report both `ρ₊₁` (naive) and `ρ_partial` plus their gap. If the gap is large and `ρ_partial ≈ 0`, the naive lead was just the contemporaneous factor leaking through autocorrelation.

### 2.4 Sample-size requirement

Fisher-z power calculation, two-sided α = 0.05, 80% power: `n_eff ≈ ((1.96 + 0.84)/atanh(r))² + 3`.

| Target effect | Independent pairs needed |
|---|---|
| r = 0.05 | ≈ 3,135 |
| r = 0.03 | ≈ 8,700 |

`n_eff` is **smaller** than the raw minute count once serial correlation and session clustering are accounted for (design effect ≈ (1+ρ)/(1−ρ)). Propose as pre-registered floors: **≥40 sessions, ≥15,000 valid aligned 1m pairs, ≥200 pairs per session**, and ≥60 sessions for a claim of per-session sign consistency. The cached 1m window (`one_minute.json:window` 2026-10-27 → 2026-11-23) has `n_1m` ≈ 6,855–6,858 per India pair over roughly 20 trading sessions — enough raw minutes for a 0.05 effect in principle, **too few sessions for cluster-robust inference or a sign-consistency claim**.

### 2.5 Placebo design (all required, none optional)

1. **Within-session circular shift (primary placebo).** For each session pick random offset `u_d ∈ [1, T_d−1]`; pair `s[d,t]` with `i[d,(t+u_d) mod T_d]`. Preserves each series' autocorrelation, destroys cross-alignment. Repeat 500× for a null distribution of `ρ_partial`.
2. **Session-date mismatch.** Pair stock session D with index session D+k at matched clock time. This is the design already in `lead_lag.json:method` ("stock session-D returns correlated with index session D+1 returns at matched time-of-day"); recorded `placebo_r` values are −0.016…0.037 across the 12 pairs — near zero, as required.
3. **Sign flip.** Multiply `s[d,t]` by −1 in randomly chosen sessions. A genuine information lead should collapse; a shared-factor artifact often survives symmetrically.
4. **Reverse-direction asymmetry.** Require `ρ₊₁` significant and `ρ₋₁` not significant. If both are positive and similar, that is a common shock / stale-quote artefact, not a lead.
5. **Out-of-window replication.** Re-run the identical pipeline on a disjoint ≥20-session window; sign and rough magnitude must replicate.

Pass rule: the real estimate lies outside the 95% null band of placebos 1–3, and placebo 4 shows the required asymmetry.

### 2.6 Multiple-comparison correction

Pre-register **one primary endpoint** (one pair, one lag `k=1`, one direction stock→index, one statistic `ρ_partial`). Everything else is secondary and labelled exploratory. If scanning `K` names × `L` lags × `M` statistics, declare `V = K·L·M` and apply Holm–Bonferroni or Benjamini–Hochberg FDR at q = 0.05 across the family; the primary must survive. The cache sets the precedent for honest variant counting: `nifty_intraday.json:robustness.variants_tried = 200`, `banknifty_intraday.json:robustness.variants_tried = 10`, and `lead_lag.json` implicitly 4 markets × 3 names × 7 lags = 84. A result that only appears after scanning unreported variants is noise.

### 2.7 Per-session sign consistency threshold (proposed, pre-register)

- `sign(ρ₊₁[d]) > 0` in **≥60%** of sessions with ≥50 valid pairs, binomial p < 0.05 against 50%;
- median `ρ₊₁[d] > 0` and 10%-trimmed mean > 0;
- no single session contributes >20% of the pooled effect (leave-one-session-out stability);
- the same direction holds for **≥2/3** of the pre-registered names.

`lead_lag.json:method` used a weaker cross-*name* gate ("same sign of r_best across >=2 of 3 names"), not a per-session gate. Do not reuse it for a lead claim.

### 2.8 Real finding vs noise

**Real finding** requires *all*: primary `ρ_partial` significant after FDR; `ρ_partial ≥ 0.03` (proposed economically-detectable floor); placebo band excludes it; `ρ₋₁` not significant; ≥60% sessions same sign; replicates out-of-window and on a second vendor; survives auction-minute exclusion.

**Noise** if any: naive `ρ₊₁` significant but `ρ_partial ≈ 0`; `ρ₊₁ ≈ ρ₋₁`; effect confined to 09:15–09:16 or 15:15–15:30; effect vanishes on quiet minutes; effect present in only one vendor; or effect depends on an undisclosed variant search.

---

## 3. Prior findings audit — actual recorded numbers

### 3.1 `lead_lag.json` — 5m resolution, all 12 pairs peak at lag 0 → refutes a multi-minute lead, silent on 1m

`lead_lag.json:sign_convention` = `"positive lag = index leads stock"`. Gate recorded in `lead_lag.json:method`: `"best_lag != 0 AND |r(best)-r(lag0)| >= 0.03 AND same sign of r_best across >=2 of 3 names"`.

`^NSEI` pairs (`r_by_lag` keys are strings):

| ticker | `r_lag0` | `r_by_lag["-1"]` (stock→index) | `r_by_lag["1"]` (index→stock) | `best_lag` | `r_best` | `placebo_r` | `n` | `verdict` |
|---|---|---|---|---|---|---|---|---|
| `JIOFIN.NS` | 0.657 | 0.023 | 0.031 | 0 | 0.657 | −0.006 | 4342 | SYNCHRONOUS |
| `HDFCBANK.NS` | 0.622 | 0.019 | 0.003 | 0 | 0.622 | 0.025 | 4338 | SYNCHRONOUS |
| `ICICIBANK.NS` | 0.607 | −0.008 | 0.031 | 0 | 0.607 | 0.015 | 4326 | SYNCHRONOUS |

`^NSEBANK` pairs:

| ticker | `r_lag0` | `r_by_lag["-1"]` | `r_by_lag["1"]` | `best_lag` | `r_best` | `placebo_r` | `n` | `verdict` |
|---|---|---|---|---|---|---|---|---|
| `HDFCBANK.NS` | 0.658 | 0.003 | 0.005 | 0 | 0.658 | 0.029 | 4338 | SYNCHRONOUS |
| `ICICIBANK.NS` | 0.653 | −0.009 | 0.008 | 0 | 0.653 | 0.006 | 4326 | SYNCHRONOUS |
| `SBIN.NS` | 0.648 | 0.001 | 0.028 | 0 | 0.648 | −0.016 | 4336 | SYNCHRONOUS |

Recorded `summary` strings: `"^NSEI: NO LEAD/LAG — all 3 names peak at best_lag=[0, 0, 0] with r_lag0=[0.657, 0.622, 0.607] … Placebo (1-session shift) r=[-0.006, 0.025, 0.015] ~ 0. n=[4342, 4338, 4326]."` and `"^NSEBANK: NO LEAD/LAG — all 3 names peak at best_lag=[0, 0, 0] with r_lag0=[0.658, 0.653, 0.648] … Placebo (1-session shift) r=[0.029, 0.006, -0.016] ~ 0. n=[4338, 4326, 4336]."`

**Audit:** this found no detectable lead at 5-minute resolution, with the caveat that the gate is insensitive (line 161): every stock→index coefficient (`r_by_lag["-1"]`) is between −0.009 and +0.023, vs contemporaneous 0.607–0.658, and the recorded gate failed for all 12 pairs. It says **nothing** about a 1-minute lead: 5m bars cannot resolve a 1m effect, and no 1m lag was computed.

**Adversarial caveat on the gate:** `best_lag` is `argmax |r|`, and since `r_0 ≈ 0.6–0.76` dominates, `best_lag = 0` is almost guaranteed; the gate therefore requires the *lagged* r to **exceed** the contemporaneous r. A genuine but small lead (e.g. 0.04) would be statistically detectable with n≈4,300 yet still be recorded `SYNCHRONOUS`. The correct test is §2.3 (partial correlation > 0 after controlling `i_t`), not "lagged r > concurrent r". The verdict is valid for the data it measured, but the gate is not a sensitive lead detector.

### 3.2 `one_minute.json` — 1m resolution, contemporaneous only → silent on lead/lag

`window.start = "2026-10-27"`, `window.end = "2026-11-23"`, `note = "1m fetched in 7-day chunks due to yfinance limit"`.

| `index` | `ticker` | `n_1m` | `n_5m` | `r_1m` | `r_5m` | `r_resampled_1m_to_5m` | `delta` | `granularity_sensitive` |
|---|---|---|---|---|---|---|---|---|
| `^IXIC` | `NVDA` | 7679 | 1521 | 0.627 | 0.785 | 0.785 | −0.159 | true |
| `^IXIC` | `TSM` | 7664 | 1518 | 0.762 | 0.822 | 0.822 | −0.060 | true |
| `^IXIC` | `AVGO` | 7679 | 1521 | 0.741 | 0.797 | 0.797 | −0.057 | true |
| `^NSEI` | `JIOFIN.NS` | 6858 | 1386 | 0.573 | 0.628 | 0.628 | −0.055 | true |
| `^NSEI` | `HDFCBANK.NS` | 6857 | 1385 | 0.657 | 0.689 | 0.689 | −0.032 | false |
| `^NSEI` | `ICICIBANK.NS` | 6855 | 1383 | 0.631 | 0.661 | 0.661 | −0.030 | false |

Recorded `summary` strings: `"Delta r_1m-r_5m ranges -0.159..-0.030 (mean -0.066) across 6 pairs."`; `"Sanity check: resampling the 1m series to 5m reproduces the native 5m correlation within 0.000000..0.000000 (max abs gap)."`; `"All six pairs show r_1m < r_5m - the Epps effect…"`; `"Honest limitation: yfinance 1m history is capped at ~8 days per request, so only four 7-day chunks are stitched here…"`.

**Audit:** this file has **no lag key of any kind** — `r_1m` is `pearson(returns_1m[index], returns_1m[ticker])` in the generating `run.py:155`, an exact-timestamp inner join. It therefore **neither supports nor refutes** a 1-minute lead. What it does establish is the noise floor: 1m correlation is systematically lower (`delta` −0.030 to −0.159), and the recorded explanation is "asynchronous/non-synchronous quotes: the index and the single name do not print on the same minute, so 1m returns are stale-quote-contaminated". Any 1m lead statistic built on the same bars will inherit exactly that contamination. It also has **no `^NSEBANK` pair at all** — `PAIRS` in `run.py:23-30` lists only `^IXIC` and `^NSEI`.

### 3.3 `quiet_rank.json` — calmest-half 5m contemporaneous correlation → silent on lead/lag

Method recorded in `quiet_rank.json:method`: `"QUIET = bottom 50% of |index 5m return| (median threshold…)"`, `"quiet_robust requires r_quiet >= 0.35 AND n_quiet >= 1500"`.

`^NSEI` `primary_top`: `JIOFIN.NS` `r_all` 0.675 / `r_quiet` 0.243 / `n_quiet` 2145 / `quiet_robust` false; `HDFCBANK.NS` 0.633 / 0.312 / 2145 / false; `ICICIBANK.NS` 0.619 / 0.259 / 2145 / false. `_meta.q50_index_abs` = 0.000356, `aligned_rows` 4290, `quiet_rows` 2145, `first_index_return` `"2026-08-26 09:20 IST"`, `position_changes` 3, `membership_changes_symmetric_diff` 0. Recorded summary: `"All quiet r values fall in ~0.24-0.31, well below the 0.35 gate."`

`^NSEBANK` `primary_top`: `HDFCBANK.NS` 0.668 / 0.307 / 2145 / false; `ICICIBANK.NS` 0.662 / 0.280 / 2145 / false; `SBIN.NS` 0.656 / 0.280 / 2145 / false. `rank_changes` = 0, `_meta.membership_changes_symmetric_diff` = 0, `_meta.q50_index_abs` = 0.000437, `first_index_return` `"2026-08-26 09:20 IST"`.

**Audit:** this is a contemporaneous 5m ranking restricted to quiet minutes. It **neither supports nor refutes** a 1-minute lead — there is no lagged field. It does show that a large share of the measured co-movement lives in the bigger moves: quiet-minute r collapses to 0.243–0.312, with `quiet_robust = false` for every name in all four markets. For the 1m study this cuts both ways and must be tested, not assumed: if a lead is information-driven it may be *strongest* in quiet minutes, but the signal-to-noise there is evidently poor.

### 3.4 Report narrative audit (`scripts/market/build_corr_eda_report.py`)

- Lines 471–474 hardcode `"All 12 pairs peak at lag zero … There is no usable timing edge at 5-minute resolution."` This matches `lead_lag.json`, but the sentence is a **static string**, not computed from the JSON — if the JSON is regenerated with different values, the prose will silently lie.
- Lines 509–516 hardcode `"measured correlation is lower at 1 minute for every pair (the Epps effect …)"` and `"Resampling 1m back to 5m reproduces the 5m number exactly"`. Both match `one_minute.json`, but again as static strings. Neither claims a lead.
- Lines 699–700 state `"1-minute data is only available in 8-day chunks, so 5-minute bars were chosen for a usable sample"` — an explicit recorded reason why the primary study is 5m.
- `LEDGER.md:45` records `lead_lag` verdict `"all 12 pairs peak at lag 0; no usable lead/lag"`; `LEDGER.md:49` records `one_minute` as `"all 6 pairs r_1m < r_5m; delta -.030 to -.159"`; `LEDGER.md:55` records `quiet_rank` as `"all r_quiet .24-.31, NONE quiet-robust (gate .35)"`. All three are consistent with the JSONs. None upgrades to a lead claim.

---

## 4. Identification limits — why "leads" is not causal

1. **The index is computed from the same stocks.** `index_weights.json:weights_pct.nifty` gives `HDFCBANK.NS` 10.70%, `ICICIBANK.NS` 9.70%, `RELIANCE.NS` 7.71%, `JIOFIN.NS` 0.62%; `weights_pct.banknifty` gives `HDFCBANK.NS` 23.64%, `ICICIBANK.NS` 21.33%, `SBIN.NS` 19.55% — **64.52% of BankNifty is those three names alone**. A constituent's move *is* part of the index move. Apparent "lead" can be nothing more than the weight plus publication timing of the index calculation.
2. **Common news, near-simultaneous reaction.** Stock and index react to the same public information. If the more liquid name updates a few seconds earlier, a 1m bar close shows a lead with zero incremental information content.
3. **Stale quotes / non-synchronous prints.** Already measured in `one_minute.json`: r drops at 1m because "the index and the single name do not print on the same minute". A bin boundary can pair a stock's last print at `t:59` with an index snapshot at `t:30` — a same-minute comparison that is actually a 29-second lead.
4. **Bid-ask bounce.** Alternating bid/ask trades induce negative serial correlation in 1m returns, generating apparent ±1-lag cross-correlation that is microstructure, not information.
5. **Feed latency / cash vs derivatives.** `^NSEI`, `^NSEBANK` are cash indices from Yahoo consolidated prints; the stocks are cash too, but there is no evidence the two series are timestamp-synchronised to the same snapshot. A constant vendor delay of even 10–20 seconds produces a stable "1-minute lead". Any result must be reproduced with a second vendor whose timestamp semantics are documented.
6. **Auction contamination.** Cached bars include 15:15–15:30 closing-auction minutes (§1.2). Lead/lag inside an auction reflects order-matching rules, not information diffusion.
7. **Bar labeling is not observation time.** A "1m close" is the last trade in the bin; bin label ≠ event time. A tick-level or snapshot study is required to distinguish a true lead from a labeling artifact.
8. **Correlation ≠ tradability.** Even a statistically clean `ρ_partial = 0.05` has r² ≈ 0.0025. Costs, slippage, impact and the inability to trade the index at the following minute's open make that economically worthless without a net-of-cost backtest.

**Evidence needed before anyone may call it causal or tradable:** synchronized tick/1s snapshots for both legs from one exchange-grade source; a pre-registered endpoint with FDR correction and all five placebos from §2.5; ≥40–60 out-of-sample sessions; replication on a second vendor; and a positive net-of-cost result using `backtest/costs.py:calculate_trading_costs()` (the repo's single source of truth) with explicit capacity and slippage assumptions.

---

## 5. Acceptance gates — implementation run must pass all before the result is called meaningful

| # | Gate | Pass criterion | Cached status |
|---|---|---|---|
| G1 | Raw 1m data persisted | OHLCV for each leg written to disk with IST timestamps | **FAIL** — `run.py` writes only `one_minute.json`; no 1m pickle exists |
| G2 | BankNifty coverage | `^NSEBANK` + its constituents at 1m | **FAIL** — no `^NSEBANK` pair in `run.py:PAIRS` |
| G3 | Session pinning | All shifts within session; first return dropped; no cross-session pairs | PASS in method text, unverifiable without raw data |
| G4 | Timezone contract | All timestamps normalised to `config.IST`; offsets present | **FAIL** — `banknifty_intraday.json:window` has no `+05:30` |
| G5 | Valid-bar / stale filter | §1.4 rules applied, rejection counts in JSON | **FAIL** — no volume field, no stale counters |
| G6 | Auction handling | 09:15–09:16 and 15:15–15:30 excluded or reported separately | **FAIL** — cached 5m bars run to 15:25 |
| G7 | Pre-registered endpoint | One pair, k=1, stock→index, `ρ_partial` declared before scan | **FAIL** — no such endpoint exists |
| G8 | Sample size | ≥40 sessions, ≥15,000 aligned pairs, ≥200/session | **FAIL** — ~18–19 sessions of 1m |
| G9 | Contemporaneous control | `ρ_partial` significant and ≥0.03 after controlling `i_t`; gap to naive reported | **NOT COMPUTED** |
| G10 | Placebos | §2.5 all five pass; reverse-direction asymmetry confirmed | **FAIL** — only session-date shift exists, at 5m |
| G11 | Multiple comparisons | `V` declared; Holm/BH q=0.05; primary survives | **FAIL** — no lead-family correction |
| G12 | Per-session consistency | ≥60% sessions same sign, binomial p<0.05, median>0, ≥2/3 names | **FAIL** — cross-name gate only, at 5m |
| G13 | Out-of-sample + 2nd vendor | Sign/magnitude replicate on disjoint window and second feed | **FAIL** — single vendor, single window |
| G14 | Net-of-cost | Positive expectancy after `backtest/costs.py` costs + slippage, with capacity | **NOT COMPUTED** |
| G15 | Honest reporting | Every null/low-n reported as-is; variant count in JSON; no hardcoded prose | **PARTIAL** — JSONs honest, report prose hardcoded |

---

## 6. Sources actually available, coverage, and blockers

### 6.1 Cached datasets (all read-only; all bar size **5m** unless noted)

| File | Interval | Symbols | Coverage | Notes |
|---|---|---|---|---|
| `data.pkl` | 5m | 12: `^IXIC`, `NVDA`, `TSM`, `AVGO`, `^NSEI`, `JIOFIN.NS`, `HDFCBANK.NS`, `ICICIBANK.NS`, `^BSESN`, `RELIANCE.NS`, `^NSEBANK`, `SBIN.NS` | India 2026-08-26 09:15 → 2026-11-23 15:25 IST, 4,495 bars; US 2026-08-31 09:30 → 2026-11-23 15:55 ET, 4,661 bars | DataFrame per symbol; `^NSEI` index starts 09:15, 5-min spacing |
| `close_series.pkl` | 5m | 61 India symbols incl. `^NSEI`, `^NSEBANK`, `^BSESN`, `HDFCBANK.NS` (4,398), `ICICIBANK.NS` (4,386), `SBIN.NS` (4,396), `JIOFIN.NS` (4,402) | 2026-08-26 09:15 → 2026-11-23 15:25 IST | Series per symbol; uneven lengths → per-pair inner join required |
| `sensex_intraday_closes.pkl` | 5m | 31 incl. `^BSESN` (4,495) | 2026-08-26 → 2026-11-23 IST | Sensex lane only |
| `one_minute.json` | **1m summary ONLY** | `^IXIC`×3, `^NSEI`×3 — **no `^NSEBANK`** | 2026-10-27 → 2026-11-23 (four 7-day chunks) | Contains r/delta/n only; **no raw 1m series, no lag statistic** |
| `lead_lag.json` | 5m | 12 pairs across 4 indices, k = −3…+3 | ~60d window; India n ≈ 4,326–4,342 | Lagged CCF, all `best_lag = 0` |
| `quiet_rank.json` | 5m | same 12 pairs | ~60d window; `quiet_rows` ≈ 2,143–2,299 | Contemporaneous r on calmest half |
| `nifty_intraday.json` / `banknifty_intraday.json` | 5m | 40 / 16 usable stocks | 2026-08-26 → 2026-11-23 IST, 4,495 index bars | Contemporaneous ranking; `variants_tried` 200 / 10 |
| `index_weights.json` | static | Nifty 50 / Sensex 30 / BankNifty 14 / Nasdaq-100 proxy | Weights accessed 2026-11-24; BankNifty/Sensex as of 2026-11-23 | `^IXIC` weight proxy is Nasdaq-100, not the 3,000-name Composite — do not treat as exact |
| `LEDGER.md` | narrative | — | 2026-11-24 | Records all lane verdicts; no new numbers beyond the JSONs |

### 6.2 Blockers — plainly stated

1. **No raw 1-minute series is cached anywhere.** `run.py` fetched 1m in four chunks but never persisted the OHLC; only `one_minute.json` (summary statistics) was written. A 1m lead study cannot be run from cache.
2. **No 1-minute BankNifty data exists.** The question's `^NSEBANK` half is entirely unmeasured at 1m.
3. **No lagged 1-minute statistic exists.** `one_minute.json` computes only same-timestamp r; `lead_lag.json`'s lags are 5m bars.
4. **1m window is ~20 sessions (18–19 exactly in the cached run)**, below the ≥40-session floor for cluster-robust inference and per-session consistency. The "~20" used elsewhere is a rounded description of that same window, not a different dataset.
5. **No volume/stale-quote field** in the 1m work, so bars cannot be validated against §1.4.
6. **No second vendor** to test the timestamp-skew explanation in §4.5.
7. **No cost model applied** to any recorded correlation.

### 6.3 Minimum additional data to answer the question

- Raw 1m (preferably tick or 1-second snapshot) OHLCV with **exchange timestamps** for `^NSEI`, `^NSEBANK` (or constituent-level data from which the index can be reconstructed), and at minimum `HDFCBANK.NS`, `ICICIBANK.NS`, `SBIN.NS`, `JIOFIN.NS`, covering **≥40 sessions, ideally 60**, with continuous-session filtering per §1.2.
- One vendor for all legs (or documented cross-vendor timestamp alignment) to eliminate feed-latency artifacts.
- A second independent vendor on a subset for the replication gate G13.
- Transaction-cost inputs from `backtest/costs.py` for gate G14.

`yfinance` alone is a weak foundation here: `one_minute.json:summary[7]` records the ~8-day-per-request cap, and ~20 sessions is all the current window holds. An Upstox V3 historical 1m/tick pull (documented in `AGENTS.md` under market-data conventions) is the practical route to ≥40 sessions — market-data pulls use the Upstox API key/secret via `get_api_client()` (`market_data/market_data.py`), **not** `get_shared_broker_token('upstox')`, because market data is not broker-OAuth gated. That is an implementation decision, not a claim that the data already exists.

> **Scope note:** this document audits **cached artifacts only**. A live-fetch implementation now exists at `scripts/market/lead_lag_1m.py`, with its results in `reports/corr_lead_lag_1m/summary.md` (verdict **MIXED**, isolated NIFTY/JIOFIN PASS). Consult those files for current 1-minute evidence rather than the cached numbers above.

**Bottom line:** the recorded evidence shows *synchronous* 5m co-movement, a 1m *contemporaneous* correlation diluted by microstructure noise, and calm-minute correlations that fail their own 0.35 gate. It contains **no observation of a stock leading the index by one minute**. Any statement that it does would be an invention beyond `lead_lag.json`, `one_minute.json`, and `quiet_rank.json`.
