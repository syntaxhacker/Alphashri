# UI Rules — Tailwind wrappers, alignment, and layout

Applies to every page/tab revamp. Components in `@/ui` are **local semantic HTML + Tailwind**, not Mantine or MUI.
Mantine-only props are silently dropped — that is the root cause of "stretched select",
"ignored width", and "misaligned row" bugs.

## 1. `@/ui` prop rules (hard)
- **Never pass `styles={{...}}` or `sx={{...}}`.** Use Tailwind `className` + `style` for dynamic values. The `ui-guard` test fails the build if `styles` is found.
- **Sizing**: inputs accept `w` / `h` (number → px). When `w` is set the input is **not** full-width.
  - Fixed width: `<Select w={280} />`
  - Fill a flex cell: `<Box className="flex-1 min-w-0"><Select style={{ width: "100%" }} /></Box>`
- **Size**: use `size="xs" | "sm" | "md" | "lg"`. Do not pass Mantine-only values.
- Props that DO work on inputs: `label`, `description`, `placeholder`, `error`, `required`, `disabled`,
  `leftSection`, `rightSection`, `clearable`, `searchable`, `data`, `value`, `onChange`, `data-testid`.

## 2. Row alignment rules
- Any horizontal row of controls **must** set `display:flex; align-items:center` and an explicit `gap`.
  Use the shared primitive `<ToolbarRow>` (from `@/ui`) instead of ad-hoc `Group`/`Box`.
- `Group` defaults to `align-items: stretch` → always pass `align="center"` for control rows.
- Never let a row's vertical alignment depend on a sibling's height.

## 3. Table / numeric alignment (from TABLE_CHECKLIST.md)
- Text → left, numbers → right, badges/actions → center, actions group → right.
- Header and cell must use the **same** `meta.align`.

## 4. Vertical layout
- No nested bordered cards. One border per section; separate inner groups with dividers/surfaces.
- Toolbars/headers: sticky top; action cluster pinned right with a `flex:1` spacer.
- Charts/canvas fill their flex parent (`autoSize`; never a fixed height inside a flex panel).

## 5. Verifying a revamp (mandatory)
1. Build + lint: `bun run build && bun run lint`.
2. Screenshot via chrome-devtools at a real viewport, in **empty / loading / full** states.
3. Confirm: every input has an intentional width (no accidental full-width), every row is centered.
4. Run the guards:
   - `npx vitest run src/test/ui-guard.test.ts`
   - `npx vitest run src/ui/inputs/inputs.w-h.test.tsx`
   - the feature's unit tests + its E2E spec.

## 6. Sector Dashboard / Rotation (hard-won rules)

### Density and typography
- Default is dense: page title 12px, description 10px, section headers 11px, table headers 9–10px, table numbers 10–10.5px, row height 18–24px.
- No hero headings or large stat cards. Use the 28px inline summary strip.
- Page header 36px, tabs 32px, panel headers 28px, layout gaps 4–8px.
- Never wrap tables in `Card` + `CardContent` + `TableContainer` + `Stack` + `Grid`. Use the shared `TanStackTable` directly (`dense`, `fillContainer`, `rowWindowSize`).
- Empty panels collapse; no large blank card bodies. Alerts and interval movers are compact custom lists, auto-height; Top Gainers fills the remaining right-rail height.

### Table / Visual switch
- Exactly two views: `Table` (dense table + rail) and `Visual` (heatmap + table + rail).
- Both views MUST use the same grid columns: `minmax(0, 2.4fr) minmax(320px, 1fr)` at `lg`. Never change widths when toggling.
- Toggle is a compact 22px two-button control with 9.5px labels; default `Table`; URL state is `?tab=dashboard&dash=visual`.
- Do not add a layout that widens/narrows the table or rail on view change.

### Data colors
- Every signed number is colored: change, RS, A/D (green >, red <, neutral =), and each top-mover value. Never render a plain `+x%` / `-x%` string.
- Heatmap uses only muted `SECTOR_*` tokens; no neon/light green/red. Labels are white; never use `colorSaturation` or dark `textBorder` on labels (they dim them). Use a subtle shadow.
- No AI-slop purple/pink, no saturated full-panel fills.

### Market hours
- Market open is IST 09:15–15:30 on weekdays and non-holidays (`isMarketOpenNow`).
- After close: no polling; one snapshot only; header shows `MARKET CLOSED`; refresh disabled; updated timestamp must stay unchanged.
- Never use `isMarketClosedToday()` as a time check; it only covers holidays/weekends.

### Sector / theme rotation
- Historical Cycles is removed entirely: tab, iframe, and static mount. Do not reintroduce unless explicitly asked.
- Rotation is CSS/DOM-only: no ECharts, no TanStackTable. Vanilla RRG, CSS table board/matrix, local drawer members.
- Use real index/theme membership; no invented sector-level money flow. Call it rotation/participation; FII/DII is market-level.
- Rotation URL state: `tab`, `dash`, `kind`, `period`, `min`, `group`; preserve other params.

### Verification
- Run targeted unit tests, `src/test/ui-guard.test.ts`, `src/ui/inputs/inputs.w-h.test.tsx`, build, lint.
- Screenshot via chrome-devtools at a real desktop viewport in both `Table` and `Visual` states.
- Measure table/rail widths before and after toggling; they must be identical.
- When the user says "dense until I stop", choose the denser option, but never use 6px slop or unreadable 6–8px text.

### No market-data computation in the UI
- Backend owns: candle cleaning + gap fill (`intraday[].synthetic`), spot vs last close (`spot_source`, `spot_chain`), IV/skew/straddle sanity, RV/IV, wall test/rejection/break events, freshness (`data_stale`).
- The UI renders and formats only. Allowed: memoized O(n) resample (1m→5m/15m), EMA series, annotations from server events, number/date formatting.
- Forbidden: re-deriving indicators from raw payloads, fabricating/gap-filling candles, event detection, per-tick scans, O(n²) work, deep JSON copies inside render.
- If a value is missing, add it to the API response — never compute it in React.
