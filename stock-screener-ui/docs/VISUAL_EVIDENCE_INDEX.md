# Visual evidence index

Scope: committed screenshots and browser-gate configuration for the design-system
wave. This index separates **evidence** (a file that exists at `HEAD`, plus what
its pixels can actually show) from **claims** (what a doc asserts or a script
would check). File presence, PNG headers, dimensions and the final 1600/390
read-back were checked at the pinned commit below.

Status at `HEAD` = `6a75a298` (2026-11-23) — **final evidence commit**:

- The final **1600/390 screenshot read-back is done at this commit**: PNGs were
  opened and checked for hero/chart/chain/toolbar legibility, no blank canvas and
  no `undefined`/`NaN` text. The read-back confirms the two latest report fixes:
  the chart is **pinned to session-scoped candles** (no stale/tape-only fallback
  or two-day series) and the **390 option chain opens on the ATM strike**, pinned
  just below the sticky header with the next row visible as a scroll cue. See
  `DESIGN_SYSTEM_A_PLUS_GATE.md` for the independent rating: three raters at
  `6d25b3c8` scored **7 / 8.5 / 8** (not A++). No A+ / A++ verdict is claimed.
- `docs/screenshots/showcase/` — 52 PNGs committed (26 names × 2 viewports).
  Widths are 1600 / 390 and every height is ≥ viewport; several specimens are
  viewport-sized (e.g. `keyvalue-390.png` = 390×844, `buttons-1600.png` =
  1600×1000) while the family landings are full-page (e.g. `overview-1600.png` =
  1600×2502, `overview-390.png` = 390×5099).
- `docs/screenshots/app/` — **all 10 PNGs committed**: report, sector, home,
  screener and patterns at 1600×1000 and 390×844 (all five routes added in
  `92282149`). The `report-*.png` re-capture is committed at the final HEAD
  `6a75a298` and read back; `/options` is explicitly out of scope (§1), not a
  pending capture.
- `tests/visual/__screenshots__/` — README plus **12 baseline PNGs committed**
  (6 stories × 2 viewports); `bun run visual:test` passes **12/12**.
- The **62-image manifest** (10 app + 52 showcase) is the evidence gate. **62/62**
  files are present at the final HEAD `6a75a298` with the expected dimensions and
  ≥8 KiB.

## 1. App-route captures (`docs/screenshots/app/`)

Capture paths: `tests/e2e/design-evidence.spec.ts` (`report` → `/report/index`,
`sector` → `/sector`, `home` → `/home`; viewports 1600×1000 and 390×844;
`SCREENSHOT_EVIDENCE=1` writes the PNGs; shared API mocks plus per-route mocks,
login, readiness selector and `verify()` assertions), plus the separate
`screener-evidence.spec.ts` and `patterns-evidence.spec.ts` for the bare
`/screener` and `/patterns` routes. Measured dimensions of all 10 committed PNGs
are exactly 1600×1000 and 390×844 (viewport-sized, even though the specs request
`fullPage: true`). The `/options` route is
explicitly **out of scope** for the design-system evidence wave: it has its own
feature spec, so it is neither a pending capture nor an unverified gap.

All paths below are under `docs/screenshots/app/`.

| Route | 1600 | 390 | Status | What it proves |
| --- | --- | --- | --- | --- |
| Report | `report-1600.png` | `report-390.png` | **Committed at HEAD `6a75a298`**, re-capture included; final 1600/390 read-back done | Real `/report/index` render with mocked Index Report APIs at both sizes; layout/chrome/legibility of the Index Report composition verified in the final read-back, including the chart pinned to candles and the 390 chain opening on the ATM strike. |
| Sector | `sector-1600.png` | `sector-390.png` | **Committed at HEAD** (`92282149`) | Real `/sector` render with `setupSectorMocks` and the `sector-analysis-view` readiness selector. |
| Home | `home-1600.png` | `home-390.png` | **Committed at HEAD** (`92282149`) | Real `/home` render at both sizes. |
| Screener | `screener-1600.png` | `screener-390.png` | **Committed at HEAD** (`92282149`) | `screener-evidence.spec.ts` drives `/screener/screener` with screener-specific mocks and a 390 scroll-cue guard. |
| Patterns | `patterns-1600.png` | `patterns-390.png` | **Committed at HEAD** (`92282149`) | `patterns-evidence.spec.ts` drives `/patterns` with pattern fixtures and result/scroll-cue guards. |

