# Design System Benchmark — 2026-11-23

**Subject:** `stock-screener-ui/src/ui` ("`@/ui`"), branch `feat/component-variations` @ `696fb937`
**Comparators:** Ant Design, GitHub Primer, Atlassian Design System, IBM Carbon
**Method:** source/palette/types/tests/`.storybook`/story catalog/docs read directly; no stories-only judgement. Read-only audit: no builds, servers, or source edits; only `find`, ripgrep-backed content search, and `git status`/`git log`.
**Evidence rule:** every claim below is tied to a file/line or a generated document. Where something cannot be proven from the repo it is marked **unknown**, not guessed.

---

## 1. Blunt verdict

**No — this is not at AntD / Primer / Carbon / ADS level.**

It is a **Tier 3 domain terminal primitive kit**: a genuinely well-governed, dark-first, dense, finance-specific component library with an unusually strong palette/guard discipline for an in-house project. It is **not** a general enterprise design system. The difference is not "missing components" — it is the absence of:

- a working theme/provider contract (`src/ui/theme.tsx:4-8` is a literal no-op stub: `uiTheme = {} as any`, `UIProvider` returns `props.children` and ignores both colour-scheme props);
- a form/validation model (no `Form`, no rules/schema; an `error` JSX element stringifies to `[object Object]` at `src/ui/inputs/TextInput.tsx:67-73`);
- i18n/RTL support of any kind (no i18n dependency in `package.json:41-83`, no `dir="rtl"`, no logical CSS properties in `src/ui`);
- an accessibility gate (a11y addon is manual only — `docs/DESIGN_SYSTEM_STORYBOOK.md:22-23`: "there is no axe gate in CI");
- a released, versioned design-system product (`package.json:4` says `0.1.0`, private, while repo release convention is `v0.2.0` per `AGENTS.md`; there is no `@alphashri/ui` package, no DS changelog, no deprecation policy);
- adoption evidence outside this single app (**unknown** — repo cannot prove cross-product adoption).

Storybook's 381 stories and `COMPONENT_AUDIT.md`'s 0 violations are real achievements, but they prove **catalog integrity and style-rule enforcement**, not enterprise maturity. AntD/Primer/Carbon ship a token pipeline, accessibility semantics as a contract, forms, i18n/RTL, visual regression, semver, and multi-product adoption. This kit ships excellent CSS variables, 79 component symbols, 44 co-located UI test files, and guard tests. That is a different tier.

**Honest tier map (1–4):**

| Tier | Definition | This repo |
|---|---|---|
| 1 | Ad-hoc CSS / one-off widgets | — |
| 2 | Shared component library | — |
| **3** | **Domain primitive kit + tokens + docs + guards** | **✔ here** |
| 4 | Enterprise design system (AntD, Primer, ADS, Carbon) | ✘ not here |

---

## 2. Scorecard (1–10)

