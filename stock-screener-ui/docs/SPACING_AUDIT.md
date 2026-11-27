# Spacing audit — Screener page + Market tab

Judged against [LAYOUT_CONTRACT.md](../LAYOUT_CONTRACT.md) and [UI_RULES.md](../UI_RULES.md).
Read-only audit: no source file was changed.

**Snapshot audited** (`git rev-parse --short HEAD` = `848613ab`, both files dirty at read time):

| file | sha1 | lines |
|---|---|---|
| `src/components/screener/ScreenerPage.tsx` | `c6765fc9acbfa4131461c06c6645c379b31aa525` | 571 |
| `src/components/market/MarketScreenerPanel.tsx` | `ce7f9059f855b4e52f18af0687913ec038f4b923` | 584 |

Both files were still being edited while this audit ran (mtimes 11:17 and 11:18 IST). Line
numbers below are for the shas above — re-`grep` if the files moved.

## 0. Measured vs inferred

| Class | Meaning |
|---|---|
| **M** | Sum/reading of height, padding, gap and border literals in source. Every number labelled **M** was computed by adding values from code, not from a browser. |
| **I** | Inferred: depends on text line-height, flex distribution, or a component default I did not execute. Flagged where used. |

No screenshot, no devtools session, no `getBoundingClientRect()`. This document therefore
does **not** claim a single visual measurement. What it claims is: *these are the numbers the
code declares, and here is where they exceed the contract.*

## 1. Chrome budget — where the first data pixel lands

Budget (LAYOUT_CONTRACT §1): primary workspace ≤ **96px** above the first data pixel.

Ancestors contribute **0px** (M): `AppLayout.tsx:133-161` sets `padding: 0px` on both the
`main` and its inner flex column; `AppShell` is not used by this route.

### 1.1 Cumulative chain

**Screener tab** (`?tab=screener`)

| step | source | px |
|---|---|---|
| page root padding-top (`p-4`) | `ScreenerPage.tsx:301` | 16 |
| control band (`h-[28px]`) | `ScreenerPage.tsx:306` | 28 |
| Stack gap (`gap={12}` → `12px`) | `ScreenerPage.tsx:302` | 12 |
| inline-filters band (`h-[24px]`, `embedded` → no border, no leading gap) | `ScreenerInlineFilters.tsx:32,72` | 24 |
| `CompactPanel` border-top | `compact.tsx:132` | 1 |
| panel header (4 top + 12 title + 1 rule; `py-1` with inline `padding-bottom: 0`) | `compact.tsx:149,155-157` | 17 |
| — **table container top** | | **98** |
| table container border-top | `TanStackTable.tsx:643-644` | 1 |
| — **table top** | | **99** |
| sticky `thead` row (non-dense, `23px`) | `TanStackTable.tsx:92,394` | 23 |
| — **first data row top** | | **122** |

The `gap-1` at `ScreenerPage.tsx:493` does **not** add to this: it separates `ScreenerContent`
from `SelectionBar`, so it contributes 0 above the table.

**Market tab** (`?tab=market`)

| step | source | px |
|---|---|---|
| page root padding-top (`p-4`) | `ScreenerPage.tsx:301` | 16 |
| control band (`h-[28px]`) | `ScreenerPage.tsx:306` | 28 |
| Stack gap (`gap={12}`) | `ScreenerPage.tsx:302` | 12 |
| panel root gap (`gap-2`) | `MarketScreenerPanel.tsx:291` | 8 |
| toolbar: 28 content + 8+8 `py-2` + 2 border | `MarketScreenerPanel.tsx:296` | 46 |
| results container border-top | `TanStackTable.tsx:644` | 1 |
| — **table top** | | **111** |
| `thead` (dense, `18px`) — `MarketGrid` passes `dense` | `MarketScreenerPanel.tsx:81`, `TanStackTable.tsx:120-123` | 18 |
| — **first data row top** | | **129** |

Warming banner / error banner / chip row are all `Show`-gated (`MarketScreenerPanel.tsx:403,425,447`)
and absent on a clean load, so 111 is the best case. Each one *adds* 30 / 30 / 26px (M) and
pushes the table down at runtime.

**Dashboard tab** (`?tab=dashboard`, default)