All five routes above are in the evidence manifest (`APP_ROUTES` in
`scripts/evidence-audit.mjs`), and their PNGs are now present at `HEAD`, so no
app-route capture is pending. Options is absent from that manifest by decision,
not omission. Storybook PNGs are not a substitute for any of these routes.

## 2. Storybook showcase (`docs/screenshots/showcase/`)

52 committed PNGs, all pairs at width 1600 and 390, captured by
`scripts/storybook-showcase.mjs`. Not every image is full-page: the audit requires
width 1600 / 390 and height ≥ viewport, so several smaller specimens are
viewport-sized (e.g. `keyvalue-390.png` = 390×844, `buttons-1600.png` =
1600×1000) while the landings are tall (e.g. `overview-1600.png` = 1600×2502,
`overview-390.png` = 390×5099). They prove the **static Storybook build** renders
these stories; they do not prove live-route behaviour, keyboard order or axe
results.

### Family landings (13 pairs)

| Name | Files |
| --- | --- |
| Overview | `overview-1600.png`, `overview-390.png` |
| Foundations | `foundations-1600.png`, `foundations-390.png` |
| Typography | `typography-1600.png`, `typography-390.png` |
| Layout | `layout-1600.png`, `layout-390.png` |
| Inputs | `inputs-1600.png`, `inputs-390.png` |
| Data display | `data-display-1600.png`, `data-display-390.png` |
| Feedback | `feedback-1600.png`, `feedback-390.png` |
| Navigation | `navigation-1600.png`, `navigation-390.png` |
| Overlay | `overlay-1600.png`, `overlay-390.png` |
| Portal | `portal-1600.png`, `portal-390.png` |
| Shared primitives | `shared-primitives-1600.png`, `shared-primitives-390.png` |
| App primitives | `app-primitives-1600.png`, `app-primitives-390.png` |
| Misc | `misc-1600.png`, `misc-390.png` |

### Component pages (9 pairs)

| Name | Files |
| --- | --- |
| Alerts | `alerts-1600.png`, `alerts-390.png` |
| Buttons | `buttons-1600.png`, `buttons-390.png` |
| Grid | `grid-1600.png`, `grid-390.png` |
| Key/value | `keyvalue-1600.png`, `keyvalue-390.png` |
| Loader | `loader-1600.png`, `loader-390.png` |
| Notifications | `notifications-1600.png`, `notifications-390.png` |
| Select | `select-1600.png`, `select-390.png` |
| Skeleton | `skeleton-1600.png`, `skeleton-390.png` |
| Table | `table-1600.png`, `table-390.png` |

### Result-state images (3 pairs)

| State | Files |
| --- | --- |
| Empty | `result-empty-1600.png`, `result-empty-390.png` |
| Scanning | `result-scanning-1600.png`, `result-scanning-390.png` |
| Feed error | `result-feed-error-1600.png`, `result-feed-error-390.png` |

### Focus-ring images (1 pair)

| State | Files | Proves |
| --- | --- | --- |
| Focus ring | `focus-ring-1600.png`, `focus-ring-390.png` | Focus-ring rendering on the Storybook specimen at both sizes. Does **not** prove live-app focus order or modal containment. |

## 3. Browser gates

