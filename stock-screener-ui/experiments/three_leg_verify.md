# Three-leg system — adversarial verification (screen + catalyst + regime)

**Verdict: NO-SHIP.** All three legs, alone and combined, lose money out-of-sample.
9 weeks, 494 symbols/week, every trade costed. L3 net **−₹19,355.50 on 12 trades
(avg −₹1,613/trade)**. Weekly mean −₹2,151, 95% CI entirely negative
[−₹4,222, −₹79]. There is no configuration in the tested neighborhood that is
profitable — only configurations that lose less by trading less.

Blunt summary: the screen flags late-stage names at the top (its own authors
measured false-positive next-week median ≈ −3%), the entry protocol buys the
breakout top at next open, and the 1×ATR stop is so wide that losers average
−1.6× the notional edge. Catalyst and regime legs reduce frequency, not
negative expectancy.

## 0. Provenance (read first)

- **No sibling three-leg files existed at verify time** (`three_leg_dataset.json`,
  backtest files: searched, absent). Legs were reconstructed from the published
  week-42 docs (`missed_breakouts_week42.md` §4 rules A/B/C; `catalysts_week42.md`;
  `pattern_profit_week42.md` protocol). All code is mine
  (`experiments/three_leg_verify.py`): raw pickle reads, own IST mapping, own
  EMA/ATR/OBV/box math, own simulator. Shared inputs only: universe membership,
  cost math (`backtest/costs.py`), sibling week-42 JSONs as compare targets.
- DB opened **read-only** (`mode=ro`); no network; no lookahead (setup < Monday,
  catalyst window < Monday, regime from prior Friday).
- Weeks tested: 9 completed (Mon 2026-08-10 … 2026-10-05). The 10th (Oct 12) is
  in the future. Split is first-5 vs last-4, disclosed, not hidden.

## 1. Recompute: 2 weeks, every L3 trade (up: Aug-10, down: Aug-24)

Up week 08-10 (regime +1.17, only positive-regime week): 7 L3 trades, net −₹5,450.
Down week 08-24 (regime −0.42): 2 L3 trades, net −₹6,064. Hand-recomputed all 9
from raw candles with separate throwaway code (`/tmp` scratch, correct cost
constants STT 0.00025 / stamp 0.00003):

| Trade | Entry → Exit | Why | Reported | Recomputed | Match |
|---|---|---|---|---|---|
| AARTIIND | 536.0×186 → 520.49 | SL | −2965.97 | −2966.37 | ✓ (<₹0.5) |
| BOSCHLTD | 45040.0×2 → 47030.56 | TP | +3901.05 | +3901.03 | ✓ |
| FLUOROCHEM | 4752.4×21 → 4737.8 | EOW | −388.89 | −388.89* | ✓ |
| HAL | 5019.5×19 → 4918.22 | SL | −2004.61 | −2004.61* | ✓ |
| MAZDOCK | 2575.0×38 → 2513.5 | SL | −2418.15 | −2418.02 | ✓ |
| PAYTM | 1593.5×62 → 1603.0 | EOW | +506.81 | +506.81* | ✓ |
| SOLARINDS | 20290.0×4 → 19788.74 | SL | −2080.28 | −2080.28* | ✓ |
| IIFL | 667.0×149 → 647.13 | SL | −3042.09 | −3042.01 | ✓ |
| WELCORP | 2394.1×41 → 2322.37 | SL | −3021.83 | −3021.88 | ✓ |

(*4/9 matched to the paisa after fixing my scratch's cost constants; 5/9 within
₹0.40 from buy/sell leg-rounding order. Price path, SL/TP, exit day, reason:
**9/9 exact**.) One real scratch-vs-module trap found and disclosed: my first
pass used delivery STT 0.001 and failed all 9 — the module uses intraday
0.00025. Mechanics verified; economics stand.

Week-42 L3 is regime-blocked (regime −3.55 < −1.0): 0 trades. The block works as
specified — it just blocks a week whose screened breakouts also lost
(L1 wk42: 6 trades, −₹13,869).

## 2. Mismatches vs sibling files (week 42)

Screen flags (sib 35 vs mine 39, overlap 29):
- **Sib-only (6):** ADANIGREEN, BAJAJHFL, CUB, DMART, EMCURE, SCHNEIDER.
- **Mine-only (10):** ABBOTINDIA, ASAHIINDIA, COALINDIA, DRREDDY, HDFCBANK,
  NTPCGREEN, PAGEIND, PHOENIXLTD, REDINGTON, RHIM.
- Root causes (each checked on raw data):
  1. My range-only box finder invents boxes the real detector rejects
     (HDFCBANK 51d/10.95%, COALINDIA 60d/9.75% — both loose drift windows) →
     over-fires rule A. Sibling detector is stricter and better here.
  2. My box blocks my rule C: DMART gets a 49d box at 7.5% dist (A fails on
     dist>6%), so C never evaluates — while the sibling (no box) correctly
     C-flags it. Box/no-box disagreement flips C eligibility: spec fragility.
  3. Knife-edge on 52w gap definition: CUB gap 8.18% (mine, 252-session max)
     vs 7.559% (sibling trigger level) — 0.6pp flips rule B.
