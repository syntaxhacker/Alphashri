# Visual evidence index

Scope: committed screenshots and browser-gate configuration for the design-system
wave. This index separates **evidence** (a file that exists at `HEAD`, plus what
its pixels can actually show) from **claims** (what a doc asserts or a script
would check). No new captures, builds or gate runs were performed for this
document.

Status of the worktree at `HEAD` = `fd219bdd` (2026-11-23):

- `docs/screenshots/showcase/` — 52 PNGs committed (26 names × 2 viewports).
- `docs/screenshots/app/` — only `report-{1600,390}.png` committed (both also have
  an uncommitted re-capture). `sector-{1600,390}.png` and `home-1600.png` exist in
  the worktree but are **untracked**; `home-390.png` does not exist. The `/options`
  route is explicitly out of scope (§1), not a pending capture.
- `tests/visual/__screenshots__/` — README plus **12 baseline PNGs committed**
  (6 stories × 2 viewports); `bun run visual:test` passes **12/12**.

## 1. App-route captures (`docs/screenshots/app/`)

Capture paths: `tests/e2e/design-evidence.spec.ts` (`report` → `/report/index`,
`sector` → `/sector`, `home` → `/home`; viewports 1600×1000 and 390×844;
`SCREENSHOT_EVIDENCE=1` writes the PNGs; shared API mocks plus per-route mocks,
login, readiness selector and `verify()` assertions), plus the separate
`screener-evidence.spec.ts` and `patterns-evidence.spec.ts` for the bare
`/screener` and `/patterns` routes. Measured dimensions of the existing PNGs are
exactly 1600×1000 and 390×844 (viewport-sized; older docs call them "viewport"
captures although the specs set `fullPage: true`). The `/options` route is
explicitly **out of scope** for the design-system evidence wave: it has its own
feature spec, so it is neither a pending capture nor an unverified gap.

| Route | 1600 | 390 | Status | What it proves |
| --- | --- | --- | --- | --- |
| Report | `docs/screenshots/app/report-1600.png` | `docs/screenshots/app/report-390.png` | **Committed at HEAD** (both also have an uncommitted re-capture in the worktree) | Real `/report/index` render with mocked Index Report APIs at both sizes; layout/chrome/legibility of that route only. The 1600 capture previously exposed a spot-value ellipsis; the KPI minimum was widened afterwards. |
| Sector | `docs/screenshots/app/sector-1600.png` | `docs/screenshots/app/sector-390.png` | **Pending capture** — files exist in the worktree but are untracked at `HEAD` | Intended as real `/sector` render with `setupSectorMocks` and the `sector-analysis-view` readiness selector. Not committed evidence until added; `VISUAL_AUDIT_APP.md` already calls them committed, which is ahead of git. |
| Home | `docs/screenshots/app/home-1600.png` | `docs/screenshots/app/home-390.png` | **Pending capture** (`home-1600.png` untracked in the worktree, `home-390.png` absent) | Spec route and desk assertions exist, but no committed image. Route remains unverified. |
| Screener | `docs/screenshots/app/screener-1600.png` | `docs/screenshots/app/screener-390.png` | **Pending capture** (no files) | `screener-evidence.spec.ts` drives `/screener/screener` with screener-specific mocks and a 390 scroll-cue guard; no committed image yet. |
| Patterns | `docs/screenshots/app/patterns-1600.png` | `docs/screenshots/app/patterns-390.png` | **Pending capture** (no files) | `patterns-evidence.spec.ts` drives `/patterns` with pattern fixtures and result/scroll-cue guards; no committed image yet. |

All five routes above are **gated by the evidence manifest** (`APP_ROUTES` in
`scripts/evidence-audit.mjs`), so their missing PNGs appear as pending evidence
in `audit:evidence:pending` and fail the gating `audit:evidence`. Options is
absent from that manifest by decision, not omission. Storybook PNGs are not a
substitute for any of these routes.

## 2. Storybook showcase (`docs/screenshots/showcase/`)

