# Table row recycling — keeping unchanged rows across a data change

`TanStackTable` renders its body with `<For each={visibleItems()}>`. Solid's
`<For>` keys by **reference** (`mapArray` compares `items[i] === newItems[i]`),
and the items used to be plain objects allocated fresh on every run of the
`bodyItems` memo:

```ts
items.push({ kind: "row", row: sortedData()[i], index: i });
```

`data` is a new array on any filter, sort or snapshot change — and in the market
screener even a *filter* that keeps object identity still produces a new array.
So every mounted row was disposed and re-created, and with it every cell, every
`<Box>` (a `createComponent` + `splitProps` + `mergeProps`), and every cell's
style effect.

**Measured** (happy-dom, 80 mounted rows × 14 columns, 120-row dataset, a
filter-shaped swap that keeps `row` object identity and only shifts membership):

| | median of 6 swaps |
|---|---|
| before | ~350 ms (256–632) |
| after | ~60 ms (4–120) |

Roughly **5×**. The first swap after mount is always the expensive one (it
creates the slots); steady state is ~40 ms.

The production description of the problem — "`mergeProps` / `splitProps` /
`cleanNode` dominate" — matches exactly what disappears when the `<tr>` is no
longer rebuilt.

## The fix: one stable slot per row key

A *slot* is a plain object with a **stable identity per row key**. `<For>` keys
on the slot, so an unchanged key is not touched at all; a changed key receives a
new frame through the slot's own signal.

```ts
type RowSlot = {
  kind: "row";
  key: string;
  frame: Accessor<RowFrame>;      // { row, index }
  set: (next: RowFrame) => void;
};
```

- `bodyItems()` builds slots via `ensureRowSlot(row, index)` /
  `ensureGroupSlot(value, rows, baseIndex)`, keyed by the existing `rowKey()` /
  `groupKey()`.
- An existing slot is **returned as-is** and its frame signal is updated. The
  signal's `equals` compares `row` by reference and `index` by value, so an
  unchanged row is a no-op.
- `renderRow(slot)` reads `frame().row` / `frame().index` inside every reactive
  position (`style`, `className`, `data-testid`, the spread attributes, and each
  cell's content accessor). Cells therefore re-render; the `<tr>` does not.

The registry (`Map<string, RowSlot>`) is pruned only when it has grown past
`2 × items + 64` entries, so a shrink (filter, collapse) does not cost a scan on
every keystroke. Pruning a slot only costs a re-mount for a row that is about to
unmount anyway.

## The second half: `numericColumnIds` identity

Keeping the `<tr>` was not enough on its own — the measured swap was still
~230 ms. Cause: `numericColumnIds` is a `createMemo` that returns a fresh
`Set<string>` on every data change, and it feeds `cellStyle()` → each cell's
`style` effect. A new `Set` identity re-ran that effect for all 80 × 14 cells
even though the columns were still numeric.

It now carries a content comparator:

```ts
equals: (a, b) => a.size === b.size && [...a].every((id) => b.has(id)),
```

Cell style stays **reactive** (a column that becomes numeric after mount still
re-aligns — `TanStackTable.test.tsx` covers that), it just no longer fires on
every data swap.

## What is deliberately unchanged

- Sorting, filtering, grouping and expansion semantics.
- `rowWindowSize` (page size + `load more`), the footer disclosure.
- All test ids, class names and DOM structure (`tr` → `td` → cell content).
- `index` is still the position in the **sorted model**, not the mounted
  position, exactly as before (`row.index` consumers: `Profitability`,
  `AggregatedDashboard`, `ReplayTradeLog`, `AdminPatternTimeframesPanel`).

## Regression tests

`src/components/common/TanStackTable.test.tsx` captures `tbody tr` before and
after a data swap and asserts **node identity** for:

| test | covers |
|---|---|
| keeps the `<tr>` DOM node of an unchanged row when data is replaced | plain body, changed cell still updates |
| keeps unchanged rows mounted when the visible set is filtered | membership change |
| keeps group header rows and their leaf rows stable across a data change | `kind: "group"` interleaved with rows |
| keeps the sub-row open across a data change | `getRowCanExpand` + `renderSubComponent` |
| reuses row nodes even with a row window applied | `rowWindowSize` |

All five **fail on the pre-slot implementation** (verified by restoring the old
file from a `/tmp` copy and re-running: 5 failed / 38 passed, vs 43 passed with
the fix) — they are reference-identity assertions, not proxies.

## Known limits

- Without `getRowTestId`, `rowKey()` falls back to `String(index)`. Identity is
  then positional: a reorder re-uses the slot at that position for a different
  row. That is no worse than before (the whole body remounted) and cells still
  update correctly, but row-local DOM state (focus, a CSS transition mid-flight)
  can land on the wrong row. Consumers that want true recycling must pass
  `getRowTestId` — 40+ already do.
- `windowEnd` still resets on every `data` change (`createEffect` on
  `props.data`), so clicking `load more` then filtering collapses the window
  again. Unchanged by design; not addressed here.
- The benchmark above is happy-dom, not a browser. It measures re-render work,
  not paint. No profiler trace was taken in a real browser in this change.
