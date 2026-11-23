# Options paper surfaces — design re-audit

Scope: the options replay page, paper-order band, positions panel, add-leg dialog and the
options dock shell/chain/legs, plus the shared primitives they lean on. Evidence is from the
working tree at the time of this audit (2026-11-23); the worktree is dirty with two in-flight
revamp lanes, so "addressed" below means *landed in the file*, not "planned".

Verdict: **the screens are cramped because the typography and spacing system is inverted**.
The code makes 9–10px the normal reading size, 4px the normal gap, 18–24px the normal row
height, and 2px the normal chip padding — and then uses inline `·` / `→` / `—` string
concatenation where a labelled, gapped structure belongs. Adding more borders or another
bordered card will make it worse, not better.

---

## 1. PROBLEMS FOUND

### 1.1 Options replay page and replay panel

| Evidence | Defect |
|---|---|
| `src/pages/options-replay/OptionsReplayPage.tsx:22-29` | Page title and description are two inline `Text` nodes in one 12px/10px-ish flex row; the description is clipped with `truncate max-w-[55vw]` and hidden behind a `title` tooltip. There is no title/description hierarchy — it reads as one run-on label. |
| `src/pages/options-replay/ReplayPanel.tsx:243` | Root layout `gap-1.5` = **6px** between every top-level section. `UI_RULES.md:75` explicitly forbids "6px slop". |
| `src/pages/options-replay/ReplayPanel.tsx:70-93` | `WorkstationPanel` header is `h-6` (24px) with inline `font-size:10px` at `:80`; body at `:90` is `p-1 gap-1` = **4px padding and 4px gap** around controls, charts and footnotes. |
| `src/pages/options-replay/ReplayPanel.tsx:249-253` | Underlying and expiry are concatenated into one `<Text size="xs">` with a literal ` · ` separator and a native tooltip. No label, no gap, no value structure. |
| `src/pages/options-replay/ReplayPanel.tsx:256-267` | Two `Badge size="xs"` chips (9px font — `src/ui/feedback/Badge.tsx:55`) 4px apart; their text itself contains inline ` · ` fragments (`COMMITTED · HOLD TO EXPIRY`). Status text is unreadable at 100% zoom. |
| `src/pages/options-replay/ReplayPanel.tsx:282-284` | "Position #… is open…" is a bare 12px `Text`, no icon, no surface, no rail; glued to its neighbours by the 6px root gap. |
| `src/pages/options-replay/ReplayPanel.tsx:304-356` | Playback toolbar crams a 24px play button, `w={84}` select, `h-6` range input, clock and PLAYHEAD badge into one row with no explicit wrap policy beyond `ToolbarRow`'s default (see §2.1). At 390 this is a traffic jam. |
| `src/pages/options-replay/ReplayPanel.tsx:358-361` | Unpriced-minutes warning is a 12px line with an inline em-dash `—` and only 4px of body gap around it. |
| `src/pages/options-replay/ReplayPanel.tsx:364-381` | The chart labels at `:366` and `:374` are bare `<Text size="xs">` with **no bottom margin** before the `min-h-[200px]` canvas — the label touches the plot. Grid columns use `gap-2` (8px), so the two charts nearly touch each other. |
| `src/pages/options-replay/ReplayPanel.tsx:383-385` | A 3-sentence footnote is forced to one line with `truncate` + tooltip. Information is deliberately hidden; the user sees a clipped sentence ending in an ellipsis. |
| `src/pages/options-replay/ReplayPanel.tsx:388-398` | 8 `CompactStat` tiles at 1600, **4 at 390** in a row ~90px wide. `CompactStat` internals (`src/components/common/compact.tsx:259-262`) are a 40px floor, `2px 8px` padding and a 2px row-gap with a 10px label. `STAT_VALUE_SHRINK` at `ReplayPanel.tsx:47-48` **ellipsizes the value** — the primary number is the thing being truncated. `CompactStatGrid` draws a `divide-x` border between every tile (`:338`) inside an already bordered `Paper` (`:72`) — nested borders. |
| `src/pages/options-replay/ReplayPanel.tsx:401-422` | "LEGS AT PLAYHEAD" repeats the same 4px body and 2px stat internals; the leg value at `:414` is three inline fragments `${entryPremium} → ${mark} · ${signed(pnl)}` and the label at `:413` is another concatenation. |
| `src/pages/options-replay/ReplayPanel.tsx:424-430` | Commit action is a lone `size="sm"` button on an otherwise empty right-aligned toolbar, 6px below the legs panel. |
| `src/pages/options-replay/replayCharts.ts:4-8,31,87,110,164` | Axis and mark-line labels are 12px `PLAYHEAD` / `SPOT` / `₹1.2k` fragments painted directly on the lines; grid insets are magic 12/16/18/26px. No chart legend or title in the host panel, so the 0.18–0.2 green/red area fills (`:61,70,138,147`) carry meaning with no key. |

### 1.2 Paper order band