| # | Dimension | Score | One-line justification | Closest AntD analogue |
|---|---|---:|---|---|
| 1 | Foundations / tokens | **7** | Single-source `palette.ts` (~417 lines, raw anchors → semantic aliases → CSS-var mirror in `tailwind.css:4-69`) plus real guards; no 3-tier seed/map/alias pipeline, no component-token tier, and `DESIGN.md` documents a stale, different palette. | `ConfigProvider` Design Token (seed/map/alias) |
| 2 | Component breadth | **5** | ~79 exported component symbols in `src/ui/index.ts:1-72`, but no Form, Table, Drawer, Pagination, Steps, Breadcrumb, DateRange, TreeSelect, Upload, Dropdown-button family. | AntD 60+ component catalog |
| 3 | Component API consistency | **4** | Mixed event-vs-value callbacks, divergent `variant` sets, `class` alias only on `Text`, Mantine compat props accepted-but-swallowed (`inputs/legacyProps.ts`), 8 `any` leaks in `types.ts`. | AntD `size`/`variant`/`onChange` prop conventions |
| 4 | Accessibility | **5** | Real roles on Tabs/Menu/Select/Switch/Alert, global focus ring (`tailwind.css:98-102`), reduced-motion CSS; but no axe gate, no Modal focus trap, error text not programmatically associated, close button uses `focus:outline-none`. | AntD `rc-*` a11y semantics + `@ant-design/tests` |
| 5 | Theming / light mode | **4** | `:root[data-color-scheme="light"]` overrides ~22 CSS vars (`tailwind.css:47-69`) and a shared scheme signal (`hooks.ts:142-169`); provider is a stub and `palette.ts` JS consumers (≈57 files) stay dark. | `ConfigProvider` + `theme.darkAlgorithm` |
| 6 | Motion | **6** | CSS-only transitions/flash/shimmer with `prefers-reduced-motion` in `tailwind.css:133`, `style.css:111,144`, `replayMotion.ts:42`; no central motion token or documented spec. | AntD motion presets / `rc-motion` |
| 7 | Density | **5** | Two-level, table-centred density module (`density.tsx`) with localStorage + CSS var; no app-wide compact/cozy component size. | `ConfigProvider.componentSize` + `Compact` |
| 8 | Forms / validation | **3** | `error` prop + native `required` only; no Form/rules/schema, no `aria-describedby`/`aria-invalid` wiring, JSX `error` → `[object Object]`. | AntD `Form` + `rules` + `Form.Item` |
| 9 | Data display | **5** | `TanStackTable`, Tree, Menu, Tabs, Accordion, Timeline exist; no virtualization in the common table (no `rowWindowSize`/virtual matches), two divergent table implementations (223 vs 632 lines). | AntD `Table` (virtual/pagination/sorter) |
| 10 | Overlays | **6** | Modal, Tooltip, Popover, Menu, Overlay, FloatingWindow, Notifications with Escape/backdrop handling; no focus trap, no Drawer, portal behaviour not uniform. | AntD Modal/Drawer/Popover/Tooltip/notification |
| 11 | i18n / RTL | **1** | No i18n library, hard-coded English in primitives ("Clear date", "dialog", "close", "Loading"), zero RTL/logical-property support. | `ConfigProvider locale` + `direction="rtl"` |
| 12 | Docs | **6** | Storybook 381 stories / 13 docs groups + audit + style rules; `docs/DESIGN.md` is factually stale vs palette, catalog is primitive-level only, no visual regression. | AntD component documentation site |
| 13 | Test strategy | **6** | 44 UI test files, 771 frontend test files, 62 E2E specs, 15 guard specs; 23 audited UI modules have no test, no a11y/visual CI gate, story guard skips when static build absent. | AntD unit + visual + a11y test matrix |
| 14 | Performance | **6** | Per-component chunks and a measured report (`perf/bundle-sizes.json`: 4,467.82 kB total, largest 494.75 kB ECharts); bundle enforcement is **warning-only** (`perf/budgets.json:33-34`), table virtualization absent. | AntD tree-shaking + bundle budgets |
| 15 | Versioning / release | **2** | App-internal, `package.json` version `0.1.0` and `private: true`; no DS package, semver contract, changelog, or deprecation policy. | AntD npm semver releases + migration guides |
| 16 | Adoption | **6** | `@/ui` is imported broadly across feature dirs (sector, options-paper, paper-trading, catalyst, etc.); duplicated primitives still in active use; cross-product adoption **unknown**. | AntD multi-product ecosystem adoption |

**Average: ≈ 4.8 / 10.** Strongest: tokens, docs/catalog, overlays, tests. Weakest: i18n/RTL, versioning, forms, API consistency, theming contract.

---

## 3. Specific evidence

### 3.1 Counts (from repo, not stories)

| Item | Count | Source |
|---|---:|---|
| `src/ui` non-test source files | 75 | `find src/ui -name '*.ts*' \| grep -v test` |
| `src/ui` co-located test files | 44 | `find src/ui -name '*.test.*'` |
| All frontend test files | 771 | `find src -name '*.test.ts' -o -name '*.test.tsx'` |
| E2E specs | 62 | `find tests/e2e -name '*.spec.ts'` |
| Guard specs in `src/test/` | 15 | `find src/test -type f` |
| Exported component symbols from `src/ui/index.ts:1-72` | ≈79 (manual count of value exports; incl. compound parts `TabsList`, `AccordionPanel`, `MenuDropdown` and the `Slider` alias) | `src/ui/index.ts` |
| Hook/utility exports | 9 (`useColorScheme`, `useTheme`, `useDebouncedValue`, `useMediaQuery`, `useTree`, `getTreeExpandedState`, `useDisclosure`, `cn`, `alpha`) + `rem` re-export | `src/ui/index.ts:74-86` |
| Type exports | ~70 (`types.ts` block at `index.ts:88-111`) | `src/ui/index.ts` |
| Story files | 92 total (13 in `src/stories/design-system/`, 79 under `src/stories/components/`) | `find src/stories -name '*.stories.tsx'` |
| Story entries / docs pages / imported component names | 381 / 92 / 147 | `docs/COMPONENT_AUDIT.md:9-11`; `docs/DESIGN_SYSTEM_STORYBOOK.md:10-12` |
| Audited modules (`src/ui` + `components/common`) | 99; 83 storied, 69 tested, 0 rule violations | `docs/COMPONENT_AUDIT.md:5,29-31` |
| UI modules in audit with **no** co-located test | 23, e.g. `Box`, `Flex`, `Stack`, `Center`, `Group`, `Paper`, `Portal`, `Divider`, `Tabs`, `Timeline`, `RingProgress`, `Popover`, `Tooltip`, `NavLink`, `AppShell`, `Avatar`, `CloseButton`, `ThemeIcon`, `notifications` | `docs/COMPONENT_AUDIT.md:74-137` |
| Docs markdown files | 90 in `docs/`, 27 at root | `find docs -maxdepth 1 -name '*.md'` |
| `any` leaks in public UI types | 8 (`types.ts:213,573,576,630,697,702,707,723`) | grep |

