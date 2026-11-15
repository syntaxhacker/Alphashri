# Test scenarios — the matrix every UI brief carries

This exists because four recent defects were all **tested** and all shipped:

| Bug | What the tests asserted | What nobody asked |
|---|---|---|
| Selecting a sector left a constant SECTOR column | the filter returns the right rows | if a filter fixes a field, is that field still informative? |
| Chart icon opened a chart but the row never highlighted | the icon calls `onOpen` | does *every* way of opening a chart set the list's selection? |
| Stale tooltip clipped by the toolbar | the tooltip renders with `position="bottom"` | is it the **topmost element at its own centre**, inside the real ancestor chain? |
| `no_data` chart went blank | empty payload → empty state | does the empty state repeat the payload's `error`/`note`? |

Each was a **scenario** miss, not a coding miss. The fix is to enumerate states
before writing tests, and to make the enumeration part of the brief and the
return contract.

---

## 1. Axes — always enumerate all of them, mark N/A explicitly

| Axis | Values |
|---|---|
| Data state | loading · empty · error · stale/cached · partial (some fields null) |
| **Transitions** | **state × previous state**: ok→error · ok→empty · ok→ok (switch) · error→ok · **decay while mounted** (true at t0, false at t0+15m) |
| View | table · map · movers · dock · standalone page |
| **Ownership** | which control writes this value? (URL vs signal, rail sort vs header sort, list order vs rendered order) |
| Input | mouse · keyboard · narrow/touch |
| **Breakpoints** | the repo's real bands: `<1024` (drawer) · `1024–1199` (dock navigates) · `≥1200` (dock) · `≥1400` (in-flow dock) |
| Theme | dark · light |
| Persistence | reload · URL · localStorage · **overlay close→reopen** |
| Ancestry | inside `overflow:hidden`/`overflow-y-auto` · inside scroll container · inside transformed parent · **any absolute popup, not just tooltips** |
| Concurrency | rapid switching · double click · request race |

A row is only "covered" when a **named test** asserts it. A file name is not
coverage: `existing test: Foo.test.tsx` is a **GAP**; `existing test:
Foo.test.tsx › "pinning a sector hides the SECTOR column"` is coverage.

---

## 1b. Fixture fidelity — tests that measure a world the producer doesn't make

A mock is a **claim about the contract**. Two failure modes, both found in this
repo:

- A mock that ignores the request parameter cannot test the switch:
  `setupValueScanMocks` returns the same Indian rows for `market=usa`, so
  "switches market" proves only that a URL was built.
- A fixture value that contradicts the producer's units makes the UI look
  broken and the test pass: `pos_52w: 0.82` against a backend that sends 0–100
  draws every 52W bar at ~1%.

Rule: **when a mock varies a request parameter, at least one response field
must vary with it**, and fixture values must be copied from the producer's
contract (or a real captured payload), not invented. Enum vocabularies are the
same class: a frontend switch over `LOW_PE` and a backend that emits
`distorted-pe` are both "tested" and mutually unreadable.

---

## 2. Universal invariants

These hold for every feature. Each has (or needs) one standing test.

1. **Empty states explain themselves.** If the payload carries `error`/`note`,
   the empty state renders both. A blank panel is a bug even when the data is
   genuinely missing.
2. **One selection truth.** Every affordance that opens a chart (row click,
   symbol text, chart icon, map tile, arrow key, deep link) leaves the list
   highlighting the same symbol.
3. **A filter that guarantees a constant value hides that column.** Sector
   pinned → no SECTOR column; one cap tier → no CAP column; F&O-only → no
   per-row F&O badge. Constant columns are noise, not data.
4. **Multi-select means N of everything.** N selections → N chips → removing one
   leaves the other N−1 and keeps the filter active.
5. **Floating UI is provably visible — every absolute popup, not just tooltips.**
   Assert `getBoundingClientRect()` inside the viewport **and** that
   `document.elementFromPoint(centre)` resolves to the popup. Test inside the
   real ancestor: `overflow:hidden`, `overflow-y-auto`, scroll containers. A
   dropdown opened from the bottom of a scroller is clipped exactly like a
   tooltip.
6. **Theme is reactive.** Computed background/surface/text change and persist
   across reload; no component may capture `data-dark` once at creation. This
   includes **canvas and third-party charts**: a `createChart()` built once in
   `onMount` with palette constants stays dark in light mode (the sibling that
   gets it right: `PaperChart.tsx` subscribes to `useColorScheme`).
