# SUBAGENT_RULES.md

Operating contract for subagents in `stock-screener-ui/`. Read fully before editing.
Sibling docs: `AGENTS.md` (repo rules), `LAYOUT_CONTRACT.md` (layout acceptance),
`SOLID_MIGRATION.md` (Solid idioms), `TEST_RULES.md` (test conventions).

---

## 1. Roles

| Role | Owns |
|---|---|
| Main agent | Brief authoring, review, integration, **only git actor**, screenshots |
| Subagent | Scoped implementation inside one brief; reports to main, never to the user |

- Subagents never ask the user anything and never spawn subagents.
- Ambiguity in the brief = **stop and report**, never guess scope.
- Main must not implement normal code tasks; it scopes, dispatches, reviews, integrates,
  verifies. Main may edit only when a subagent is blocked/quota-exhausted, or for a small
  integration fix — and must say so.

---

## 2. Hard safety (non-negotiable)

- **NEVER** modify `db/alphashri.db`.
- **NEVER** delete anything under `reports/**` — overwrite in place.
- **No destructive git**: `reset --hard`, `checkout --`, `restore`, `clean`, `stash`
  (push/pop/apply/clear/drop), `rebase`, `merge`, `cherry-pick`, `revert`, `branch -D`,
  `push --force`.
- **Subagent git is read-only and narrow**: `git status`, `git log --oneline`,
  `git diff --stat`. Nothing else. In particular **never `git switch` / `git checkout -b`** —
  one agent created a branch mid-task and stranded a parent commit on it.
- No commits, pushes, or branch changes.
- No secrets/keys/tokens in code, fixtures, or logs.
- No DB writes, migrations, or seed runs.
- No server start/stop/restart, no `start.sh`, no killing processes.
- No dependency installs, no lockfile edits.

Violation risk → abort, report `blocked: <command>` + reason.

---

## 3. Scope discipline

- Edit **only** the files listed in the brief.
- Never touch another agent's files or another worktree.
- No broad refactors, renames, formatting sweeps, or drive-by cleanups.
- If a change needs an unlisted file: **stop**, report the exact path and why.
- If a test needs a fixture change outside scope: report, don't edit.
- Smallest diff that satisfies the acceptance criteria.

### File ownership in a shared worktree

Parallel agents share one worktree, so two agents editing one file corrupt each other.
Before your first edit, run `git status --porcelain` and check your lane against it. If a
file you own is already modified by someone else, **report it and skip it** — do not revert
or "fix" their work.

---

## 4. Comments

- No narration, no changelog, no restating the signature.
- Comment only: non-obvious invariants, workarounds (with cause), external constraints,
  safety-critical ordering. One line.
- No commented-out code.
- Delete comments that are now stale.
- JSDoc only for exported public contracts.

---

## 5. The defect classes that actually bite here

These five account for nearly every real bug found in this repo. **Check each one in your
scope, every time.** They are all silent — no error, no warning, wrong output.

### 5.1 Accessor used as a value (Solid)

```tsx
// WRONG — renders "function() {…}" or compares a function
<Text c={accent}>{label}</Text>
if (active === tab.key) …
// RIGHT
<Text c={accent()}>{label()}</Text>
if (active() === tab.key) …
```

Also: `activePut(row)` when the callback takes the resolved value → `activePut(row())`.
Symptom: literal `function …` text on screen, a comparison that is always false, a testid
reading `foo-<function>`, or NaN geometry in SVG.

### 5.2 Numeric style values (silently dropped)

Solid writes styles via `style.setProperty`, which needs a **string**. `height: 24` is
invalid and discarded — the declaration never appears.

```tsx
style={{ height: 24 }}              // WRONG — dropped
style={{ height: "24px" }}          // RIGHT
style={{ "font-size": `${n()}px` }} // RIGHT
```

`0` is the exception (unitless zero is valid CSS).

### 5.3 camelCase style keys (silently dropped)

`style.setProperty` requires kebab-case. `backgroundColor` never applies.

```tsx
style={{ backgroundColor: x, borderLeft: y }}   // WRONG — both dropped
style={{ "background-color": x, "border-left": y }}  // RIGHT
```

Guarded by `src/test/style-keys.test.ts`. If it fails on your file, fix the file —
never the test.

### 5.4 Sort id with no matching column

```ts
initialState={{ sorting: [{ id: "breakout_score", desc: true }] }}
// but no column has id "breakout_score" → TanStack finds nothing,
// keeps insertion order, and no header shows an indicator
```

Cross-check every `sorting` id against the column ids in the same file. This made the
patterns "Breakout" sort silently do nothing.

### 5.5 `accessorKey` pointing at a field the row does not have

```tsx
{ id: "price", accessorKey: "price" }   // data is at row.tech.price
```

`getValue` returns `undefined`, both comparator sides coerce to `0`, the header arrow flips
and the rows never reorder. If the value is nested or derived, use `accessorFn`.

### Also check

