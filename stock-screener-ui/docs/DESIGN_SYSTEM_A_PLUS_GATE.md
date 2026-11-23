# Design system A+ gate

**Goal:** reach an **A+ score for the dark-only financial-terminal design system**, not Ant Design parity. Light mode, i18n/RTL and SSR are explicitly out of scope by product decision.

This file is the loop contract. We do not mark the design-system task finished until the gate below is met.

## Scope-adjusted A+ definition

| Dimension | A+ target | Evidence required |
|---|---:|---|
| Tokens / dark theme contract | 9/10 | one palette source, semantic + component tokens, no hardcoded hex outside palette, JS consumers use token accessor |
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

## Current known gaps (as of 2026-11-23, after P0–P3)

- ~57 chart/ink modules still import static dark palette values instead of the token accessor.
- API consistency is the weakest score: value-vs-event `onChange`, event-vs-void `onClick`, swallowed legacy Mantine props, `Menu.loop`/Tree keyboard gaps.
- DatePicker is intentionally single-date; no range/time/locale.
- Tooltip requires a focusable child unless the opt-in tab stop is used.
- Common table and paper-trading table remain two implementations; no visual regression baseline.
- Icon duplication is reduced by 11 re-exports; `components/common/Icons.tsx` still overlaps.
- Storybook catalog guard now builds and runs in the CI lint job; local runs still skip without a manifest.
- Axe is happy-dom only; real-browser contrast/focus/order is unverified.
- `Tree`/`Menu` keyboard contracts are being closed in the current wave.
- Screenshots are current only after the latest visual recapture; check commit dates before quoting them.
