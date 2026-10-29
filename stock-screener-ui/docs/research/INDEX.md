# Research index — ICT/SMC strategy research (NQ, 2022–2026)

Start with the **handbook** (the reusable method), then dip into the raw detail.

## The handbook (reusable — read these first)
| doc | what it gives you |
|---|---|
| [`../strategy-research-method.md`](../strategy-research-method.md) | **the process**: the pipeline, the 10 gates, the 5 failure modes, the reuse checklist |
| [`../backtest-fill-honesty.md`](../backtest-fill-honesty.md) | ⭐ **the engine rules** — the same-bar-target + gap-stop traps that invalidated most results, with code |
| [`../agent-fleet-playbook.md`](../agent-fleet-playbook.md) | how to run 20+ research hypotheses in parallel without losing state |
| [`../ict-findings.md`](../ict-findings.md) | **the condensed result**: what survived, what didn't, and why |

## Raw detail (this folder — snapshots; live copies are under `reports/`)
| doc | what it is |
|---|---|
| [`CISD_LRLR_DEEPDIVE.md`](./CISD_LRLR_DEEPDIVE.md) | the full 13-section deep-dive of the CISD + LRLR model (every agent, every axis) |
| [`LRLR_METHOD.md`](./LRLR_METHOD.md) | the low-resistance-liquidity-run method, written out |
| [`STRATEGY_VERSIONS.md`](./STRATEGY_VERSIONS.md) | **the ledger** — one row per concept (A→CB), verdict + numbers |

## The code library
~330 archived agent scripts (one per concept, each with the honest engine) live at
**`reports/MNQ_ICT_SETUPS/agent_code/`** (gitignored — local; also see `INDEX.md` in that folder).
Highest-value files to read first:
- `agent_AW_honest_rescore.py` — the honest engine (all sleeves)
- `agent_AV_trail_audit.py` · `agent_AZ_fillorder.py` — the fill-honesty audits
- `agent_BF_catalog.py` — the per-instance catalogue builder
- `agent_BP_draw.py` — the corrected liquidity-draw model

## Where to go next
- **A different market:** [`../india_nify_plan.md`](../india_nify_plan.md) — the NIFTY port of this process.
- **The loop doctrine:** the `non-stop` skill (`~/.config/opencode/skills/non-stop/`).
