# Design language — "tastytrade desk"

Dense, high-contrast, calm. The screen should look like a professional options
desk, not a dashboard template: dark slate surfaces, one violet accent for
interaction, colour reserved for meaning (P&L, side, warnings), numbers always
aligned and tabular.

## Tokens (single source: `src/ui/palette.ts`)

| Role | Token | Value | Use |
|---|---|---|---|
| Body | `BG_COLOR` / `bg-fin-bg` | `#0B0D10` | page background |
| Panel | `SURFACE_COLOR` / `bg-fin-surface` | `#14171D` | cards, tables, chrome |
| Raised | `SURFACE_ALT` / `bg-fin-surface-alt` | `#1B1F27` | sticky headers, hover, wells |
| Hairline | `BORDER_COLOR` / `border-fin-border` | `#262C36` | 1px separators only |
| Text | `TEXT_COLOR` / `text-fin-text` | `#E8EDF5` | primary copy, prices |
| Muted | `TEXT_MUTED_COLOR` | `#8B95A5` | labels, units, timestamps, headers |
| Accent | `PRIMARY` / `bg-fin-primary` | `#7C5CFC` | focus, selection, active tab, links |
| Up | `POSITIVE_COLOR` / `text-fin-positive` | `#00C98D` | gains, long, bullish |
| Down | `NEGATIVE_COLOR` / `text-fin-negative` | `#FF4D5E` | losses, short, bearish |
| Warning | `WARNING` / `text-fin-warning` | `#F5A524` | stale data, muted alerts, EOD |
| Info | `INFO` / `text-fin-info` | `#35B8F0` | neutral informational, spot line |

Rules:

- **Never hardcode a hex outside `palette.ts`.** Reach for a token or a
  `bg-fin-*` / `text-fin-*` / `border-fin-*` utility.
- Colour is **semantic, never decorative**. A row is not "blue because it looks
  good"; it is positive because P&L > 0, and the class comes from a signal.
- Options legs keep the desk convention: CE blue, PE orange (`TERM_CE`,
  `TERM_PE`). Do not recolour them to the brand accent.
- Selection uses the violet accent at ~16-18% alpha, never a solid fill.

## Type and rhythm

- Numbers: `font-mono tabular-nums`, right aligned, unit on the same line in
  muted text. A ticking price must not shift horizontally.
- Row height: `h-6` (24px) default; dense tables 20-23px via density tokens.
- Font sizes: 11px body cells, 10-11px headers (uppercase, `0.02em` tracking),
  12px panel titles.
- Spacing: 4px inside a control row, 8px inside a panel, 16px between panels.
  The 8pt grid is a floor, not a suggestion.
- Borders: one hairline per section. Never nest bordered cards.

## Component contract

| Component | Rules |
|---|---|
| `CompactPanel` | One border, header row 28px, body pad 4px, `flush` for edge-to-edge headers. |
| `CompactStat` | Label uppercase muted 10-11px, value tabular 13-18px, optional hint. Never nest in another card. |
| `TanStackTable` | Sizing from CSS vars (`--tbl-row-h`, `--tbl-cell-pad`, `--tbl-fs`); sticky header paints `SURFACE_ALT`; numeric columns auto-right-align and get `font-mono`; hover tints the `td` (cells own their background). |
| `PnlText` | Mono tabular by default; colour from `getPnLTextColor`. |
| `BadgeComponents` | Pill carries meaning only. Badge colour/label must be accessors, never body-time constants. |
| `EmptyState` / `InlineLoader` | 36px muted icon well, 12px title, 11px description capped at 42ch. |
| `Icons` | Kebab-case names resolve to the camelCase node map; every alias must paint a node (`Icons.test.tsx`). |

## Performance invariants (Solid)

The design is only "fast" if reactivity stays fine-grained.

1. **Never destructure props.** Use accessors or `splitProps`.
2. **Derive with `createMemo`**, not `createEffect` that writes a signal.
3. **Lists use `<For>`/`<Index>`**; `each` is keyed by identity, so rows keep
   their DOM and only changed cells update.
4. **Density and theme are CSS variables**, not JS-computed styles. Toggling
   density repaints; it must not re-render a single row.
5. **No per-row subscriptions to unrelated state.** A 1 Hz spot tick must not
   invalidate a table bound to positions.
6. **Virtualise long lists** with `rowWindowSize`; cap mounted rows before
   reaching for a heavier solution.
7. **A hook that returns state returns an accessor.** `useDensity().tokens` is
   a getter for exactly this reason.

## Verifying a visual change

```bash
bun run lint && bun run build
npx vitest run src/test/ui-guard.test.ts src/ui/inputs/inputs.w-h.test.tsx
npx vitest run src/components/common/
```

Then look at it: `./start.sh` and check a table-heavy page (screener, options
chain, `/report/index`) and a stat-heavy page (dashboard) in empty, loading and
full states. Build and lint cannot catch a misaligned column.
