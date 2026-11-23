# Design system A+ gate

**Goal:** reach an **A+ score for the dark-only financial-terminal design system**, not Ant Design parity. Light mode, i18n/RTL and SSR are explicitly out of scope by product decision.

This file is the loop contract. We do not mark the design-system task finished until the gate below is met.

## Scope-adjusted A+ definition

| Dimension | A+ target | Evidence required |
|---|---:|---|
| Tokens / dark theme contract | 9/10 | one palette source, semantic + component tokens, no hardcoded hex outside palette; JS consumers use semantic palette constants (or `tokenColor` where a computed CSS variable is required — there is only one scheme) |
| Typography | 9/10 | one six-step `text-ui-*` scale, 12px floor, no private inline sizes, chart/JS consumers read the same scale |
| Component completeness | 9/10 | every exported primitive has default/hover/focus/active/disabled/loading/error (where meaningful), light/dark not applicable |
| API consistency | 9/10 | no advertised-but-ignored props, one callback convention per control family, no swallowed legacy props |
| Accessibility | 9/10 | zero serious/critical axe violations, keyboard + focus management, form errors associated, modal/popover containment |
| Forms | 8/10 | label/description/error contract, invalid state, required semantics; no schema engine required |
| Data display | 9/10 | table, tree, tabs, menu, timeline, key/value, charts; density + empty/loading/error states |
| Overlays | 9/10 | modal, popover, tooltip, floating window; focus trap, dismissal, background inert, keyboard parity |
| Documentation / Storybook | 9/10 | every component page has variants/states/usage/a11y notes; family pages; links resolve |
| Test strategy | 9/10 | co-located tests for every primitive, axe smoke gate, catalog guard, visual evidence |
| Performance | 8/10 | no new runtime deps, CSS-only motion, no layout thrash, bundle budget no regression |
| i18n / RTL / light / SSR | N/A | explicitly out of scope; documented, not silently broken |

A+ is the **median of three independent raters**, each scoring the table above from source, tests, Storybook and screenshots. Self-scoring by the implementation agent does not count.

## Loop

1. Run **3 disjoint fix agents** on P0/P1 gaps.
2. Integrate and verify: typecheck, lint, targeted tests, axe gate, Storybook build, 1600/390 screenshots.
3. Run **3 independent rating agents** (no edit permission) against this table.
4. If median < 9 on any in-scope dimension, or any P0/P1 remains, open the next 3-agent wave.
5. Repeat until the median is ≥ 9 on every in-scope dimension and no P0/P1 remains.
6. Only then mark the task finished.

## Current known gaps (as of 2026-11-23, after P5)

Resolved since the first draft (verified against source/CI, not memory):

- `uiTheme` is typed (`as const` + `export type UiTheme` in `src/ui/theme.tsx`) and `UIProvider` now applies the colour-scheme props through the shared signal. The old "no-op theme stub" claim is stale.
- `FormField` (`src/ui/form/FormField.tsx`, with story and co-located test) owns ids, `aria-describedby` and `aria-invalid`; `Checkbox` and `Switch` now expose `error`/`description` slots and wire the same attributes. The "no error slot on Checkbox/Switch" claim is stale.
- `Tree` and `Menu` keyboard contracts are closed: Arrow/Home/End roving focus, `loop={false}` clamping, Escape dismissal, with regression tests in `Tree.test.tsx` / `Menu.test.tsx`. They are no longer "being closed in the current wave".
- `Select`/`MultiSelect` no longer accept `allowDeselect`, `maxDropdownHeight`, `comboboxProps` or `withinPortal` (`@ts-expect-error` tests assert they are absent). `legacyProps.ts` is now only a defensive strip for Text/Number/Password inputs; `InputProps` is still accepted on write and stripped in `UISelectProps`, so the swallowed-prop debt is reduced, not zero.
- Automated a11y is no longer happy-dom-only: `src/test/a11y-smoke.test.tsx` runs in vitest and `node scripts/storybook-a11y.mjs` runs axe-core in real Chromium over representative stories (serious/critical fail the job). Scoped UI coverage (`bun run test:coverage:ui`), the Storybook catalog guard (after a CI Storybook build) and `design-scale.test.ts` (no `ui/` exemption) also run in CI. Local catalog-guard runs still skip without a built manifest.
- Real-browser gates now cover **21 axe stories** (all 13 family landings + 3 overlay playables + 5 component representatives) and **9 keyboard walkthroughs**: Modal, Tree, Menu, horizontal/vertical Tabs, Popover, Tooltip and modal FloatingWindow, plus the original modal dismissal case.
- Typography has one tier: `src/ui/typography.ts` + `--text-ui-*` in `tailwind.css`, with a 12px hard floor, a 12/13/14/16/20/24 ladder and `uiTheme.fontSizes` aliases. The migration is complete: `node scripts/typography-audit.mjs` reports **0 private size declarations** across non-test/non-story source; `design-scale.test.ts` rejects any new one, and `audit:typography:check` is a CI step. The report now derives `REPORT_FONT` from the same scale (12/13/16/24), and every family/component showcase was recaptured at 1600 and 390.

