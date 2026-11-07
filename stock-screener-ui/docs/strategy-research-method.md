# Strategy Research Method — how we find, validate, and tune a trading edge

> **Purpose.** This is the reusable playbook distilled from the NQ/MNQ ICT research project
> (~30 agents, 42,209 catalogue instances). It exists so a future session — on NQ, on NIFTY, on
> anything — can run the *right* process and avoid the five failure modes that produced every
> false positive we found.
>
> **Read this first, then [`backtest-fill-honesty.md`](./backtest-fill-honesty.md) before writing any simulator.**
> Related: [`agent-fleet-playbook.md`](./agent-fleet-playbook.md) · [`ict-findings.md`](./ict-findings.md) ·
> [`../india_nify_plan.md`](../india_nify_plan.md) (the NIFTY port) · `STRATEGY_VERSIONS.md` (the live ledger).

---

## 0. The one-paragraph summary
**Most trading "edges" are measurement artifacts.** An honest research process is therefore not
"find a strategy" — it is **"try to falsify every candidate, and only then believe the survivor."**
The process below is ordered so that the cheapest, most-likely-to-kill tests run **first**.

---

## 1. The pipeline (run in this order — cheapest kill first)

```
0. DATA + ENGINE     build the honest engine BEFORE any strategy work
1. RECON             what exists; freeze the "already tried" index
2. HYPOTHESIS        one mechanical rule set per agent, falsifiable, stated in advance
3. SINGLE EXAMPLE    does the detector even fire on a hand-checked canonical setup?
4. BOTH-REGIME GATE  positive in IS *and* out-of-regime?
5. PLACEBO           beat a matched-frequency random entry?
6. ATTRIBUTION       which component carries the edge (toggle one at a time, causally)
7. COST / FILL       survive realistic cost, slippage, and honest fills?
8. TRUE HOLDOUT      positive on data never used in any selection?
9. WALK-FORWARD      select on roll-forward windows → test the next block
10. TAIL / ROBUST    drop-best-month, drop-biggest-trade, ±param perturbations
11. MULTIPLE TESTING state the cell count; apply a Bonferroni-style bar
12. CATALOGUE        for the survivor: list EVERY historical instance + its outcome
13. CONCESSION       if it fails, write down *why* (the ledger row) — negative results are the product
```

**Rule of thumb:** a candidate that fails at step 4–7 costs minutes. A candidate that is only
tested at steps 8–12 costs days and can still be an artifact. **Fail early.**

---

## 2. The gates (non-negotiable — each one killed a real false positive for us)

| gate | what it catches | how |
|---|---|---|
| **Fill honesty** | the #1 killer. Limit entries that fill on a bar which *also* touches the target; trailing stops filled at the stop level when the bar *gapped through* | see `backtest-fill-honesty.md`; report the **same-bar-target share** |
| **Both-regime** | one-era wonders | positive in the in-sample **and** an out-of-regime period |
| **Placebo** | engine/time artifacts | matched-frequency, matched-risk random entries ≈ 0 |
| **Causal attribution** | decoration mistaken for edge | toggle one component at a time, re-simulate; post-hoc subsetting overstates ~2× |
| **True holdout** | selection leakage | a block of data never used in *any* fitting/choosing |
| **Walk-forward** | the honest test | train/select on window N → test on N+1; the aggregate is the only number that counts |
| **Tail check** | one lucky trade | median R, the top-decile share of profit, drop-best-month |
| **Multiple testing** | data dredging | state the cell count; a lone survivor of 500 cells with t≈1.5 is noise |
| **Honest cost** | unrealistic friction | sweep cost; report the break-even; tiny stops are cost-fragile |
| **MFE/MAE** | why it loses | only 26% of our trades ever reached 2R; 50-60% were full −1R stops |

---

## 3. The five failure modes we hit (and their signatures)

1. **The same-bar-target artifact** — a limit fills *and* the target is touched on the same bar; the engine credits the target (assumes fill-then-target). *23–41% of exits in our "winners" were this; honest fills flipped them from +0.44R to **negative**.*
   → **never credit a profit exit on the entry-fill bar**; prefer **market entries**.
2. **The gap-through trailing stop** — a trailing stop filled *at the stop level* when the bar opened beyond it. *72–74% of one strategy's trail exits were over-credited ~1R each.*
   → **a stop fills at the bar OPEN when the bar gaps through it**.
3. **The specificity trap / hindsight bias** — the chart you're shown worked; the *population* it belongs to lost. *One beautiful setup: 9,222 mechanically-similar instances averaged −0.065R with 54% full stops.*
   → **always catalogue the population** (step 12); never judge from one example.
4. **Multiple testing** — slice 40,000 trades enough ways and something always looks positive. *Our best pocket beat only ~95% of random-selection draws — exactly chance.*
   → **state the cell count and require a Bonferroni-style bar**; require a **plateau**, not a spike.
5. **The volatility confound** — a "big move" measured in *points* selects a volatile era, not a mechanic. *Our "big displacement" edge was flat once normalised by ATR.*
   → **always test the scale-free (ATR-normalised) version**.

---

## 4. Engine conventions that produced honest numbers
- Signals are computed **from bars up to and including the signal bar's close**; fills only on **later** bars.
- If the fill bar **opened beyond the limit**, fill at the **OPEN** (not the limit).
- **Stop before target** within a bar (conservative).
- One position (per direction); realistic cost per instrument; state the **bid/ask side** of the data.
- A **session/day boundary** must be explicit (e.g. flat at the RTH close).
- Every result reported as: **n, trades/day, win%, NET avgR, PF, t** — per regime, plus the holdout.
- **A prop/$-evaluation is a separate model** (target, trailing DD, daily stop) — a positive avgR does not imply a pass.

---

## 5. What "works" looked like (the honest survivors)
Across ~50 ICT/SMC concepts on NQ, the only sleeves that stayed positive after *all* gates were
**market-entry** shapes (no resting limit): a PDH/PDL sweep with a reclaim-close entry, an HTF-FVG
confirmation entry, and a momentum-continuation entry. All were **real but too slow** (~0.09 R/day vs
the ~0.5 needed for a fast eval). See `ict-findings.md`.
**Nothing in the limit-retrace / FVG-retrace family survived the fill-honesty audit.**

---

## 6. Reuse checklist (copy for a new market)
- [ ] Build the honest engine **first** (`backtest-fill-honesty.md`), with a `sbt` counter.
- [ ] Freeze the data splits: IS / an out-of-regime set / a **true holdout** block never touched.
- [ ] Verify the engine on **one hand-checked canonical trade** before any grid.
- [ ] Run the fleet (`agent-fleet-playbook.md`) with the wave contract; one hypothesis per agent.
- [ ] Keep an append-only **ledger** (`STRATEGY_VERSIONS.md` style): id · concept · verdict · numbers.
- [ ] Catalogue every instance of anything that survives; then walk-forward it.
- [ ] Write the negative results down — they are the most valuable output.
