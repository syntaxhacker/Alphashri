# Folder & file restructure — plan

## Why (measured, not assumed)

| Evidence | Number |
|---|---|
| `jscpd` literal clones (`src`, 8 lines / 60 tokens) | **31 clones, 0.48% of lines** |
| Files hand-rolling a `TanStackTable` | **58** |
| Files declaring their own `const columns` | **44** |
| Files importing the shared `tableCells` kit | **5** |
| Files in `src/pages/report/` | **121** (63 components, 19 `nifty*` helpers, 9 `Report*`) |
| Column-definition files | **52** |

So: duplication is *not* copy-paste (0.48%). It is **structural** — 44 files each re-declare a
column array, and only 5 use the shared cell kit. That is what makes the codebase hard to
navigate and what makes an agent (or a human) re-invent a table every time.

The fix is not "move files around". It is: **one canonical place per concept**, then point every
consumer at it. Directory moves come *after*, and only where they reduce search cost.

---

## Target structure

```
src/
  components/
    table/                      ← NEW: everything about rendering tabular data
      TanStackTable.tsx         (moved from common/)
      cells.tsx                 (renamed from common/tableCells.tsx — the kit)
      columns/                  ← NEW: shared column factories
        index.ts
        symbol.ts  numeric.ts  badge.ts  pnl.ts  spark.ts
        alignment.ts            (meta.align helpers + numeric-id inference)
      states.tsx                (empty / loading / error wells — moved from common/)
    common/                     ← only cross-feature widgets
      compact.tsx  Icons.tsx  SymbolLink.tsx  RangeInput.tsx  ...
  pages/
    report/
      components/               ← 63 Nifty*/Report* components
      helpers/                  ← 19 nifty*.ts pure modules
      panels/                   ← the 8 desk/strip boards
      DailyReportPage.tsx       ← page entry stays at the root
    patterns/
      components/  helpers/     ← same split for the 55 files
```

Rules encoded by the layout:
- A **table** lives in `components/table/`. A **column definition** is either a factory in
  `components/table/columns/` or a `*.columns.ts` next to its consumer — never inline in a page.
- A **pure function** goes in `helpers/`; only a component file imports `solid-js` + JSX.
- Page entries stay at `pages/<feature>/` so routes are obvious.

---

## Phases (each independently shippable, each verified)

### P0 — guardrails first (no moves)
1. `src/test/table-usage.test.ts`: any file that renders `TanStackTable` must pass an explicit
   `meta.align` for every column (or use a column factory). Fails today on the 39 files that
   don't → allowlist, shrink over the phases.
2. `src/test/no-inline-columns.test.ts`: a `*.tsx` page file may not declare `const columns`
   unless it is in `components/**`. Allowlist, shrink.
   These two stop the drift during the refactor instead of after it.

### P1 — extract the column factories (biggest win, no file moves)
Create `components/table/columns/` with factories that already encode align + formatting:

```ts
symbolColumn<T>(opts)        // SymbolCell + onOpen + optional secondary line
numColumn<T>(opts)           // NumCell, mono/tabular/right, optional signed + format
badgeColumn<T>(opts)         // BadgeCell, centred
textColumn<T>(opts)          // TextCell, left, truncating
sparkColumn<T>(opts)         // fixed-width sparkline cell
```

Then convert consumer by consumer, starting where duplication is worst. Each conversion is
mechanical and test-covered, so it can go out in small commits.

### P2 — dedupe the repeated table shells
58 files wrap `TanStackTable` in the same `CompactPanel + header + filters` shape. Extract
`components/table/DataPanel.tsx` (panel + title + count badge + actions + `<TanStackTable>`),
then collapse the shells.

### P3 — directory moves (only after P1/P2)
- Move `common/TanStackTable.tsx`, `common/tableCells.tsx`, `common/states.tsx` → `components/table/`.
- Split `pages/report/` into `components/ | helpers/ | panels/`.
- Split `pages/patterns/` the same way.
- Re-export from `components/common/index.ts` during the transition so nothing breaks mid-move.

### P4 — navigation docs for agents
- `docs/MAP.md`: "to add a table, do X; to add a column, do Y; pure helper → here". Written for a
  cold agent, with the three file paths it needs every time.
- Update `AGENTS.md` folder section to the new tree.

---

## Ordering rationale

P1 before P3 because moving files while 44 files still hand-roll columns just relocates the mess.
P0 before everything because without guards the counts regrow during the refactor.

## Non-goals
- No behaviour change, no restyle. Pure structure.
- No barrel-file explosion: only `common/index.ts` and `components/table/index.ts` re-export.
- Not touching `src/api/**`, `src/state/**`, `src/types/**` in this pass.
