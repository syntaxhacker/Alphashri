# SUBAGENT_RULES.md

Operating contract for subagents in `stock-screener-ui/`. Read fully before editing.
Sibling docs: `AGENTS.md` (repo rules), `LAYOUT_CONTRACT.md` (layout acceptance),
`SOLID_MIGRATION.md` (Solid idioms), `TEST_RULES.md` (test conventions).

---

## 1. Roles

| Role | Owns |
|---|---|
| Main agent | Brief authoring, review, integration, **only git actor**, screenshots, approver |
| Subagent | Scoped implementation inside one brief; reports to main, never to the user |
| Independent verifier | Read-only, separate session; grades screenshots + running UI per `UI_RULES.md` §7 |
| Approver | Main agent (or named human); records the verifier's A+ verdict; no self-approval |

- Subagents never ask the user anything and never spawn subagents.
- Ambiguity in the brief = **stop and report**, never guess scope.
- Main must not implement normal code tasks; it scopes, dispatches, reviews, integrates,
  verifies. **No implementation at all** — not even a one-line or one-character fix.

### Visual verifier + approver (UI work)

- **Independence.** The implementing agent, or anyone who authored a changed file, may not verify or
  approve the visuals. The main agent dispatches a **read-only verifier in a separate session** after
  the 1600/390 screenshots exist.
- **Verify the product, not the tests.** The verifier opens every PNG and exercises the running UI
  (legend/tooltip, selectors, keyboard/focus, 390 overflow). Code, tests, build and Storybook are
  supporting evidence only. The verifier edits nothing and starts no server or build.
- **Grade, don't bless.** Return A+/A/B/C/F against `UI_RULES.md` §7.3, with exact file:line and
  screenshot coordinates plus the required fix. A/B/C/F are FAIL; "looks fine" and "minor" are not
  verdicts.
- **Loop until A+.** The implementer implements **every** suggestion, recaptures and resubmits; the
  verifier regrades. The implementer never re-grades or triages a defect down.
- **Approver and commit gate.** The main agent records the A+ verdict; it cannot approve a change it
  implemented or verified. No `git commit`, `git push`, or PR before that record exists.

### Enforcement

- The main agent **never** edits source, tests, styles/theme, configs, the generated
  `openapi.yaml`, or deliverable docs — unless the task **is** a docs task assigned to it.
- **No quick-fixes.** Any defect found in review — failing assertion, lint warning, misaligned
  column, stale spec, wrong comment — goes **back to the subagent that owns those files**, with
  the exact failure output. The main agent does not "just fix it" to unblock itself. If the
  owner is gone, dispatch a new subagent scoped to those files.
- **Exception protocol (all three required, in order):** a subagent is blocked/quota-exhausted
  **or** an emergency recovery is required → (a) ask the user and get explicit approval in the
  same turn, (b) state `MAIN-AGENT EXCEPTION: <reason>` in that turn, (c) list every file
  touched. Missing any one of the three = no edit. A "small integration fix" is not an exception.
- **Verification ≠ implementation.** Running build/lint/typecheck/targeted tests/OpenAPI
  export/screenshots and reading output is allowed; changing the code under test to make a
  check pass is forbidden.
- **Attribution.** Every edited file must map to a named subagent session in the main agent's
  report.
- **Violation handling:** stop, report `main-agent-edit-blocked`, hand the file back to its owner.

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

**The silent variant — `?? default` hides the wrong-object read.** Reading a property off
the accessor *function* yields `undefined`, and a `?? default` turns that into a plausible
value:

```tsx
const filters = () => props.filters;
<NumberInput value={filters.max_pb ?? ""} />      // always "" — never warns
<Switch checked={filters.require_low_de ?? false} />  // always off, still fires onChange
```

A controlled switch then shows OFF while the request carries the gate. Symptom: the
`onChange` test passes, the screen disagrees; reopen a modal and every field is blank.
Rule: when a prop is an accessor, every read gets `()`; `?? default` is not a substitute.

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

`npx tsc --noEmit` in this repo reports **322 pre-existing errors as of 2026-11-17** (historical
measurement: 369 as of 2026-11-14). Re-measure rather than trusting that number:
`npx tsc --noEmit 2>&1 | grep -c "error TS"`. **Do not treat them as
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
| Typography | only `text-ui-*` / `typeSize()` | one six-step scale, 12px floor; a private `text-[Npx]` or inline `font-size` is drift even when the number looks reasonable |
| Focus | one `@layer base` rule rings every `button/a/[role=button]/summary` + `input/select/textarea` | 55 of 61 raw buttons had no focus state; not fixable per component |

Exempt by design: chart/canvas *containers* (a 340px sparkline is content, not a control)
and decorative hero/empty-state art. Text inside charts still uses `typeSize()`; there is no
`src/ui` exemption — the primitives use the same tier.

