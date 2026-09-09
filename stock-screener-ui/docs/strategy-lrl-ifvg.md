# LRL + Highest-Timeframe iFVG — Long/Short into Low-Resistance Liquidity

## Status

- **Stage:** prototype v1 (research script, not production strategy)
- **Date:** 2026-09-07
- **Prototype:** `scripts/lrl_ifvg_check.py`
- **Market:** NQ proxy — Dukascopy `usatechidxusd` ticks → 30s/1m/2m/3m bars
- **Verdict so far:** mechanics work end-to-end (tick-accurate, SL-first fills), but **no edge yet with loose LRL** — prime window is ~coin-flip on 6 days (9/18), all-day is overtrading (345 signals). The edge, if real, lives in the discretionary filter: only the *cleanest* stack, first leg, 9:30–10:00am EST.

## TL;DR

1. **Find Low-Resistance Liquidity (LRL)** — 3–4 stacked highs or lows a clean trendline can connect. Those are stacked stop-losses. That line is the **target**.
2. **Find the highest-timeframe iFVG swept in the leg** — if 30s + 1m + 2m all inverted, only the 2m matters. If 1m + 2m + 3m, only the 3m.
3. **Trade into LRL** — LRL below → SHORT before it gets swept. LRL above → LONG before it gets swept.
4. **TP fixed 1R, SL beyond the swing high/low.** Risk $500 → target $500.
5. **Only the open matters** — 99% of A+ setups print 9:30–10:00am EST (19:00–19:30 IST). After 10am they can work but are B-grade.

## 1. How it works (exact rules from the trader)

> "Low Resistance Liquidity: if there are a bunch of stacked highs or lows where you can CLEANLY draw a trend line, this is Low Resistance Liquidity. I aim for at least 3–4 lows or highs stacked. All that it is is stacked stop losses that the market is likely to come back to."

- **LRL below us → look for shorts** into it (before the lows get hit/swept).
- **LRL above us → look for longs** into it (before the highs get hit/swept).
- **iFVG:** an FVG whose opposite edge closes through — a failed auction flipping polarity. (If unfamiliar, watch any "Inverse FVG" video; the code definition below is the tradable version.)
- **Highest-TF rule:** 30s vs 1m → watch 1m. 1m vs 2m vs 3m → watch 3m. Always the heaviest timeframe that swept.
- **Timing:** first 15–30 min after the 9:30am EST open carries ~95% of the best setups.
- **Risk:** SL ideally above/below a swing high/low. TP 1R.

Worked example (matches the 8 screenshots in `~/Documents/*.webp`):
`HQkqUn_W8AAnBaN.webp` shows a 2m iFVG long off the lows into an LRLR slope, then a 1m iFVG short off the top into lows below. `HQp4zHfWIAAAEQx.webp` shows "perfect equal highs" (the LRL) raided, then the long into it. `HRD4jxnW0AA6UZ-.webp` labels the short entry zone literally `30sec IFVG`.

## 2. Why it works (the market logic)

1. **Stops are liquidity.** A triple-top or a clean rising trendline of higher-lows is visible to every algo and retail trader. Longs cluster stops just under it, shorts cluster stops just above equal highs. A "clean trendline" = a dense, resting stop pool with little traded volume *through* it — hence "low resistance": once price reaches it, stops market-execute and fuel the next leg with minimal absorption.
2. **Price is drawn to pools before expanding.** Dealing desks need counterparties to fill large orders. Sweeping the stacked pool (the LRL raid) provides them, then price expands the other way. Trading *into* LRL means positioning on the same side as the desk's target, not chasing after the sweep.
3. **An iFVG is the footprint of that intent.** A bullish FVG that closes back *below* its bottom (bearish inversion) means buyers failed to defend the premium — supply took control. A bearish FVG closing back *above* its top means sellers failed. The inversion, not the original gap, is the signal: failed auction → reversal leg toward the opposing pool.
4. **Higher timeframe dominates.** A 3m inversion contains six 30s auctions. Its stop pool, range, and participant set are larger, so its polarity flip overrules any smaller-TF gap inside it. Taking only the highest swept iFVG filters out lower-TF noise that gets run over.
5. **The open is when pools are deepest.** 9:30–10:00am EST is peak volume, peak stop density (overnight highs/lows + premarket extremes + opening drive stops), and peak urgency. Sweeps travel furthest and follow-through is cleanest. After 10am, pools are chewed up and legs chop.
6. **1R + swing SL is expectancy math, not prediction.** Swing beyond the iFVG/structure is where the thesis is *proven wrong* (close back through = no inversion). Capping winners at 1R accepts a ~50% win rate as breakeven-ish and lets session selection (only A+ open prints) carry expectancy, instead of hoping for runners that revert.

## 3. What we coded (prototype v1)

`scripts/lrl_ifvg_check.py` — history-only, tick-accurate, SL-checked-before-TP (same conservatism as `trading/smc_ifvg.py`).