7. **Keyboard parity.** Every pointer action has a key path, the focused element
   is visibly focused, and the walk follows the **rendered** order (not a
   different list's order).
8. **URL round-trips.** State that should be linkable is written on change and
   restored on load.
9. **One value, one owner.** Two controls may not write the same concept. Rail
   sort vs header sort, URL `view` vs a `viewMode` signal, list order vs
   rendered order — pick one owner, make the other read from it, and assert the
   **observable** (rendered order / displayed count), not the setter.
10. **Time is a state.** A value true at t0 may be false at t0+15 min. Assert it
    flips without new data (stale badges, "last updated", countdowns).
11. **Overlays round-trip.** For any modal/drawer-hosted form, close → reopen
    and assert every control shows the **applied** value. A control that reads
    the accessor object (`filters.max_pb` instead of `filters().max_pb`) still
    passes `onChange` tests while displaying `""` / `false`.
12. **Every server-computed field has exactly one renderer.** Grep the payload
    keys (`fields_complete`, `cached`, `age_seconds`, `warnings`,
    `missing_fields`) and prove each is rendered or deliberately dropped. A
    field that travels to `meta()` and is read by nobody is a silent lie.
13. **No dead ends.** Every overlay has a dismiss path (close button **and**
    Escape), every empty state has the action that resolves it, and every
    error has a retry. If a test cannot close an overlay, that is the bug, not
    a test limitation.

---

## 3. Market tab

| Scenario | Expected | Test home |
|---|---|---|
| Sector selected (one) | only that sector's rows; SECTOR column hidden | `MarketScreenerPanel.test.tsx` |
| Two sectors selected | union of rows; two chips; SECTOR column hidden | `marketFilters.test.ts` |
| Remove one chip | other sector stays active, rows shrink to it | `marketFilters.test.ts` + panel |
| Clear all filters | column returns, rows reset | panel |
| Switch Table → Map → Table | same sort, same filter, same rows | `MarketScreenerPanel.test.tsx` |
| Arrow keys with nothing selected | Down selects first, Up selects last | `MarketScreenerPanel` + E2E |
| Symbol / icon / row / map click | dock opens **and** the row highlights | `tests/e2e/*market*` |
| Stale snapshot | Stale badge tooltip fully visible under the toolbar | `tooltip-position.spec.ts` |

## 4. Chart / dock

| Scenario | Expected | Test home |
|---|---|---|
| Candles present | chart renders, no empty state | `PatternFullscreenView.test.tsx` |
| `no_data` | "No chart data" + the endpoint's note + code | `PatternFullscreenView.test.tsx`, `ChartView` |
| `fetch_timeout` | same, with the timeout note | backend + payload fixture |
| Transport failure | error state with retry, previous candles kept | `ChartView.test.tsx` |
| BE/BZ symbol | resolves like an EQ symbol | `upstox_api` test |
| Timeframe switch during load | newest response wins (race) | hook test |

---

## 5. Deep Value

| Scenario | Expected | Test home |
|---|---|---|
| market switch succeeds | rows are the **new** market's (currency/company vary with the param) | `ValuePanel.test.tsx` + mock fidelity |
| market switch fails with rows on screen | error visible; old rows not presented as current | `ValuePanel.test.tsx` |
| switch mid-flight | old rows marked loading/stale, never silently current | hook + panel |
| `fields_complete: false` | partial-fundamentals disclosure | panel |
| stale cache served | a stale marker (not just an ISO string) | router + panel |
| preset selected | request carries it; a clear path exists | panel |
| drawer close → reopen | controls reflect applied filters | `ValueFilters.test.tsx` |
| drawer flag | the API's own flag vocabulary is explained | panel |
| export during a switch | filename and content are the same market | panel |
| NAME header sort | rows reorder, indicator matches | `ValueTable.test.tsx` |

---

## 6. Discovery prompts — how to *find* the next row

The matrix is the checklist; these are the questions that produce new rows.

1. **Invert the requirement.** "Show the sector" → what must *disappear* when the
   sector is fixed?
2. **Pair every success with its failure after success.** ok→error, ok→empty,
   ok→ok (different key), error→ok, and *while in flight*. One test per state
   from a fresh mount misses all of these.
3. **Propagate both directions.** For each payload field: who renders it? For
   each control: who else writes that value? (One owner.)
4. **Let it decay.** What is true now that will be false in 15 minutes, or after
   a scroll, a resize, a theme change? Assert the flip without new data.
5. **Walk the ancestors.** From every popup, listbox, menu, tooltip: up to the
   nearest `overflow`, `transform`, or scroll container. Measure
   `elementFromPoint`.
6. **Enumerate the real boundaries.** Not "narrow" — the actual breakpoints
   (`1023 / 1200 / 1400`), the actual caps (`rowWindowSize`, `max-h-60`), the
   actual units (`pos_52w` 0–100, market cap rupees/crore).
7. **Copy the contract.** Enums and units in fixtures must come from the
   producer. A fixture the API cannot emit is a false pass.
8. **Multiply the affordances.** Every way to open X must also do Y (select the
   row, write the URL, close the overlay).
9. **Tear down and reopen.** Close a modal, switch a tab and return, reload with
   the same URL.

If a scenario is found but not tested, it is not covered — it is a named risk.

---

## 7. How an agent must use this

The brief pastes the relevant rows. The return contract answers each one:

```
## Scenario coverage
| Row | Result |
|---|---|
| Sector selected hides column | test added: marketColumns.test.ts "hideSector" |
| Two sectors → two chips | test added: marketFilters.test.ts |
| Arrow keys with no selection | N/A — keyboard not touched |
```

Rules:

- **Reproduce first.** For a reported bug, the regression test must fail before
  the fix (temporarily revert from a `/tmp` copy, never `git checkout`).
- **No row may be silently skipped.** `N/A` needs a reason.
- **A passing test is not coverage if it asserts implementation.** Prefer the
  user-visible outcome (computed style, DOM text, row count, URL) over a spy.
- **Layout claims need numbers.** If the answer is "now it fits/visible", paste
  the before/after rects or the `elementFromPoint` result.