- `class=` on a `@/ui` component — those read `className`, and `{...rest}` is applied last,
  so `class` **overwrites** the computed classes. `c="success"` stops colouring.
- Two `className` attributes on one element — a JSX error; intent is lost.
- A clickable element styled as a button must carry `role="button"` + focusability.
- `number | null` used in arithmetic without a guard → `NaN` rendered as a value.
- A formatter receiving `undefined` → `undefined.toFixed` throws and blanks the panel.

---

## 6. Type errors are a bug-finding instrument

`npx tsc --noEmit` in this repo reports **369 pre-existing errors as of 2026-11-14**. Re-measure
rather than trusting that number: `npx tsc --noEmit 2>&1 | grep -c "error TS"`. **Do not treat them as
cosmetic.** Every cluster cleared so far exposed real runtime defects:

| Cluster cleared | Runtime bug it exposed |
|---|---|
| `pages/report` 314 → 0 | a column accessor took one bucket, callers passed the array → every series drew flat |
| `common` + `ui` 415 → 0 | `tt="uppercase"` never applied on 34 labels; camelCase styles made 4 panels unstyled |
| `paper-trading` + `bots` 196 → 0 | numeric row-height/font-size dropped, so table sizing never applied |

When you clear a cluster, assume roughly one in twenty errors is a real defect and look for
it. Report those separately from the type-only fixes — they are the valuable output.

---

## 7. UI rules (condensed — full spec in `UI_RULES.md` + `LAYOUT_CONTRACT.md`)

Reuse, don't rebuild:

- Tables: `TanStackTable` (`src/components/common/TanStackTable.tsx`) only. No bespoke table.
- Cells: `NumCell / TextCell / SymbolCell / BadgeCell` (`components/common/tableCells.tsx`).
  Numbers = mono + tabular + right. Never hand-roll a numeric cell.
- Columns: factories in `components/table/columns/`, or a `*.columns.ts` beside the consumer.
- Panels/stats: `CompactPanel` (`flush` when nested), `CompactStat`, `CompactStatGrid`.
- Control rows: `ToolbarRow` (forces `align-items:center` + explicit gap).
- Theme: `palette.*` tokens only. No raw hex. Tabs are a flat strip, not a bordered pill box.

Layout invariants:

- 8pt grid: outer 16, inner 8, gaps 4/8/16. One border per section; no nested bordered cards.
- Panels fill their flex parent (`flex:1`, `min-height:0`); no fixed heights inside flex.
- A column with no `size` absorbs all slack and starves its neighbours — always size it.
- The identifier column never truncates.
- Floating labels inside a horizontal control row are forbidden → `placeholder` + `aria-label`.
- Empty/loading states collapse; they never reserve the data height.
- Page never scrolls; the table scrolls.

### 7.1 The design scale (enforced by `src/test/design-scale.test.ts`)

| Dimension | Allowed | Why |
|---|---|---|
| Surface ramp | `BG #000` → `SURFACE #13161C` → `SURFACE_ALT #1F242D` → `BORDER #2C313B` | each adjacent step ≥1.15:1. When page == panel the panel has no existence, and every control floats on one sheet — this was the actual cause of "everything looks the same" |
| Radius | 0/1/2/3/4/6/8/10, `9999px`, `50%` | controls 6, small items 4. Never a new inline radius |
| Control height | 16–48 from the scale | six heights (22/26/28/30/32/34/36) for one job reads as inconsistent spacing at a glance |
| Icon size | 8/12/14/16/18/20/24/32/40 | 10/11/13/15/22 was drift, not intent |
| Type floor | **≥9px** | 7px/8px is a smudge at 1x, not a label |
| Focus | one `@layer base` rule rings every `button/a/[role=button]/summary` + `input/select/textarea` | 55 of 61 raw buttons had no focus state; not fixable per component |

Exempt by design: `src/ui/**` (owns its own `xs/sm/md/lg` map), chart/canvas containers
(a 340px sparkline is content, not a control), decorative hero/empty-state art.

