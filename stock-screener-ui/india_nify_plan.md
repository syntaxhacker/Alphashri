# india_nify_plan.md — run the "muse fleet" research process on Indian markets (NIFTY)

> **What this is:** a cold-start handoff. A previous session ran a multi-day,
> ~45-concept research fleet on **MNQ/NQ (US Nasdaq futures)**. This document is
> the complete recipe — the process, the agent briefs, the gates, and (most
> importantly) the **lessons that invalidated most of the results** — so a **new
> session with a fresh agent can run the same process on Indian markets**
> (NIFTY 50 / Bank NIFTY / FINNIFTY / liquid F&O stocks) and get an *honest*
> answer.
>
> **Read §1 before doing anything.** It is the difference between finding an edge
> and finding a backtest artifact.

---

## 0. TL;DR of the method

```
recon → ledger → dispatch a WAVE of background subagents (one concept each, strict contract)
      → harvest as each lands → fold into the ledger + one canonical artifact
      → seed the next wave from what was learned → repeat
      → FINAL WAVE = adversarial verification + TRUE HOLDOUT + FILL-HONESTY AUDIT
```
Always run it as a **loop** (`non-stop` skill), never one agent at a time.

---

## 1. THE LESSONS THAT MATTER (read first — this cost a whole session to learn)

1. **Fill honesty is the #1 killer of intraday backtests.** A resting-**limit**
   entry that fills on a bar which *also* touches the target will credit the
   target on the fill bar. That is **unverifiable** (the bar may have touched the
   target *before* the fill). Enforce, always:
   - **No profit exit may trigger on the entry-fill bar** (the stop may).
   - **A trailing/gap-through stop fills at the bar's OPEN**, not the stop level.
   - **A limit whose bar opened beyond the level fills at the OPEN** (or is unfillable).
   - **Report, per config, the share of same-bar targets and gap-through stops.**
   In the NQ run this flipped an entire "validated" family from **+0.4R to
   negative** — 23–41% of exits were same-bar targets and supplied the whole edge.
   **Prefer MARKET entries** (enter at the signal bar's close / the next bar's
   open): they cannot produce this artifact.

2. **Multi-context gate.** A result only "works" if net avgR > 0 in the
   in-sample set **AND** an out-of-regime set. One-period winners are noise.

3. **True holdout.** Split the data so a period is **never used in selection**,
   then test on it at the very end. (In the NQ run, the "OOS" set was also used in
   the selection gate, so only a separately held-out 6-month block was clean.)

4. **Placebo.** Same-frequency, matched-risk **random entries** must be ~0, else
   the "signal" is an artifact.

5. **Causal attribution, not post-hoc.** Apply filters at decision time and
   re-simulate. Post-hoc subsetting overstates (~2× when signals compete for one slot).

6. **The SMC/ICT labels are cosmetic.** Sweeps, SMT, equal-highs, order blocks,
   FVG-vs-iFVG, AMD, kill zones, time-of-day, MSS/BOS — repeatedly **inert** as
   filters. What *looked* like the edge (entry "depth", displacement) turned out
   to be the fill artifact. Do not assume any of it; test it.

7. **Honest costs, swept to break-even.** Short-stop sleeves are cost-fragile
   (a 9pt stop means 1pt ≈ 0.11R). Report break-even cost.

8. **Disclose the variant count.** A lone survivor of 2,000 configs is a
   multiple-testing suspicion until it survives a fresh adversarial re-implementation.

