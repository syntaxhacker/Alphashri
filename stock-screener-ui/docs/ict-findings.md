# ICT / SMC Findings — what survived an honest audit on NQ (2022–2026)

> The condensed result of ~50 concepts, 42,209 catalogue instances, and ~30 agents.
> Raw detail: `CISD_LRLR_DEEPDIVE.md` · the ledger `STRATEGY_VERSIONS.md` · code in
> `reports/MNQ_ICT_SETUPS/agent_code/`. **Data caveat: a Dukascopy vendor feed (approximate levels,
> bid-side), not raw CME.**

---

## 1. Headline
**No mechanical ICT/SMC strategy we tested cleared every gate.** The only sleeves positive after
honest fills were **market-entry** shapes, and all were **~6–9× too slow** for a fast prop eval.
**The model is a good *reading lens*, not a *system*.**

---

## 2. What survived (market-entry only)
| sleeve | edge (IS / OOS / holdout) | notes |
|---|---|---|
| **G** — PDH/PDL sweep, reclaim-close entry, TP 3R | +0.38 / +0.32 / +0.28 | ~0.2 trades/day; the direction filter (daily bias + kill-zone) is what carries it |
| **AY** — momentum continuation (15m, next-open entry) | +0.17 / +0.16 / **+0.44** | the best *honest* edge; still slow |
| **M** — HTF FVG, confirmation-bar entry, TP 3R | +0.47 / +0.25 / +0.15 | thin |

**Why market entry:** a known fill price makes the same-bar-target artifact **impossible**
(`backtest-fill-honesty.md`). Every resting-limit variant failed the audit.

---

## 3. What did NOT survive (and why)
| family | verdict | the reason |
|---|---|---|
| **FVG / iFVG / OB limit-retrace** (J, K, X, AK, L, M-limit, O) | ❌ **artifact** | 23–41% same-bar targets; honest fills → negative |
| **Trailing-exit variants** (v3, AK) | ❌ / degraded | gap-through stops over-credited 0.2–1.2R/trade |
| **Liquidity sweeps as a *filter*** (P, Q, S, AC) | ❌ inert/harmful | −0.06…−0.09R; removing them *raises* the edge |
| **EQH/EQL clusters** | ❌ failed | "equal" clustering adds **nothing** over a plain swing |
| **SMT divergence (NQ/ES)** | ❌ failed | the *inverse* and a *shuffled* ES scored the same |
| **AMD / Power-of-3, CRT, MSS/BOS/CHoCH** | ❌ failed | the narratives are decoration; 0/2880 variants reached t≥1.5 both regimes |
| **Silver Bullet (literal)** | ❌ failed | IS −0.18R; the published model |
| **iFVG / CISD reversal families** | ❌ failed | same fill artifact; the *true* LRLR (measured 3 ways) is inert |
| **Big-displacement ("run size")** | ❌ confound | in **points** it looked monotone; **flat once ATR-normalised** → it was volatility |

---

## 4. The five recurring lessons
1. **The setup is 100% consistent; the outcome is ~57% predictable.** Every trade had LRLR→sweep→CISD;
   but two identical setups still split ~40/60. The defining event (a few points of dip) happens
   **after** the entry.
2. **ICT *confluence* is decoration on top of the entry.** Sweeps, kill-zones, equal highs, SMT,
   reference candles, daily bias — all inert or harmful as filters. *Fewer filters, not more.*
3. **The reference must be a MAJOR pool** (session/PDH-PDL/overnight/major swing), never a
   1–3 bar micro-fractal — the micro-swing reference let a 1.5-pt poke masquerade as a "sweep".
4. **Direction = the liquidity draw** (sellside taken + buyside intact → long). Real as a *lens*;
   it does not produce a mechanical edge.
5. **The best cell of the entire search** was the **NY open (09:00–10:00) on 15m** (+0.10/+0.15/+0.18R,
   *positive in all 3 regimes*) — found independently by 4 agents — **but t≈1.6 where the multiple-testing
   bar is 3.9, it fails the plateau test, and only ~95% of random-selection draws lose to it = chance.**

---

## 5. The probability budget (why it fails)
- **Win ~40–45%**; **wins average ~1.3R**; **losses are full −1R** (often worse via gap fills).
- **Only ~26% of trades ever reach +2R** before the stop; **50–60% are full stops.**
- A 1R target needs a **50%** win rate (52–55% with cost) — the model achieves **~51%** at best, not stably.
- **Therefore:** `0.41×1.3 − 0.59×1.0 ≈ −0.06R` per trade. That arithmetic *is* the verdict.

---

## 6. Where the value actually is
1. **A negative result you can trust** — plus the tooling that produced it.
2. **The reading lens**: major pools + the draw + the open, used *discretionarily*, measurably
   selects better trades (beats a matched placebo, **p<0.001**; AUC ≈ 0.57). That is *exactly* the
   information a good trader uses and a fixed rule cannot.
3. **The library**: ~330 archived agent scripts — one per concept, each with an honest engine.

## 7. The honest next step
Not more backtesting (we are at the noise floor; more slicing only manufactures false positives) —
a **forward paper test** of the one cell with support (**the NY open on 15m**) with a human skipping
the obvious losers, tracked over 30–50 samples.