- Event recall: mine 7/21 vs claimed 8/21. Of their 8 "caught", only 5 survive
  their own recommended 1.5× volume gate (AETHER, BHEL, GLAND, KOTAKBANK,
  LEMONTREE). **CUPID (1.04×) and TDPOWERSYS (1.0×) are rejected by the entry
  protocol** — including CUPID, the week's +17.8% MFE star. The screen's
  precision/recall is computed pre-entry-gate and overstates tradable edge.
- Phantom: my box creates a LGEINDIA Monday "breakout" the sibling method
  doesn't see. PETRONET: I flag it (rule A) but my box level erases the event
  the sibling sees via 20d-high. Box definition is the single biggest
  divergence source — use the real detector, not a range window.
- Damning trade-level fact: the 5 confirmed wk42 breakouts all lost under the
  entry protocol (AETHER −3,547; BHEL −2,832; GLAND −2,799; LEMONTREE −2,409;
  KOTAKBANK +145). GLAND had +10.3% MFE and still lost −₹2.8k: next-open entry
  buys the top, 1×ATR stop can't survive the shakeout.

## 3. Split test (the overfitting guard)

L3 = screen + catalyst≥1 + regime≥−1%:

| Half | Trades | Net | Avg/trade | Win% |
|---|---|---|---|---|
| First 5 (08-10 → 09-07) | 10 | −₹14,311.77 | −₹1,431 | 20% |
| Last 4 (09-14 → 10-05) | 2 | −₹5,043.73 | −₹2,522 | 0% |

Both halves negative. No week-42 overfit illusion to puncture — the system
doesn't work in-sample either. 9-week totals: L1 (screen only) 92 trades
−₹134,095 (avg −₹1,458); L2 (+catalyst) 14 trades −₹21,637 (avg −₹1,546);
L3 (+regime) 12 trades −₹19,356 (avg −₹1,613). **Each added leg cuts trade
count but leaves per-trade expectancy negative; catalyst even worsens it.**
4 of 9 weeks regime-blocked (09-07, 09-14, 09-28, wk42) — the regime leg's
only contribution is staying out.

## 4. Sensitivity (knife-edge or robust?)

| Config | Trades | Net | Δ vs base | Avg/trade |
|---|---|---|---|---|
| Base (floor 30d, cat≥1, reg≥−1%) | 12 | −₹19,356 | — | −₹1,613 |
| Floor 30→45d | 11 | −₹17,275 | +₹2,080 | −₹1,570 |
| Catalyst ≥1→≥2 | 3 | −₹2,904 | +₹16,452 | −₹968 |
| Regime −1%→0% | 7 | −₹5,450 | +₹13,905 | −₹779 |

Robustly unprofitable, not knife-edge: every notch still loses. The big
"improvements" are selectivity illusions — cat≥2 keeps 3 trades (news coverage
is thin: 34–123 mentioned symbols/week), reg≥0% keeps only the single
least-bad week. Per-trade expectancy stays negative everywhere (−₹779 best).
No threshold rescue available in this neighborhood.

## 5. Solutions report

Per-leg verdicts:
- **Screen (A/B/C): NO-SHIP standalone.** 92 trades, avg −₹1,458, win-rate
  7–42% by week. Confirms the sibling's own warning: flags late-stage names,
  median false-positive week ≈ −3%. My range-only replication over-flags vs
  the real detector — but the real detector's 35 flags produced the same
  losing trade mechanics.
- **Catalyst ≥1: NO-SHIP as edge.** Kills 85% of trades yet avg worsens
  (−₹1,458 → −₹1,546). Mention coverage is thin and biased to large-caps;
  dated-trigger logic (QIP/upgrade LEADs) needs filing timestamps, not
  headline counts.
- **Regime ≥−1%: NO-SHIP as profit driver.** Correctly blocks deep-down weeks
  but every traded week still lost. A stay-out rule is not a system.
- **Entry protocol (next-open, 1×ATR SL, 2R TP, EOW): NO-SHIP — this is the
  actual leak.** It converts +10% MFE breakouts into −₹3k losses.

Final recommended config: **none — do not ship; paper-only, ₹0 deployed.**
If a gun-to-head config is required: floor 45d + cat≥2 + reg≥0% (3 trades/9wk,
−₹2,904) — still negative, listed only to show no viable point exists.
Position sizing (for when a profitable variant exists): max concurrent L3
observed = 2 → cap 2 concurrent × ₹1L (≤₹2L deployed); single-trade risk must
be ≤1% (current 1×ATR daily SL risks ~3%: AARTIIND 15.51/536 = 2.9% — oversized
before any edge is proven).

What would invalidate this verdict: 4+ consecutive profitable OOS weeks with
avg/trade > +₹500 after costs, or a variant study (fit weeks 1–6, frozen,
holdout 7–9) with PF > 1.3.

**Single most promising fix: entry timing, not filters.** Replace next-open
market entry with a hold-confirmation — enter Day+1 open only if Day+1 opens
above the breakout close (skip gap-and-crap tops like GLAND/BHEL), or invert:
the screen's false positives skew −3%, so a fade-the-flag short leg deserves
its own study. Either needs a fresh fit/holdout split before any claim.