9. **Adversarial verification catches what the author misses.** Re-implement
   from scratch; sweep cost/fills; test the true holdout. Twice in the NQ run the
   "best result" (and even a *verifier's* sign-off) was overturned by a stricter pass.

---

## 2. The process, step by step

### 2.0 Set up (before any agent)
- A **sandbox dir** for the fleet (e.g. `/tmp/opencode_in/`) holding: data
  pickles, per-agent scripts, per-agent result JSONs, and the **ledger**.
- A **ledger** file (`MUSE_LOG_IN.md`) — append-only, one row per concept:
  `| id | concept | verdict | ~600-char summary WITH the numbers |`.
- A **canonical deliverable** (e.g. `reports/IN_STRATEGIES/SHOWCASE.html`) that
  every finisher folds into.
- An **archive** dir (persistent, gitignored is fine) + an auto-generated
  `INDEX.md`, so the code is never lost with `/tmp`.

### 2.1 Recon (mandatory)
List what already exists so nobody re-runs finished work; freeze the "already
tried" index; state the objective + the hard gate; publish the topic list.

### 2.2 Waves
Dispatch **6–10 background agents** at a time (one concept each), each with the
**contract in §3**. Keep the pipeline ~⅔ full: when a wave drains, seed the next
from the findings. While agents run, *you* fold results in and update the ledger
(never idle).

### 2.3 The verification wave (do NOT skip)
The last wave is always:
- **Adversarial red-team** of the lead result (fresh re-implementation, cost/fill
  realism, placebo, stationarity folds).
- **True holdout** on never-seen data.
- **Fill-honesty audit** across *every* surviving sleeve (same-bar targets,
  gap-through stops, over-credit in R).

### 2.4 Drain
On STOP (or completion): stop dispatching, collect in-flight artifacts, rebuild
the deliverable once, write the honest ranked table + the "what failed and why".

---

## 3. The agent contract (paste into every subagent — see `non-stop` skill)

```text
You are a quant research agent testing ONE concept on <INSTRUMENT>. Work ONLY
under <SANDBOX>. NEVER run git. Do not modify other agents' files.

ENVIRONMENT
- python: <repo>.venv/bin/python
- data: <paths + format + date ranges + timezone>
- session: NSE 09:15-15:30 IST (convert carefully; use config.IST)

HARD RULES (non-negotiable)
1. FILL HONESTY: no profit exit on the entry-fill bar; gap-through stops fill at
   the bar OPEN; limit-through-open fills at the OPEN; stop checked before target.
   Report the same-bar-target share and the gap-through-stop share. Prefer MARKET entries.
2. NO LOOK-AHEAD. One position. Realistic Indian F&O costs (use backtest/costs.py).
3. BOTH-REGIME GATE: works only if net avgR > 0 in IS AND OOS (and >=0 on the holdout).
4. PLACEBO: same-frequency, matched-risk random entries must be ~0.
5. CAUSAL ATTRIBUTION: toggle each component at decision time; report marginal Δ.
6. HONEST COSTS: sweep cost to find break-even.
7. PROP/ACCOUNT EVAL: <define the account model + risk>.

OUTPUT
- script: <sandbox>/agent_<ID>_<slug>.py
- result: <sandbox>/agent_<ID>_result.json  (fixed schema)
- append ONE row to <ledger>
Be brutally honest. Disclose the variant count. Negative results are valuable.
```

**Fixed result schema:**
`{ concept, verdict, best_config, IS{...}, OOS{...}, HOLDOUT{...}, attribution, prop, wins_where, loses_where, notes }`

---

## 4. Indian-market specifics (adapt the NQ setup)

### 4.1 Instruments & universe
- **Index futures:** NIFTY 50 (`NIFTY`), Bank NIFTY (`BANKNIFTY`), FINNIFTY, MIDCPNIFTY.
- **Liquid F&O stocks:** top-N by turnover (e.g. RELIANCE, HDFCBANK, ICICIBANK, INFY, TCS…).
- Start with **NIFTY futures** (deepest, cleanest) as the primary; Bank NIFTY as the volatile sibling.

### 4.2 Session & structure (NSE)
- Continuous trading **09:15–15:30 IST**; pre-open 09:00–09:15; close auction rules.
- **Opening range** 09:15–09:30 (or 09:15–10:00) is the analogue of the US ORB.
- Note the **mid-session lull** (~11:30–13:30) and the **expiry-day** (weekly/monthly) mechanics.
- Use `config.IST` everywhere; never `datetime.now()` without tz.

### 4.3 Data acquisition
- **Primary (already in this repo):** Upstox V3 —
  `market_data...fetch_intraday_data_v3` (today) / `fetch_historical_data_v3` (past),
  resolving instrument keys via the `instruments` table. See `api/paper/` + `scripts/test_upstox_data.py`.
- **Fallbacks:** `yfinance` (`^NSEI`, `^NSEBANK`, `<TICKER>.NS`), broker APIs, or
  Dukascopy if it carries the index CFD.
- **Required:** 1m (or 3m/5m) OHLCV for **IS**, a separate **OOS**, and a **TRUE HOLDOUT** block.
  Example split: IS 2025–2026, OOS 2022–2024, HOLDOUT one untouched 6-month block.

### 4.4 Costs (DO NOT hardcode)
- Use **`backtest/costs.py:calculate_trading_costs()`** — the repo's single source
  of truth for Indian F&O costs (brokerage + STT + exchange + GST + stamp + SEBI).
  Everything else in the fleet must use it too.

### 4.5 Contract / account model
- NIFTY lot size & point value (₹) from the repo's instruments/config.
- Define the eval model explicitly (e.g. a personal account: target, max DD,
  daily stop) — the Indian analogue of the prop-firm eval. State it in every brief.

---

## 5. The wave plan (concrete)

| wave | purpose | example agents (one concept each) |
|---|---|---|
| **W0** | engine + data + baselines | build the honest engine; **ORB market-entry**, **day-open bias**, **VWAP market-entry** |
| **W1** | concept exploration | sweep-reclaim (PDH/PDL/session), breakout-at-close, momentum-continuation, failed-breakout, gap play, equal-highs/lows, SMC labels (FVG/OB/iFVG) — **as MARKET entries** |
| **W2** | improvement | take the honest survivors; tune TF/session/target/direction; test long-only; cross-instrument (NIFTY vs BANKNIFTY) |
| **W3** | combinations | confluence grid (causal), portfolio of survivors |
| **W4** | **verification** | adversarial re-implement of the lead; **true holdout**; **fill-honesty audit of EVERY sleeve** |

Start ~8 agents/wave (a 4-vCPU box handles ~6–10 single-threaded agents).

---

## 6. Deliverables the fleet must produce
1. `MUSE_LOG_IN.md` — the ledger (one row per concept).
2. `<sandbox>/agent_*_result.json` — one per agent (fixed schema).
3. `reports/IN_STRATEGIES/SHOWCASE.html` — ranked honest table + winner/loser
   cards + a "failed" table + an **honesty banner**.
4. `reports/IN_STRATEGIES/agent_code/` — the archived scripts + `INDEX.md` (never delete).
5. A short final report: what works (honestly), what doesn't, the single best
   recommendation, and remaining risks.

---

## 7. Model routing (cost control)
- Default **every** fleet subagent to the cheap **Muse** model:
  **`opencode-go/muse-spark-1.3-contributor`** ("Muse Spark 1.3 Contributor", ~$0.10/M).
  For literally-$0: `opencode-go/beam-free` or `opencode-go/longcat-2.5-preview-free`.
- **Note:** `opencode/muse-spark-1.3-contributor-free` appears in the model list but is
  **not selectable** for subagents — use the `opencode-go/…contributor` id above.
- Escalate a **single** agent to a stronger model only for correctness-critical
  verification (the fill-honesty audit / true holdout), and say so.
- Cheap models are weaker on long numeric reasoning → **the gate, not the model,
  is what protects you.**

---

## 8. Kickoff prompt for the new session (copy-paste)

```text
Read india_nify_plan.md in full, then the `non-stop` skill. Run the muse-fleet
research process on Indian markets, starting with NIFTY 50 futures.

Phase 0: set up the sandbox /tmp/opencode_in, the ledger MUSE_LOG_IN.md, and fetch
NIFTY 1m data (Upstox V3 via the repo, or yfinance ^NSEI) for IS 2025-2026,
OOS 2022-2024, and a TRUE HOLDOUT block.

Phase 1: build the HONEST backtest engine FIRST (fill-honesty rules from §1: no
profit exit on the entry-fill bar, gap-through stops fill at the OPEN, report the
same-bar-target and gap-through shares). Then dispatch a wave of ~6-8 background
subagents (free model), one MARKET-ENTRY concept each, with the contract in §3.

Loop: harvest each result into the ledger + a showcase HTML, seed the next wave,
and finish with an adversarial verification wave + a true holdout + a fill-honesty
audit of every surviving sleeve.

Never stop until I say STOP. Default subagents to opencode/muse-spark-1.3-contributor-free.
```

---

## 9. Reference (the NQ run this is derived from)
- Archived agent code (≈45 concepts, scripts + results): `reports/MNQ_ICT_SETUPS/agent_code/` (+ `INDEX.md`, `README.md`).
- Ledger: `MUSE_LOG.md`. Ranked summary + lessons: `reports/MNQ_ICT_SETUPS/STRATEGY_VERSIONS.md`.
- Showcase (with the honesty banner): `reports/MNQ_ICT_SETUPS/v3/STRATEGY_SHOWCASE.html`.
- The loop skill: `~/.config/opencode/skills/non-stop/SKILL.md`.
- **Reusable takeaway:** the *market-entry* sleeves (a reclaim-close / confirmation
  entry, no resting limit) were the only ones that survived an honest fill model —
  design the Indian fleet around those first.