### 3.2 Token tiers

Present:
- Raw anchors + 14 dark colour scales (`palette.ts:19-44`).
- Semantic aliases (`POSITIVE/NEGATIVE/ERROR/WARNING/INFO`, border tokens `:46-77`).
- Derived surface ramp + contrast-aware heat stops (`SURFACES :95`, `RED_GREEN_HEATMAP_STOPS :245-255`).
- CSS variable mirror in Tailwind `@theme` (`tailwind.css:4-36`) plus a light override block (`tailwind.css:47-69`).
- Scale guards: radius/height/icon/type (`src/test/design-scale.test.ts`), contrast pairs (`src/test/contrast.test.ts`), single-source hex guard (`src/test/theme-single-source.test.ts`, `src/test/component-audit.test.ts`).

Missing:
- **Component-level token tier**: no `--button-primary-bg-hover`, `--input-error-fg`, etc.; components inline `bg-fin-*` classes and `paddingSize()` maps (`overlay/Modal.tsx:15-19`, `inputs/TextInput.tsx:15-25`).
- **Token algorithm/derivation layer**: no AntD-style seed→map→alias computation; `alpha()` is the only derivation helper.
- **Elevation/motion token tiers**: one `DIALOG_SHADOW` (`palette.ts:83`) and one `sxTheme.transitions.create()` returning the literal `"all 150ms ease"` (`sxTheme.ts:47-49`).
- **Dogfooding gap**: `src/test/design-scale.test.ts:132,157` explicitly skips `ui/` for the type and control-height scales — the kit is exempt from its own scale guards.
- **Doc drift**: `docs/DESIGN.md:12-22` documents `BG #0E1012`, `SURFACE #1A1D21`, red accent `#E11D2E`, green `#00C853`, and a "violet accent" (`DESIGN.md:4-5`) — none of which match `palette.ts` (`#000000`, `#13161C`, amber `#D9902A`, green `#2FA36B`). A new contributor following `DESIGN.md` ships the wrong palette.

### 3.3 Theming / light mode / i18n / RTL / SSR / forms / date / motion

