# Design system A+ gate

**Goal:** reach an **A+ score for the dark-only financial-terminal design system**, not Ant Design parity. Light mode, i18n/RTL and SSR are explicitly out of scope by product decision.

This file is the loop contract. We do not mark the design-system task finished until the gate below is met.

## Scope-adjusted A+ definition

| Dimension | A+ target | Evidence required |
|---|---:|---|
| Tokens / dark theme contract | 9/10 | one palette source, semantic + component tokens, no hardcoded hex outside palette, JS consumers use token accessor |
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
- A real-browser keyboard walkthrough (`scripts/storybook-keyboard.mjs`) now runs after the axe gate: Modal trap/Escape/focus return, Tree arrows/expand/select, Menu roving focus/Escape and automatic Tabs activation. 5/5 pass.
- Typography has one tier: `src/ui/typography.ts` + `--text-ui-*` in `tailwind.css`, with a 12px hard floor, a 12/13/14/16/20/24 ladder and `uiTheme.fontSizes` aliases. `scripts/typography-audit.mjs` measures private declarations; the migration from 9/10/11px labels is in progress across `src/ui`, `src/components`, pages, report and stories.

Still open — keep the A+ verdict honest:

- **Typography adoption.** The tier exists, but the app still carries private `text-[Npx]` / inline `fontSize` declarations and a handful of sub-12px sector/report labels. The 2026-11-23 wave is migrating them by directory; the gate is not met until `node scripts/typography-audit.mjs --check` is clean and the report floor tests pass.
- **Token-accessor adoption vs dark-only scope.** Light mode, i18n/RTL and SSR are out of scope by product decision, but dark-token consistency is unfinished: `src/ui/tokens.ts` exists, yet almost no app code calls `tokenColor`/`useTokenColor`. A literal grep finds ~240 non-test, non-PoC source files importing `src/ui/palette.ts` directly; the old "~57 modules" figure is not reproducible from current source.
- **API callback conventions.** `onChange` is value-based on most inputs but event-based on `Checkbox`/`Switch`; `onClick` is an event in `UIBaseProps` but void in `NavLink`/`MenuItem`/`CloseButton`. No single convention per family yet.
- **Two tables.** `components/common/TanStackTable.tsx` and `components/paper-trading/TanStackTable.tsx` remain separate implementations with different feature sets.
- **App dialects.** Feature-local duplicates (paper-trading table, `PanelModal`/`ExpandedPanel`, `components/common/Icons.tsx`, `RangeInput` vs `RangeSlider`, `TradingDatePicker`) still drift from `@/ui`.
- **Visual regression baseline.** Browser axe covers representative stories for serious/critical violations, including rendered contrast; it does not assert pixels. No 1600/390 snapshot baseline for the catalog, and keyboard focus order/trap plus screen-reader output still need a manual or Playwright walkthrough.
- **Coverage is scoped, not universal.** 84/100 audited modules have a story and 88/100 a co-located test; "story: yes" means one exported name is imported, not that every state is reviewed.
- DatePicker is intentionally single-date; no range/time/locale.
- Tooltip requires a focusable child unless the opt-in tab stop is used.
- Screenshots are current only after the latest visual recapture; check commit dates before quoting them.
