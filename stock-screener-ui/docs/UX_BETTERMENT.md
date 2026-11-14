# UX Betterment Review — dense terminal surfaces

Read-only review: `TanStackTable`, the Patterns workspace, the Daily Report, and the Screener.
No browser, no build, no code changes. Findings are ordered **impact ÷ effort** across the whole
document; each surface's list is a slice of that same ranking.

Ranking lens: a professional scanning hundreds of names at speed. The cost of a finding is measured
in *wrong reads* (a trader acts on a value that says the opposite of the truth) and *lost time*
(hovering, re-running, guessing). Cosmetic-only items are last.

Legend: **Cost** = what the user actually loses. **Fix** = smallest change, one or two sentences.

---

## 1. Shared table primitive — `src/components/common/TanStackTable.tsx`

Everything below appears on all four surfaces, so this is the highest-leverage section.

### F1 · The selected / active row is not visible at all (structural, not styling taste)

**Cost.** Both Patterns views mark the row that owns the docked chart by passing `getRowStyle`
(`background` + inset shadow) to the `<tr>`. Every cell then paints an **opaque**
`background-color: SURFACE` inline (`TanStackTable.tsx:281–306`), which paints over the row box.
The only active-row rule in CSS is `.trade-row-highlighted`, which these tables never use. So after
clicking a row — or hovering to preview — the user cannot see which symbol the chart belongs to,
which is the single most important "where am I" cue in a two-pane terminal. This also silently
breaks any future selected-row state built on `getRowStyle`.

**Fix.** Add one shared rule keyed on the existing `data-active` attribute (and on `getRowStyle`'s
intent) that colours the cells, not the row, plus the inset marker on the first cell — mirroring
`.trade-row-highlighted` which already does exactly this correctly.

---

### F2 · Long tables silently stop at 80–100 rows

**Cost.** `rowWindowSize` is a hard `items.slice(0, N)` with no scroll listener and no disclosure
(`TanStackTable.tsx:427–434`). Patterns matrix caps at 80, Screener at 80 once a section exceeds
120, F&O at 100, Sector at 40. The scrollbar ends at row 80, so the surface genuinely ends there:
a trader who scans "hundreds of names" reads the top 80 as the whole result set. Sorting still
operates on the full model, so the *composition* of the 80 is right — which makes the truncation
even more believable and more dangerous.

