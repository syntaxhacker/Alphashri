# Options paper / replay — UX evidence audit

**Scope:** dock PAPER ORDER band (`src/components/options-paper/PaperOrderBand.tsx`), positions modal/table
(`src/components/options-paper/OptionPositionsPanel.tsx`, mounted at
`src/components/options-dock/OptionsDockPanel.tsx:1056-1064`), and the options replay page
(`src/pages/options-replay/ReplayPanel.tsx`, `replayCharts.ts`, `OptionsReplayPage.tsx:14-20`).

**Audited against:** `UI_RULES.md`, `UI_CHECKLIST.md`, `docs/COLOR_SEMANTICS.md`,
`/home/mysyntax/Documents/Alphashri/TABLE_CHECKLIST.md`, `docs/SCREENSHOT_EVIDENCE.md`.

> Line numbers are a working-tree snapshot from 2026-11-22. `ReplayPanel.tsx` was being edited by
> another lane during this audit (motion wiring landed mid-read); re-check the cited lines before
> acting on an issue. This document and `tests/e2e/options-paper-visual.spec.ts` are the only files
> owned by this lane — no source, state, style or shared mock was touched.

**Companion evidence harness:** `tests/e2e/options-paper-visual.spec.ts` writes 16 PNGs to
`/tmp/opencode/options-paper-shots` (8 states × 1600×900 / 390×844). Main agent runs it and reads
the PNGs back; this lane did **not** run Playwright.

---

## 1. Dock PAPER ORDER band

Mounted once, inside the dock column, at `src/components/options-dock/OptionsDockPanel.tsx:979`.
The band itself is `PaperOrderBand.tsx:150-263`.

| Check | Result | Evidence |
|---|---|---|
| One border per section | **PASS** | `DockSection.tsx:41-45` gives the outer section exactly one `border-t`; header is a 22px tinted strip (47-51); body is a padded flex column (75-78). No second border inside the band. `PaperOrderBand.tsx:151-156` passes only `title`/`testId`/`headerTestId`/`meta`. |
| `ToolbarRow` for control rows | **PASS** | `PaperOrderBand.tsx:157` (three inputs), `:204` (debit/costs), `:234` (two buttons). All use shared primitive; `ToolbarRow.tsx:31-43` forces `align-items:center` + explicit `gap`. |
| No nested bordered cards | **PASS** | Inputs are wrapped in plain `Box` flex cells (`PaperOrderBand.tsx:158,174,188`), badges/errors are `Badge`/`Alert`, no `Card`/`Paper`/`CompactPanel` inside the section. |
| `@/ui` components only; no `styles={{…}}`; `className` (not `class`) on `@/ui` Text | **PASS** | Import at `PaperOrderBand.tsx:3` (`Alert, Badge, Box, Button, NumberInput, Select, Text, ToolbarRow`). All `Text` uses carry `className` (`:159,175,189,205,209,215,221,258`). No `styles=` match anywhere in `src/components/options-paper/`. |
| Palette single source / `alpha()` / contrast / no raw hex | **PASS** | No `#RRGGBB`/`rgba(` in `src/components/options-paper/`. `Badge color="info" variant="light"` (`:155`) and `Alert color="error" variant="light"` (`:228`) get token + 10% tint from `Alert.tsx:71-75`/`Badge` (see `COLOR_SEMANTICS.md:48-52`). `c="warning"` at `:215` is a valid `TONE_CLASS` key (`Text.tsx:18-28`). |
| Control heights / type floor / 8pt grid | **PASS (with inherited note)** | All controls `size="xs"` (`PaperOrderBand.tsx:161,177,191,235,246`) → 24px (`Select.tsx:157-162`); `Text size="xs"` = 12px (`Text.tsx:6-12`), above the 9px floor. `w="100%"` inside `flex-1 min-w-0` cells (`:158-201`) resolves to width:100% (`Select.tsx:224-226,245-255`) — intentional, not accidental full-width. `ToolbarRow gap={4}` (`:157,234`) is 4px dense spacing. `DockSection.tsx:76-78` uses `py-1.5` (6px) — inherited 6px slop, not introduced by this band. |
| Empty / loading / error distinguishable | **PASS** | Loading `paper-order-loading` (`:220-224`), error `paper-order-error` (`:226-232`), conditional margin warning `paper-order-margin-warning` (`:214-218`), limit explanatory text (`:257-261`). Distinct testids and surface types. |
| Reduced motion / keyboard parity | **PASS** | Every input is a native/`@/ui` control with `aria-label` (`:171,185,199`); both buttons are native `Button` with `data-testid` (`:241,251`). No bespoke animation in this band. |
| 1600 / 390 expectations | **PASS (to be confirmed by PNG)** | At 1600 the three inputs share the narrow dock rail via `flex-1 min-w-0` (`:158,174,188`); at 390 the dock is a 62vh bottom sheet (`options-dock.spec.ts:398-445`) and the band sits in its scroll container. `REPLAY THIS STRUCTURE` (`:253`) is the longest label; it is the label most likely to clip in a narrow rail. |

