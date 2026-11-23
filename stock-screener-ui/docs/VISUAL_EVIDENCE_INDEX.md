# Visual evidence index

Scope: committed screenshots and browser-gate configuration for the design-system
wave. This index separates **evidence** (a file that exists at `HEAD`, plus what
its pixels can actually show) from **claims** (what a doc asserts or a script
would check). No new captures, builds or gate runs were performed for this
document.

Status of the worktree at `HEAD` = `fd219bdd` (2026-11-23):

- `docs/screenshots/showcase/` — 52 PNGs committed (26 names × 2 viewports).
- `docs/screenshots/app/` — only `report-{1600,390}.png` committed. `sector-*` exist
  in the worktree but are **untracked**; `home-*` and `options-*` do not exist.
- `tests/visual/__screenshots__/` — README committed, **0 PNGs**.

## 1. App-route captures (`docs/screenshots/app/`)

Capture path is `tests/e2e/design-evidence.spec.ts` (routes `report` → `/report/index`,
`sector` → `/sector`, `options` → `/options`, `home` → `/home`; viewports
1600×1000 and 390×844; `SCREENSHOT_EVIDENCE=1` writes the PNGs; shared API mocks
plus per-route mocks, login, readiness selector and `verify()` assertions).
Measured dimensions of the existing PNGs are exactly 1600×1000 and 390×844
(viewport-sized; older docs call them "viewport" captures although the spec sets
`fullPage: true`).

| Route | 1600 | 390 | Status | What it proves |
| --- | --- | --- | --- | --- |
| Report | `docs/screenshots/app/report-1600.png` | `docs/screenshots/app/report-390.png` | **Committed at HEAD** (both also have an uncommitted re-capture in the worktree) | Real `/report/index` render with mocked Index Report APIs at both sizes; layout/chrome/legibility of that route only. The 1600 capture previously exposed a spot-value ellipsis; the KPI minimum was widened afterwards. |
| Sector | `docs/screenshots/app/sector-1600.png` | `docs/screenshots/app/sector-390.png` | **Pending capture** — files exist in the worktree but are untracked at `HEAD` | Intended as real `/sector` render with `setupSectorMocks` and the `sector-analysis-view` readiness selector. Not committed evidence until added; `VISUAL_AUDIT_APP.md` already calls them committed, which is ahead of git. |
| Home | `docs/screenshots/app/home-1600.png` | `docs/screenshots/app/home-390.png` | **Pending capture** (no files) | Spec route and desk assertions exist, but no committed image. Route remains unverified. |
| Options | `docs/screenshots/app/options-1600.png` | `docs/screenshots/app/options-390.png` | **Pending capture** (no files) | Spec route exists (`options-chain-panel`), no committed image. Route remains unverified. `docs/screenshots/options-paper-replay/*.png` cover the replay workstation feature, **not** the `/options` route. |

Also unverified, with no route capture anywhere: **bare `/screener`** and
**`/patterns`** (patterns are source-only; no screenshot exists). Storybook PNGs
are not a substitute for any of these routes.

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
| Keyboard, **10 walkthroughs** | `scripts/storybook-keyboard.mjs`: Modal open (Tab cycle/Shift+Tab wrap), Modal dismissal (Escape/focus return), Tree (arrows/expand/select), Menu (arrows/Home/End/Escape), horizontal Tabs, vertical Tabs, Popover, Tooltip, modal FloatingWindow, NavLink (button[role=link] Enter/Space activation, disabled inert, href stays an anchor). | **Configured.** `DESIGN_SYSTEM_A_PLUS_GATE.md:90` documents 10/10; no committed run artifact accompanies this index, so treat 10/10 as a documented claim, not fresh evidence. |
| Visual baseline, **12 images** | `tests/visual/__screenshots__/README.md` and `docs/VISUAL_REGRESSION.md`: 6 stories × 2 viewports — `typography-landing`, `overview`, `inputs-landing`, `data-display-landing`, `overlay-landing`, `foundations-landing` at `desktop-1600` / `mobile-390`; `bun run visual:test` must find all 12 (no writes). | **Harness + CI step configured (`ff939b9a`), baselines pending.** Directory contains only `README.md`; 0 of 12 PNGs exist. `bun run build-storybook` + `bun run visual:update` must produce and commit them before the gate can pass; do not call it green. |

## 4. Evidence vs claims — the line

- A committed PNG proves only that the captured surface rendered at the measured
  size with the mocked data used for that capture. It does not prove current
  `HEAD` behaviour if source changed afterwards (the report PNGs themselves have
  uncommitted re-captures).
- Static Storybook images do not verify `/home`, `/options`, bare `/screener`,
  `/patterns`, focus order, live WCAG ratios or reduced motion.
- Script definitions are gate *configuration*; a pass result needs a run/artifact.
  The 30-story axe number comes from the script, and `DESIGN_SYSTEM_A_PLUS_GATE.md`
  agrees at 30 — still configuration, not a committed run result.
- The pixel-diff harness and CI step exist (`ff939b9a`), but no baseline PNGs
  have been generated or committed yet (0 of 12), so "visual regression gate
  passes" is not a supportable claim today.
- Screenshot captions in `VISUAL_AUDIT_APP.md` describe `sector-390.png` as
  committed; git does not. Trust the file state in §1.

## 5. Missing evidence (pending capture)

1. `sector-{1600,390}.png` — commit the existing worktree files (or re-capture).
2. `home-{1600,390}.png` and `options-{1600,390}.png` — capture both routes.
3. Bare `/screener` and `/patterns` route captures at 1600/390 (no files at all).
4. All 12 visual-baseline PNGs in `tests/visual/__screenshots__/`.
5. A committed run result for the 30-story axe gate; a committed run result for
   10 keyboard walkthroughs.
6. Live-app focus/keyboard, actual contrast ratios and reduced-motion evidence —
   currently source-only or Storybook-only.

## 6. Evidence guard

From `stock-screener-ui/`:

```
node scripts/evidence-audit.mjs
```

Dependency-free structural check of the manifest declared in the script: 8 app
route PNGs and 52 Storybook showcase PNGs. Each must exist, be a valid PNG, be
at least 8 KiB, and have the expected IHDR dimensions (app exactly 1600×1000 /
390×844; showcase width 1600 / 390 and height ≥ viewport). It lists
missing/wrong/too-small/invalid files and exits 1 if any fail; it does not
decode pixels or rate visuals. `--allow-missing` prints the same list as pending
and exits 0.