| Rule | Implementation |
|---|---|
| Bars | Ticks → 30s / 1m / 2m / 3m bid bars (`build_bars`). Base clock 1m. |
| FVG | 3-bar gap: bull `low[i] > high[i-2]`, bear `high[i] < low[i-2]`, per-TF gap floor (30s 1.0 / 1m 2.0 / 2m 3.0 / 3m 4.0 pts). |
| iFVG | Prior FVG inverted by **close** beyond opposite edge (wick alone never counts). First inversion per FVG only. Mirrors `src/utils/smc.ts:81` (`detectIFVG`) and `trading/smc_ifvg.py:180-196`. |
| LRL | Recent 2-2 strict-fractal pivots (last 120 1m bars, pool = last 6). Best subset of 3–4 collinear within `0.60 × ATR(14)`, target unswept (`±2 pts`), within `5.0 × ATR`. Returns side (`above`/`below`), touches, trendline target. Relaxed on purpose for v1 — see §6. |
| Direction | LRL `below` → SHORT only. LRL `above` → LONG only. |
| Highest TF | Most recent inversion agreeing with direction wins, 3m first. Lookbacks in 1m bars: 30s ≤5, 1m ≤5, 2m ≤8, 3m ≤12. |
| Entry | Next minute's first tick (SHORT at bid, LONG at ask). Min risk 5 pts. |
| SL | Nearest 5-bar swing in last 10 bars, `±6.0` buffer (same as engine `sl_buf`). Fallback: signal-bar high/low. |
| TP | Fixed **1R** (`entry ± risk`). No structure TP, no trail — deliberate deviation from engine's `RR≥3` (`trading/smc_ifvg.py:245`). |
| Exits | Tick loop SL-first, then TP. Give-up after 90 min (`TIME`, ~never hit). |
| Sessions | `prime` = entry `19:00–19:30 IST` (= 9:30–10:00am EST). `all` = no filter. |

Relation to the existing UI engine:

- `src/utils/smc.ts:39` (`detectFVG`) / `:81` (`detectIFVG`) — same close-inversion semantics, single-TF, no LRL.
- `trading/smc_ifvg.py` (`SMCIFVGEngine`) — BOS-gated inv + retest stacks, TP = nearest untouched structure with `min_rr 3.0` else trail. Profitable on validation (+875 pts, 6 sessions) but a *different* trade: RR≥3 runners, session `14:10–19:00 IST` (ends at the US open), no LRL, no multi-TF pick.
- `src/pages/poc/SmcTrades.tsx` — visualizes that engine, not this prototype.
- `backtest/strategies/smc.py` — older BOS/sweep/DB/OB scalper, unrelated to iFVG.

## 4. Data

- Source: Dukascopy `usatechidxusd` (NQ proxy) ticks, disk cache `experiments/data/duka_cache/` — **123 sessions, ~3.8 GB**, no re-download needed.
- Loader: `scripts/smc_tick_eval.py:30` (`fetch_ticks`, cache-first) + `build_1m_bars`.
- Validated dates used here (the 6 pre-existing engine dates): `2026-07-02, 2026-07-10, 2026-07-22, 2026-07-24, 2026-08-26, 2026-09-02`.
- Note: `2026-09-04/-07/-08/-09` caches are empty (`[]`, 2 bytes — weekend/holiday, 0 bars). `2026-09-03` is partial (119k ticks, 473 bars).

## 5. Results

Commands:

```bash
.venv/bin/python scripts/lrl_ifvg_check.py --date 2026-09-02 --window prime
.venv/bin/python scripts/lrl_ifvg_check.py --matrix --window prime --dates "2026-07-02,2026-07-10,2026-07-22,2026-07-24,2026-08-26,2026-09-02"
.venv/bin/python scripts/lrl_ifvg_check.py --matrix --window all   --dates "2026-07-02,2026-07-10,2026-07-22,2026-07-24,2026-08-26,2026-09-02"
```

### Prime window (19:00–19:30 IST) — 18 trades, 9/18 win, net +76.8 pts

| Date | Trades | Detail (IST side via-TF → result P&L) | Net |
|---|---|---|---|
| 07-02 | 1 (1/1) | 19:04 LONG 1m → TP +135.9 | +135.9 |
| 07-10 | 5 (4/5) | 19:08 SHORT 2m TP +49.2 · 19:12 LONG 1m TP +74.2 · 19:24 LONG 3m SL −9.1 · 19:26 LONG 3m TP +19.0 · 19:29 LONG 3m TP +27.4 | +160.7 |
| 07-22 | 2 (0/2) | 19:06 SHORT 30s SL −33.2 · 19:17 SHORT 1m SL −50.6 | −83.8 |
| 07-24 | 5 (2/5) | 19:02 LONG 2m SL −68.3 · 19:18 SHORT 3m SL −43.8 · 19:20 SHORT 2m TP +82.6 · 19:26 LONG 30s TP +21.3 · 19:29 LONG 30s SL −18.2 | −26.4 |
| 08-26 | 3 (1/3) | 19:05 SHORT 1m SL −68.7 · 19:16 SHORT 30s SL −36.9 · 19:26 SHORT 2m TP +13.6 | −92.0 |
| 09-02 | 2 (1/2) | 19:09 LONG 3m SL −57.7 · 19:26 LONG 1m TP +40.1 | −17.6 |
| **Total** | **18 (9/18 = 50%)** | TP 9 · SL 9 · avg **+4.27 pts/trade** | **+76.8** |