**Colour derives, it never repeats.** `TINT_POSITIVE`/`VOLUME_BULLISH`/`ORB_AREA` all come
from `alpha(anchor, a)`. Three independent green/red pairs had accumulated (#2FA36B/#D94A55,
#00C853/#FF3B30, #E11D2E) so a row tint, a volume bar and a marker could disagree about what
"positive" is. A near-miss duplicate ramp (`TERM_BORDER #2A2E35` vs `BORDER #2C313B`) is the
same defect: it reads as the same thing but cannot be retuned together.

**A tint means something.** Red is error/bearish, never "informational" and never "selected":
`ORB_AREA`/`IV_AREA_*` (range and IV bands) read INFO blue; `BOT_SELECTED_BG` reads PRIMARY.

Screenshots are captured by the main agent or implementer; only an independent verifier grades them (`UI_RULES.md` §7). A subagent never self-approves.

---

## 8. Implementation + verification

Read the minimum. **Start with [`docs/AGENT_QUICKSTART.md`](./docs/AGENT_QUICKSTART.md)** —
it has the commands, folder map, unit/E2E/backend recipes and fixture locations. Then
`docs/MAP.md` for the task→file map. Prefer `grep`/targeted reads over whole directories.
For API shape, read `openapi.yaml` first, not the routers end to end.

### Batch reads — one locate pass, then all reads at once

Sequential one-file-per-turn reading is the slowest thing a subagent does. Do not do it.

1. **Locate in one pass.** One `grep` (or a few, one per symbol family) prints every file:line
   you need. `glob` for structure. Do not open a file just to discover a path grep can print.
2. **Then read in one parallel batch.** Issue every `read` in a single turn — 5–10 files at a
   time is normal. A brief that names six files should cost one read turn, not six.
3. **Use `offset`/`limit`** for files over ~200 lines; read the section around the hits, not the
   whole file. Never re-read a file already in context.
4. **Order:** types / `openapi.yaml` → the consumer → its test. Independent verification
   commands (`oxlint`, `vitest`, `tsc`) may be batched with reads.
5. If a read reveals another file is needed, batch that with anything else the same finding
   implies — never a single-file round trip.

Run **targeted** checks only — never the full ~6.5k suite locally:

```bash
npx oxlint <your files>
npx vitest run <your test files>
npx tsc --noEmit 2>&1 | grep -E '^src/<your scope>/' | wc -l   # before/after
.venv/bin/python -m pytest <your test files> -q                # backend
```

### 8.0 CPU budget — check before any test run that fans out

A vitest worker pool can saturate the box: a stranded worker once held **8.4 GB** and drove an 8-core machine to **3% idle / load 72**, which makes every other gate time out and look like a real failure.

- **Before** a multi-file suite, `bun run test`, or Playwright: check `cat /proc/loadavg` and `top -bn1 | grep "^%Cpu"`.
- **Floor: ≥30% idle** (or load average < core count). Below that, **sleep 10–20 s and re-check**, up to a minute, then report the number you waited for. Do not start a heavy run on a saturated box.
- **After** a cancelled or failed run: `pgrep -af "vitest|pytest|playwright"` — an orphaned worker keeps burning CPU and will skew the next run.
- Never run a full suite concurrently with another lane, and never raise Playwright `--workers` beyond what idle CPU can take.

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

### Scenario coverage — enumerate before you test

Unit tests assert the code you wrote; scenarios assert the **user's states**. Four recent
defects were fully "tested" and still shipped because nobody enumerated the matrix:

- sector filter made the SECTOR column constant → the column should have been hidden;
- the chart icon opened the dock but the row never selected → arrows did nothing;
- the toolbar tooltip was clipped by `overflow:hidden` → the test measured a bare harness;
- `{candles: [], error: "no_data", note: …}` rendered a blank chart → the type never
  admitted `error`/`note`, so the UI could not show them.

Before writing tests, copy the relevant rows of `docs/TEST_SCENARIOS.md` into the brief and
end every row as **test added**, **existing test (name it)**, or **N/A + reason**. Axes
that must be enumerated: data state, view, input modality, theme, persistence, ancestor
overflow, and request races. Prefer user-visible assertions (computed style, DOM text, row
count, URL, `elementFromPoint`) over spies.

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
| **Default and only model for all subagent work** | `opencode-go/hy4-flash-free` ("Hy4 flash Free" under **OpenCode Go**) — user instruction, 2026-11-16 |
| Never use | DeepSeek, `commandcode/*`, `opencode/hy4-flash-free`, or any other provider/model |
| If Go Hy4 is unavailable (overload/quota) | stop and report; do not substitute another model |
| If the user changes the model | update this table first, then dispatch |

- The user's standing instruction is **one model for every agent** — do not mix models
  across a wave unless asked.
- **Every subagent must be dispatched in the background by default** (`background: true`).
  Foreground is allowed only when the user explicitly asks for a blocking result.
- **Concurrency is 8 simultaneous subagents** (user instruction, 2026-11-16) until the
  user says decrease to 5. Keep one agent per disjoint file set; if a wave would
  overlap, queue the lane instead of sharing files.
- Hard ceiling is the 8 above; do not dispatch a ninth lane. Queued lanes wait for a
  free slot rather than sharing files.
- Free tiers return `Free usage limit reached` mid-task and can leave the tree half-edited.
  When that happens: dispatch a replacement subagent scoped to the affected files; the main
  agent edits only under the §1 `MAIN-AGENT EXCEPTION` protocol (user approval first).
- Verify every agent claim. Reports have asserted success while the page was blank, the
  build broken, or a test failing.
- **Read this section before the first dispatch, not after.** It is the only place the
  model and the concurrency ceiling are defined, and `AGENTS.md` deliberately does not
  restate them. Omitting `model` from a `subagent` call silently inherits the
  session default — which is a *forbidden* model here — so "I didn't set a model" is
  itself a rule violation, not a neutral default. State the model explicitly on every
  call, or do not dispatch.

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
- UI: independent verifier's **A+** verdict, with screenshot paths and the running UI reviewed

## Scenario coverage (from docs/TEST_SCENARIOS.md)
- <paste the relevant rows; each ends as test-added / existing-test / N/A + reason>

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
6. **Scenario coverage** table — every row from the brief, with test-added / existing-test / N/A+reason.
7. Risks / untested paths.
8. Blockers, or "none".
9. **Visual verdict** (UI work only): grade, verifier/approver, screenshot paths, and every FAIL item with its required fix.

Never claim a surface "looks correct" if you cannot see it. Say what you measured.
