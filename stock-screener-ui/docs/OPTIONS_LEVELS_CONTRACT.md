# Options chain strike levels — implementation contract

Companion to [OPTIONS_ANALYTICS_PLAN.md](./OPTIONS_ANALYTICS_PLAN.md). Status:
**implemented (2026-11-16)** — see "Implemented status" below.

## Implemented status (2026-11-16)

- DTO/state patch, chain badges (wide chip + 390px `M/C/P/S/R` letter), summary
  line and E2E coverage are **done**; the shared max-pain/GEX module has
  anti-drift tests against the report wrapper.
- **PAIN is authoritative on the `levels` block:** `summary.max_pain` is sourced
  from `levels.max_pain.strike` (`0` for compatibility); the frontend reads the
  DTO and never recomputes it.
- **No stale gate by design:** levels are a pure function of the returned chain
  frame — no second staleness check inside `build_levels`. Freshness is carried
  by the chain's `quotes_live:false` / STALE badge.

## Decision

- **Extend `GET /api/options/chain` with a top-level `levels` object.** No new
  endpoint: levels are a pure function of the chain frame the table already
  shows, the chain cache key already includes expiry/session, and the dock must
  not add a third request (open = 2 requests is a tested invariant).
- **One pure module `api/options_levels.py`** owns max pain, GEX and walls. The
  report and the chain route both import it; the four existing max-pain
  implementations become wrappers. No formula duplication.
- **Frontend** reads `maxPain` from the DTO instead of recomputing it; wall sets
  are built once per table render, never per row.

## Response shape (snake_case, additive)

```jsonc
"levels": {
  "spot": 22962.6,
  "step": 50.0,            // inferred modal/median strike gap (2.5 / 5 / 50)
  "thin": false,

  "call_wall": { "strike": 23100, "side": "above", "strength": 0.18, "oi": 13599300 },
  "put_wall":  { "strike": 22800, "side": "below", "strength": 0.14, "oi": 9821500 },
  "call_walls": [ /* top-3 near-band */ ],
  "put_walls":  [ /* top-3 near-band */ ],

  "max_pain": { "strike": 22900, "side": "below", "strength": 0.31, "payout": 1234567 },

  "gex": {
    "support":    { "strike": 22900, "side": "below", "strength": 0.37, "net_gex": 0.57 },
    "resistance": { "strike": 23200, "side": "above", "strength": 1.0,  "net_gex": 2.30 },
    "fuel_down":  { "strike": 22500, "side": "below", "strength": 0.74, "net_gex": -4.59 },
    "fuel_up":    { "strike": 23000, "side": "above", "strength": 0.45, "net_gex": -0.69 },
    "flip": 23000,
    "regime": "short",       // long | short | flat
    "degraded": false
  }
}
```

- Every absent level is `null` (never `0`, never `{}`).
- `side` is computed from the **unrounded float spot**.
- `strength` is 0..1 within its family; `null` only when the denominator is 0.
- `summary.max_pain` is sourced from `levels.max_pain.strike` (or `0` for
  compatibility) so the existing contract does not change.

## Definitions (reuse, don't re-derive)

| Field | Source |
|---|---|
| walls | near-band top OI (1% of spot) with global top-1 fallback; `strength = oi / side total OI` |
| max pain | canonical payout-minimising strike, ties → lowest; `strength = 1 − min/mean payout` |
| GEX support/resistance/fuel/flip/regime | port of `nifty.compute_gex` (gates unchanged: `GEX_LEVEL_MIN_SHARE=0.10`, `GEX_LEVEL_MAX_DIST_PCT=0.05`, flip band 5%) |
| `step` | modal positive strike gap, median fallback |
| `thin` | `total_oi < 50_000` OR `rows < 5` OR `max(single-leg OI)/total_oi > 0.4` |

Null rules: empty/zero OI → all null, `regime=flat`, `degraded=true`, `thin=true`;
missing greeks → gex levels/flip null, `degraded=true`; one-sided OI → that side’s
wall null; a GEX strike outside the gates → null; 0-DTE keeps walls/max-pain and
degrades GEX if gammas round to zero.

## Dock labels

Priority per strike row: **MAX PAIN > CALL WALL > PUT WALL > SUP > RES > FUEL**.

| Label | Token (semantic role) |
|---|---|
| `MP` | `LEVEL_MAX_PAIN` — amber equilibrium |
| `CW` | `LEVEL_CALL_WALL` — red, resistance |
| `PW` | `LEVEL_PUT_WALL` — green, support |
| `SUP` | `LEVEL_SUPPORT` — green |
| `RES` | `LEVEL_RESISTANCE` — red |
| `FU↑/FU↓` | `INFO` — blue, opt-in (tooltip/expansion only) |