| Evidence | Defect |
|---|---|
| `src/components/options-paper/PaperOrderBand.tsx:220-261` | Three fields in a `ToolbarRow gap={4}` (4px); each field is `gap-0.5` (2px) at `:221,233,247`. Labels `TYPE / LOTS / SLIP TICKS` are glued to their controls. |
| `src/components/options-paper/PaperOrderBand.tsx:222,234,248` | Labels are `Text size="xs"` (12px) uppercase with no tracking, while dock section headers are forced to 10px with tracking (`DockSection.tsx:60-61`) — two incompatible label systems in one column. |
| `src/components/options-paper/PaperOrderBand.tsx:263-271` | `NET DEBIT ₹…` and `ENTRY COSTS ₹…` are string concatenations inside two 12px mono `Text`s. The sign word is concatenated at `:265`. No label/value separation, no alignment, no grouping. |
| `src/components/options-paper/PaperOrderBand.tsx:273-277` | Margin warning is a bare 12px `Text` with no surface, rail or icon; the DockSection body gives it 4px of separation. |
| `src/components/options-paper/PaperOrderBand.tsx:279-288` | Loading state is a bare pulsing 12px `Text` inserted conditionally. It has no reserved height, so the band jumps between states — violates `docs/LAYOUT_INVARIANTS.md:47` ("No conditional 0↔N rows above a table: reserve the height"). |
| `src/components/options-paper/PaperOrderBand.tsx:290-296` | Error `Alert` is rendered `variant="light"` inside another bordered DockSection — nested surfaces. |
| `src/components/options-paper/PaperOrderBand.tsx:298-319` | Two 24px buttons separated by `gap={4}`; `filled` vs `default` is the only hierarchy cue. At 390 they split a ~358px band into two cramped halves. |
| `src/components/options-paper/PaperOrderBand.tsx:143` | Validation errors joined with `" · "` into one Alert line. |

### 1.3 Option positions panel

| Evidence | Defect |
|---|---|
| `src/components/options-paper/OptionPositionsPanel.tsx:167-170` | Root `gap-1` = 4px between the action row, alerts, loader, empty state, scroll hint and table. |
| `src/components/options-paper/OptionPositionsPanel.tsx:171-183` | A right-aligned `ADD LEG` button on its own toolbar row with no panel title or count. It is an orphan control floating above the table. |
| `src/components/options-paper/OptionPositionsPanel.tsx:56-164` | 8 columns with declared widths summing to **924px**. `dense` is on (`:225`), so rows are 18px with `1px 6px` cell padding and a 10px table font (`src/components/common/TanStackTable.tsx:35-38`). At 390 the table necessarily overflows; the "fix" at `:211-219` is a 12px `Scroll horizontally to see all columns →` hint, not responsive column management. |
| `src/components/options-paper/OptionPositionsPanel.tsx:64-67` | Underlying/expiry stacked as two 12px Texts in a 150px cell with no gap utility — line boxes touch. |
| `src/components/options-paper/OptionPositionsPanel.tsx:77-84,93-105` | BOOK and STATUS are `Badge size="xs"` — **9px text in an 18px row**. That is the single most unprofessional detail in these surfaces. |
| `src/components/options-paper/OptionPositionsPanel.tsx:114-116` with `:26-32` | Leg summary is `4 legs · BUY CE 1,420 / SELL CE 1,470` built with ` · ` and ` / ` joins, then `truncate`d into 260px. Structured data rendered as punctuation. |
| `src/components/options-paper/OptionPositionsPanel.tsx:125,137,149,161` | Cells inject `<Text size="xs">` = 12px into a table whose own `--tbl-fs` is 10px. Two type sizes fight inside one grid. |
| `src/components/options-paper/OptionPositionsPanel.tsx:203-209` | Empty state sits 4px under the Add Leg row with no title/count/hint/action framing. |

### 1.4 Add-leg dialog

| Evidence | Defect |
|---|---|
| `src/components/options-paper/AddLegDialog.tsx:150-157` | `Modal size="sm" padding="sm"` — `padding` maps to 8px (`src/ui/overlay/Modal.tsx:17`). A form this dense needs 24px. Title is `ADD LEG` (14px default) while every body label is 12px: no hierarchy. |
| `src/components/options-paper/AddLegDialog.tsx:160-177` | One good `Stack gap={12}`, immediately undercut by `gap-1` (2px) label→chips at `:161` and `gap-1` (4px) between chips at `:163`. |
| `src/components/options-paper/AddLegDialog.tsx:170-173` | Existing leg chips are `Badge size="xs"` (9px/14px tall) containing `BUY CE 1,420 × 1` — four inline fragments in a 9px badge. |
| `src/components/options-paper/AddLegDialog.tsx:162,183-241` | Double labelling: the group `Text` says `CURRENT STRUCTURE` while the inputs carry `label="ACTION" / "OPTION" / "STRIKE" / "LOTS" / "ENTRY TIME (IST)"`, all in the same 11–12px range. |
| `src/components/options-paper/AddLegDialog.tsx:179-231` | Two-column grids of `size="xs"` `Select`/`NumberInput` — 24px tall controls at 390, below a comfortable touch target. |
| `src/components/options-paper/AddLegDialog.tsx:243-251,262-275` | Loading is a bare pulsing 12px Text; error is an Alert; footer buttons are 24px with `gap={8}` and no `border-t` separator. The modal has no header/body/footer rhythm. |

### 1.5 Dock shell and section primitive

