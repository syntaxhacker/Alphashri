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
- `Select`/`MultiSelect` no longer accept `allowDeselect`, `maxDropdownHeight`, `comboboxProps`, `withinPortal` or `InputProps` (`@ts-expect-error` tests in `legacyProps.test.tsx` assert they are absent); Tooltip's `withinPortal` is gone too. `legacyProps.ts` is now only a defensive strip for force-cast callers of Text/Number/Password (`LEGACY_INPUT_PROP_KEYS`). `InputProps` has been removed from every public input type and from that strip — callers must not pass it at all, so no swallowed-prop debt remains.
- Automated a11y is no longer happy-dom-only: `src/test/a11y-smoke.test.tsx` runs in vitest and `node scripts/storybook-a11y.mjs` runs axe-core in real Chromium over representative stories (serious/critical fail the job). Scoped UI coverage (`bun run test:coverage:ui`), the Storybook catalog guard (after a CI Storybook build) and `design-scale.test.ts` (no `ui/` exemption) also run in CI. Local catalog-guard runs still skip without a built manifest.
- Real-browser gates now cover **30 axe stories** (all 13 family landings + 3 overlay playables + 5 component representatives + 9 newly pinned visible states, including NavLink) and **10 keyboard walkthroughs**: Modal, Tree, Menu, horizontal/vertical Tabs, Popover, Tooltip, modal FloatingWindow and NavLink (native-button Enter/Space activation, disabled inert, href stays an anchor), plus the original modal dismissal case.
- Typography has one tier: `src/ui/typography.ts` + `--text-ui-*` in `tailwind.css`, with a 12px hard floor, a 12/13/14/16/20/24 ladder and `uiTheme.fontSizes` aliases. The migration is complete: `node scripts/typography-audit.mjs` reports **0 private size declarations** across non-test/non-story source; `design-scale.test.ts` rejects any new one, and `audit:typography:check` is a CI step. The report now derives `REPORT_FONT` from the same scale (12/13/16/24), and every family/component showcase was recaptured at 1600 and 390.

Still open — keep the A+ verdict honest:

- **Token contract (dark-only).** With one colour scheme, static semantic palette imports are the intended contract; `tokenColor`/`useTokenColor` exist for the cases that must read a computed CSS variable. The guard is the absence of raw hex outside `palette.ts` (asserted by `theme-single-source.test.ts`), not call-site counts. This is a scope correction, not a claim that every chart was migrated to a runtime accessor.
- **API callback conventions (resolved).** `onChange` is value-based across the input family, including `Checkbox`/`Switch`/`Chip` (`boolean`); `onClick` is the `UIBaseProps` `MouseEvent` handler on every control, including `NavLink`, `Menu.Item` and `CloseButton`. No void overrides remain — reopen this only with a new independent rating.
- **Visual regression baseline.** Browser axe now covers **30 stories** including rendered contrast, and the keyboard walkthrough covers **10 interactions**; `docs/COMPONENT_AUDIT.md` reports **100 audited modules, 96 story files / 403 story entries, 88/100 modules with a story, 100/100 with a co-located test and 0 violations** (modules with no standalone story are composition-only helpers documented in `docs/COMPONENT_AUDIT_EXCEPTIONS.md`). It does not yet pass a pixel assertion: the automated 1600/390 image-diff harness (`scripts/visual-regression.mjs`, `bun run visual:test`, plus the `Verify Storybook visual baseline` CI step added in `ff939b9a`) now exists, but its 12 baseline PNGs (6 stories × 2 viewports) are still pending generation by the main agent, so the gate is configured, not green. The Storybook showcase is captured full-page (`scripts/storybook-showcase.mjs`), but the app-route evidence is **viewport-only** (`fullPage: false`) at 1600×1000 / 390×844 by `tests/e2e/design-evidence.spec.ts`, which reproduces the checked-in `docs/screenshots/app/report-{1600,390}.png` when run with `SCREENSHOT_EVIDENCE=1`.
- **Coverage is scoped, not universal.** `docs/COMPONENT_AUDIT.md` reports **100 audited modules, 96 story files / 403 story entries, 88/100 with a story, 100/100 with a co-located test, 0 violations**; the 12 modules without a standalone story are context providers, error boundaries, chart adapters and similar composition-only helpers listed in `docs/COMPONENT_AUDIT_EXCEPTIONS.md`. "story: yes" means one exported name is imported, not that every state is reviewed.
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

The P1 set driving the current wave: primitive rem size aliases (now fixed — `Text/Title/Anchor/List` resolve through `TYPE_CLASS` on the shared scale), event-vs-value input callbacks (now fixed — value-based `onChange`, event-based `onClick`), void `onClick` overrides (now fixed — `NavLink`/`Menu.Item`/`CloseButton` inherit `UIBaseProps.onClick`), swallowed legacy props (now fixed — `InputProps`, Select compat props and Tooltip `withinPortal` are gone from every public type), vertical Tabs keyboard, Menu/Popover disclosure ARIA, missing primitive tests, and an advertised-but-unimplemented Tabs/overlay prop surface. This section is superseded only by a new independent rating, never by implementer self-scoring.

## P5 evidence (2026-11-23)

| Check | Result |
|---|---|
| `bun run typecheck` / `bun run lint` | 0 errors / 0 warnings |
| Typography audit | 0 private declarations; 12px floor clean |
| Frontend suite | 11,968 passed, 1 fixed theme assertion; the only remaining worker error is a pre-existing `PatternsPage.test.tsx` fork OOM (reproduced on the pre-typography commit) |
| Production build | clean (198 chunks) |
| Storybook build + catalog | clean |
| Browser axe (30 stories) | 0 serious/critical violations |
| Screenshots | `docs/screenshots/showcase/` recaptured full-page at 1600/390 with focus-ring proof (`scripts/storybook-showcase.mjs`); Index Report app route captured **viewport-only** (`fullPage: false`, 1600×1000 / 390×844) by `tests/e2e/design-evidence.spec.ts` into `docs/screenshots/app/report-{1600,390}.png` — reproduce with `SCREENSHOT_EVIDENCE=1 npx playwright test tests/e2e/design-evidence.spec.ts`; the 1600/390 pixel-diff harness and CI step landed in `ff939b9a`, but its 12 baseline PNGs are still pending generation by the main agent, so that gate is not green |
| Browser keyboard | 10/10 (Modal, Tree, Menu, horizontal/vertical Tabs, Popover, Tooltip, modal FloatingWindow, NavLink, modal dismissal) |