| Gate | Definition (source of truth) | Evidence status |
| --- | --- | --- |
| Axe, **30 stories** | `scripts/storybook-a11y.mjs`: 13 family landings + 3 overlay playables + 5 component representatives + 9 pinned visible states (BrokerAuthNotice, MembersDrawer, ×2 ChartPreviews states, Foundations theme bridge, 3 data-display result states, NavLink states). WCAG 2.0/2.1 A/AA; fails on serious/critical. | **Configured, not re-certified here.** No committed run log for the 30-story set. `DESIGN_SYSTEM_A_PLUS_GATE.md` agrees with the script at **30** stories; only the missing run log, not a doc mismatch, keeps 30 from being called green here. |
| Axe, **app routes** | `tests/e2e/app-a11y.spec.ts` **runs in CI** in the `e2e-smoke` job (step `Verify app routes with axe`, `APP_A11Y=1`, 2 workers), after the smoke tests and reusing the same API + dev server. Real-browser axe audits of `/report/index`, `/sector`, `/options`, `/home` (desk) and bare `/screener` with shared mocks; WCAG 2.0/2.1 A/AA tags; fails on serious/critical only (`color-contrast` incompletes documented/allowed). | **Wired into CI.** Configuration change only — no committed run artifact accompanies this index, so treat the pass as a CI gate claim, not fresh evidence here. |
| Keyboard, **10 walkthroughs** | `scripts/storybook-keyboard.mjs`: Modal open (Tab cycle/Shift+Tab wrap), Modal dismissal (Escape/focus return), Tree (arrows/expand/select), Menu (arrows/Home/End/Escape), horizontal Tabs, vertical Tabs, Popover, Tooltip, modal FloatingWindow, NavLink (button[role=link] Enter/Space activation, disabled inert, href stays an anchor). | **Configured.** `DESIGN_SYSTEM_A_PLUS_GATE.md` documents 10/10; no committed run artifact accompanies this index, so treat 10/10 as a documented claim, not fresh evidence. |
| Visual baseline, **12 images** | `tests/visual/__screenshots__/README.md` and `docs/VISUAL_REGRESSION.md`: 6 stories × 2 viewports — `typography-landing`, `overview`, `inputs-landing`, `data-display-landing`, `overlay-landing`, `foundations-landing` at `desktop-1600` / `mobile-390`; `bun run visual:test` must find all 12 (no writes). | **12/12 passing.** Harness + CI step landed in `ff939b9a`; all 12 baseline PNGs (6 stories × 2 viewports) are generated and committed in `tests/visual/__screenshots__/`, and `bun run visual:test` passes **12/12** with no writes. This gate is green. |
| Screenshot evidence, **62 PNGs** | `scripts/evidence-audit.mjs` via `bun run audit:evidence`: gating structural check of 10 app-route PNGs (`1600×1000` / `390×844`) and 52 showcase PNGs (width 1600 / 390, height ≥ viewport); each must exist, be a valid PNG and be ≥8 KiB. The 10 app-route PNGs cover report, sector, home, **screener and patterns**; the options route is explicitly out of scope and not in the manifest. **Runs in CI** in the `frontend-lint-typecheck` job (step `Verify screenshot evidence`, immediately after `Verify Storybook visual baseline`). | **The 62-image structural audit is the gate.** Wired into CI (exits 1 on missing/invalid/too-small/wrong-dimension). **62/62** manifest files are present at the final HEAD `6a75a298` with the expected dimensions and ≥8 KiB, and the 1600/390 read-back is complete. |

## 4. Evidence vs claims — the line

- A committed PNG proves only that the captured surface rendered at the measured
  size with the mocked data used for that capture. It does not prove current
  `HEAD` behaviour if source changed afterwards; the final 1600/390 read-back at
  HEAD `6a75a298` is the current visual verdict for the committed report pair.
- Static Storybook images do not verify live-route behaviour; the app-route PNGs
  in §1 do cover `/report/index`, `/sector`, `/home`, bare `/screener` and
  `/patterns` at both sizes. Focus order, live WCAG ratios and reduced motion are
  still source/gate claims, not pixel evidence. `/options` is out of scope for
  this evidence wave (it has its own feature spec), not an unverified gap.
- Script definitions are gate *configuration*; a pass result needs a run/artifact.
  The 30-story axe number comes from the script, and `DESIGN_SYSTEM_A_PLUS_GATE.md`
  agrees at 30 — still configuration, not a committed run result.
- The pixel-diff harness, CI step and all 12 committed baseline PNGs exist
  (`tests/visual/__screenshots__/`), and `bun run visual:test` passes **12/12** —
  "visual regression gate passes" is now a supportable claim.
- The final 1600/390 screenshot read-back for the Index Report composition is
  **done at HEAD `6a75a298`** — PNGs were opened and checked for legibility and
  no blank canvas / `undefined` / `NaN`. The read-back specifically confirms the
  chart is pinned to session-scoped candles (no stale/tape-only or two-day series)
  and the 390 option chain opens on the ATM strike, pinned below the sticky header
  with the next row as a scroll cue. The independent panel at `6d25b3c8` scored
  **7 / 8.5 / 8**, not A++ (see `DESIGN_SYSTEM_A_PLUS_GATE.md`); the presence of
  a PNG alone is not a rating, and no A+ / A++ verdict is claimed.

