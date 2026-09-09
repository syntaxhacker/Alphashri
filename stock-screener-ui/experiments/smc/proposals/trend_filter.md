# HTF (15m) Trend-vs-Sideways Filter — Implementable Spec

## 0. Purpose & scope

The 1m engine (`trading/smc_ifvg.py`) trades chop as eagerly as trends: its
`bos_dir` latch fires on any 1m close beyond the last fractal pivot, with no
regime notion. This filter adds a **higher-timeframe gate**: 1m entries are
allowed only when the 15m regime is trending **and** aligned with the signal
direction.

- **Status:** design / proposal. No engine, API, src, or DB code touched.
- **Inputs:** 15m OHLC bars aggregated from the engine's 1m bars (bid-based).
- **Output:** one state per 15m bar — `bull | bear | sideways`.
- **Constraint:** strictly history-only. State of bar `i` uses bars `[0..i]`
  only (closes, confirmed pivots, trailing statistics). No lookahead.
- **Concept budget (strict):** HH/HL vs LH/LL swing sequences, BOS/CHoCH on
  15m closes, range expansion vs compression. Nothing else (no EMA, no RSI,
  no ADX, no time-of-day).

## 1. Timeframe construction

1. Build 1m bars exactly as `scripts/smc_tick_eval.py:build_1m_bars` (bid ticks).
2. Aggregate into 15m bars on **wall-clock boundaries**: bucket key
   `(t1m // 900) * 900`; `open` = first 1m open, `high/low` = extremes,
   `close` = last 1m close. (A 09:30 ET session-open bar therefore starts at a
   :00/:15/:30/:45 boundary like every other bar — no session anchoring, no
   special cases.)
3. Partial buckets (session edges, feed gaps) are kept as-is; a 15m bar with
   `< 15` 1m bars still closes normally. Rationale: the filter must never stall
   waiting for a "complete" bar.

## 2. Per-bar algorithm (history-only)

State carried across bars: `piv_hi, piv_lo` (confirmed fractal pivots),
per-side broken flags, `bias ∈ {+1, −1, 0}`, `bias_bar`, `brk_level`
(level of the bias-setting break), `exp_at_break`.

For each closed 15m bar `i` with OHLC `b`:

**Step 1 — fractal pivots (engine-identical semantics, on 15m).**
If `i >= 4`, let `j = i − 2`, `w = bars[j−2 .. j+2]`; if `w[2].high` is strictly
the highest of the five, append `(j, w[2].high)` to `piv_hi` and reset the
high broken flag (same for lows). Pivot at `j` is therefore confirmed with a
**2-bar (30 min) lag** — accepted as the cost of engine consistency
(a 5-bar swing variant was system-negative in the 1m engine: +425 vs +875).

**Step 2 — BOS / CHoCH on 15m closes (latching bias, engine order).**
If `piv_hi` non-empty, unbroken, and `b.close > piv_hi[-1].price` →
`bias = +1, bias_bar = i, brk_level = piv_hi[-1].price`, mark broken.
Mirror for lows → `bias = −1`. A break against the prevailing bias is the
CHoCH and flips `bias`/`brk_level`. Same-side re-breaks refresh `bias_bar`
(the 09:30 UTC 09-02 re-break pattern). Bias persists until flipped —
there is intentionally **no staleness cap**; exits are structural (Step 5).

**Step 3 — expansion vs compression.**
`rng_i = high − low`. Baseline `M_i` = median of `rng` over the prior 14 bars
(`bars[i−14 .. i−1]`, excludes current bar). `expand_i = rng_i ≥ 1.25 · M_i`.
ATR `A_i` = simple mean of `rng` over `bars[i−13 .. i]` (includes the closed
current bar; still history-only).

**Step 4 — swing-sequence diagnostics.**
`HL = (last two confirmed swing lows ascend)`, `LH = (last two confirmed
swing highs descend)` (+ `HH`/`LL` tracked symmetrically). Used as an
*alternative* continuation condition (Step 6), never as a hard gate —
validated: requiring two-sided HH&HL agreement lags V-reversals by ~2h
(09-02: sequence confirmed bear only at 10:45 UTC, hours after the 08:45
break; it blocked the entire 11:07–12:05 bull grind).