## 2. Positions modal + table

Modal: `OptionsDockPanel.tsx:1056-1064`. Panel: `OptionPositionsPanel.tsx:30-197`. Table: shared
`TanStackTable` (`TanStackTable.tsx:24-190`).

| Check | Result | Evidence |
|---|---|---|
| One border per section / no nested bordered cards | **PARTIAL — issue 5** | `Modal.tsx:149` draws a border on the dialog panel; `TanStackTable.tsx:169-179` draws a second border on its `Paper` container. Two nested hairlines around one table. `OptionPositionsPanel.tsx:155-158` itself is borderless (good). |
| `ToolbarRow` for control rows | **N/A** | No control rows in this surface (table only). |
| `@/ui` components only; no `styles={{…}}`; `className` on `Text` | **PASS** | Import `OptionPositionsPanel.tsx:2` (`Badge, Box, Text`); all `Text` uses `className` (`:53,54,103,113,125,149`). No `styles=` in `src/components/options-paper/`. `PnlText` for signed P&L (`:8,137`). |
| TanStackTable + explicit `meta.align`; wrapper matches | **PASS** | All 8 columns set `meta.align`: `:49 left`, `:62 center`, `:78 center`, `:100 left`, `:110 right`, `:122 right`, `:134 right`, `:146 right`. Header uses it (`renderers.tsx:59`); cell `text-align` and `text-${dir}` class derive from it (`columns.ts:99,115,122`). `dense` at `:187` → 18px rows, 10px font (`TanStackTable.tsx:35-38`). Row click/keyboard at `renderers.tsx:119-120`. |
| Palette single source / contrast / no raw hex | **PASS** | No hex/rgba literals in `src/components/options-paper/`. `Badge variant="light"` for BOOK/STATUS (`:65-72,81-94`); `PnlText` → semantic success/error. Status token mapping reuses `success`/`warning`/`neutral` (`:84-89`), not invented colours. |
| ECharts containers / ScrollArea | **N/A** | No charts here. The table's own `ScrollArea` (`TanStackTable.tsx:93-96`) is correct — ECharts must never be in one. |
| Control heights / type floor / 8pt grid | **PASS** | `TableColumnDef.size` values (`:50,63,79,101,111,123,135,147`) are column widths, not control heights. Cells use `size="xs"`/10px dense font. |
| Empty / loading / error distinguishable | **PASS** | `option-positions-error` ErrorAlert (`:159-167`), `option-positions-loading` InlineLoader (`:169-171`), `option-positions-empty` EmptyState (`:173-179`), table only when rows exist (`:181-194`). Mutually exclusive via `Show` guards. |
| Reduced motion / keyboard parity | **PASS** | No motion. Rows are focusable with Enter/Space (`renderers.tsx:119-120`); modal has Escape + close button (`Modal.tsx:81-99,168-178`). |
| 1600 / 390 expectations | **PARTIAL — issue 8** | `Modal size="lg"` → `max-w-lg` = 512px (`Modal.tsx:7-13,101-108`); fixed column widths sum to **924px** (`OptionPositionsPanel.tsx:50,63,79,101,111,123,135,147`). Horizontal scroll is mandatory at both viewports. `TanStackTable.tsx:93-96` provides it, but there is no visible "scroll →" affordance. |

## 3. Options replay page

`OptionsReplayPage.tsx:14-20` mounts `ReplayPanel` inside `CompactPage`. Panel body: `ReplayPanel.tsx:181-359`.
Charts: `replayCharts.ts:20-95` (path), `:98-172` (payoff). Motion presets: `replayMotion.ts:22-61`.