- **Side coding is a separate axis:** CE/calls = `OI_CALL` (`INFO`, blue), PE/puts = `OI_PUT` (`WARNING`, orange), including OI bars. Never green/red — OI is not bullish/bearish. Do not reuse these tokens for levels above.
- **Row treatment:** CW/PW get a 2px inset rail + 8% tint, MP a 7% tint/outline, ATM keeps its amber fill. One row may carry both CW and PW — render both rails; the priority above picks only the visible chip/letter.
- **Contrast:** text ≥ 4.5:1, UI graphics ≥ 3:1 (decorative hairlines exempt); use `src/utils/contrast.ts` and `bun run contrast`, and add new pairs to `src/test/contrast.test.ts`. Solid green/red behind 10px text measured ~2.6:1 — the rail+tint pattern is the fix.

- Wide: 9px chip left of the strike number in the 72px strike cell; a secondary
  level may be a 2px left-rail tint.
- 390px: no text chips; a 2px tinted rail + one uppercase letter
  (`M/C/P/S/R`) top-left, full explanation in `title`/`aria-label`.
- Summary: keep the six cells; PAIN reads the DTO. Add one thin 9px line
  `SUP · RES · PW · CW` (narrow: SUP/RES only; thin chain: existing warning).
- Never badge `null`; never duplicate a label; never show live-only levels when
  the session is stale (keep the existing STALE badge).

## Narrow-viewport (390px) contract

Verified at 390×844 against `chain.columns.tsx`, `SummaryStrip.tsx`,
`AnalyticsTabStrip.tsx` and `tests/e2e/options-dock.spec.ts`
(`narrow 390: level rails, five analytics tabs and a stable header when analytics opens`).

- Strike rails render one uppercase letter `M/C/P/S/R` (max pain / call wall /
  put wall / support / resistance) with `role="img"` + `data-letter` and a 2px
  tinted rail; no multi-letter chip survives at 390px.
- The summary level line shows `SUP/RES` only; max pain is the **PAIN** stat
  value, never an `MP` chip.
- Measured header **31px**, summary **32px**, chain top **411px** — each unchanged
  when the analytics band mounts.
- All five tabs (`PAYOFF/SMILE/TERM/SURFACE/PROB`) fit at 390px; the strip's
  `overflow-x-auto` (scrollbar hidden) is an overflow guard, not active scroll.

## Reuse plan

1. New `api/options_levels.py`: `normalize_strikes` (accepts the chain, report and
   flat shapes), `compute_max_pain`, `compute_gex`, `top_walls`, `near_walls`,
   `is_thin`, `infer_step`, `build_levels`.
2. `api/reports_api/nifty.py` and `options_report.py` keep their public functions
   as thin wrappers; delete the formula bodies.
3. `api/options.py`: `calculate_max_pain` becomes a deprecated wrapper; build
   `strikes` once in the existing OI loop, call `build_levels` once, source
   `summary.max_pain`.
4. `optionChainMetrics.ts` moves to `src/utils/` with a re-export shim; `rowFlags`
   accepts precomputed wall `Set`s (avoid 2 allocations per row/call).
5. `optionsDock.ts` maps `levels` null-preservingly; `state/optionsDock.ts` patches
   the whole `levels` object on a tick.

## Tests / acceptance

- Pure module: adapter across all three row shapes; max-pain tie/no-OI; GEX cases
  parametrised against both the shared function and the `nifty` wrapper (anti-drift);
  null-rule table; step inference 2.5/50; float spot side boundary.
- `/chain`: `levels` present; `summary.max_pain == levels.max_pain.strike`; one
  upstream fetch per chain; expiry change changes the frame.
- Frontend: null-preserving normalization; PAIN reads the DTO (assert `maxPain` is
  not called); row badge priority/narrow letter; tick patches levels; guards +
  build/lint + 390px screenshot.
- Perf: `build_levels` once per frame; walls computed in a memo, never per cell;
  no new timer/network call.

## Checklist

1. `api/options_levels.py` + tests.
2. Rewire report/options wrappers; add `levels` to `/chain`; regenerate OpenAPI.
3. Move `optionChainMetrics` + wall sets.
4. DTO + SummaryStrip + state patch.
5. Chain badges (wide/narrow) + tests.
6. Lint/build/guards + 390px screenshot.