**Step 5 — failure exit (loss of displacement).**
`failed = (bias==+1 and close < brk_level) or (bias==−1 and close > brk_level)`.
A 15m close back through the broken level voids the leg → `sideways`.

**Step 6 — state.**
Let `age = i − bias_bar`, `disp = ±(close − brk_level)` signed in bias
direction. If `i < WARMUP or bias == 0 or failed or A_i undefined` →
`sideways`. Else:
- **Impulse** (`age ≤ 2`): trending iff `exp_at_break or expand_i`.
  A fresh BOS with range expansion *is* the SMC impulse definition; the swing
  sequence cannot have re-formed yet, so it is not required here.
- **Extension** (`age ≥ 3`): trending iff `disp ≥ 0.25 · A_i`
  (displacement holds — the market defends the break) **or** the one-sided
  progression agrees (`HL` for bull, `LH` for bear).
- Direction follows `bias`.

## 3. Thresholds & justification

| Parameter | Value | Justification |
|---|---|---|
| 15m bar / fractal (2 bars each side, strict) | 15m, 3-bar | Engine-identical (`smc_ifvg.py:on_close`); 5-bar swing tested system-negative |
| ATR length | 14 bars (3.5h) | Standard ATR(14) ported to 15m; SMA (not Wilder) for exact reproducibility |
| Expansion baseline | median of prior 14 ranges (excl. current) | Median resists single-impulse contamination; excluding current bar keeps it predictive, not descriptive |
| `EXP_MULT` | **1.25** | Measured: impulse bars 1.8–2.5× baseline (08:45: 2.1×, 11:00: 2.5×, 14:15: 1.8×); chop hovers ~1.0×. 1.50 was tested and kills the genuine 14:15 (+59) impulse; 1.25 keeps all three with margin |
| `DISP_MULT` | **0.25 × ATR** | Hold threshold ≈ 10 pts at ATR 40 — above 1m microstructure noise (median 1m range 8–16) but below leg scale. 0.50 tested: nearly identical shares, slightly cleaner late-chop; kept as the documented stricter variant |
| Impulse window | `age ≤ 2` bars (30 min) | Break bar + one confirmation bar; matches the engine's own 2-bar pending-fill horizon |
| Warmup `WARMUP` | **14 bars (3.5h)** | = ATR/expansion baseline depth; fractal stream is live from bar 5. Pre-warmup bars → `sideways` (conservative: gate blocks entries) |
| No staleness cap | ∞ (structural exits only) | Opposite BOS/CHoCH or `failed` close-through ends trends; a cap (8 bars tested) cut genuine grind continuations without improving chop rejection |

## 4. Warmup requirements (implementation checklist)

- First 14 closed 15m bars of a session: always `sideways`. (~3.5h after the
  04:00 UTC session start; both 09-02 legs occur after warmup.)
- Do **not** carry pivots/bias across sessions (Globex-style day boundary);
  reset all carried state per session, exactly like the 1m engine's fresh run.
- ATR/median windows that would reach before bar 0 are undefined → `sideways`
  (already covered by `WARMUP`).

## 5. Mapping 1m entries to HTF states

- Each 1m bar maps to the latest **closed** 15m bar: greatest `k` with
  `T15[k] + 900 ≤ T1m`. The forming 15m bar is never consulted (no lookahead).
- Gate rule: 1m **LONG** allowed iff HTF state == `bull`; 1m **SHORT** iff
  `bear`; blocked when `sideways`. `(entries="both"` engine signals are
  filtered; no direction flipping — a counter-trend 1m signal is skipped,
  never reversed.)
- Inherent latency: regime birth is knowable only at the breaking 15m bar's
  close → up to ~15 min before 1m bars see the new state (measured: first
  ~8 min of the 11:07 grind still map to the pre-break bar).