- **Theming:** `src/ui/theme.tsx` is a 8-line stub. `UIProvider` accepts `defaultColorScheme`/`forceColorScheme` and ignores both. `useColorScheme` is a module-level signal that writes `data-color-scheme` on `<html>`/`<body>` and localStorage (`hooks.ts:126-169`); `index.html` duplicates the bootstrap, guarded by a parity test (`useColorScheme.test.ts:147-183`). Light CSS overrides exist only for the `fin-*` CSS variables. Runtime JS palette imports stay dark: ≈57 files import `@/ui/palette` / `sxTheme`, including charts (`pages/report/*`, `components/options-dock/analytics/*`, `pages/agri/*`). Storybook is explicitly dark-only with no toggle (`DESIGN_SYSTEM_STORYBOOK.md:22-25`). **Conclusion: light mode is partial and per-feature, not a theme contract.**
- **i18n:** no i18n dependency in `package.json`; hard-coded English UI strings in primitives (`dates/DatePicker.tsx:115,123`, `overlay/Modal.tsx:143,171`, `feedback/Alert.tsx:113`, `feedback/Loader.tsx:38-51`, `inputs/PasswordInput.tsx:190`). `Intl.*` usage found in the repo is number/date **formatting** (`config/currency.ts`, `utils/istChartTime.ts`), not translation.
- **RTL:** no `dir="rtl"`, no `direction: rtl`, no logical CSS properties (`margin-inline`, `padding-inline`, `inset-inline`, `text-start`, `text-end`) in `src/ui`. Physical classes (`leftSection`, `rightSection`, `absolute right-2`, `translateX`) are pervasive. Not supported.
- **SSR:** no `renderToString`, `renderToStream`, `@solidjs/start`, or hydration entry in `src/`; the only `hydrate()` calls are the app's saved-config store. It is a client-only SPA. Code has SSR guards (`density.tsx:52,61`) but no SSR implementation.
- **Forms:** no `Form`, `Field`, `FormItem`, rules, or schema library. Inputs forward native `required` and expose `error`; error text is a plain `<span>` with no `id`, no `aria-describedby`, and no `aria-invalid` on the control (`inputs/TextInput.tsx:126-157`). Non-string `error` (JSX) is rendered via `String(...)` → `[object Object]` (`TextInput.tsx:67-73`) despite the type allowing `JSX.Element` (`types.ts:346`).
- **Date/time:** `DatePicker` is a native `<input type="date">` with min/max/exclude (`dates/DatePicker.tsx:84-128`). The declared `valueFormat`, `weekendDays`, `getDayProps`, and `size` props (`types.ts:760-774`) are **not in `splitProps` and never read**. No range picker, time picker, timezone model, or locale. `dayjs` is used in app code (e.g. `components/paper-trading/tradeHistoryUtils.ts:1`), not by the DS.
- **Motion:** CSS-only flash (`tailwind.css:107-130`), shimmer and dropdown keyframes (`style.css:104-150`), reduced-motion blocks (`tailwind.css:133`, `style.css:111,144`, `replayMotion.ts:42`). No named motion tokens, no shared duration/easing scale beyond `sxTheme.transitions.create()` and ad-hoc `duration-150` classes. Reasonable for a trading terminal; not an enterprise motion system.

### 3.4 API inconsistencies (exact)

- `onClick` typed `(e: MouseEvent) => void` in `UIBaseProps:11`, but `() => void` in `UINavLinkProps:594`, `UIMenuItemProps:733`, `UICloseButtonProps:757`.
- `onChange` is a **value** callback for `TextInput`/`Select`/`Chip`/`SegmentedControl`/`DatePicker` (`types.ts:369,402,509,520,763`) but a **DOM event** callback for `Switch`/`Checkbox` (`types.ts:480,496`).
- `variant` vocabularies disagree: `Button` has 7 variants (`:299`), `Badge` adds `"dot"` (`:43-44`), `Alert` has 5 (`:246`), `ActionIcon` 6 (`:316`), `ThemeIcon` 5 (`:746`), `Chip` 3 (`:513`), `NavLink` 3 (`:591`).
- `size` is `UISize` on most components but `UISize | number | string` on `Loader`, `Progress`, `ActionIcon`, `Avatar`, `CloseButton`, `Modal`, etc.
- `class` is accepted only on `Text` (`types.ts:154-156`); every other primitive uses `className`.
- `title` is overloaded as a native tooltip on `Button`/`Badge`/`ActionIcon`/`Title`, while `Alert`/`Tooltip` use `label`/`title` semantically.
- `error` is `boolean | string | JSX.Element` on text inputs (`:346`) but `boolean | string` on Switch/Checkbox (`:488,502`).
- Mantine-era compat props are accepted but swallowed: `allowDeselect`, `maxDropdownHeight`, `comboboxProps`, `withinPortal`, `InputProps`, `dropdownOpened`, `limit` (`inputs/legacyProps.ts:9-17`; `types.ts:410-419,448-457,553-556`). The file comment even says "so React doesn't emit unknown-attribute warnings" — React-era residue in a Solid codebase.
- `FloatingWindow` is exported as a **default** re-export (`index.ts:62`) while every other component is named.
- `middlewares?: any`, `tree?: any`, `renderTarget?: (props: any)`, `[key: string]: any` in public types (`types.ts:573,702,723,697`).
- Tailwind safelist is required because tone classes are assembled at runtime (`tailwindSafelist.ts:1-5`) — a build-time workaround for runtime abstraction.

### 3.5 Accessibility gaps

