# Layout contract (A+ composition)

Every page must read as a **Bloomberg/tastytrade terminal**, not a form with stacked boxes.
This file is the single spec the layout pass is judged against.

## 1. Chrome budget

Chrome = everything above the first data pixel (table row, chart, card grid).

| Page weight | Max chrome |
|---|---|
| Primary workspace (patterns, screener, report, options, paper) | **≤ 96px** |
| Secondary (settings, admin, strategies) | ≤ 120px |

Measure: `firstDataTop = min(top of table/canvas/card)`.

## 2. Band rule — no orphan rows

A row is **orphan** when it holds < 2 controls on the left and the rest is empty.
Forbidden composition:

```
┌ SCOPE pills ────────────────────────────┐   ← row 1
│                                          │
│                    [CACHED] [Scan again] │   ← row 2: ORPHAN (left 60% empty)
└──────────────────────────────────────────┘
```

Required: actions share a row with the controls they act on, pushed right by `margin-left:auto`.

```
┌ SCOPE pills ─────────────── [CACHED] [Scan again] ┐
```

Rules:
- **Never** give an actions cluster its own row. `ml-auto` on the same line.
- **Never** put a `border-t`/`border-b` between two rows that belong to one band.
- A band is **one** bordered row. Dividers only between *semantic* sections.

## 3. Three bands maximum

| Band | Height | Contents |
|---|---|---|
| Identity | 32–36px | page title/tabs + primary action (right) |
| Context | 24–28px | scope/filters/summary — one line, truncates |
| Tools | 32px | search, selects, view toggle, secondary actions |

If a page needs a 4th band, two of them merge.

## 4. Control row invariants

- `display:flex; align-items:center` + explicit `gap` (4/8/16 only). Use `<ToolbarRow>`.
- Every control in a row: **same height** (`size="sm"` = 30px, `xs` = 24px for chips only).
- Floating labels inside a row are forbidden → `placeholder` + `aria-label`.
- Child centre spread must be **0–2px** (measure `max(mid)-min(mid)`).

## 5. Fill rule

- The main data region fills the viewport: `flex:1; min-height:0` down the whole chain.
- Tables use `TanStackTable` with `fillContainer`; the **page never scrolls**, the table does.
- Route must satisfy `scrollHeight === innerHeight` and `scrollWidth === clientWidth`.
- Empty/loading states collapse; they never reserve the full data height.

## 6. Typography & numbers

- Labels: `10px`, `font-semibold`, `uppercase`, `tracking-[0.06em]`, `text-fin-text-muted`.
- Body/table: `11px`. Row height `h-6` (24px), dense `18px`.
- Every number: `font-mono tabular-nums`, right-aligned.
- Text left, numbers right, badges/actions centre (`meta.align` per column).
- Primary identifier column never truncates.

## 7. Colour

`palette.*` tokens only. No raw hex. No neon. Positive/negative only for signed values.

## 8. Anti-patterns (auto-fail)

- Stacked bordered cards inside a bordered panel.
- An actions cluster alone on its own row.
- A `<Divider>` used to separate what should be one band.
- A label above an input inside a horizontal toolbar.
- Fixed heights inside a flex panel.
- More than one loading indicator in a region.
- `gap-4`/`p-4` inside a dense panel.