TP = +1R / SL = −1R by construction, so 50% win ≈ breakeven before costs; the +76.8 comes from point-size variance (large-range days win bigger), not from win-rate edge. n=18 is far too small for conclusions.

### All-day (no session filter) — 345 trades, 180/345 win, net +94.5 pts

| Date | Trades | Net implication |
|---|---|---|
| 07-02 | 77 | overtrading |
| 07-10 | 31 | — |
| 07-22 | 63 | — |
| 07-24 | 53 | — |
| 08-26 | 65 | — |
| 09-02 | 56 | — |
| **Total** | **345 (52%) · avg +0.27/trade** | **+94.5** |

~57 signals/day proves the v1 LRL is far too loose: with best-3-of-6 at 0.6×ATR, almost any drift produces a "trendline". The trader's actual filter ("I can CLEANLY draw it" + first leg + open only) is doing nearly all the work — the code doesn't have it yet.

### Debug trail (how v1 got here)

- First pass (strict: all-6 must fit at 0.30×ATR, 5-bar inversion window, gap 2.0 all TFs): **0 trades** on 09-02 prime *and* all-day. FVGs fired (148 @ gap>2 on 975 1m bars) but LRL hit only 2/98 sampled bars — LRL was the bottleneck (ATR 8–14 → tolerance ~3 pts for 6 pivots is perfection, not trading).
- v1 relax (best subset 3–4 of 6, 0.60×ATR, 5.0 ATR reach, per-TF gaps + per-TF lookbacks): 09-02 all-day went 0 → 56 trades; prime 0 → 2. That confirms the dial exists but is now turned too far toward recall over precision.

## 6. Limitations (honest)

1. LRL is geometric, not visual — no slope sanity vs. trend, no "virgin target" history check, no displacement-into-iFVG requirement, no stacked-stop density proxy (equal-highs tolerance).
2. No BOS / market-structure gate (engine has it, prototype doesn't) — counter-trend inversions into dead LRLs trade.
3. No spread/cost model — NQ spread + commissions on 1R scalps will eat a large share of +0.27–4.27 pts/trade averages.
4. 6 days only, hand-picked engine dates — selection bias; need the full 123-session run + walk-forward.
5. Single 1R exit — screenshots suggest partials/runners exist in discretion; untested.

## 7. Next steps (tightening in order)

1. **Virgin-target + displacement:** LRL line untouched since formation; iFVG leg must displace (e.g. `|close−close[3]| ≥ 0.5×ATR`) into the sweep.
2. **Cleanliness score:** rank candidates by residual/ATR + horizontality + touch spacing; take top-1 per side, require ≥4 touches for prime.
3. **3m-priority + BOS:** require 3m (or 2m) inversion AND 1m BOS agreement; drop lone-30s entries in prime.
4. **De-dupe / cap:** max 2 fills/day, 5-min same-side dedupe (engine already supports `shared` fills).
5. **Full-cache run:** all 123 sessions, prime only, report PF/expectancy with 2-pt spread + $4 commission haircut.
6. **Promote if PF ≥1.3 over ≥100 prime trades:** port `detectLRL` to `src/utils/smc.ts`, add LRL overlay (gold trendline like `NT_IFVG_STROKE #FFD700`), new `entries="lrl-ifvg"` mode in `trading/smc_ifvg.py`, and a `SmcLrlTrades` POC page next to `SmcTrades.tsx`.

## Appendix — screenshot map (~/Documents/*.webp, 2026-09-07)

- `HQK5a2OW8AAM7y9.webp` — full-session MNQU6 30s context (Bal $51,431.5 / RP&L $603.5), the 09:40–09:53 sell leg this strategy shorts.
- `HRKkhCbWEAAfLC8.webp` — "LOW RESISTANCE LIQUIDITY" teaching chart (stacked-top short staircase).
- `HQq91DIXkAAeB2G.webp` — `Data High` + `LRL` long prototype (risk box entry).
- `HQkqUn_W8AAnBaN.webp` — `2m iFVG` long then `1m iFVG` short, dual LRL slopes — the highest-TF rule illustrated.
- `HQm_RCYW4AEziLK.webp`, `HQp4zHfWIAAAEQx.webp` ("perfect equal highs"), `HRD4jxnW0AA6UZ-.webp` (`30sec IFVG`, `LRLR`), `HRS6KcwW4AAuy54.webp` — single-setup crops of each entry archetype.
- `is-this-true-v0-bs1ety83ahlh1.webp` — unrelated Groww/SEBI F&O FY26 infographic (retail −₹72K Cr) — motivation, not setup.