| Evidence | Defect |
|---|---|
| `src/components/options-dock/DockSection.tsx:8-12` | The docstring says the 22px/10px header exists so "labels inside a body stay at 9px". That is the design bug stated as a requirement: 9px is the current type **floor** (`AGENTS.md` / `UI_RULES.md:75`), not a target. |
| `src/components/options-dock/DockSection.tsx:49-51,60-61` | Fixed `h-[22px]` header, forced `font-size:10px`, `bg-fin-surface-alt/40`. No room for a two-line title or a real section number/count. |
| `src/components/options-dock/DockSection.tsx:41-45` | Every section draws `border-t border-fin-border`; bodies then add their own cards/badges/chip borders — nested borders down the column. |
| `src/components/options-dock/DockSection.tsx:76-78` | Body is `gap-1 px-2 py-1.5` = 4px gap, 8px horizontal, **6px vertical** — 6px is off the documented 4/8/12/16/24/32 scale (`src/ui/layout/spacing.ts:2`). |
| `src/components/options-dock/OptionsDockPanel.tsx:68-80` | `PAYOFF_BAND_HEIGHT = "206px"` and `CHART_BAND_HEIGHT = "clamp(320px, 42vh, 400px)"`; the comment documents a previous clipping incident caused by these fixed bands. Still magic numbers. |
| `src/components/options-dock/OptionsDockPanel.tsx:202-206` | Chain-side toggle is 18px tall, `text-[9px]`, min-w 28px, `border-radius:4px` inline (the documented control radius is `--radius-fin: 6px`, `src/tailwind.css:33`). |
| `src/components/options-dock/OptionsDockPanel.tsx:554,696,708,916` | Four separate inline `"font-size": "9px"` overrides on `<Text size="xs">`, plus `:656` expiry `<select>` at `text-[10px]`, 22px tall, inline 4px radius. Five independent copies of "tiny text" prove drift. |
| `src/components/options-dock/OptionsDockPanel.tsx:689-780` | Header action cluster uses `gap-0.5` (2px) between four 22×22 icon buttons and the POSITIONS chip; the whole header uses `px-2 py-1` (`:622`). |
| `src/components/options-dock/OptionsDockPanel.tsx:721,724` | POSITIONS chip: `text-[9px]`, 22px tall, content `POSITIONS {n} · {formatSignedPnl()}` — a count and a P&L crammed into one 9px inline fragment. |
| `src/components/options-dock/OptionsDockPanel.tsx:711` | `closed · as of ${asOfLabel()}` — another inline connector fragment with no label/value split. |
| `src/components/options-dock/OptionsDockPanel.tsx:795-832` | Dock error and empty states are hand-rolled `gap-1` centred columns with 12px/9px text — they do **not** use `EmptyState` (`src/components/common/states.tsx:123`), so the dock's empty state has no icon, tone, hint or action slot while the replay page's does. |
| `src/components/options-dock/OptionsDockPanel.tsx:932-957` | Error banner is `h-[26px]` with `border-l-[3px]` — two off-scale values — and 10px text. |
| `src/components/options-dock/OptionsDockPanel.tsx:989-1000` | Payoff placeholder `${formatDte(...)} · add a leg to see the payoff` is split across a JSX newline with an inline ` · `; no EmptyState. |
| `src/components/options-dock/OptionsDockPanel.tsx:916-918` | `{rows.length} strikes` is a bare 9px count in the header meta, with no label and no alignment with the other meta items. |

### 1.6 Chain and leg builder

| Evidence | Defect |
|---|---|
| `src/components/options-dock/chain.columns.tsx:31` | `CELL = "...text-[10px] leading-none"` — 10px text with line-height **1** inside an 18px row. No vertical breathing at all. |
| `src/components/options-dock/chain.columns.tsx:52,123` | 14×14 chart button with a 12px icon and a 13px-tall OI cell inside an 18px row (`src/components/common/TanStackTable.tsx:35`, `src/components/options-dock/OptionChainTable.tsx:31-32`). The entire content area is smaller than the row it sits in. |
| `src/components/options-dock/chain.columns.tsx:71-83` | LTP and chart button are 4px apart; the price button is `text-[10px] leading-none`. |
| `src/components/options-dock/chain.columns.tsx:197,245` | Tooltip copy built with `parts.join(" · ")` — inline fragments everywhere. |
| `src/components/options-dock/chain.columns.tsx:375-390` | Strike cell renders ATM `◀`, badge and the number in one span with a literal `{" "}` — zero-gap fragments, and a 9px badge (`ml-0.5` = 2px) at `:251-261` / 9px letter 4px from a 2px rail at `:270-292`. |
| `src/components/options-dock/chain.columns.tsx:19` | `DASH = "—"` is the empty value for every numeric cell. Missing data reads as punctuation, not as a state. |
| `src/components/options-dock/LegBuilder.tsx:65-69` | Chips are `gap-1` (4px) apart and use `gap-1 px-1 py-[1px] rounded-[4px]` internally — **1px vertical padding** and a 4px radius, with four 10px fragments (B/S, strike, CE/PE, `− ×1 +`, `@premium`, trash). |
| `src/components/options-dock/LegBuilder.tsx:31-54` | Header meta uses `items-baseline gap-2` with three separate 9–10px fragments (`3/4`, `net credit`, `₹…`) — no label/value grouping. |
| `src/components/options-dock/LegBuilder.tsx:60-62,153-156` | Legs-empty and mismatch states are bare 12px Text lines with inline ` · `, no EmptyState/tone/rail. |
| `src/components/options-dock/OptionChainTable.tsx:28-32` | `NARROW_MIN_TABLE_WIDTH = 262` for 5 columns and `minTableWidth: 452` for 9 columns (`:321`) — the chain is engineered to be dense at both sizes rather than to breathe. |

---

## 2. ROOT CAUSES

1. **`ToolbarRow` defaults are wrong for this density.** `src/ui/layout/ToolbarRow.tsx:14-15` makes `wrap` default `true` and `:41` makes gap caller-supplied. Callers pass `gap={4}` (`PaperOrderBand.tsx:220,298`) or rely on wrapping (`ReplayPanel.tsx:304`), producing rows that either collide or wrap without a plan. `UI_RULES.md:16-20` requires `align-items:center` + an explicit gap; alignment is fine, the gap is not.

2. **`CompactStat` bakes the cramped look into a shared primitive.** `src/components/common/compact.tsx:259-262` hard-codes a 40px floor, `2px 8px` padding, 2px row-gap and a 10px label; `:285` gives the value no font-size at all. `CompactStatGrid` at `:338` adds `divide-x` between tiles. The replay panel then wraps those tiles in a bordered `Paper` (`ReplayPanel.tsx:70-93`) — nested borders by construction.

