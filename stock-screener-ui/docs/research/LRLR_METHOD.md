# LRLR — the method (how to find it PROPERLY)

> **LRLR = Low-Resistance Liquidity Run.** It is *not* a pattern you see after the fact — it is the
> **direction of the draw** plus **the target pool**, both computable **before** the entry.
> This is the corrected definition (the prior tests used micro-swings as "liquidity" and were therefore wrong).

---

## 1. Build the POOL SET — **major liquidity only** (this is where the old model failed)
Each entry is a level, **anchored to the first touch** (never drifts), from:

| pool | definition |
|---|---|
| **PDH / PDL** | the prior RTH session (09:30–16:00 ET) high / low |
| **ONH / ONL** | the **overnight / pre-market** high / low (18:00 ET prior day → 09:30 ET) |
| **ASIA H/L** | 20:00–02:00 ET (the accumulation range) |
| **SESSION H/L** | the **running** RTH high / low so far |
| **EQH / EQL** | ≥2 confirmed swings within `tol·ATR` (tol 0.1–0.3), anchored to the **first** swing |
| **MAJOR SWINGS** | confirmed fractal swings with **lookback L ≥ 10 bars** AND **≥ k·ATR from price** (k = 0.25–1.0) |
| **(opt) PWH / PWL** | the prior week's high / low |

**Reject anything that is a micro-swing** (a 1–2 bar fractal, or closer than `0.25·ATR`).
> *Oct-13 example:* the 09:30 bar poked the 09:26 high by **1.5 pts** → **not a pool** → rejected.
> The overnight high (30,550.5) WAS a pool and was **untouched**.

## 2. State of every pool, per bar (strictly causal)
- **UNTOUCHED** — price has not traded beyond it.
- **SWEPT** — price traded beyond it **and closed back inside** within N bars (a wick-through + reclaim). *The stops above/below it have been taken.*
- **BROKEN** — a **close** beyond it (acceptance). The pool is consumed; **the draw shifts to the next pool**.

Track the nearest **untouched pool above** (the BSL draw) and **below** (the SSL draw) at all times.

## 3. THE DRAW RULE — **the direction comes from the draw, not from the last candle**
| state | direction | target |
|---|---|---|
| a **SELLSIDE pool was just swept** + the **nearest BUYSIDE pool is untouched** | **LONG ONLY** | that buyside pool |
| a **BUYSIDE pool was just swept** + the **nearest SELLSIDE pool is untouched** | **SHORT ONLY** | that sellside pool |
| both sides exhausted · the swept level was **not a pool** · the opposing draw is **too close** (`< ~2R`) | **NO TRADE** | — |

> *Oct-13:* the overnight low (SSL) was taken and the overnight high (BSL, 30,550.5) was intact →
> **LONG only** → the 09:34 long (+2.61R). The micro-poke short is **rejected by §1**.

## 4. ENTRY (the timing) — enter *after* the draw is set
1. The pool is **swept** and price **closes back inside**.
2. Wait for the **CISD** — a close beyond the last opposing delivery run (see `agent_BE_cisd_fixed.py`).
3. **Enter MARKET at the next bar's open.** *(Optional confirmation: reclaim the sweep bar's high/low.)*
4. **Stop** — beyond the swept extreme (+ buffer).
5. **Target** — the **untouched opposing pool** (the LRLR target).

## 5. Quantify the LRLR (the "low resistance" test — measured **before** the entry)
| feature | meaning |
|---|---|
| **distance** | to the target pool, in **ATR** and in **R** |
| **draw ratio** | `dist(target) / dist(opposing pool)` — you want the target **nearer** than the invalidation |
| **resistance count** | confirmed swings / pools **between** the entry and the target |
| **barriers** | does the path cross the **day open / VWAP / prior close / an EQ level**? |
| **cleanliness** | the fraction of recent bars closing in the draw direction; ATR-normalised opposing momentum |

**Filters:** require **≥ 2R to the target** and a **resistance count ≤ R_max**.

## 6. INVALIDATION
- Stop beyond the swept extreme.
- If price takes the **opposing** pool first (the draw flips) → exit / stand aside.
- If price **accepts** beyond the swept extreme (a *close* beyond it) → the "sweep" was a real break → **cancel** (no trade).

---

## The one-sentence method
> **Find the major pool that was swept; find the major pool still untouched on the other side; trade ONLY toward the untouched one; enter on the CISD; stop beyond the sweep; target the untouched pool — and measure the path before you enter.**

## Why the old model failed (for the record)
It treated **micro-swings as liquidity**, so it "found a sweep" on 1–2 points of noise and **took both
directions of the same move**. Agent evidence: BH found the *reference quality* inert **using that same
micro-swing reference**, and BK found the *HTF alignment* real but weak. The corrected pool definition
(§1) plus the draw rule (§3) are the untested pieces — see `agent_BP_draw.py`.
