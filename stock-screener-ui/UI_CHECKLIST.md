# UI Revamp Checklist

Use this for every tab/page revamp. Copy it into the PR description and tick each line.

## 0. Scope
- [ ] List every element in the region and classify: label / input / action / stat / row / chart.
- [ ] Identify the `@/ui` wrapper for each input (Select, NumberInput, TextInput, MultiSelect, Textarea, PasswordInput).
- [ ] Confirm the state matrix to verify: empty, loading, error, full.

## 1. Props (avoid silently-dropped Mantine props)
- [ ] No `styles={{...}}` anywhere (guard test enforces).
- [ ] Every input has an intentional width: `w={n}` (fixed) or a flex cell + `width:"100%"`.
- [ ] No `w`/`h`/`styles` on components that don't support them.
- [ ] `size` uses `xs|sm|md|lg` only.

## 2. Rows
- [ ] Every control row uses `<ToolbarRow>` (or explicit `align-items:center` + `gap`).
- [ ] Buttons/actions align to the row's vertical center.
- [ ] Primary action cluster is pinned right where a toolbar has actions.

## 3. Tables / columns
- [ ] text left, numbers right, badges centered, actions right — header and cell match (`meta.align`).

## 4. Layout / chrome
- [ ] No nested bordered cards; one border per section, inner separation via dividers.
- [ ] Header sticky; no dead space; panels/charts fill their flex container.
- [ ] Consistent 8pt spacing (`xs4 sm8 md16`).

## 5. Verify (mandatory)
- [ ] `bun run build` passes.
- [ ] `bun run lint` 0 errors.
- [ ] `npx vitest run src/test/ui-guard.test.ts` passes.
- [ ] `npx vitest run src/ui/inputs/inputs.w-h.test.tsx` passes.
- [ ] Feature unit tests pass.
- [ ] chrome-devtools screenshots captured for empty/loading/full and reviewed.
- [ ] Feature E2E spec passes (targeted, not full suite).

## 6. Finish
- [ ] `UI_RULES.md`/`UI_CHECKLIST.md` respected (link in PR).
- [ ] AGENTS.md updated if a new shared primitive/rule was added.