| step | source | px |
|---|---|---|
| page root + control band + Stack gap | `ScreenerPage.tsx:301,306,302` | 56 |
| toolbar 1 — universe · as-of + Refresh (`Button xs`) | `DashboardView.tsx:622` | 24 |
| root gap (`gap-2`) | `DashboardView.tsx:620` | 8 |
| toolbar 2 — search (`TextInput xs` = 26) + Customize + ₹500Cr chip | `DashboardView.tsx:665` | 26 |
| root gap (`gap-2`) | `DashboardView.tsx:620` | 8 |
| section header row — `Text size="sm"` writes inline `font-size: 14px`; line-height stays inherited 1.5 → 21 (**I**) | `DashboardView.tsx:744` | 21 |
| section gap (`gap-2`) | `DashboardView.tsx:742` | 8 |
| — **first card top = first data pixel** | | **151** |

Dashboard has **no** table; its first data pixel is the first dashboard card, which is why the
chrome is so much larger than the two table tabs.

### 1.2 Verdict

| tab | first data pixel (M) | over 96px | worst offender |
|---|---|---|---|
| Screener | 99 (table top) / 122 (first row) | **+3 / +26** | page `p-4` + 12px gap = 28px before any panel |
| Market | 111 / 129 | **+15 / +33** | 46px toolbar for a 28px control row |
| Dashboard | 151 | **+55** | **three** stacked toolbar rows |

Pre-content chrome (`p-4` 16 + band 28 + gap 12 = **56px**) is 58% of the whole budget before
a single panel is drawn. Nothing on this page can fit 96px while that stack stands.

Horizontal: the Market table's left edge sits at 16 (`p-4`) + 240 (rail) + 8 (gap) = **264px**.
With the chart dock open `basis-[38%]` (`MarketScreenerPanel.tsx:556`) at a 1400px viewport:
`1400 − 148 (nav) − 32 (p-4) = 1220`; dock ≈ 464 (`min-w-80` floor 320); grid gets
`1220 − 240 − 8 − 8 − 464 = 500px` against `minTableWidth={1000}` (`MarketScreenerPanel.tsx:82`).
That is a 500px horizontal overflow at exactly the breakpoint where the dock appears (**M** on
the arithmetic, **I** on flex rounding). Fill rule §5 (`scrollWidth === clientWidth`) cannot hold
at 1400–1600px with the dock open.

## 2. Spacing values in use — histogram

Generated by scanning `gap-*`, `p|px|py|pt|pb|pl|pr-*`, `m|mx|my|mt|mb|ml|mr-*`, `space-x|y-*`,
`h-[…]`, `min-h-[…]`. Tailwind 4 `--spacing: .25rem`, so `-1 = 4px`, `-2 = 8px`, `-0.5 = 2px`.

### 2.1 The two files under audit

26 tokens, 10 distinct values.

| token | px | count | locations |
|---|---|---|---|
| `gap-2` | 8 | 8 | Page 306, 308, 404 · Market 291, 296, 470, 500, 549 |
| `px-2` | 8 | 3 | Market 296, 407, 429 |
| `p-2` | 8 | 2 | Page 103 · Market 549 |
| `gap-1` | 4 | 6 | Page 474, 493 · Market 407, 429, 450, 459 |
| `py-0.5` | 2 | 2 | Market 407, 429 |
| `p-1` | 4 | **1** | Page 478 |
| `py-2` | 8 | **1** | Market 296 |
| `px-1.5` | 6 | **1** | Market 459 |
| `p-4` | 16 | **1** | Page 301 |
| `p-6` | 24 | **1** | Market 500 |

By value: **8px ×14**, **4px ×7**, 2px ×2, then one each of 6 / 16 / 24.

Drift (single use): `p-1`, `py-2`, `px-1.5`, `p-4`, `p-6` — 5 of 10 distinct values are one-offs.
`p-4` and `p-6` are the only values above the 8px inner scale, and `p-6` is 3× the app's inner
step on an error card.

### 2.2 The surrounding band (8 files: page + its 4 child panels + Header/InlineFilters/Rail)

71 tokens, 19 distinct.