3. **`DockSection` institutionalises 9/10px type and 4px gaps.** `DockSection.tsx:8-12,49-51,76-78` is the template for every dock band; fixing call sites without fixing this primitive changes nothing.

4. **No type-scale token exists, so call sites invent sizes.** `Text`'s `xs` is 12px (`src/ui/typography/Text.tsx:6-12`), but eight call sites override to 9 or 10px inline (`OptionsDockPanel.tsx:554,656,696,708,916`, `DockSection.tsx:61`, `chain.columns.tsx:31,261,287`, `compact.tsx:176,270`). Nothing enforces 11/12/14/18.

5. **`Badge size="xs"` is used as a data display, not a micro-label.** `src/ui/feedback/Badge.tsx:55` sets 9px/14px. It is used for commit state, leg chips, BOOK/STATUS columns and header meta — places that need 11px and 20px.

6. **`TanStackTable dense` is applied to tables that are not dense enough to need it.** `src/components/common/TanStackTable.tsx:35-38` sets an 18px row / 1px 6px pad / 10px font for a market screener; the options tables then inject 12px `Text` cells on top, so neither size is coherent. `OptionPositionsPanel.tsx:225` and `OptionChainTable.tsx:316` both opt in.

7. **No `KeyValue` / `MetaRow` / `StatPair` primitive exists in `@/ui` or `@/components/common`.** Consequently structured facts are rendered as string concatenation with ` · `, ` → `, ` / ` and `—`: `ReplayPanel.tsx:252,414`, `PaperOrderBand.tsx:265-269`, `OptionPositionsPanel.tsx:31`, `LegBuilder.tsx:8,60-62,153-156`, `chain.columns.tsx:197,245`, `OptionsDockPanel.tsx:711,724,997`. This is the direct cause of the "inline mdash fragments" the user is reacting to.

8. **The new semantic border tokens are defined but unused.** `src/ui/palette.ts:62-75` and `src/tailwind.css:17-26` add `border-subtle/default/strong/focus/positive/negative/warning/info/disabled`, but every surface still uses `border-fin-border` uniformly (`ReplayPanel.tsx:72,74`, `DockSection.tsx:43`, `OptionsDockPanel.tsx:192,622,656,721,905`). A single hairline weight carries both "section separator" and "critical error", so hierarchy comes from adding *more* borders instead of *different* ones.

9. **The new `Grid` / `Row` / `Col` primitives are not adopted.** `src/ui/layout/Grid.tsx:49-64`, `Row.tsx:45-71` and `Col.tsx:56-83` now support 12-column responsive layouts, but surfaces still use ad-hoc `grid grid-cols-1 lg:grid-cols-2` (`ReplayPanel.tsx:364`) and JS-driven column counts from `useMediaQuery` (`ReplayPanel.tsx:389,402`). The result is layout logic that cannot be tuned per breakpoint without JS.

10. **The in-flight lanes have not changed layout yet.** `git diff` at audit time shows only functional edits in `PaperOrderBand.tsx` and `AddLegDialog.tsx` (replay-session discovery, validation hardening), and structural edits in `ReplayPanel.tsx` (new `WorkstationPanel`, empty-state centring, stat shrink workaround) plus the new tokens/primitives. `OptionPositionsPanel.tsx`, `OptionsDockPanel.tsx`, `DockSection.tsx`, `LegBuilder.tsx`, `OptionChainTable.tsx` and `chain.columns.tsx` are untouched.

---

## 3. DESIGN SPEC

This is the target system for these surfaces. Every rule names the exact class or token.

### 3.1 Type scale — 11 / 12 / 14 / 18

| Role | Class / token | Line-height | Where |
|---|---|---|---|
| Micro / dense numeric | `text-[11px] leading-[14px]` | 14px | chain OI/IV/Δ/LTP, badge chips, stat labels, chart axis + mark labels |
| Body / secondary | `text-xs leading-4` (`Text size="xs"`) | 16px | descriptions, hints, form labels, warnings |
| Section header / primary value | `text-sm leading-5 font-semibold` (`Text size="sm"`) | 20px | panel titles, stat values, modal title, primary inputs |
| Surface / page title | `text-lg leading-6 font-bold` (`Text size="lg"`) | 24px | `OptionsReplayPage` page title, modal title if upgraded |

- Delete every `text-[9px]`, `font-size:"9px"`, `text-[10px]` and `font-size:"10px"` in this scope. Where 9px existed use `text-[11px]`; where 10px existed use `text-[11px]` for numerics or `text-xs` for prose.
- Keep `font-mono tabular-nums` for every price, P&L, OI, IV, strike and count. Keep `uppercase tracking-[0.06em]` **only** on section headers. Never track body copy.
- Use `text-fin-text` for primary, `text-fin-text-muted` for secondary; tone via `text-fin-positive` / `text-fin-negative` / `text-fin-warning` / `text-fin-info` (`src/tailwind.css:10-16`). Never set `color` inline when a token class exists (`Text.tsx:18-28`).

### 3.2 Spacing scale — 4 / 8 / 12 / 16 / 24 / 32

Tailwind classes only: `gap-1/p-1` (4), `gap-2/p-2/px-2 py-2` (8), `gap-3/p-3` (12), `gap-4/p-4` (16), `gap-6/p-6` (24), `gap-8` (32).