Working: global `:focus-visible` ring (`tailwind.css:98-102`, asserted by `design-scale.test.ts:88-95`); `role="tablist"/"tab"/"tabpanel"` (`Tabs.tsx:97,149,174`); `role="menu"/"menuitem"` (`Menu.tsx:468,551`); `role="combobox"` + `aria-expanded` + listbox options (`Select.tsx:634-636,576,599`); `role="switch"` (`Switch.tsx:167`); `role="progressbar"` + accessible name (`Loader.tsx:50-51`); `role="alert"` (`Alert.tsx:86`); accordion `aria-expanded` (`Accordion.tsx:170`); focus restore on Modal close (`Modal.tsx:83,97`).

Gaps:
- `Modal` has **no focus trap** — it focuses the dialog and restores focus, but Tab can move into the background (`overlay/Modal.tsx:81-99`). Its close button uses `focus:outline-none` (`:174`), suppressing the global ring. Accessible name falls back to the literal `"dialog"` and the visible title is not linked with `aria-labelledby` (`:143`).
- Form errors are visual-only (no `aria-invalid`/`aria-describedby`) — `TextInput.tsx:126-157`; `textControls.test.tsx:176-187` proves pass-through works only when the caller supplies it.
- `Popover` declares `trapFocus` (`types.ts:571`) but focus trapping is not a universal overlay contract.
- No axe/WCAG gate in CI; addon-a11y is a manual panel (`docs/DESIGN_SYSTEM_STORYBOOK.md:22-23`). Contrast tests cover dark anchors only (`src/test/contrast.test.ts`); light-theme pairs are not in that matrix.
- 23 audited UI modules have no co-located test (§3.1).

### 3.6 Duplicated primitives (real, measurable)

| Concern | Competing implementations | Evidence |
|---|---|---|
| Icons | `src/ui/icons.tsx` (210 lines) vs `src/components/common/Icons.tsx` (264 lines) | both exported/used; audit lists both as storied |
| Range slider | `src/ui/inputs/RangeSlider.tsx` (343 lines) vs `src/components/common/RangeInput.tsx` (139 lines) | both exported and storied under different groups with different APIs |
| Date picker | `src/ui/dates/DatePicker.tsx` (129 lines) vs `src/components/common/TradingDatePicker.tsx` (76 lines) | both exported in the catalog |
| Table | `src/components/common/TanStackTable.tsx` (223 lines) vs `src/components/paper-trading/TanStackTable.tsx` (632 lines) | grep found no `rowWindowSize`/virtual usage in the common table; paper-trading table has `ROW_ESTIMATED = 23` |
| Modal/dialog | `src/ui/overlay/Modal.tsx`, `components/common/PanelModal.tsx`, `components/common/preview/ExpandedPanel.tsx`, `pages/report/LocalPanelModal.tsx` | four hand-rolled centring overlays with `translate(-50%,-50%)` |
| Empty/loading states | `src/ui/feedback/Skeleton.tsx` vs `components/common/states.tsx` (`EmptyState`, `InlineLoader`) vs `TableEmptyState`/`TableLoadingState` | catalog groups them separately |

Also note `src/components/paper-trading/TanStackTable.tsx` and `src/components/common/TanStackTable.tsx` have different feature sets — a consumer's choice of table changes keyboard/sorting/density behaviour.

### 3.7 Performance / release evidence

- `perf/bundle-sizes.json`: 200 chunks, **4,467.82 kB** total uncompressed JS; largest chunk `echarts-charts` **494.75 kB**, followed by `lightweight-charts.development` 348.24 kB and `assets/ui-*` **147.9 kB** (the DS core chunk). The DS is not the bundle villain; charting is.
- `perf/budgets.json:32-43`: `enforcement: "warning-only"`, largest chunk budget 520 kB, total 4,800 kB. Both budgets are currently *under* the limits — but neither gates CI.
- `package.json:4`: `"version": "0.1.0"`, `"private": true`. `AGENTS.md` documents releases `v0.1.0`/`v0.2.0` for the **app**, not a DS package. No DS changelog, no migration guides, no deprecation timetable.

---

## 4. Top 12 gaps, ranked (real user impact first)