**Fix.** Either render the remainder on scroll, or print a fixed footer line ("showing 80 of 312 —
scroll to load") and keep the count in the panel header. The disclosure alone is a one-day change
and removes the false negative.

---

### F3 · "No data" and "loading" share the same look, and the empty text is styled by a class that does not exist

**Cost.** The empty state is a raw `div` with `className="text-xs c-dimmed"`
(`TanStackTable.tsx:492`). There is no `.c-dimmed` rule anywhere in `style.css`/`tailwind.css` and
Tailwind does not generate it — the text silently renders at full `#E8E8E8` (the same colour as
data) at 12px instead of the dense 11px muted style. A blank table therefore reads as *content*
rather than *absence*, and it does not match the neighbouring "loading" row, which uses the shared
`Text` component properly.

**Fix.** Use the kit `Text size="xs" c="dimmed"` for the empty message (the same pattern every panel
already uses) and give the loading row the same row height so the region does not jump between
states.

---

### F4 · Sort state is invisible before the first click, and third click removes it with no residue

**Cost.** `initialState.sorting` seeds several tables (Breakouts by `% Above`, Follow-through by
`Ret %`, F&O by `+2% est.`), but a table sorted *in code* before render — the Patterns matrix sorts
by conviction in `visibleRows` — shows **no** indicator at all: the order is real, the header says
nothing. Meanwhile the default third click clears sorting (`enableSortingRemoval` true), leaving
server order with no "unsorted" affordance. There is also no `aria-sort`, so the arrow exists only
as appended text inside the `<th>`.

**Fix.** Seed `initialState.sorting` wherever the rows are pre-sorted (matrix), and add an explicit
`aria-sort` to the `<th>`; when sorting is cleared, render a faint neutral glyph so "no arrow" no
longer means both "sorted elsewhere" and "nothing sorted".

---

### F5 · No keyboard row navigation, no row-level enter hint

**Cost.** Rows are `tabIndex=0` only when `onRowClick` exists and respond to Enter/Space, but there
is no up/down between rows and no visible cue that Enter opens the chart. A trader working a
watchlist has to move hand to mouse for every name. The table is dense enough that keyboard
stepping is materially faster than pointer work.

**Fix.** Add ArrowUp/ArrowDown to move focus between rows (the Patterns page already binds arrows
for chart stepping, so scope the table handler to the focused table) and show the active key hint in
the panel header rather than in a tooltip.

---

## 2. Patterns workspace — `src/pages/patterns/PatternsPage.tsx`, `src/components/patterns/*`

### F6 · Filter controls that require a re-scan apply instantly and silently do nothing

**Cost.** `min_rel_volume`, `min_volume_m`, `min_avg_volume_10d` are **scan-time** pre-filters: they
are only sent in `startScan` (`state/chartPatterns.ts:895–903`). They sit in the same filter modal,
styled identically to result-level filters, and "Apply filters" only reloads results. A user sets
"Rel vol ≥ 2", applies, and the table does not change — so they conclude the filter is broken, or
worse, believe the universe was filtered when it was not.

**Fix.** Mark the three volume controls with a "scan-time" tag in the rail, and when an apply
changes any of them, make the primary action read "Apply + re-scan" (or show a one-line banner
"volume limits apply on next scan").

---

### F7 · Four names for two actions in one band

**Cost.** Within ~40px of screen the user meets **Scan again** (`UniverseBar.tsx:79–83`),
**Refresh** in the empty state, **Force refresh** in the ⋮ menu, and **Force re-run** on the cached
chip. Only one of them clears the candle cache; three of them are named as if they do. Choosing
wrong costs minutes (a full re-scan) or produces stale results (a refresh).

**Fix.** Keep one primary "Scan" button and one clearly-labelled destructive-adjacent
"Re-scan (clear cache)" in the overflow; delete the other two labels.

---

### F8 · The dense empty-state copy literally prints `patterns()` and `filters()`

**Cost.** `PatternsPage.tsx:929` renders *"No patterns() match the current filters()."* — visible
empty-state text with parentheses and lowercase code identifiers. It is the first thing a new user
sees when a filter is too tight, and it reads as a broken build.

**Fix.** Replace with plain prose ("No patterns match the current filters.") and keep the code term
out of the string.

---

### F9 · Matrix glyph columns require a hover to decode

**Cost.** Each timeframe column shows ▲/▼ plus a small count. The arrow meanings (bullish/bearish)
and the number (how many patterns on that TF) exist only in a `title` (`PatternSymbolMatrix.tsx:171–188`).
A trader scanning columns sees red/green marks with an unexplained digit. Worse, the row also has a
separate "Patterns" chip column, so the same information appears twice in two encodings.

**Fix.** Put a one-line legend in the matrix header ("▲ bull · ▼ bear · n patterns") and drop the
count from the glyph since the chip column already enumerates the hits.

---

### F10 · Three unexplained abbreviations in one toolbar row: TLS/TLR, IDX, Bars

**Cost.** `TLS/TLR` is a switch whose meaning lives in a tooltip only (`PatternsPage.tsx:741–751`);
`IDX` is the leftSection of an All/Big/Other select (`:796`) that does not say "index group"; `Bars`
is a lookback count with no statement that a bar is timeframe-dependent. The rail then repeats
TLS/TLR as "Support only / Resistance only", so the abbreviation is defined *somewhere else*.

**Fix.** Rename the switch to "S/R lines" (full words), the group select to "Group", and give Bars a
tooltip that names the current bar size; keep TLS/TLR only as the tooltip's expansion.

---

### F11 · Multi-timeframe selection is invisible in List and Grid

**Cost.** Selecting 3 timeframes expands the Matrix into 3 columns, but List and Grid show only the
primary TF, disclosed by a 10px muted "List/Grid: 1D" (`PatternsPage.tsx:775–784`). Users switch to
List to compare and silently lose two thirds of their scan.

**Fix.** Make the view toggle show the active TF per view (e.g. "List · 1D") or put the full TF set
in the panel header, not a side-note after the control.

---

### F12 · The stat strip has a duplicate counter and an unexplained raw value

**Cost.** When filters are active, `displaySummary` assigns `patterns` **and** `in_view` the same
number (`PatternsPage.tsx:365–374`) → two adjacent counters always identical, which trains the user
to ignore the strip. "Last candle" prints `summary.data_through` raw (an ISO date) in a 30px band,
next to "Last scan" as a relative age — two different time formats, no unit, no timezone.

**Fix.** Drop `In view` (or make it the filtered count and `Patterns` the universe count); format
the candle stamp as `d MMM HH:mm` with an IST marker, matching the report's own convention.

---

### F13 · Clickable counters look exactly like static counters, and clicking filters instead of sorting

**Cost.** In `ScanStats`, "Confirmed" and each half of "Bull / Bear" are clickable filters, with
affordance limited to cursor + hover background and the real meaning buried in `title`
(`ScanStats.tsx:92–158`). Everywhere else in this app a counter click sorts. A user who clicks
"Patterns" gets nothing; a user who clicks "Confirmed" mentally changes the ordering and instead
silently narrows the data set.

**Fix.** Give the two filterable counters a visible chevron/pill outline and label the tooltip as
"filter", and make them toggle-visible (pressed state) so the active filter is legible without the
chip row.

---

### F14 · Preview vs pinned chart is an invisible state

**Cost.** Hovering a symbol for 300ms opens a preview (closes 800ms after leave); clicking pins it.
Nothing in the docked panel says which mode it is in (`patternsFullscreen.ts:393–501`). Moving the
pointer to read the chart can therefore replace it or dismiss it, and after a click the user cannot
tell whether the next hover will overwrite their selection.

**Fix.** Add a PREVIEW / PINNED chip in the chart header (one badge, driven by the existing
`pinned` flag), and dim the row stripe for previews vs solid for pinned.

---

### F15 · Two different destinations from one row, with the primary-looking target going external

**Cost.** In the matrix and list, the symbol text is a TradingView link (`SymbolLink` default
`tvLink=true`) while the tiny candle icon opens the in-app chart and the row click opens the docked
chart. In the Screener the same inversion repeats (`ScreenerTable.tsx:152–203`). The largest, most
obvious target is the one that leaves the app — the opposite of the terminal expectation, and it
also makes every symbol permanently underlined in a dense table.

**Fix.** Make the symbol text the in-app chart action and move TradingView to the hover icon
(existing `tvIcon`), or demote the underline to hover-only so the row reads as data, not as links.

---

### F16 · "Score" means two different numbers, and neither states its range

**Cost.** Matrix `Score` is `best.confidence` (pattern-fit); List `Score` is the same field with a
tooltip clarifying it is *not* breakout conviction; the filter rail then offers `Score ≥` **and**
`Breakout ≥` as separate 0–100 inputs (`PatternFilterRail.tsx:692–716`). The same word therefore
means "shape fit" in one place and an unexplained 0–100 in another.

**Fix.** Rename the fit metric to "Fit" everywhere (matching the existing tooltip's own wording) and
put the 0–100 range in the rail section labels.

---

### F17 · Applied-filter chips have a pluralisation bug and mix four naming families

**Cost.** `AppliedFilters.tsx:318` renders `${group}s` → "Familys", "R:Rs", "52Ws". Adjacent chips
use "Formed", "Base", "Range", "Score", "Breakout", "Volume", "Trendlines" — four of which are also
column headers with different meanings. The user must re-derive what each chip narrows.

**Fix.** Use a lookup for the plural labels (Family → Families, R:R → R:R, 52W → 52W) and align chip
group names to the rail section titles.

---

## 3. Daily Report — `src/pages/report/DailyReportPage.tsx`, `src/pages/report/*`

### F18 · `52W gap %` prints the correct sign but colours it the opposite way

**Cost.** `ReportBreakoutTable.tsx:173–185` passes `-to_52w_high` as the value and then formats
`formatPercentage(-v)`. The **text** ends up showing `to_52w_high` while the **tone** is derived
from its negation. A stock 2% above its 52-week high prints a red **+2.00%**; a breakdown 30% below
its high prints a green **−30.00%**. In a table whose entire purpose is separating breakouts from
breakdowns, the colour is exactly inverted, and colour is what a trader reads at speed.

**Fix.** Compute text and tone from the same signed value (one variable, one formatter) and state
the direction in the header ("52W gap % · negative = below high").

---

### F19 · The page lands on the third tab, and the first tab is misnamed

**Cost.** Default state is `tab = "breakouts"` (`DailyReportPage.tsx:68`) while the strip renders
Scan · Breakouts · Moves · Follow-through · Events. A first-time user opens the page with a
mid-strip tab active and no model of the first tab; and "Scan" actually shows breadth plus
sector/theme leaders (`:470–537`), not a scan. Two competing mental models for one page.

**Fix.** Default to the first tab and rename it "Breadth" (or "Overview"); if Breakouts is the real
home, move it to position one and make it the default.

---

### F20 · Copy actions are page-global but only copy breakouts

**Cost.** `Copy CSV` / `Copy symbols` sit in the identity band next to date and universe
(`:404–434`) and always serialise `breakoutCsvRows()`, even while the Moves or Events tab is in
front. Clicking "Copy symbols" on the Events tab yields a breakout list — a silent wrong-data
handoff into a spreadsheet or a broker.

**Fix.** Move both buttons into the Breakouts panel header (where the data is), or disable and
relabel them as `Copy breakouts` when another tab is active.

---

### F21 · "as of HH:mm" cannot be trusted across tabs, and "(cached)" is a whisper

**Cost.** `asOf` is `daily().as_of ?? breakouts().as_of` (`:299`), so the timestamp under the title
may be from a *different section* than the one on screen; it shows time only — no date, no timezone
— and cached-ness is a dim parenthetical (`:405–414`). On a historical date the label still reads as
a live cutoff. The same logic appears nowhere else, so there is no cross-page definition of
"cached".

**Fix.** Bind the stamp to the active tab's payload, always render date + time + IST, and promote
CACHED to a proper chip (the same `ScanCacheChip` vocabulary the Patterns page already has).

---

### F22 · Follow-through's `Held` and `Max fav %` are unexplained, and an empty delivery strip is indistinguishable from a failed one

**Cost.** `Held` is a bare ✓/✗ with no header tooltip and no statement of what "held" means (close
above the broken level every session since), and `Max fav %` is maximum favourable excursion with no
definition (`ReportFollowThrough.tsx:94–113`). Separately, the delivery block returns **nothing**
when rows are empty (`ReportDeliveryStrip.tsx:41`), so "no high-delivery names today", "bhavcopy not
published", and "the section never loaded" all look identical.

**Fix.** Add one-line header tooltips to `Held` and `Max fav %`, and render a single collapsed line
for delivery ("NSE bhavcopy · 0 names") instead of hiding the panel.

---

### F23 · Section-level loading is multiplied, and a past date reads like a live page

**Cost.** Each of the five sections has its own skeleton and its own independent load
(`:531–697`), so a half-loaded page shows several spinners with no way to know whether the page is
still working. The date stepper also has no "Today" reset and no guard against future dates, and a
future date produces the ordinary empty message (`No unusual moves or breakouts for <date>`) rather
than stating that the session does not exist yet.

**Fix.** Show one page-level progress line that names the sections still loading, add a Today
button next to the date, and clamp/mark future dates explicitly.

---

## 4. Screener — `src/components/screener/ScreenerPage.tsx`, `src/components/screener/*`

### F24 · Missing prices render as `₹0.00`

**Cost.** `rupeePrice` returns `₹${(value ?? 0).toFixed(2)}` (`columnHelpers.ts:25`), used by the
52W and trending LTP/price columns. A null quote — halted, not subscribed, provider mismatch —
prints **₹0.00**, which a trader will read as a real (catastrophic) price. This is the same class of
error as F18: the cell asserts something the data does not say.

**Fix.** Return `—` for null/undefined (the file already has `fixedCellDash` for exactly this) and
reserve `₹0.00` for a genuine zero.

---

### F25 · Filters are read-only badges here and editable elsewhere, with one Apply button serving both

**Cost.** The context band shows `Filters:` chips read from the profile (`ScreenerInlineFilters.tsx:101–145`)
and an **Apply** button that re-fetches. Editing happens only in the **Config** tab. To a user the
chips look like removable values with an Apply action, so clicking one does nothing and the mental
model of "where do I change this" is wrong. `Apply` also does not say it means "re-run the scan".

**Fix.** Make each chip a link into that screener's Config section (same profile selected) and
rename Apply to "Re-run scan"; or drop the chips here and show only the count.

---

### F26 · Three unlabelled controls in the toolbar, one of them a bare number

**Cost.** `ScreenerHeader` renders a refresh icon, a `NumberInput` (30), a provider select ("Upstox
/ IND") and a mode select ("Intra / 5D") with no visible labels (`ScreenerHeader.tsx:35–86`). The
number has a unit only in `aria-label` ("Auto-refresh seconds"). A new user cannot tell what 30
controls or what "Intra" vs "5D" changes.

**Fix.** Add `leftSection` micro-labels ("AUTO 30s", "SRC", "MODE") or a single "Data" popover that
groups all four with labels; no new band needed.

---

### F27 · A 148px slot repeats the active tab's name, and a 248px rail is inert

**Cost.** Every non-Screener tab renders a fixed-width text label ("F&O Momentum", "Market", "Event
calendar", "Deep Value") purely to stop the toolbar shifting (`ScreenerPage.tsx:277–332`) — it
duplicates the active tab two elements to the right and carries zero information. The Groups rail
(`GroupPerformancePanel`) then occupies 248px permanently but is not clickable in this page because
`onSelectGroup` is never passed (`:449`), so it only re-orders its own list.

**Fix.** Let the toolbar shrink and drop the placeholder text; wire the group rows to filter the
table (the handler already exists) or collapse the rail by default.

---

### F28 · Score is a filled badge that carries no colour, and every row repeats copy/chart chrome

**Cost.** `getScoreColor` is a stub that always returns `default` (`ui-helpers.ts:362`), so the score
renders as a solid badge with no encoding — it looks like a graded signal and is not. Each row also
carries a copy icon plus a chart icon plus optional FRESH/RETEST badges at 16px hit targets
(`ScreenerTable.tsx:173–200`), which is a lot of chrome per 23px row.

**Fix.** Render score as a mono number with a real tone ramp (or delete the badge), and move the
per-row copy into a row context action / keep it only in the section header (which already has
"Copy all").

---

### F29 · Both screener sections duplicate the same header furniture

**Cost.** "Approaching (n)" and "Touched (n)" each get a bordered panel, a description line and a
"TV symbols" copy button (`ScreenerContent.tsx:84–107`), even when one section is empty (it is then
hidden entirely, changing the page height). Two near-identical table headers plus the page status
"265 stocks" make three counters for two lists.

**Fix.** Merge both sections into one table with a section column/group header, or keep the panels
but move the copy action to a single page-level action and state the counts once.

---

## 5. Cross-surface vocabulary

### F30 · Number formatting changes between surfaces

**Cost.** Prices use `en-US` grouping in the Patterns matrix (`patternFormat.ts:57`), `en-IN` in
F&O (`fnoColumns.ts:54`), and plain `toFixed` with no grouping in the report
(`ui-helpers.ts:11`). Indian users read `1,23,456` and `123,456` as different magnitudes for a
moment, and the same ₹ price can render three ways across pages opened side by side.

**Fix.** Point every price formatter at one shared `formatRupees` (en-IN, 2dp, `—` for null) and let
the report/F&O/matrix call it.

### F31 · Freshness has four vocabularies

**Cost.** "Fresh / Cached · 12 min ago / Cache 43%" (Patterns), "(cached)" (report),
"STALE 4m" (Nifty report), "as of HH:mm" (report), plus `updated_at` phrasing elsewhere. A pro
cannot form one rule for "can I trust this number", which is the whole point of a freshness label.

**Fix.** Fix one enum (LIVE / CACHED·age / STALE·age / CLOSED) with one chip component, and reuse it
in all four places.

### F32 · Dense tables carry no column-meaning affordance

**Cost.** Abbreviations that are never expanded in-place: `POP %`, `OTM %`, `COST`, `CALL`
(a strike string like "1230 CE"), `+2% est.`, `Vol ×`, `vol_adj`, `TLS/TLR`, `S1`/`R1` in pivots.
`DTE` is the only one explained (in the expiry option label). Hover titles exist on a minority of
headers; there is no shared convention.

**Fix.** Make header tooltips mandatory on any column whose header is not a word (a single
`header` helper that always renders `title`), and state the unit in the header itself where the
column is already wide enough (`POP %`, `OTM %`).

---

## Top 5 do first

1. **F1 — make the selected row visible.** One shared rule that colours cells (not the `<tr>`);
   without it, the right-hand chart and the highlighted row can never be reconciled.
2. **F2 — stop tables at 80 rows silently.** `slice()` with no disclosure turns a 300-name scan into
   a 80-name scan; either continue on scroll or print "showing 80 of N".
3. **F18 — fix the `52W gap %` sign/tone inversion.** The table currently paints breakouts red and
   breakdowns green; this is the highest risk of a wrong trade in the whole review, for a two-line
   change.
4. **F6 — flag scan-time filters.** Rel-vol / volume / 10d-avg controls look instant, are not, and
   teach the user the filters are broken; a tag plus "Apply + re-scan" fixes the trust gap.
5. **F24 — never render a missing price as `₹0.00`.** A null quote must be `—`; the same
   "assert less than you know" principle as F18 and the cheapest guard against a false read.

Runner-up worth doing in the same pass: **F15** (symbol text goes to TradingView while the row goes
to the in-app chart) — it is the click inversion every pro trips on first, and the `SymbolLink`
props to fix it already exist.