- Suggested integration: evaluate the gate at the 1m signal bar's close
  (same bar the engine arms on), using the mapped HTF state. Log blocked
  signals with their HTF state for later attribution (trend-blocked vs
  sideways-blocked).

## 6. Descriptive validation (frozen params, six sessions)

Prototype: `/tmp/htf_v3.py` (`EXP_MULT=1.25, DISP_MULT=0.25`,
`ATR_LEN=WARMUP=14`). Sessions: Dukascopy `usatechidxusd` day-slices.
 Times below in UTC (quoted IST legs − 5:30).

**Share of 1m bars per HTF state (mapped, latest-closed rule):**

| Session | bear | bull | sideways | 15m trend-run behaviour |
|---|---|---|---|---|
| 2026-07-02 | 22% | 36% | 41% | bull 8 runs avg 4.0 bars; bear 2 runs avg 9.5 |
| 2026-07-10 | 4% | 46% | 51% | bull 4 runs avg 6.8 bars (~100 min) |
| 2026-07-22 | 41% | 18% | 41% | bear 2 runs avg 18 bars (session downtrend) |
| 2026-07-24 | 19% | 2% | **79%** | choppiest session; gate blocks most |
| 2026-08-26 | 20% | 22% | 58% | balanced, 11 trend runs avg ~3.3 bars |
| 2026-09-02 | 5% | 42% | 54% | bull 6 runs avg 4.5; bear 1 run × 3 bars |

**Known legs (2026-09-02, IST → UTC):**
- 14:21–14:24 IST = **08:51–08:54 UTC bear cascade** (−65 in 4 min):
  **0/4 1m bars trending (`sideways`)**. Reason: the mapped 08:30 bar shows
  bias −1 but displacement only +2 < 0.25·ATR(41) — at the 08:45 close no 15m
  evidence distinguished drift from impulse. The 15m confirms bear at the
  08:45 close (known 09:00), and the **continuation 09:00–09:30 UTC classifies
  31/31 bear**. Honest scope limit: a 4-minute cascade cannot be pre-confirmed
  by 15m structure; the filter catches the leg's continuation, not its first
  seconds. (Forcing it with `DISP_MULT=0` was tested — it passes on a 2-pt
  margin, i.e. luck, while leaking chop elsewhere. Rejected.)
- 16:37–17:35 IST = **11:07–12:05 UTC bull grind** (+175 over ~58 min):
  **51/59 1m bars `bull`**. The 8 misses are the first minutes mapping to the
  pre-break 10:45 bar (close-lag, §5). Impulse (11:00 BOS+1, 2.5× expansion)
  → extension via displacement (23→126 pts vs ATR ~44).

**Chop controls (2026-09-02):**
- Overnight drift 04:00–06:00 UTC: **121/121 `sideways`** ✓
- Late drift 18:30–20:00 UTC (+54 slow grind): 60/91 `bull` — borderline by
  design: displacement genuinely holds above the 14:15 break level. Documented
  limitation, not a failure; `DISP_MULT=0.50` trims only the weakest of these.
  The 1m engine's own signal quality remains the second line of defence here.

## 7. Known limitations & non-goals

1. Micro-cascades (< one 15m bar, no prior regime) pass through as `sideways`
   until the containing 15m bar closes — see leg-1 result. A 5m HTF would halve
   this blind window but triple structure noise; left as future work.
2. Slow grinds far from the break level stay trending indefinitely (no cap) —
   intended; exits come from `failed` closes or CHoCH.
3. One-sided sequence (`HL`/`LH`) is a fallback, not a gate: 15m fractal
   sequences whipsaw inside grinds (09-02 afternoon shows `HL==LH==1`
   simultaneously during pullback fractals).
4. This spec is **descriptive-only**: no entry backtest with the gate applied,
   no threshold optimisation beyond the ±1 sensitivity grid above. The next
   step is a gated replay measuring blocked-trade P&L attribution per §5.