- 4px: **only** the gap between an icon and its text inside a chip/button.
- 8px: default `ToolbarRow gap={8}` between adjacent controls in one toolbar; chip-to-chip.
- 12px: panel body padding and the gap between a stat's label, value and hint; `p-3 gap-3` replaces every `p-1 gap-1` in `WorkstationPanel`/`DockSection`.
- 16px: between panels/sections; page outer padding stays `FIN_OUTER_PAD = 16` (`src/ui/palette.ts:348`).
- 24px: modal body `p-6`; between a page title and its content.
- 32px: maximum separation, used only for a page-level hero-to-content break.
- **Banned**: `gap-0.5`, `ml-0.5`, `py-[1px]`, `gap-1.5`, `py-1.5`, `px-1 py-[1px]`, `h-[22px]`, `h-[24px]`, `h-[26px]`, `border-l-[3px]`, `206px`, `clamp(320px,42vh,400px)`. Replace with the next scale step or a flex/`min-h-*` rule.

### 3.3 Surfaces and borders (using the new semantic tokens)

- Page `bg-fin-bg` → panel `bg-fin-surface border border-fin-border-default rounded-fin` → raised/popover `bg-fin-surface-alt border border-fin-border-subtle rounded-md`. One border per surface, never a bordered card inside a bordered panel.
- Section separators inside one panel: `border-t border-fin-border-subtle` (not `border-fin-border`). Stat strips: `divide-x divide-fin-border-subtle` with `px-3 py-2` per cell. Statement rows: `divide-y divide-fin-border-subtle`.
- Emphasis: `border-fin-border-strong` for an active/selected edge; `border-fin-border-focus` for keyboard focus (the global `:focus-visible` ring already uses `--color-fin-primary`, `src/tailwind.css:98-102`).
- State: error `border-fin-border-negative` + a tint made with `alpha(NEGATIVE, 0.08)` from `src/ui/palette.ts:53` (`bg-fin-negative` is a solid and must not carry `text-fin-text`); warning `border-fin-border-warning` + `alpha(WARNING, 0.07)`; success `border-fin-border-positive` + `alpha(POSITIVE, 0.08)`; disabled `border-fin-border-disabled`.
- Radius: controls `rounded-fin` (6px), inner chips `rounded-md` (6px) or `rounded-sm` (4px) only for sub-20px indicators, modal `rounded-lg` (10px). Never inline `border-radius:4px` on a 22px control.
- Semantic colours unchanged: CE/PE = `OI_CALL`/`OI_PUT` (`docs/COLOR_SEMANTICS.md:8-12`); CW/PW/MP = `LEVEL_CALL_WALL`/`LEVEL_PUT_WALL`/`LEVEL_MAX_PAIN` (`:16-25`); OI bars stay a 2px solid rail + ≤14% tint + normal text (`:29-37`).

### 3.4 Component anatomy

**Header** (replaces `DockSection.tsx:47-73` and `WorkstationPanel.tsx:74-89`):
`h-10 px-4 flex items-center justify-between gap-3 border-b border-fin-border-default bg-fin-surface-alt/40`. Title `text-sm font-semibold uppercase tracking-[0.06em] text-fin-text`; optional second-line caption `text-xs text-fin-text-muted` grows the header to `h-14`; right meta `text-[11px] font-mono tabular-nums text-fin-text-muted` in a `gap-2` cluster. A count/amount is a labelled pair (`<span class="text-fin-text-muted">LEGS</span><span class="text-fin-text">3/4</span>`), never a concatenated fragment.

**Empty state** (all surfaces — replay, dock, positions, legs, chain):
Use `EmptyState` from `src/components/common/states.tsx:123` with `kind`, `title`, `description`, optional `hint` and exactly one `action`. Its internal sizes are already 12/11px (`:189,206,222`) — leave them; raise the *call sites*, not the primitive. Container `min-h-[160px] p-6 flex flex-col items-center justify-center gap-3`. Reserve the slot height in loading→empty→full transitions (`docs/LAYOUT_INVARIANTS.md:47`).

**Stat** (replaces `CompactStat` internals for these surfaces):
`min-h-[56px] px-3 py-2 flex flex-col gap-1`; label `text-[11px] uppercase tracking-[0.06em] text-fin-text-muted`; value `text-sm font-mono tabular-nums text-fin-text` (tone via `text-fin-positive`/`text-fin-negative`); hint `text-[11px] text-fin-text-muted truncate`. **Never ellipsize the value**: drop `STAT_VALUE_SHRINK` (`ReplayPanel.tsx:47-48`) and let a 14px value wrap or use `title` as a fallback only at 390. A stat belongs in a `divide-x divide-fin-border-subtle` strip, not a `Card` with its own border.

**Table**:
- Chain (9 columns, contractual density): keep `dense`, but cell text `text-[11px] leading-[14px] font-mono tabular-nums` via `--tbl-fs` (no per-cell `<Text>`), row ≥22px, chart/target buttons ≥20×20, OI bar ≥14px. Header/cell `meta.align` parity per `TABLE_CHECKLIST.md`.
- Positions (8 columns): drop `dense` — use default row 23px, font 11px, pad `3px 8px` (`TanStackTable.tsx:22,37-38`); BOOK/STATUS badges become `size="sm"`-equivalent `h-5 text-[11px] px-2`; render the leg summary as a real list (`<span>` per leg with `gap-1`) instead of a joined string. Hide columns responsively via `visibleColumns` instead of a scroll hint.
- `DASH = "—"` remains the missing-data glyph, but it must live in a cell with `aria-label="unpriced"` so the state is not just punctuation.

**Modal**: `size="md"`, `p-6` (24px), title `text-lg`, group gap `gap-4`, field gap `gap-3`, inputs `size="sm"` (34px) with `w`/flex cells per `UI_RULES.md:9-11`, chips `h-6 text-[11px] px-2`, footer `pt-4 border-t border-fin-border-subtle` with `gap-2`, CTA `size="sm"`. Remove the duplicate `Text` group labels where the input `label` already says the same thing.