| # | Pri | Gap | Exact files / paths | Smallest high-value fix |
|---:|---|---|---|---|
| 1 | **P0** | Theme provider is a no-op and JS palette never flips in light mode; toolbar toggle paints CSS but charts/states stay dark. | `src/ui/theme.tsx:4-8`, `src/ui/hooks.ts:126-169`, `src/tailwind.css:47-69`, `src/ui/palette.ts`, ≈57 palette importers | Make `UIProvider` actually apply `defaultColorScheme`/`forceColorScheme`; add one `useTokenColor('primary' \| 'surface' \| …)` accessor that reads `getComputedStyle(var(--color-fin-*))`, and migrate the top 5 chart ink modules. Add a guard asserting every dark `fin-*` var has a light override. |
| 2 | **P0** | Form errors are inaccessible and JSX errors render as `[object Object]`. | `src/ui/inputs/TextInput.tsx:67-73,126-157`; same pattern in `NumberInput`, `Select`, `MultiSelect`, `Textarea`; `src/ui/types.ts:346` | Render `error` as JSX (not `String()`), add `id={resolvedId + '-error'}` to the helper span, set `aria-describedby` and `aria-invalid` on the input; fix the 5 inputs in one pass with a shared helper. |
| 3 | **P0** | Modal is not keyboard-contained; its close button removes the focus ring. | `src/ui/overlay/Modal.tsx:81-99,141-175` | Add a `keydown` Tab-cycle over focusable descendants inside the dialog; delete `focus:outline-none` from the close button; link title via `aria-labelledby`. |
| 4 | **P1** | DatePicker silently ignores 4 declared props and ships hard-coded English; no range/time/locale. | `src/ui/types.ts:760-774` vs `src/ui/dates/DatePicker.tsx:29-43,84-128` | Remove `valueFormat`/`weekendDays`/`getDayProps`/`size` from the type (or implement them); add a `labels={{ clear, invalid }}` prop; state "single date only" in docs so callers stop expecting Mantine parity. |
| 5 | **P1** | Design documentation contradicts the implemented palette; contributors will ship wrong colours. | `docs/DESIGN.md:1-56` vs `src/ui/palette.ts:19-52`, `src/tailwind.css:6-35` | Regenerate the token table from `palette.ts` (one small script) and add a guard test asserting every `DESIGN.md` hex appears in `palette.ts`. |
| 6 | **P1** | No automated accessibility gate; manual a11y panel only. | `.storybook/main.ts:7`, `docs/DESIGN_SYSTEM_STORYBOOK.md:22-23`, `src/test/contrast.test.ts` | `axe-core` is already transitively installed; add 5 `vitest-axe` smoke tests (Modal, Select, Tabs, DatePicker, Button) and a CI reporter — start non-blocking, then gate. |
| 7 | **P1** | Public API carries swallowed Mantine props and 4 different callback conventions. | `src/ui/inputs/legacyProps.ts`, `src/ui/types.ts:11,298-325,335-340,410-419,448-457,553-556,582-597,733,757` | Mark legacy props `@deprecated`, stop adding new ones, and add a type-level test that `onClick` is a DOM event everywhere; normalise boolean/value `onChange` in one RFC before the next major. |
| 8 | **P1** | Six duplicated primitive families with divergent behaviour. | `src/ui/icons.tsx` ↔ `components/common/Icons.tsx`; `ui/inputs/RangeSlider.tsx` ↔ `common/RangeInput.tsx`; `ui/dates/DatePicker.tsx` ↔ `common/TradingDatePicker.tsx`; `common/TanStackTable.tsx` ↔ `paper-trading/TanStackTable.tsx`; 4 hand-rolled modal panels; Skeleton ↔ states.tsx | Declare one winner per pair this sprint and turn the loser into a 5-line re-export wrapper; delete the extra centring logic. No new components. |
| 9 | **P1** | Core table has no virtualization; docs claim it does. | `src/components/common/TanStackTable.tsx` (no virtual matches), `src/stories/components/app/PaperTradingTable.stories.tsx:98`, `docs/DESIGN.md:69` | Either implement windowing (`@tanstack/solid-virtual`) or change `docs/DESIGN.md` and the story note to say "not virtualized — cap rows upstream"; add a 5k-row render benchmark before choosing. |
| 10 | **P2** | No copy-injection path, so every locale/RTL effort must fork primitives. | hard-coded strings in `dates/DatePicker.tsx:115,123`, `overlay/Modal.tsx:143,171`, `feedback/Alert.tsx:113`, `feedback/Loader.tsx:38-51`; physical `left-`/`right-` classes across `src/ui` | Add a small `labels` prop bag to the 5 string-bearing primitives and replace `left/right` with `start/end` aliases in compound parts. Full i18n/RTL remains explicitly out of scope. |
| 11 | **P2** | Performance and scale gates are advisory; the kit is exempt from its own guards. | `perf/budgets.json:32-43`, `src/test/design-scale.test.ts:132,157` | Flip bundle enforcement to error after a baseline week; remove the two `rel.startsWith("ui/")` skips and fix the offenders (or record dated exceptions). |
| 12 | **P2** | No DS release contract and meaningful coverage gaps. | `package.json:2-4`, `docs/COMPONENT_AUDIT.md:29-31`, `src/test/storybook-catalog.test.ts:19-32` (guard skips without static build) | Create a `@alphashri/ui` workspace package with semver + CHANGELOG + deprecation policy; add tests/stories for the 16 untested/unstoried primitives from the audit inventory; make the catalog guard fail (not skip) in CI by building Storybook there. |