**Colour derives, it never repeats.** `TINT_POSITIVE`/`VOLUME_BULLISH`/`ORB_AREA` all come
from `alpha(anchor, a)`. Three independent green/red pairs had accumulated (#2FA36B/#D94A55,
#00C853/#FF3B30, #E11D2E) so a row tint, a volume bar and a marker could disagree about what
"positive" is. A near-miss duplicate ramp (`TERM_BORDER #2A2E35` vs `BORDER #2C313B`) is the
same defect: it reads as the same thing but cannot be retuned together.

**A tint means something.** Red is error/bearish, never "informational" and never "selected":
`ORB_AREA`/`IV_AREA_*` (range and IV bands) read INFO blue; `BOT_SELECTED_BG` reads PRIMARY.

Verify visually only if the brief says so — screenshots are the main agent's job.

---

## 8. Implementation + verification

Read the minimum. Prefer `grep`/targeted reads over whole directories. For API shape, read
`openapi.yaml` first, not the routers end to end.

Run **targeted** checks only — never the full ~6.5k suite locally:

```bash
npx oxlint <your files>
npx vitest run <your test files>
npx tsc --noEmit 2>&1 | grep -E '^src/<your scope>/' | wc -l   # before/after
.venv/bin/python -m pytest <your test files> -q                # backend
```

Guards that must stay green when your scope touches them (canonical list — `AGENTS.md` points here):

```bash
npx vitest run src/test/style-keys.test.ts          # kebab-case + px strings
npx vitest run src/test/no-props-destructure.test.ts
npx vitest run src/test/numeric-typography.test.ts   # mono + tabular
npx vitest run src/test/table-structure.test.ts      # column-declaration baseline
npx vitest run src/test/ui-guard.test.ts
npx vitest run src/test/design-scale.test.ts         # radius · control height · icon size · 9px type floor · focus ring
npx vitest run src/test/theme-single-source.test.ts  # palette is the only hex source
npx vitest run src/ui/inputs/inputs.w-h.test.tsx
```

Never run Playwright without a file filter.

### Prove the fix, not the test

If you fix a bug, the regression test must **fail without your fix**. Verify by
temporarily reverting your change from a `/tmp` copy (never `git checkout`), running the
test, and restoring. State the before/after.

If you added a test that passes both ways, it is not a regression test.

### Known flakes — do not "fix" them by weakening the test

- `ScreenerConfigView.test.tsx › preview debounce` — **fixed**: it asserted
  `toHaveBeenCalledTimes` and its URL mock ignored the `screener` argument. Now asserts the
  URL's `screener` param; mutation-checked. Do not reintroduce call-count assertions here.
- Mount-heavy page tests under 8 parallel workers — timing, not logic.

> A flake that survives a session becomes "normal". Before writing a flake off, read its
> assertions against `TEST_RULES.md § 0`: the anti-pattern table is where flakes live.

### Dead config is a defect, not tidiness

A constant that is declared and never read is worse than a missing one — it reads as if the
system does the thing right:

```ts
const WALLS_GRID_COLS = { xs: "minmax(0,1fr)", md: "250px 1fr 1fr …" } as const;
// every call site read .xs → the card rendered mobile-stacked at desk width,
// 475px tall, pushing the chart below the fold. The `md` value was correct and dead.
```

Check **readers**, not declarations. A name used exactly once (its own declaration) has no
second reader — the mapping is decorative:

```bash
grep -c "WALLS_GRID_COLS" NiftyWallsCard.tsx   # count occurrences, not lines
```

---

## 9. Model routing

Canonical source for model routing **and** concurrency — `AGENTS.md` and
`docs/agent-fleet-playbook.md` point here rather than restating it.

| Purpose | Model |
|---|---|
| **Default for all subagent work** | `opencode/nemotron-3.5-super-vl-free` ("Nemotron 3.5 Super VL Free", $0) |
| Fallback pool (use when a free tier reports `Free usage limit reached`) | `opencode/deepseek-v4.1-flash-free`, `openrouter/nvidia/nemotron-3.5-super-vl:free`, `openrouter/baidu/ernie-5.5-flash-preview:free`, `commandcode/deepseek-v4.1` |
| Adversarial / final verification | escalate one agent, state why |

- The user's standing instruction is **one model for every agent** — do not mix models
  across a wave unless asked.
- **5 concurrent agents** max, on disjoint file sets. More just queues.
- Free tiers return `Free usage limit reached` mid-task and can leave the tree half-edited.
  When that happens: the main agent finishes the task itself and says so.
- Verify every agent claim. Reports have asserted success while the page was blank, the
  build broken, or a test failing.

---

## 10. Brief template

```markdown
## Task
<one paragraph: what and why>

## Files allowed
- path/one.tsx
- path/two.test.tsx
## Do not touch
- db/alphashri.db, reports/**, package.json, lockfiles
- <other agents' files>
- no git write commands (incl. switch/checkout -b), no DB writes, no servers

## Defect classes to check
<the relevant subset of §5 — say which apply>

## Acceptance
- <the assertion that must pass, and that it fails without the fix>
- lint clean; targeted vitest green
- `npx vitest run src/test/design-scale.test.ts src/test/theme-single-source.test.ts` green
- tsc count for the scope: before → after (if a tsc task)
- if the brief claims a layout now fits: `getBoundingClientRect()` before → after

## Return
files changed · diff summary per file · commands run · pass/fail counts ·
runtime bugs found (separate from type-only) · risks · blockers
```

Author rules: one task per brief; explicit file lists; measurable acceptance; no implied
follow-up work; state the model.

---

## 11. Return contract

A report is rejected without **pass/fail counts**, the **exact commands**, and an explicit
**"not done"** section. Required:

1. Files changed (paths).
2. Per-file diff summary, one line each.
3. Commands run verbatim.
4. Test/lint/tsc output with counts (before → after for tsc).
5. **Runtime bugs found**, listed separately from type-only fixes.
6. Risks / untested paths.
7. Blockers, or "none".

Never claim a surface "looks correct" if you cannot see it. Say what you measured.