**Chart**: panel `p-3 gap-3`; caption `text-[11px] uppercase tracking-[0.06em] text-fin-text-muted mb-2` above the canvas; canvas `flex-1 min-h-[220px]` with no `max-h` inside a flex chain (`UI_RULES.md:29`); axis/mark labels `text-[11px]`; footnote `text-xs leading-5 whitespace-normal` (use `line-clamp-2`, not single-line `truncate`). Pass chart ink through `palette.ts` tokens only; keep the 2px rail + ≤14% tint pattern for any filled band.

### 3.5 Responsive rules — 1600 and 390

- Replace JS breakpoints (`useMediaQuery`, `isNarrow()` at `ReplayPanel.tsx:106,389,402`) with `Grid`/`Row`/`Col` (`src/ui/layout/Grid.tsx:49-64`, `Col.tsx:56-83`): `Grid cols={12} gap={4}` + `Col span={12} md={6} lg={4}`.
- **1600**: replay charts 2-up (`Col md={6}`); 8 stats in one `divide-x` strip; legs 4-up; dock rail full height; positions table all 8 columns; modal centred `size="md"`.
- **390**: page `p-4`; charts stacked (`grid-cols-1`); stats **2-up**, never 4-up; legs 2-up; chain one-sided 5 columns with 11px text; positions table shows only STRUCTURE / LEGS / P&L via `visibleColumns`; modal `w-full p-4`; every input and button `size="sm"` (≥34px); toolbars `flex-wrap gap-2` with a deliberately full-width second row instead of `max-w-[55vw]`.
- Hard gate: `document.documentElement.scrollWidth === clientWidth` at 390 (already asserted by `tests/e2e/options-paper-visual.spec.ts:71-78`).

---

## 4. PRIORITISED FIX LIST

Lane keys: **H** = in-flight header/empty-state lane (`OptionsReplayPage`, `ReplayPanel`, empty states, new Grid/Row/Col, border tokens); **D** = in-flight dock band / positions / add-leg lane (`PaperOrderBand`, `OptionPositionsPanel`, `AddLegDialog`). "Landed" means the current worktree already contains a relevant edit; "not yet" means the file is untouched or the edit was functional only.

| # | Severity | File:line | Minimal fix | Lane |
|---|---|---|---|---|
| 1 | CRITICAL | `ReplayPanel.tsx:243,70-93,388-398,401-422` | Root `gap-1.5`→`gap-4`; `WorkstationPanel` body `p-1 gap-1`→`p-3 gap-3`; header 24px/10px→40px/14px; stats 2-up at 390 with 14px values and no ellipsis (delete `STAT_VALUE_SHRINK`). Also split `OptionsReplayPage.tsx:22-29` title/description onto two lines. | H — lane landed a structural `WorkstationPanel` and empty-state centring, but kept 6px/4px gaps and 4-up mobile stats; **remains** |
| 2 | HIGH | `DockSection.tsx:8-12,49-51,60-61,76-78` | Replace the 22px/10px/9px/4px convention with the §3.4 header (`h-10`, 14px) and `gap-3 p-3` body; delete the "body stays at 9px" rule from the docstring. | Neither lane — shared primitive, **remains** |
| 3 | HIGH | `OptionsDockPanel.tsx:202,554,656,689,696,708,721,916` | Remove all inline 9/10px overrides → `text-[11px]`/`text-xs`; controls 22px→`h-[34px]`/`size="sm"` + `rounded-fin`; action cluster `gap-0.5`→`gap-2`; POSITIONS chip becomes a labelled 11px pair. | Neither lane — **remains** |
| 4 | HIGH | `chain.columns.tsx:31,52,71-83,123,251-292` + `OptionChainTable.tsx:31-32,321` | `CELL`→`text-[11px] leading-[14px]`; chart button 14px→20px; OI cell 13px→14px; badge 9px→11px; row 18px→22px and `minTableWidth` recomputed from the new sizes. | Neither lane — **remains** |
| 5 | HIGH | `OptionPositionsPanel.tsx:56-164,167-183,203-219` | Drop `dense`, drop the 12px scroll hint, hide BOOK/STATUS/MARK/DTE at 390 via `visibleColumns`; 9px badges→`h-5 text-[11px]`; render leg summary as a gapped list; give ADD LEG a real panel header with a count. | D — file not yet touched; **remains** |
| 6 | HIGH | `ReplayPanel.tsx:414,252,383-385` + `PaperOrderBand.tsx:265-269` + `chain.columns.tsx:197,245` | Add a `KeyValue`/`MetaRow` primitive in `@/ui` and replace every ` · `/` → `/` / ` string join (leg marks, underlying/expiry, NET DEBIT, tooltip copy). Footnote `truncate`→`line-clamp-2`. | Neither lane — **remains** (highest leverage: removes most "inline mdash" complaints at once) |
| 7 | MEDIUM | `PaperOrderBand.tsx:220-261,263-271,279-288,298-319` | Field labels→`text-[11px]` with `gap-2` to controls; NET DEBIT/COSTS as labelled KeyValue rows; reserve a 20px height for the loading slot; buttons `gap-2` and `size="sm"`. | D — lane changed replay-session logic only; **remains** |
| 8 | MEDIUM | `AddLegDialog.tsx:150-157,160-177,179-241,262-275` | `size="md" p-6`, title `text-lg`, inputs `size="sm"`, chips `h-6 text-[11px]`, `gap-4` groups / `gap-3` fields, footer `pt-4 border-t border-fin-border-subtle`; remove duplicate group labels. | D — lane changed validation/reset logic only; **remains** |
| 9 | MEDIUM | `OptionsDockPanel.tsx:795-832,989-1000` + `LegBuilder.tsx:60-62,153-156` | Replace hand-rolled centred columns and bare warning lines with `EmptyState` (`kind`/`title`/`description`/`action`) and a tinted-rail warning band using `border-fin-border-warning`. | H for the convention, but these call sites are in the dock; **remains** |
| 10 | MEDIUM | `palette.ts:62-75` + `tailwind.css:17-26` + `compact.tsx:338` + `ReplayPanel.tsx:72,74` | Adopt the new tokens: section separators `border-fin-border-subtle`, panels `border-fin-border-default`, states `border-fin-border-negative/warning`, focus `border-fin-border-focus`; remove `CompactStat` card borders inside a bordered panel (use `divide-x`). | H landed the token definitions; adoption **remains** |