52 committed PNGs, all pairs at 1600 and 390, captured full-page by
`scripts/storybook-showcase.mjs` (e.g. `overview-1600.png` = 1600×2502,
`overview-390.png` = 390×7355). They prove the **static Storybook build** renders
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
| Keyboard, **10 walkthroughs** | `scripts/storybook-keyboard.mjs`: Modal open (Tab cycle/Shift+Tab wrap), Modal dismissal (Escape/focus return), Tree (arrows/expand/select), Menu (arrows/Home/End/Escape), horizontal Tabs, vertical Tabs, Popover, Tooltip, modal FloatingWindow, NavLink (button[role=link] Enter/Space activation, disabled inert, href stays an anchor). | **Configured.** `DESIGN_SYSTEM_A_PLUS_GATE.md:90` documents 10/10; no committed run artifact accompanies this index, so treat 10/10 as a documented claim, not fresh evidence. |
| Visual baseline, **12 images** | `tests/visual/__screenshots__/README.md` and `docs/VISUAL_REGRESSION.md`: 6 stories × 2 viewports — `typography-landing`, `overview`, `inputs-landing`, `data-display-landing`, `overlay-landing`, `foundations-landing` at `desktop-1600` / `mobile-390`; `bun run visual:test` must find all 12 (no writes). | **12/12 passing.** Harness + CI step landed in `ff939b9a`; all 12 baseline PNGs (6 stories × 2 viewports) are generated and committed in `tests/visual/__screenshots__/`, and `bun run visual:test` passes **12/12** with no writes. This gate is green. |
| Screenshot evidence, **62 PNGs** | `scripts/evidence-audit.mjs` via `bun run audit:evidence`: gating structural check of 10 app-route PNGs (`1600×1000` / `390×844`) and 52 showcase PNGs (width 1600 / 390, height ≥ viewport); each must exist, be a valid PNG and be ≥8 KiB. The 10 app-route PNGs cover report, sector, home, **screener and patterns**; the options route is explicitly out of scope and not in the manifest. **Runs in CI** in the `frontend-lint-typecheck` job (step `Verify screenshot evidence`, immediately after `Verify Storybook visual baseline`). | **Wired into CI (gating, exits 1 on missing/invalid/too-small/wrong-dimension).** Current `HEAD` has known pending app-route captures (§5), including screener/patterns — intentional until the final capture commit adds them; do not call it green before that commit lands. |

## 4. Evidence vs claims — the line

- A committed PNG proves only that the captured surface rendered at the measured
  size with the mocked data used for that capture. It does not prove current
  `HEAD` behaviour if source changed afterwards (the report PNGs themselves have
  uncommitted re-captures).
- Static Storybook images do not verify `/home`, bare `/screener`, `/patterns`,
  focus order, live WCAG ratios or reduced motion. `/options` is out of scope for
  this evidence wave (it has its own feature spec), not an unverified gap.
- Script definitions are gate *configuration*; a pass result needs a run/artifact.
  The 30-story axe number comes from the script, and `DESIGN_SYSTEM_A_PLUS_GATE.md`
  agrees at 30 — still configuration, not a committed run result.
- The pixel-diff harness, CI step and all 12 committed baseline PNGs exist
  (`tests/visual/__screenshots__/`), and `bun run visual:test` passes **12/12** —
  "visual regression gate passes" is now a supportable claim.
- Screenshot captions in `VISUAL_AUDIT_APP.md` describe `sector-390.png` as
  committed; git does not. Trust the file state in §1.

## 5. Missing evidence (pending capture)

1. `sector-{1600,390}.png` — commit the existing worktree files (or re-capture).
2. `home-1600.png` (worktree, untracked) and `home-390.png` (absent) — commit or
   capture both viewports.
3. Bare `/screener` and `/patterns` route captures at 1600/390 (no files at all).
4. A committed run result for the 30-story axe gate; a committed run result for
   10 keyboard walkthroughs.
5. Live-app focus/keyboard, actual contrast ratios and reduced-motion evidence —
   currently source-only or Storybook-only.

The `/options` route is **out of scope**, not pending: it has its own feature
spec and is deliberately absent from the evidence manifest (§6).

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

While captures are still in progress (see §5), use the non-gating variant:

```
bun run audit:evidence:pending
```

This is the `node scripts/evidence-audit.mjs --allow-missing` flag: it prints
the same list of problems, labelled as pending evidence, and exits 0 so the
capture-in-progress state does not fail the gate.

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
the command. While
captures are still incomplete, `audit:evidence:pending`
may report the gaps non-fatally, but the final capture commit must satisfy the
gating `audit:evidence`.