| px | count | note |
|---|---|---|
| 8 | 36 | dominant (`gap-2`, `p-2`, `px-2`, `py-2`, `pt-2`) |
| 4 | 22 | second step (`gap-1`, `p-1`, `px-1`, `pb-1`, `py-1`) |
| 2 | 5 | `py-0.5` ×4, `gap-0.5` ×1 |
| 0 | 3 | `gap-0` ×2, `px-0` ×1 |
| 6 | 2 | `px-1.5`, `py-1.5` |
| 12 | **1** | `gap-3` — `MarketFilterRail.tsx:80` (the rail's only section gap) |
| 16 | **1** | `p-4` — `ScreenerPage.tsx:301` |
| 24 | **1** | `p-6` — `MarketScreenerPanel.tsx:500` |

Findings:

- **4 and 8 are the real scale.** They account for 58 of 71 tokens (82%).
- **`gap-3` (12px) appears exactly once in the whole band** — and it is the rail's section gap, so
  twelve of the file's 71 tokens' worth of rhythm is set by a value used nowhere else. The
  contract §4 allows gaps of **4 / 8 / 16 only**; 12 is neither.
- **`p-6`** on the Market error card is off the scale in the opposite direction (contract §8
  auto-fails `p-4` *inside a dense panel*; 24 is worse).
- **`mt-sm` is not a class.** `ScreenerPage.tsx:103` uses `className="mt-sm"`. Tailwind 4 has no
  `--spacing-sm`; confirmed against the built stylesheet: `grep -c 'mt-sm' dist/assets/index-*.css`
  → **0**. That skeleton is stacked with **0 gap** instead of 8px (**M**).

## 3. Border stacking

Every element declaring a border inside/replacing a parent that already has one, or declaring the
same edge twice.

| # | file:line | what is declared | risk |
|---|---|---|---|
| B1 | `src/components/common/Tabs.tsx:90` + `ScreenerPage.tsx:366` | `TabsList` ships `border-b border-fin-border` + `min-h-[30px]`; the page cancels it with inline `border-bottom-width: 0px` + `min-height: 26px` | A component default authored then suppressed at the call site. Any page that does **not** cancel it gets a 1px list rule **and** `border-b-2` on the active tab (`Tabs.tsx:135`) = a 2px rule sitting on a 1px rule. |
| B2 | `src/components/screener/ScreenerPage.tsx:306` | control band is `border-b` only, no box | correct (one rule per band) — listed as the positive control |
| B3 | `src/components/screener/ScreenerSection.tsx:24-31` → `compact.tsx:132` + `common/TanStackTable.tsx:643-644` | `CompactPanel` border 1px; body has `padding: 0` (`padded={false}`); the table's own container border 1px sits **flush inside it** | **Real double border.** Screener-tab tables render a 2px edge on left/right/bottom, and the table's top border lands directly under the panel header's rule. |
| B4 | `src/components/common/compact.tsx:127` vs `:132` | `border border-fin-border` class **and** `border: 1px solid palette.BORDER` inline, same element | same box declared twice; identical today, diverges the moment either token moves |
| B5 | `src/components/common/compact.tsx:149` vs `:159` | `border-b border-fin-border` class **and** `border-bottom: 1px solid palette.BORDER` inline, same header | as B4, on the header rule |
| B6 | `src/components/market/MarketScreenerPanel.tsx:426` | `border border-fin-border border-l-[3px] border-l-fin-negative` | left edge declared twice at two widths; sibling banner at `:407` declares `border` only → the two banners in one column have different left-edge geometry |
| B7 | `src/components/screener/DashboardView.tsx:384` (+ `:444`) | per-row `border-b` inside a card that already has an outer border (`compact.tsx:132`) and a header rule (`compact.tsx:159`); footer adds `border-t` at `:444` | three rule systems in one card. Last row drops its `border-b` only when collapsed — an expanded last row gets `border-b` **and** the footer's `border-t` one row apart. |
| B8 | `src/components/screener/GroupPerformancePanel.tsx:93` + `:194` | panel `border`; rows `border-b border-fin-border/60` | fourth border token (`/60` alpha) inside a panel already bordered with the solid token |
| B9 | `src/components/market/MarketFilterRail.tsx:149,201,229,250` inside `MarketScreenerPanel.tsx:474` | four `<hr class="border-fin-border">` inside a 1px-bordered rail; each `<hr>` is 1px tall but sits inside the parent's `gap-3`, i.e. 12px above **and** below | allowed by §4 (dividers between semantic sections), but each divider costs 25px of rail chrome; ×4 = **100px** of a 240px-wide rail |
| B10 | `src/components/market/MarketScreenerPanel.tsx:474` sans border | (contrast) the Market grid's table container is inside a border-less `Box` (`:487-489`) | single border — the correct pattern B3 should copy |

## 4. Control-height drift

Kit height map (all **M**): `Select xs 24` (`Select.tsx:85`) · `TextInput xs 26`
(`TextInput.tsx:14`) · `NumberInput xs 26` (`NumberInput.tsx:24`) · `Button xs 24`
(`Button.tsx:94`) · `ActionIcon xs 24` (`ActionIcon.tsx:82`) · `SegmentedControl xs track 26`
(`SegmentedControl.tsx:63-65`, item 20 + 2·2 pad + 2 border) · `Chip xs 20` (`Chip.tsx:18`) ·
`Badge xs 14` (`Badge.tsx:28`) · `Switch xs 14` (`Switch.tsx:16`).

### Band A — ScreenerPage control band (`ScreenerPage.tsx:306`, 28px)

| control | height | file:line |
|---|---|---|
| `Select size="xs" w={148}` | 24 | `ScreenerPage.tsx:317-318` → `Select.tsx:85` |
| `Tabs.List` / `Tabs.Tab` | **26** | `ScreenerPage.tsx:366`, `:170`, `:368` |
| `Switch size="xs"` | 14 (track) | `ScreenerPage.tsx:407` → `Switch.tsx:16` |
| `ActionIcon size="xs"` | 24 | `ScreenerPage.tsx:418` → `ActionIcon.tsx:82` |

Same band, right cluster (Screener tab only):

| control | height | file:line |
|---|---|---|
| `ActionIcon size="xs"` | 24 | `ScreenerHeader.tsx:39` |
| `NumberInput size="xs" w={64}` | **26** | `ScreenerHeader.tsx:55` → `NumberInput.tsx:24` |
| `Select size="xs" w={96}` ×2 | 24 | `ScreenerHeader.tsx:67,80` |

→ **24 / 26 / 24 in one row.** The NumberInput is the only control 2px taller, and it is a text
field next to two selects, so the visual mismatch is a text-field-vs-select mismatch, not a
deliberate step. Contract §4 ("every control in a row same height") fails.

### Band B — Market toolbar (`MarketScreenerPanel.tsx:296`, `py-2`)

| control | height | file:line |
|---|---|---|
| `Select size="xs" h={28}` | 28 (forced) | `:302-303` |
| `TextInput size="xs" h={28}` | 28 (forced) | `:311-312` |
| `Badge size="xs"` (Live / Stale) | 14 | `:322`, `:338` |
| `ActionIcon size={28}` ×2 | 28 (numeric escape) | `:358`, `:380` |
| `SegmentedControl size="xs"` (view toggle) | **26** | `:390` → `SegmentedControl.tsx:63` |
| `Button size="xs"` + `style height 28px` | 28 (forced) | `:391-394` |

→ **28 / 28 / 14 / 28 / 26 / 28.** Four separate `h={28}` escapes exist to drag xs controls up to
28. The view toggle is the one that was missed and sits 2px short. 28 is not a step in the kit's
map (24 / 30 / 34 / 38), so the whole band is off-scale by construction; it is admitted to
`design-scale.test.ts`'s `HEIGHT_SCALE` set (`src/test/design-scale.test.ts:31-34`), which is why
the guard stays green.

### Band C — Market banners and chips

| control | height | file:line |
|---|---|---|
| warming banner | 30 = 24 (Button xs) + 4 (`py-0.5`) + 2 border (**I** on line-height) | `MarketScreenerPanel.tsx:407` |
| error banner | same 30, left edge 3px | `:429` |
| chip | **22** (`h-[22px]`) | `:456` |
| chip text | 11px | `:456`, `:461` |

`h-[22px]` is a third chip height in the app (Chip = 20, Badge = 14, hand-rolled = 22) and is
2px off the contract's `xs = 24`.

### Band D — Group rail (`GroupPerformancePanel.tsx`)

| element | height | file:line |
|---|---|---|
| collapsed rail | `w={32}` | `:74` |
| expanded rail | `w={248}` | `:93` |
| period buttons | `size="xs"` (24) with `!px-0`, `text-[9px]`, `gap-[2px]` | `:113-121` |
| group rows | `h-[18px]` | `:194` |
| row bar | `w-[46px] h-[5px]` | `:205` |
| period column | `w-[52px]` | `:222` |

`gap-[2px]` is the only 2px grid gap in the audited band (every other column gap is 4 or 8) and
`h-[18px]` rows sit next to `h-5` (20px) avatars in the Dashboard cards — two different dense
row heights for the same kind of list.

## 5. Ranked fixes

Ranked by measured px recovered per unit of risk. Sizes: **S** ≤ 10 lines, **M** ≈ one component,
**L** = cross-component / kit change.

| # | file:line | issue | measured / observed | fix | size |
|---|---|---|---|---|---|
| 1 | `ScreenerPage.tsx:301` + `:302` | page root is `p-4` and the Stack gap is 12px, so 56px of the 96px budget is spent before any panel | 16 + 28 + 12 = **56px**, 58% of budget | `px-2 py-1` (8/4) + `gap={8}` → **40px**; recovers **16px** | S |
| 2 | `MarketScreenerPanel.tsx:296` | toolbar is `py-2` + `border` around a 28px control row → 46px band for one row; contract's Tools band is 32px | **46px** (28 + 16 + 2); 64% overhead on control height | `h-[28px] py-0 px-2` (band like `ScreenerPage.tsx:306`) → **30px**; recovers **16px** | S |
| 3 | `DashboardView.tsx:622` + `:665` + `:744` | three stacked toolbar rows above the first card (as-of+Refresh / search+Customize+chip / section title), each separated by 8px | **151px** to the first card = **+55** over budget | fold as-of text + Refresh into row 2; drop the section header row (cards carry their own titles) → **74px** | M |
| 4 | `MarketScreenerPanel.tsx:549` | loading state reserves a fixed 394px stack of 12×24px skeletons — contract §5: "empty/loading states collapse; they never reserve the full data height" | 12·24 + 11·8 + 16 + 2 = **394px** fixed | 4 rows, or `Skeleton` with `flex-1` at 3 rows | S |
| 5 | `Select.tsx:85` / `TextInput.tsx:14` / `NumberInput.tsx:24` | xs fields disagree: Select 24, TextInput 26, NumberInput 26 — surfaces as 24/26/24 inside `ScreenerHeader` | **2px** mismatch, 3 controls, 1 row | one number for all three xs fields (24) | S |
| 6 | `ScreenerPage.tsx:103` | `className="mt-sm"` is not a Tailwind class; the skeleton fallback stacks two bars with no gap | `grep -c 'mt-sm' dist/assets/index-*.css` → **0** (class emits no CSS) | `mt-2` (exists in the bundle) | S |
| 7 | `ScreenerSection.tsx:24-31` → `compact.tsx:132` + `TanStackTable.tsx:644` | table container border nested flush inside the panel border, body padding 0 → 2px edge on 3 sides | **2px** rule where 1px is intended | pass a border-less container to `TanStackTable` inside a bordered panel (the Market grid already does this) | M |
| 8 | `MarketScreenerPanel.tsx:82` + `:556` | at 1400px the chart dock takes 38% and the grid is left 500px against `minTableWidth={1000}` → horizontal overflow at the exact breakpoint the dock turns on | **500px** short (**M** on arithmetic) | raise the dock breakpoint (`isWide` 1400 → 1600) or drop `minTableWidth` when the dock is mounted | M |

Runner-up, same size class as #6 — `MarketFilterRail.tsx:80` is the only `gap-3` (12px) in the
band, against contract §4's 4/8/16 set; and `MarketFilterRail.tsx:149/201/229/250` spend **100px**
of a 240px rail on four 25px-tall divider slots. Fixing both to `gap-2`/`gap-1` is S.

## 6. Canonical spacing table for this app

Proposed single source, derived from what the code already does 82% of the time (8px ×36, 4px ×22)
plus the page inset:

| role | value | where it may appear |
|---|---|---|
| **outer** (page inset) | **16** | the route root only, once. Currently `p-4` on all four sides (`ScreenerPage.tsx:301`) |
| **section** (between bands / panels) | **12** | between page-level bands only — `ScreenerPage.tsx:302`, `MarketFilterRail.tsx:80`. **Conflict: LAYOUT_CONTRACT §4 permits 4/8/16 only** — see §7 |
| **inner** (between controls, panel body inset) | **8** | `gap-2`, `p-2`, `px-2` — 36 uses, the dominant value |
| **micro** (inside a control, label→field, chip padding) | **4** | `gap-1`, `p-1`, `px-1`, `py-0.5`(2px is a half-step, not in the table) |

### Exceptions found, with justification

| value | where | verdict |
|---|---|---|
| **2** | `py-0.5` ×4 (`MarketScreenerPanel.tsx:407,429`, `DashboardView.tsx:288,382`), `gap-0.5` (`DashboardView.tsx:288`), `gap-[2px]` (`GroupPerformancePanel.tsx:113`) | Half-step. Legitimate for a **banner's** vertical inset (a 30px banner does not want 8px of air) and for a 7-column dense grid. Keep, but cap at these three uses — it is currently also the only 2px *gap* in the band, which is drift. |
| **0** | `gap-0` ×2 (`DashboardView.tsx:390`, `GroupPerformancePanel.tsx:96`), `px-0` (`GroupPerformancePanel.tsx:121`) | Legitimate: deliberately collapsing a wrapper that would otherwise add rhythm inside a tight cluster. |
| **6** | `px-1.5` (`MarketScreenerPanel.tsx:459`), `py-1.5` (`DashboardView.tsx:446`) | Matches `Chip`'s own `px: 6` (`Chip.tsx:18`) — kit-sanctioned for pills. Do **not** generalise; it is not a layout step. |
| **24** | `p-6` (`MarketScreenerPanel.tsx:500`) | Not a layout step here. An error card inside a dense workspace should use `p-2` (8) with `gap-2`; 24 is a marketing-page inset. |
| **26/28/22** | control heights (§4) | Not spacing, but they set the band heights above. 28 is not in the kit map (24/30/34/38) and is admitted only by `design-scale.test.ts`'s `HEIGHT_SCALE` allow-set. |

## 7. Doc conflicts found (need a decision, not a code change)

1. **Gap set.** LAYOUT_CONTRACT §4: "explicit `gap` (**4/8/16 only**)". The requested canonical
   table has **12** as "section". The page currently uses 12 (`ScreenerPage.tsx:302`). One of the
   two documents must yield; if 12 is kept, §4 should say 4/8/12/16.
2. **`xs` control height.** LAYOUT_CONTRACT §4: "`size="sm"` = 30px, `xs` = 24px **for chips
   only**". AGENTS.md and every primitive use `xs` for full-width toolbar controls (Select,
   TextInput, NumberInput, Button, ActionIcon). Taken literally, the contract forbids the app's
   dominant toolbar idiom. Either the contract's qualifier is stale or ~all toolbars are
   non-conforming.
