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
| View | table · map · movers · dock · standalone page |
| Input | mouse · keyboard · narrow/touch |
| Theme | dark · light |
| Persistence | reload · URL · localStorage |
| Ancestry | inside `overflow:hidden` · inside scroll container · inside transformed parent |
| Concurrency | rapid switching · double click · request race |

A row is only "covered" when a **named test** asserts it. "Looks right" is not
coverage; neither is "the component renders".

---

## 2. Universal invariants

These hold for every feature. Each has (or needs) one standing test.

1. **Empty states explain themselves.** If the payload carries `error`/`note`,
   the empty state renders both. A blank panel is a bug even when the data is
   genuinely missing.
2. **One selection truth.** Every affordance that opens a chart (row click,
   symbol text, chart icon, map tile, arrow key, deep link) leaves the list
   highlighting the same symbol.
3. **A filter that fixes a field hides that column.** Sector pinned → no SECTOR
   column. One universe → no universe column. Constant columns are noise.
4. **Multi-select means N of everything.** N selections → N chips → removing one
   leaves the other N−1 and keeps the filter active.
5. **Floating UI is provably visible.** Assert `getBoundingClientRect()` inside
   the viewport **and** that `document.elementFromPoint(centre)` resolves to the
   floating element. Test it inside the real ancestor (`overflow:hidden`, scroll).
6. **Theme is reactive.** Computed background/surface/text change and persist
   across reload; no component may capture `data-dark` once at creation.
7. **Keyboard parity.** Every pointer action has a key path, and the focused
   element is visibly focused.
8. **URL round-trips.** State that should be linkable is written on change and
   restored on load.

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

## 5. How an agent must use this

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
