# Reusable report visualisations — plan

## Goal

Copy the chart vocabulary from the 2026-11-17 NIFTY expiry book, the 2026-10-27
expiry book and the 2026-11-18 tape review into one **instrument-agnostic
library** so a future SENSEX / stock / futures report does not re-implement a
gamma flip, an OI surface or a flow stream.

This is deliberately **additive**. No existing generator, HTML report or data
file is edited. The old reports remain the visual reference and the acceptance
fixtures.

## Location and contract

```
scripts/market/report_viz/
  contracts.py        InstrumentSpec (currency, strike step, lot, units, session)
  theme.py            palette loaded from src/ui/palette.ts
  page.py             panel/page shell; JSON payload per panel
  assets/core.js      RV.register / format / tooltip / resize / Plotly base
  assets/core.css     dark report frame
  charts/*.py         Python panel builders (one per domain)
  assets/*.js         one browser renderer per chart family
  demo/               SENSEX + stock fixture page
  tests/              data-contract and rendered-panel tests
```

Every panel payload is `{spec, data}`. `spec` is the only place that knows
`NIFTY` vs `SENSEX` vs a stock: currency symbol, price decimals, strike step,
lot size, OI unit, value unit and session window. Charts must never hardcode
`25,000`, `50`, `₹`, `Cr`, `NIFTY` or a 09:15–15:30 axis.

The browser runtime dispatches `RV.charts[<name>]`; each chart family registers
its renderers in its own JS file. Python ownership is therefore disjoint.

## Inventory to port

### 1. Pin / spot / walls (`nifty_research_pin_gamma.py` + `07-research.html`)

| id | section | data |
|---|---|---|
| `spot_pin` | Spot vs max pain, walls, pin band | `t`, `spot`, `max_pain`, `call_wall`, `put_wall`, `pin_band` |
| `pin_score` | Pin score strip (100 = on max pain) | `t`, `pin_score`, `dist_pin`, band |
| `pin_null` | Observed \|spot − max pain\| vs random-walk p05/p95 | `t`, `obs`, `p05`, `p50`, `p95` |
| `wall_migration` | Wall strikes / max pain step lines | `t`, `spot`, `max_pain`, `call_wall`, `put_wall` |

### 2. Gamma / GEX (flagship)

| id | section | data |
|---|---|---|
| `gamma_flip_gex` | **Gamma flip vs spot, and the two GEX definitions** | `t`, `spot`, `flip`; `net_gex` all-strike; `regime_gex` gated-at-spot |
| `gex_profiles` | Dealer gamma profile at 3 clocks | `profiles[]` with `strikes`, `net_gex`, `cum_gex`, `spot`, `max_pain`, `flip` |
| `gex_surface` | Time × strike × net GEX (Plotly 3D) | `times`, `minutes`, `strikes`, `z` |
| `gex_by_strike` | GEX profile at snapshot(s) | `strikes`, `net_gex`, `spot`, `max_pain` |

### 3. Futures

| id | section | data |
|---|---|---|
| `futures_price_oi` | Futures close + open interest | `t`, `close`, `oi` |
| `futures_basis` | Futures minus spot | `t`, `basis`, `spot` |
| `futures_regimes` | 15-minute OI/price regime timeline | `t`, `regime` |
| `futures_volume` | 1-minute volume | `t`, `volume` |

### 4. Flow / volatility

| id | section | data |
|---|---|---|
| `flow_stream` | CE vs PE volume increments | `t`, `ce`, `pe`, optional `spot` |
| `flow_share` | ITM PE share of PE volume | `t`, `share`, `spot` |
| `flow_heatmap` | PE volume by strike × time | `labels`, `strikes`, `matrix` |
| `flow_top_itm` | Top ITM PE strikes | `strike`, `pe_itm`, `share` |
| `iv_smile` | IV smile / skew around spot | `strikes`, `ce_iv`, `pe_iv`, `spot` |
| `levels_distance` | Wall and max-pain distance from spot | `levels[]` with distance/value |

### 5. Tape / 3D / timeline + volatility extras

| id | section | data |
|---|---|---|
| `tape_spot_futures` | Spot + futures path | `t`, `spot`, `futures` |
| `tape_basis` | Basis path | `t`, `basis` |
| `tape_oi_pcr` | CE/PE OI + PCR | `t`, `ce_oi`, `pe_oi`, `pcr` |
| `tape_volume` | CE/PE volume by bucket | `labels`, `ce`, `pe` |
| `tape_walls` | Max pain + call/put walls | `t`, `spot`, `max_pain`, `call_wall`, `put_wall` |
| `tape_surface` | Time × strike × PE OI (Plotly 3D) | `x`, `xlabels`, `y`, `z` |
| `tape_strikes` | Top strikes by OI | `strike`, `ce_oi`, `pe_oi` |
| `tape_oi_change` | OI change by strike | `strike`, `ce_change`, `pe_change` |
| `tape_timeline` | Session leg/timeline ribbon | `label`, `start`, `duration`, `change` |
| `rv_iv` | IV vs realised vol | `t`, `iv`, `rv` |
| `straddle_1sigma` | Straddle 1σ vs realised move | `t`, `straddle`, `realised` |

## Five disjoint lanes

### Agent 1 — pin / spot / walls

Own: `charts/pin.py`, `assets/pin.js`, `tests/test_report_viz_pin.py`.
Port `spot_pin`, `pin_score`, `pin_null`, `wall_migration` from
`nifty_research_pin_gamma.py` (git commit `8fc9ea0d`) and the 11-17 fragments.
Use `spec.money`, `spec.points`, `spec.strike_step`; no NIFTY literals.

### Agent 2 — gamma / GEX