Still open — keep the A+ verdict honest:

- **Token contract (dark-only).** With one colour scheme, static semantic palette imports are the intended contract; `tokenColor`/`useTokenColor` exist for the cases that must read a computed CSS variable. The guard is the absence of raw hex outside `palette.ts` (asserted by `theme-single-source.test.ts`), not call-site counts. This is a scope correction, not a claim that every chart was migrated to a runtime accessor.
- **API callback conventions.** `onChange` is value-based on most inputs but event-based on `Checkbox`/`Switch`; `onClick` is an event in `UIBaseProps` but void in `NavLink`/`MenuItem`/`CloseButton`. No single convention per family yet.
- **Visual regression baseline.** Browser axe now covers 21 stories including rendered contrast, and the keyboard walkthrough covers 9 interactions. It still does not assert pixels: there is no automated 1600/390 image diff, only checked-in full-page evidence.
- **Coverage is scoped, not universal.** 84/100 audited modules have a story and 88/100 a co-located test; "story: yes" means one exported name is imported, not that every state is reviewed.
- DatePicker is intentionally single-date; no range/time/locale.
- Tooltip requires a focusable child unless the opt-in tab stop is used.
- Screenshots are current only after the latest visual recapture; check commit dates before quoting them.

## Latest independent rating — 2026-11-23 (pre-fix wave)

Three read-only raters scored the P5 tree. **Not A+**: no P0, multiple P1s.

| Dimension | Target | Rater 1 | Rater 2 | Rater 3 |
|---|---:|---:|---:|---:|
| Tokens / theme | 9 | 7.5 | — | — |
| Typography | 9 | 6.5 | — | 7 |
| API consistency | 9 | 5.5 | — | — |
| Forms | 8 | 8.0 | — | — |
| Performance | 8 | 8.0 | — | — |
| Accessibility | 9 | — | 8.0 | — |
| Overlays | 9 | — | 8.5 | — |
| Data display | 9 | — | 8.0 | 7 |
| Test strategy | 9 | — | 8.0 | — |
| Component completeness | 9 | — | 8.0 | — |
| Documentation | 9 | — | — | 7 |
| Visual confidence | 9 | — | — | 7 |
| Evidence quality | 6 | — | — | 6 |

The P1 set driving the current wave: primitive rem size aliases, event-vs-value input callbacks, void `onClick` overrides, swallowed `InputProps`, vertical Tabs keyboard, Menu/Popover disclosure ARIA, missing primitive tests, and an advertised-but-unimplemented Tabs/overlay prop surface. This section is superseded only by a new independent rating, never by implementer self-scoring.

## P5 evidence (2026-11-23)

| Check | Result |
|---|---|
| `bun run typecheck` / `bun run lint` | 0 errors / 0 warnings |
| Typography audit | 0 private declarations; 12px floor clean |
| Frontend suite | 11,968 passed, 1 fixed theme assertion; the only remaining worker error is a pre-existing `PatternsPage.test.tsx` fork OOM (reproduced on the pre-typography commit) |
| Production build | clean (198 chunks) |
| Storybook build + catalog | clean |
| Browser axe (21 stories) | 0 serious/critical violations |
| Screenshots | `docs/screenshots/showcase/` recaptured full-page at 1600/390 with focus-ring proof; Index Report app route captured at `docs/screenshots/app/report-{1600,390}.png` |
| Browser keyboard | 9/9 (Modal, Tree, Menu, horizontal/vertical Tabs, Popover, Tooltip, modal FloatingWindow, modal dismissal) |