---

## 5. 30 / 60 / 90-day plan to a credible enterprise tier

### Days 0–30 — Make the existing contract honest (P0s + doc truth)
- Ship gaps 1–3: real provider + token accessor, form error semantics, Modal focus containment.
- Ship gap 5: regenerate `docs/DESIGN.md` from `palette.ts`; add the guard.
- Add the axe smoke suite from gap 6 as a **report-only** CI job; record the baseline count.
- Publish a one-page "Support matrix" in `docs/`: dark + light CSS-var theme, single-language, LTR only, client-only SPA, no visual regression yet. Mark RTL/SSR/i18n **not supported** rather than silent.
- Exit gate: all `src/ui/` tests green, 0 new axe violations vs baseline, theme toggle verified in both schemes in the real app at 1600 and 390.

### Days 31–60 — Consolidate and prove (API, duplicates, coverage)
- Ship gaps 4, 7, 8, 9: trim DatePicker's false API, deprecate/remove legacy props with a codemod, one winner per duplicated family, virtualize or honestly de-scope the table.
- Add tests/stories for the 23 untested and 16 unstoried primitives from `COMPONENT_AUDIT.md`.
- Remove the `ui/` exemptions in `design-scale.test.ts`; make the Storybook catalog guard mandatory in CI.
- Introduce the `labels` prop bag (gap 10) — this is what makes future i18n a translation-file change, not a component fork.
- Turn axe from report-only into a blocking gate; collect a full week of bundle measurements.
- Exit gate: API RFC approved, duplicate count halved, a11y gate blocking, coverage of `src/ui` modules raised from 69/99 to ≥90/99.

### Days 61–90 — Earn the "enterprise" label
- Publish `@alphashri/ui` as a versioned workspace package (semver, CHANGELOG, peer deps, deprecation policy) — gap 12.
- Flip bundle budgets to errors and add per-route budgets — gap 11.
- Add visual regression: Playwright screenshots of catalog stories at 1600/390 for every primitive state (the repo already has Playwright and a static Storybook; no new platform needed).
- Document a migration guide from v0 → v1 (legacy props, DatePicker, table). Run the benchmark again and publish the scorecard.
- Decide explicitly (and document) that full ICU i18n and SSR are **out of scope for a terminal tool**; do not leave them as vague "later" items.
- Target scores at day 90: tokens 8, API 7, a11y 8, forms 7, theming 7, docs 8, versioning 6; overall ≈6.5/10 — a credible Tier 3+ / entry Tier 4, not AntD parity, and that is the right goal for a domain terminal kit.

### What NOT to copy from AntD
1. **Do not copy the seed→map→alias token algorithm.** Flat CSS variables with 22 light overrides are simpler, debuggable, and already work. AntD's theme engine exists for dozens of themes; we have two.
2. **Do not chase component count.** Adding Drawer/Steps/Breadcrumb/Upload to "match 60+" would dilute a finance-terminal kit. Breadth is not the missing tier; contracts are.
3. **Do not copy the bundle weight.** AntD + rc-* + icon packages are large; our largest chunk is ECharts (494.75 kB), not the DS (147.9 kB). Keep per-component chunks, zero runtime theme JS, no moment/lodash-class dependencies.
4. **Do not copy `rc-motion` choreography.** CSS-only transitions plus `prefers-reduced-motion` are correct for a terminal rendering live tick data; spring physics and coordinated enter/leave sequences add cost without user value here.
5. **Do not copy wrapper-heavy APIs** (`Form.Item`, `getPopupContainer` prop drilling, deep `rc-` abstraction layers). The kit already carries Mantine-era swallow-props debt; adding another abstraction layer makes gap 7 worse.
6. **Do not copy "one JS theme object for everything."** The current split (CSS vars for paint, JS palette for charts) is only half-broken because JS consumers don't flip. Fix that seam with a CSS-var accessor; don't duplicate AntD's runtime token engine.