---

## 5. VERIFICATION PLAN

Run gates only with the lanes quiet. Check `cat /proc/loadavg` first; require ≥30% idle
(`top -bn1 | grep "^%Cpu"`) before Playwright, and confirm no orphaned workers afterwards
with `pgrep -af "vitest|pytest|playwright"`.

### Guards and unit tests (narrow, touched files only)

```
npx vitest run src/test/ui-guard.test.ts
npx vitest run src/ui/inputs/inputs.w-h.test.tsx
npx vitest run src/test/theme-single-source.test.ts
npx vitest run src/ui/layout/gridPrimitives.test.tsx
npx vitest run src/pages/options-replay/ReplayPanel.test.tsx
npx vitest run src/pages/options-replay/replayCharts.test.ts
npx vitest run src/components/options-paper/PaperOrderBand.test.tsx
npx vitest run src/components/options-paper/OptionPositionsPanel.test.tsx
npx vitest run src/components/options-paper/AddLegDialog.test.tsx
npx vitest run src/components/options-dock/chain.columns.test.tsx
npx vitest run src/components/options-dock/OptionChainTable.test.tsx
npx vitest run src/components/options-dock/LegBuilder.test.tsx
bun run contrast
bun run lint && bun run build
npx tsc --noEmit 2>&1 | grep -c "error TS"     # baseline 322; must not rise
```

Any new tint/rail/text pair added in §3.3 must be added to `src/test/contrast.test.ts` and
`scripts/check_contrast.ts` before `bun run contrast` is trusted (`docs/COLOR_SEMANTICS.md:54-62`).

### E2E (only the specs for touched surfaces)

```
npx playwright test \
  tests/e2e/options-paper-visual.spec.ts \
  tests/e2e/options-paper-dock.spec.ts \
  tests/e2e/options-paper-multileg.spec.ts \
  tests/e2e/options-dock.spec.ts \
  --workers=4 --output=/tmp/opencode/options-design-e2e
```

No `waitForTimeout`. The layout invariants spec to re-measure if any header/filter band moves:
`npx playwright test tests/e2e/market-screener.spec.ts tests/e2e/screener-inline-band.spec.ts --workers=4 --output=/tmp/opencode/options-design-layout`
— only if a shared primitive (`ToolbarRow`, `DockSection`, `CompactPanel`) changes height;
record `getBoundingClientRect()` before/after and Δ ≤ 1px in the commit message
(`docs/LAYOUT_INVARIANTS.md:45-52`).

### Screenshots — capture and READ BACK

`tests/e2e/options-paper-visual.spec.ts:19,54-58` writes full-page PNGs to
`/tmp/opencode/options-paper-shots/<state>-<1600|390>.png` and asserts each is >4KB.
Read **every** PNG back with the `read` tool; a small file, blank canvas or visible
`undefined`/`NaN`/`—` where a value belongs means the change is not done
(`UI_RULES.md` §5 / AGENTS.md UI Revamp Rules).

Existing states (8 × 2 viewports):

1. `dock-with-legs-1600.png` / `dock-with-legs-390.png`
2. `positions-modal-2-rows-1600.png` / `…-390.png`
3. `replay-preview-1600.png` / `…-390.png`
4. `replay-mid-scrub-1600.png` / `…-390.png`
5. `replay-committed-1600.png` / `…-390.png`
6. `replay-expired-1600.png` / `…-390.png`
7. `replay-empty-1600.png` / `…-390.png`
8. `replay-api-error-1600.png` / `…-390.png`

**Gaps in the current harness — add these captures in the same commit as the fix:**
`add-leg-dialog` (open state, 2 rows), `chain-loading`, `positions-loading`, `replay-loading`
(reserved-height check), and a **metric/state matrix** for every selector touched (each
chain side toggle CE/PE at 390, each analytics tab if touched). For each shot, eyeball that:
section headers read at a different weight/size from body copy; no two text runs touch without
a visible gap; no `9px` micro-text; table values are 11px+ and aligned; the 390 shot has no
horizontal scroll; and no bordered card sits inside another bordered panel.

Finally, re-run `docs/market/reports_index.py --check` only if any `reports/**` artifact is
regenerated as evidence; no report HTML should be added for this work.

---

## Fix status (2026-11-23 — final worktree check)

Read directly from the current worktree (`git diff --stat`: 41 modified + 8 new files; no
staged changes). `LANDED` = the edit is present in the file. A LANDED row can still carry a
`Still open` caveat — it is **not** a claim that the whole §4 finding is finished. This status
pass read files only: it did not run a build, E2E suite or screenshot capture.

### LANDED

