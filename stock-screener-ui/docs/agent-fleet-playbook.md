# Agent Fleet Playbook — running many research hypotheses in parallel

> How we ran ~30 research agents on one problem without (a) losing state, (b) duplicating work,
> or (c) fooling ourselves. Complements the `non-stop` skill (the long-running-loop doctrine).

---

## 1. When to use it
A large **search space** with independent work items — concept sweeps, hyper-parameter searches,
per-instrument validation, "try 20 variants and tell me which survives". Not for a single edit.

---

## 2. The shape
```
recon → ledger → dispatch WAVE (background agents, one hypothesis each)
      → harvest as each lands → fold into the ledger + one canonical artefact
      → seed the next wave from what was learned → repeat
      → FINAL WAVE: adversarial verification + TRUE HOLDOUT + fill-honesty audit
```

---

## 3. The wave contract (paste into every agent — it starts cold)
```
You are a <role> testing ONE hypothesis: <name>. Work ONLY under <sandbox>. NEVER run git.

ENVIRONMENT  <interpreter path, data paths, formats, timezones>
HARD RULES   <no look-ahead; honest fills (see backtest-fill-honesty.md); one position; cost>
GATE         positive in IS AND out-of-regime; (state the exact condition up front)
OUTPUT       script <path>; result <path>.json (fixed schema); ONE row appended to <ledger>
HONESTY      disclose the variant count; negative results are valuable; do not p-hack.
```
**Rules:** self-contained brief; **one hypothesis per agent**; a **fixed result schema**; **one
append-only ledger row**; the gate stated **before** the run.

---

## 4. Resource limits (learned the hard way)
- **Size the wave to the machine**: ~6–10 single-threaded agents on 4 vCPU; more just queue.
- **Don't run your own heavy jobs** while the fleet is full; **batch** artifact regenerations
  (each `matplotlib`/build spawns processes).
- **Don't poll.** Launch, attach a watcher, and let completion notify you.

---

## 5. Failure modes & recovery (all real, all hit)
| failure | symptom | recovery |
|---|---|---|
| **Premature subagent return** | the agent session "completes" but its result file is missing / its log is still growing | **the background process is often still alive** — check the process list + the log tail, collect the artifact when it lands, or re-dispatch. "Completed" ≠ "produced output". |
| **Orphaned duplicate process** | two copies writing the same cache/log → a race, truncated logs | kill the orphan **by PID** (⚠️ never `pkill -f <name>` if the name is in your own command — it kills your own shell) |
| **Log truncation** | a re-run's `> log` overwrites history | the ledger is the source of truth, not the logs |
| **Context blow-up** | your own window filling | write detail to disk; keep only the index in-context |
| **Correlated errors** | "10 agents agree!" | they share your brief and your engine — reproduction is **not** independence. Only an *adversarial* re-implementation counts. |

---

## 6. The verification wave (the highest-value wave — do not skip)
1. **Adversarial re-implementation** of the lead result from scratch (different code, same rules).
2. **Fill-honesty audit** of *every* surviving sleeve (`backtest-fill-honesty.md`).
3. **True holdout** on data never used in selection.
4. **Pyramid of falsification**: cost, slippage, fill realism, placebo, drop-best-month.

**In our run this wave invalidated the top result *and* a verifier's sign-off** — it is the single
most valuable step in the whole process.

---

## 7. State files (the loop's memory)
```
<workdir>/<LEDGER>.md          # append-only: id · concept · verdict · numbers
<workdir>/agent_<ID>_result.json   # one per agent, fixed schema
<canonical artefact>           # one deliverable (HTML report / ranked table)
<archive>/ + INDEX.md          # the code, permanently
```
Give each wave a theme so the ledger reads as a story. **Archive the agent code** (ours:
`reports/MNQ_ICT_SETUPS/agent_code/`, 330 files) — the scripts *are* the reusable method library.

---

## 8. Cost control
Default fleet agents to a cheap model (`opencode-go/muse-spark-1.3-contributor`); escalate a
**single** agent only for correctness-critical work (adversarial verification / the final audit) and
say why. **The gate, not the model, is what protects you.**