| Check | Result | Evidence |
|---|---|---|
| One border per section / ToolbarRow / no nested bordered cards | **PASS** | Root div is borderless (`ReplayPanel.tsx:182`); two sibling `CompactPanel`s (`:227,324`), each with one border (`compact.tsx:129-142`) and an internal header divider (`compact.tsx:155-166`), not nested. Control rows use `ToolbarRow` at `:183,228,346`. |
| `@/ui` components only; no `styles={{…}}`; `className` on `@/ui` Text | **PARTIAL** | Imports `@/ui` at `:2`; `Text` uses `className` (`:188,264,281,318,353`). No `styles=` in `src/pages/options-replay/`. However `:182,184,192,286,287,296` use raw `<div class=…>` where `@/ui Box` would be consistent — legal but drifts from the local-kit convention. Not a runtime defect. |
| TanStackTable + `meta.align` | **N/A** | No table on this page. |
| Palette single source / `alpha()` / contrast / no raw hex | **PASS, one token error — issue 2** | No hex/rgba in `src/pages/options-replay/`. `replayCharts.ts:1` imports palette; area fills use `palette.POSITIVE/NEGATIVE` with opacity (`:61,70,138,147`) and no text painted on them. `tone()` uses palette tokens (`ReplayPanel.tsx:32-33`). `c="warning.main"` at `:281` is **not** a `TONE_CLASS` key (`Text.tsx:18-28`) and not a literal colour (`Text.tsx:31-33,79`) → falls back to inherited ink. |
| ECharts explicit dimensions, not in ScrollArea | **PASS (caveat — issue 7)** | `ReplayPanel.tsx:289-294` and `:298-303` set `style={{ height: "220px" }}` + `w-full min-w-0`; `createECharts` observes resize (`echartsSolid.ts:53-59`). Containers sit directly in `CompactPanel` (`:227`), whose default `scrollable=false` (`compact.tsx:120`) → no `ScrollArea`. Caveat: fixed 220px inside a flex column (`ReplayPanel.tsx:286-305`) contradicts `UI_RULES.md §4` ("never a fixed height inside a flex panel"). |
| Control heights / type floor / 8pt grid, fullWidth vs `w` | **PARTIAL — issue 3** | `size="xs"` on Button/Select (`:230,241,348`) → 24px floor; `w={84}` explicit on speed Select (`:242`). But `:248-261` is a raw `<input type="range" class="w-full">` with no height token, inside a `ToolbarRow` that defaults to `wrap: true` (`ToolbarRow.tsx:35`). At 390 the cluster Button + Select(84) + `w-full` slider + clock + badge cannot fit one line. |
| Empty / loading / error distinguishable | **FAIL — issue 1** | Testids exist and are mutually exclusive: `replay-error` (`:208-212`), `replay-loading` (`:213-215`), `replay-empty` (`:217-226`). But `error()` folds three distinct causes into the **same** `replay-error` Alert: commit failure, fetch failure, and `result()?.skipped` (`:166`). An expired position (skipped, zero frames) is visually identical to an HTTP failure. The COMMITTED badge (`:193-201`) stays visible while the committed note (`:352-356`) is hidden, because the whole body is behind `when={result() && frames().length > 0}` (`:218`). |
| Reduced motion / keyboard parity | **PASS, one gap — issues 2/6** | `replayMotion.ts:22-35` carries `motion-reduce:*` variants; `reducedMotionClass()` (`:59-61`) is a JS gate; wired at `ReplayPanel.tsx:171-179` and applied at `:197,264,273,292,301,308-315,348,353`. Charts set `animation:false` (`replayCharts.ts:29,113`). Speed Select and scrubber have `aria-label` (`:246,260`); rows/buttons are native. Play button text is glyph-only (`:237`) with no `aria-label`. |
| 1600 / 390 expectations; most likely overflow | **390 replay preview/mid-scrub is the risk state** | 1600: charts go two-up at `min-[1100px]` (`:286`), stats are 4-up (`:307`). 390: charts stack (`:286`), but `CompactStatGrid cols={4}` (`:307`) gives ~90px per stat and `cols={2}` (`:325`) gives ~180px per leg stat; the leg value string `"12.50 → 13.60 · +₹82.50"` (`:337`) has no `truncate`/`lineClamp` in `CompactStat` (`compact.tsx:280-293`). Combined with the wrapping control row (issue 3), **replay preview at 390 during a mid-scrub is the state most likely to overflow or clip**. Empty/error states are short and should fit both viewports. |

---

## Prioritised issues (at most 8 — proposed fixes only, not implemented)

1. **P1 — expired is indistinguishable from an API error, and its committed note disappears.**
   `src/pages/options-replay/ReplayPanel.tsx:166` merges `result()?.skipped` into `error()`; `:208-212`
   renders it in the same red `replay-error` Alert as a 500; `:218` gates the body (and therefore the
   committed note at `:352-356`) on `frames().length > 0`.
   *Fix:* give `skipped` its own `replay-skipped` warning Alert (distinct testid/tone) and drop it from
   `error()`; render the commit-badge/committed-note outside the frames `Show`.

2. **P1 — gaps warning uses an unsupported Text tone and renders in default ink.**
   `src/pages/options-replay/ReplayPanel.tsx:281` `c="warning.main"`; `Text.tsx:18-28` only maps
   `warning`, and `Text.tsx:31-33,79` treats non-literal strings as unknown → no colour.
   *Fix:* `c="warning"` (the spelling already used at `PaperOrderBand.tsx:215`).

3. **P1 — 390 control row wraps unpredictably.**
   `src/pages/options-replay/ReplayPanel.tsx:228-261`: `ToolbarRow` (default `wrap:true`,
   `ToolbarRow.tsx:35`) contains a `w-full` raw range input with no height floor.
   *Fix:* wrap the slider in `<Box className="flex-1 min-w-0">`, give it an explicit `h-6` (24px),
   and set `wrap={false}` on the row (or split into two `ToolbarRow`s below a mobile breakpoint).