| §4 | Theme | What is in the worktree | Still open (honest caveats) |
|---|---|---|---|
| 10 | Semantic borders | The 9 tokens + light overrides in `palette.ts` / `tailwind.css` are now adopted, not just defined: `DockSection`, `OptionsDockPanel`, `ReplayPanel`, `PaperOrderBand`, `OptionPositionsPanel` and `AddLegDialog` use `border-fin-border-subtle` / `-default` / `-warning` for separators, selected edges and rails. | `CompactStatGrid` (`compact.tsx:338`) still uses `divide-x divide-fin-border` (old token). Adoption is per call site, not enforced by a guard. |
| — | `Grid` / `Row` / `Col` | `Grid.tsx` gains `cols` / `gap` / `rows` / `flow`; new `Row.tsx` and `Col.tsx` are exported from `src/ui/index.ts`; new `gridPrimitives.test.tsx`; `COMPONENT_AUDIT.md` regenerated (98 components, 66 tested, 0 violations). | The options surfaces still use ad-hoc `grid grid-cols-1 lg:grid-cols-2` / JS `isNarrow()`; the primitives are available and tested but not adopted by these screens. |
| 1 | Full-screen replay | `ReplayPanel` root is `h-full min-h-0 w-full`; titled `WorkstationPanel` sections; two-up chart band `lg:grid-cols-2 gap-4` with `min-h-[240px]`, no `max-h`; pinned playback and legs rows; centred `EmptyState` with an `Open Options Dock` action; stat values are now 12px `font-mono tabular-nums`, right-aligned. | Root still `gap-1.5` (6px); `WorkstationPanel` header still `h-6` / 10px; `STAT_VALUE_SHRINK` still ellipsizes values; narrow stats are 4-up (legs 2-up), not the §3.5 2-up; footnote is still a truncated bare `Text`. |
| 1 | Deep-link header | `OptionsReplayPage` reads `underlying` / `expiry` from the query string and passes `hintUnderlying` / `hintExpiry` to `ReplayPanel`, which renders them as labelled chips before a structure loads; page title is `size="lg" fw={700}` with a separate description node and stable test ids. | — |
| 2, 3 | Dock type scale | `DockSection` header 22px/10px → `h-10` with a `size="sm" fw={600}` title, `gap-3 px-3 py-3` body, `-subtle` separator, and the "body stays at 9px" docstring removed. `OptionsDockPanel` inline 9/10px overrides are gone: 11px / `h-8` / `rounded-fin` controls, `gap-2` clusters, a split `N strikes` count, `EmptyState` for error/empty, reserved `min-h-[160px]` loading slot, `border-l-2` error rail. | `POSITIONS {n} · P&L` and `closed · as of …` remain inline connector fragments, not a `KeyValue` pair. |
| 4 | Chain + shared table metrics | `chain.columns.tsx`: `CELL` → 11px / `leading-[14px]`, 20px chart button, 11px strike badges with `gap-2`, `NumericCell` adds `aria-label="unpriced"`. `TanStackTable.tsx` adds `TABLE_METRICS` (`default` 32px / 8/12 / 12px, `comfortable` 36px, `dense` 18px kept as a contract) and re-applies header font size after column changes; `BadgeCell` defaults to `sm` / 11px / 18px. `OptionPositionsPanel` drops `dense` and overrides cell metrics at the wrapper. | The chain table still opts into `dense` (18px row) and its `minTableWidth` values are unchanged — that density is contractual for the 9-column chain. |
| 5, 7, 8 | Paper surfaces | Positions panel gains a titled `PAPER BOOK` header, 11px cells, `size="sm"` ADD LEG, subtle dividers and an 11px scroll chip; the band uses 11px labels/controls, `gap-2` fields and reserved chip/loading slots; the dialog uses grouped `gap-2` sections with `border-t` dividers, 11px validation text, `size="sm"` inputs and hardened duplicate detection. | No count in the positions header (earlier status claimed one — it is not there); the scroll hint is retained instead of `visibleColumns` responsive hiding; the modal is still not `size="md"` / `p-6` with a `text-lg` title. |
| 9 | Empty states | `EmptyState` is now used by replay, positions, dock error/empty and `LegBuilder`'s legs-empty; the legs expiry-mismatch warning is a tinted `border-fin-border-warning` rail. | — |
| 6 | `KeyValue` primitive | New `src/components/common/KeyValue.tsx` + `KeyValue.test.tsx` export `KeyValue`, `KeyValueGrid`, `KeyValuePair` and `Delta` (tone / mono / dense / align); listed in the regenerated `COMPONENT_AUDIT.md`. | **No production surface imports it yet.** The ` · ` / ` → ` / ` / ` joins in replay legs, the POSITIONS chip, band NET DEBIT and tooltip copy are still string concatenation. The primitive landed; the call-site migration did not. |
| — | E2E spec refresh | `tests/e2e/options-paper-dock.spec.ts` now mocks `GET /options-paper/replay/sessions` and returns a non-empty replay frame (spot / marks / P&L / coverage) so the dock → replay flow has data to render. | Mock/harness change only — **no E2E run was performed for this status pass**. |

### REMAINING — genuinely not done

| Item | Status |
|---|---|
| Legacy options-report surfaces named in §1 | Untouched — no options-report file appears in `git diff`. The dock, replay and paper-order surfaces were revamped; those report screens were not. |
| Chart ink labels (`replayCharts.ts`) | Untouched — 12px `PLAYHEAD` / `SPOT` mark labels and axis text painted on the lines, magic 12/16/18/26px grid insets, and no legend in the host panel. §3.4's 11px labels + legend/key were not applied. |
| `KeyValue` call-site adoption | The primitive exists and is tested, but the inline-fragment joins it was meant to replace are still present (see LANDED row 6). |
| `CompactStatGrid` token, replay 6px/10px/ellipsis residuals | Named in the LANDED caveats above; not fixed. |

**Final E2E run and the 1600/390 screenshot refresh are pending the main agent.** They are not
part of this status pass and must not be reported as done. Per `UI_RULES.md` §5, every PNG still
has to be captured at 1600 and 390, read back, and checked for plausible values, no `undefined`
/ `NaN` / stray `—`, no horizontal scroll and no nested bordered cards before this revamp is
called complete.