## 5. Open evidence items (no longer capture gaps)

All five in-scope app routes and all 26 showcase names have committed PNGs at both
viewports (§1–§2); **62/62** manifest images are present at HEAD `6a75a298` and
the final 1600/390 read-back is done. There are no pending captures. The `/options`
route is **out of scope**, not pending: it has its own feature spec and is
deliberately absent from the evidence manifest (§6).

Still not evidenced by a committed artifact:

1. A committed run result for the 30-story axe gate.
2. A committed run result for the 10 keyboard walkthroughs.
3. Live-app focus/keyboard, actual contrast ratios and reduced-motion evidence —
   currently source-only or Storybook-only.
4. A fresh **independent rating** for the final `6a75a298` tree. The
   `6d25b3c8` panel scored **7 / 8.5 / 8** and is not an A++ certification (see
   `DESIGN_SYSTEM_A_PLUS_GATE.md`). The final 1600/390 read-back is complete at
   HEAD `6a75a298`.

## 6. Evidence guard

From `stock-screener-ui/`:

```
bun run audit:evidence
```

Dependency-free structural check of the manifest declared in
`scripts/evidence-audit.mjs`: 10 app route PNGs (report, sector, home, screener,
patterns; options is out of scope) and 52 Storybook showcase PNGs — 62 required
images total.
Each must exist, be a valid PNG, be at least 8 KiB, and have the expected IHDR
dimensions (app exactly 1600×1000 / 390×844; showcase width 1600 / 390 and
height ≥ viewport). It does not decode pixels or rate visuals. **The default
`audit:evidence` is gating: it lists missing, invalid, too-small and
wrong-dimension PNGs and exits 1 if any fail.** This gating command is the one
wired into CI in the `frontend-lint-typecheck` job (step `Verify screenshot
evidence`, right after `Verify Storybook visual baseline`), so a PR with
missing/invalid/wrong-dimension committed screenshots fails.

There is no pending-capture state to excuse now. The non-gating variant exists
for capture-in-progress debugging only:

```
bun run audit:evidence:pending
```

This is the `node scripts/evidence-audit.mjs --allow-missing` flag: it prints the
same list of problems, labelled as pending evidence, and exits 0. It must not be
used to sign off the final state.

## 7. Capture commands

From `stock-screener-ui/`, each command sets `SCREENSHOT_EVIDENCE=1` (so the spec
writes PNGs instead of only asserting the DOM) and pins `--workers=1` for a
deterministic capture:

`evidence:all` runs all three specs sequentially (each `SCREENSHOT_EVIDENCE=1`
and `--workers=1`, chained with `&&` so a failure stops the run) and prints a
reminder that `bun run audit:evidence` is the gate:

```
bun run evidence:all        # design-evidence → screener-evidence → patterns-evidence, then prints the audit:evidence gate reminder
```

The individual captures are still available if you only need one route family:

```
bun run evidence:app        # design-evidence.spec.ts — report/sector/home → docs/screenshots/app/{report,sector,home}-{1600,390}.png
bun run evidence:screener   # screener-evidence.spec.ts — bare /screener → docs/screenshots/app/screener-{1600,390}.png
bun run evidence:patterns   # patterns-evidence.spec.ts — /patterns → docs/screenshots/app/patterns-{1600,390}.png
```

Prerequisite: **the app/API or preview server must already be running with the
local API env before any capture command.** `playwright.config.ts` sets
`baseURL: http://localhost:5173` and declares no `webServer`, so Playwright will
not start one for you — bring up the UI server yourself (`./start.sh`, or
`bun run dev` / `bun run preview`). Start it with the local API env in place: the
Vite proxy targets `VITE_API_BASE_URL || http://localhost:8765`, so the UI must
point at the local API (default `localhost:8765`) for `/api` mock interception
and route readiness to behave as the specs expect.

After capturing, run the gating check from §6 and **it must pass before the
PNGs are committed**:

```
bun run audit:evidence
```

It exits 0 only when all 10 app-route PNGs (report, sector, home, screener,
patterns; options is out of scope) and 52 showcase PNGs exist, are valid PNG
files, are ≥8 KiB and have the expected dimensions; a missing/invalid PNG fails
the command. **62/62** are present at the final HEAD `6a75a298`, with the
1600/390 read-back complete — `audit:evidence:pending` is not a substitute for
the gating command.