3. **`p-4`.** §8 auto-fails `gap-4`/`p-4` "inside a dense panel" — the page root is not a dense
   panel, so `p-4` there is legal but is also, at 16px top, the third-largest single contributor
   to the Market tab's overrun.

## 8. Not verified / carried forward

- **No browser numbers.** Every px figure is a sum of literals. Anything marked **I** (the
  21px Dashboard section header row; the 30px banner heights) depends on inherited
  `line-height: 1.5` and should be re-read with `getBoundingClientRect()` once.
- **`Text` line-height.** `size` is written as an inline `font-size` (`Text.tsx:96`), not the
  `text-sm` utility, so the `--text-sm--line-height` token never applies and body text inherits
  `1.5` from the preflight `html` rule. That is why the section row is 21px rather than 20px;
  if a `leading-*` class is ever added the number changes.
- **Target files moved during the audit** (ScreenerPage mtime 11:18, Market panel 11:17). Two
  findings were re-checked against the final sha (`mt-sm` at :103, `gap={12}` at :302) but a
  further edit would shift every line number in §2–§5.
- **`ScreenerContent.tsx:123`** currently reads `gap={8}` (8px), not `gap={1}` as in the version
  read at the start of the audit — the section gap moved during this session, which changes the
  Screener tab's first-row number by 0px vertically (it is a column gap between sections) but
  changes the inter-section rhythm from 1px to 8px.
- **Dock overflow (#8)** is arithmetic on declared `basis-[38%]`, `min-w-80`, `minTableWidth={1000}`
  and a 148px nav. Flex rounding and the actual `isWide` match at 1400 were not executed.
- **`Indicator size={14}`** (`MarketScreenerPanel.tsx:373`) is a badge dot, not a control height;
  excluded from the height-drift tables.