4. **P1 — dense stat grids clip long values at 390.**
   `src/pages/options-replay/ReplayPanel.tsx:307` (`cols={4}`) and `:325` (`cols={2}` with the string
   at `:337`); `CompactStat`'s value `Text` has no `truncate`/`lineClamp` (`compact.tsx:280-293`).
   *Fix:* derive `cols` from a mobile breakpoint (2 and 1) and add `truncate` to the value Text in
   `CompactStat` when dense.

5. **P2 — nested borders in the positions modal.**
   `OptionsDockPanel.tsx:1056-1064` (Modal panel border, `Modal.tsx:149`) wraps
   `OptionPositionsPanel.tsx:182-193` → `TanStackTable`'s bordered `Paper` (`TanStackTable.tsx:169-179`).
   *Fix:* pass `bare` to `TanStackTable` inside this modal (`TanStackTable.tsx:167`) and let the modal
   own the single border.

6. **P2 — play/pause button has no accessible name.**
   `src/pages/options-replay/ReplayPanel.tsx:229-238` renders only `▶ PLAY` / `❚❚ PAUSE` glyph text.
   *Fix:* `aria-label={playing() ? "Pause replay" : "Play replay"}` on the `Button`.

7. **P3 — fixed chart heights inside a flex column.**
   `src/pages/options-replay/ReplayPanel.tsx:293,302` (`height:"220px"`); `UI_RULES.md §4` requires
   charts to fill their flex parent. ResizeObserver (`echartsSolid.ts:53-59`) means this is cosmetic,
   not a broken canvas.
   *Fix:* `class="w-full min-w-0 flex-1"` with a `min-height` floor instead of a fixed height.

8. **P3 — positions table needs horizontal scroll that is not signposted.**
   `OptionPositionsPanel.tsx:50-147` fixed widths total 924px inside `Modal size="lg"` (512px,
   `Modal.tsx:7-13`); scroll exists (`TanStackTable.tsx:93-96`) but has no affordance.
   *Fix:* add a "scroll →" hint above the table at narrow widths, or reduce non-essential column
   `size`s / hide `LEGS` under a breakpoint.

---

## Screenshot inventory produced by the companion spec

`/tmp/opencode/options-paper-shots/<state>-<viewport>.png` for each state:

`dock-with-legs`, `positions-modal-2-rows`, `replay-preview`, `replay-mid-scrub`,
`replay-committed`, `replay-expired`, `replay-empty`, `replay-api-error` — each at `1600` and `390`.

Each shot asserts its anchor testid is visible first and asserts the visible replay/positions region
contains no `undefined`/`NaN`. Main agent must open and read every PNG before treating a state as done
(`docs/SCREENSHOT_EVIDENCE.md:13-18`); a small/blank PNG or error text means the state is not verified.

---

## Fix status (2026-11-22)

The audit above was taken against a mid-edit working tree; the fixes below have since landed. This
section is the authoritative status — where it disagrees with a cited line number, the line number is
the stale audit snapshot, not the current code.

| Finding | Status | What changed |
|---|---|---|
| #1 P1 — expired indistinguishable from an API error; committed note hidden | **FIXED** | Skipped results now render a separate warning-toned alert with their own testid and are no longer folded into `error()`; the committed badge and committed note render outside the `frames().length > 0` gate, so they survive a zero-frame/skipped result. |
| #2 P1 — unsupported `warning.main` Text tone | **FIXED** | Switched to the supported `warning` tone. |
| #3 P1 — 390 control row wraps unpredictably | **OPEN** | Not in the applied fix set — re-check the slider row at 390 before calling it done. |
| #4 P1 — dense stat grids clip long values at 390 | **FIXED** | Stat columns are responsive at narrow viewports. |
| #5 P2 — nested borders in the positions modal | **FIXED** | `TanStackTable` is now bare inside the modal; the modal owns the single border. |
| #6 P2 — play/pause button has no accessible name | **FIXED** | `aria-label` added to the play/pause control. |
| #7 P3 — fixed chart heights inside a flex column | **PARTIAL** | Heights were not changed. ECharts initialisation was moved to a microtask so it measures a laid-out flex container; the fixed-height caveat against `UI_RULES.md §4` remains. |
| #8 P3 — positions table scroll not signposted | **OPEN** | No scroll affordance added; horizontal scroll itself still works. |

Two additional fixes landed outside the original eight findings: the options dock now closes on
navigation, and ECharts initialises on a microtask (see #7). The 16 PNGs committed in
`docs/screenshots/options-paper-replay/` are the post-fix visual evidence at 1600 and 390.