---

## 6. PR-ready scorecard

| Dimension | Score | Dimension | Score |
|---|---:|---|---:|
| Foundations / tokens | 7/10 | Data display | 5/10 |
| Component breadth | 5/10 | Overlays | 6/10 |
| API consistency | 4/10 | i18n / RTL | 1/10 |
| Accessibility | 5/10 | Docs | 6/10 |
| Theming / light mode | 4/10 | Test strategy | 6/10 |
| Motion | 6/10 | Performance | 6/10 |
| Density | 5/10 | Versioning / release | 2/10 |
| Forms / validation | 3/10 | Adoption | 6/10 |

**Verdict line:** *Tier 3 domain terminal primitive kit (avg 4.8/10) — strong tokens/guards/catalog, but no real theme contract, form model, a11y gate, i18n/RTL, or versioned DS product. Not AntD parity; 30/60/90 plan targets ≈6.5, not imitation.*

---

## 7. CRED NeoPOP reference

Cloned `https://github.com/CRED-CLUB/neopop-web` (Apache-2.0) into `/tmp/opencode/neopop-web` for comparison.

**What NeoPOP is:** CRED's open-source web expression of its design language. It is **16 components** (Button, Card, Typography, Tag, Back, Header, Toggle, Radio, Checkbox, InputField, SearchBar, BottomSheet, Dropdown, ScoreMeter, Slider, Toast, plus layout helpers), **19 Storybook pages**, no test suite, React 17 + styled-components, and a 2022-era Storybook. It is a **visual identity kit**, not an enterprise engineering system.

**What it does better than us:**
- **Token layering**: `mainColors` → `colorPalette` (100–800 ramps) → `colorGuide.darkComponents/lightComponents` → component config. We have anchors + semantic aliases, but no component-token tier.
- **Theme maps as first-class data**: every component reads dark/light component tokens; theme switching is a real mode, not a CSS-only partial.
- **A distinct physical language**: elevated buttons with a 3px extruded edge, 45° skew faces and press translation; the design has personality rather than generic rounded rectangles.
- **Motion as product language**: spring/gesture motion for sheets and toggles, not just loading spinners.
- **Public primitives boundary**: exports `/components`, `/primitives`, `/hooks`, `/utils` as separate package entry points.
- **Playground**: an interactive docs surface that shows variants instead of only API tables.

**What we do better:**
- breadth (79 exported UI symbols vs 16), tests (44 UI test files, 771 frontend tests vs none), accessibility roles, token guards, catalog integrity, table/data primitives, and a real app integration.
- We already have 10-step scales (`SCALE_*`), semantic border tokens, light CSS-variable overrides, and contrast tests. CRED does not have our guard suite.

**What to adopt, not copy:**
1. Add the missing **component-token tier** (`--button-primary-bg`, `--input-error-fg`, etc.) above the semantic tokens.
2. Make **theme maps explicit and testable** for both schemes; stop mixing static JS dark hex with CSS-var light mode.
3. Give **primary controls a subtle press/elevation response** (cheap transform/box-shadow, not NeoPOP's full 3D edge) so buttons feel deliberate.
4. Add a **motion token scale** (`fast 120ms`, `base 180ms`, `slow 240ms`, standard easing) and use it.
5. Keep the **playground/catalog** we have; add a real variant playground to each component page where useful.

**What not to copy:** the 3D skew edges (too loud for a trading terminal), React/styled-components runtime, the tiny component count, the missing tests/a11y, and the 2022 build stack.

**Bottom line:** NeoPOP has stronger **identity and theme maps**; ours has stronger **engineering, accessibility and breadth**. The right move is to borrow its token/theme discipline and tactile confidence, not its implementation.

---

## 8. Unknowns (not inferred)

- Real runtime appearance of light mode (no screenshots or builds were run; CSS override block exists but was not visually verified).
- Actual WCAG conformance (no axe run; manual a11y panel only).
- Frontend coverage percentage, test pass counts, bundle numbers after this branch's changes (no builds/tests run; `perf/bundle-sizes.json` is a checked-in report of unknown age).
- Cross-product / multi-team adoption and consumer satisfaction outside this repository.
- Browser support matrix and target viewport/assistive-technology policy — not documented in `docs/`.
- Whether the checked-in `storybook-static/index.json` matches current stories after commit `696fb937` (catalog guard skips without a fresh build; the doc claims 381 stories / 92 docs from the generated audit).
