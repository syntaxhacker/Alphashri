# UI Rules — MUI wrappers, alignment, and layout

Applies to every page/tab revamp. Components in `@/ui` are **MUI wrappers**, not Mantine.
Mantine-only props are silently dropped — that is the root cause of "stretched select",
"ignored width", and "misaligned row" bugs.

## 1. `@/ui` prop rules (hard)
- **Never pass `styles={{...}}`** (Mantine). Use `sx`/`style`. The `ui-guard` test fails the build if found.
- **Sizing**: inputs accept `w` / `h` (number → px). When `w` is set the input is **not** full-width.
  - Fixed width: `<Select w={280} />`
  - Fill a flex cell: `<Box sx={{ flex: 1, minWidth: 0 }}><Select style={{ width: "100%" }} /></Box>`
- **Size**: use `size="xs" | "sm" | "md" | "lg"` (mapped to MUI small/medium). Do not pass Mantine-only values.
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