Own: `charts/gex.py`, `assets/gex.js`, `tests/test_report_viz_gex.py`.
Port `gamma_flip_gex` (the exact section the user named), `gex_profiles`,
`gex_surface`, `gex_by_strike` from `nifty_research_pin_gamma.py`,
`nifty_report_volatility.py` and `06-3d.html`. Keep both definitions explicit:
`net_gex` = all strikes, `regime_gex` = cumulative strikes ≤ spot; label them,
never silently substitute one.

### Agent 3 — futures

Own: `charts/futures.py`, `assets/futures.js`, `tests/test_report_viz_futures.py`.
Port `futures_price_oi`, `futures_basis`, `futures_regimes`, `futures_volume`
from `nifty_report_futures.py` / `03-futures.html`. `basis` must be expressed
in price points, not percent, and must carry `spot` for the reader.

### Agent 4 — flow / volatility

Own: `charts/flow.py`, `charts/volatility.py`, `assets/flow.js`,
`assets/volatility.js`, `tests/test_report_viz_flow_vol.py`.
Port flow stream/share/heatmap/top ITM from `nifty_report_flow.py` / `01-flow.html`
and IV smile/levels distance from `nifty_report_volatility.py` / `04-volatility.html`.
Preserve the “share of PE volume” label; it is not share of total volume.

### Agent 5 — tape / 3D / timeline / volatility extras

Own: `charts/tape.py`, `assets/tape.js`, `tests/test_report_viz_tape.py`.
Port the nine 2026-11-18 tape charts from `nifty_tape_report.py` plus
`rv_iv` / `straddle_1sigma` from `nifty_report_volatility.py`. The 3D surface
must accept nulls and forward-fill only where the source did; missing chain
minutes must stay blank, not zero.

## Non-goals (explicit)

- Do not edit `reports/**`, `scripts/market/nifty_*.py`, `api/**` or `src/**`.
- Do not regenerate or overwrite any existing report.
- Do not add a build step or a second palette.
- Do not claim a chart works because a Python test passes: the demo page must
  render at 1600 and 390 with zero console/page errors.
- Do not apply retention/compaction.

## Phase 2 — gaps found after the first 29

The first pass covered the pin/GEX/tape/flow/futures families, but not every
chart in the source books. In particular, **“CE vs PE net positioning”** is in
`reports/nifty_2026-10-27/research/participant_flow.html` (and the assembled
`07-research.html`), not in the 11-18 tape page.

### Lane 6 — positioning / participant flow

`charts/positioning.py`, `assets/positioning.js`

- `ce_pe_net_positioning` — net ΔOI per bucket, CE vs PE, spot line (the missing chart)
- `ce_pe_divergence` — CE vs PE at the same strike, signed bars
- `pe_oi_heatmap` — PE OI change by strike × time
- `positioning_window_bars` — 11:45–12:00 strike-by-strike ΔPE/ΔCE OI
- `volume_vs_net_oi` — incremental PE volume vs ΔPE OI, bubble = PE OI
- `participant_class_stream` — Σ|ΔOI| by class per bucket
- `participant_class_heatmap` — class × bucket state map
- `participant_focus` — 25,500 PE premium/OI focus
- `strike_terrain` — put minus call OI by strike
- `wall_ladder` — live wall distance from spot

### Lane 7 — replay / 3D

`charts/replay3d.py`, `assets/replay3d.js`

- `positioning_terrain_3d` — time × strike × PE/CE volume or OI change
- `iv_surface_3d` — time × strike × OTM IV
- `futures_path_3d` — time × OI × price
- `replay_heatmap` — 10s chain time × strike heatmap
- `replay_pe_focus` — 25,500 PE focus
- `top_volume_strikes` — highest-volume strikes
- `event_annotations` — event ribbon/annotations over the replay

### Lane 8 — vol decay / futures cross / anatomy

`charts/volcross.py`, `assets/volcross.js`

- `pe_premium_ribbon` — PE premium ribbon by strike over time
- `smile_four_clocks` — IV smile at four clocks
- `premium_vs_intrinsic` — premium vs intrinsic vs frozen-spot model
- `theta_decomposition` — premium decay attribution
- `skew_rotation` — CE/PE skew rotation
- `basis_3d` — time × basis × OI
- `basis_regime_strip` — basis path + regime strip
- `lead_lag` — naive vs clock-aligned lead/lag
- `nifty_vs_sensex` — normalized index comparison + spread
- `futures_quadrants` — price/OI quadrants
- `event_study` — ±30-minute event windows

## Delivered (2026-11-19)

- **57** builders across 8 chart families (29 phase 1 + 28 phase 2); **208**
  offline tests pass.
- Gallery: `scripts/market/report_viz/demo/index.html` (30 panels incl. the
  requested `ce_pe_net_positioning`), plus a 29-panel phase-2 fixture smoke page
  used for the 1600/390 visual gate.
- Visual gate: no overflow, no `RV.error` panels, 0 console/page errors. It
  caught a palette/frame collision in `pin.js`, a band-scale `MNaN` spot path
  in `positioning.js`, and a GEX tick-label collision.
- No existing report generator or report HTML was edited.

## Acceptance

1. Every chart is a pure `panel()` builder: no network, no DB, no file reads.
2. A SENSEX fixture with 100-point strikes and a stock fixture with 20-point
   strikes render with the same functions (units/labels change only).
3. `gamma_flip_gex` visibly labels both GEX definitions and uses the same
   y-scale for spot and flip.
4. Missing data is `None`/blank, never `0`; the 11-17 chain outage demo stays
   blank.
5. Demo page at 1600 and 390: no overflow, charts render, no console errors.
6. Targeted pytest only; check `/proc/loadavg` and `%Cpu(s)` idle ≥30% before
   any fan-out. No full suite.
