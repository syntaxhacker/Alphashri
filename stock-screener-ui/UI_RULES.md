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
2. Screenshot via chrome-devtools at a real viewport, in **empty / loading / error / full** states.
3. Confirm: every input has an intentional width (no accidental full-width), every row is centered.
4. Run the guards:
   - `npx vitest run src/test/ui-guard.test.ts`
   - `npx vitest run src/ui/inputs/inputs.w-h.test.tsx`
   - the feature's unit tests + its E2E spec.
5. Pass the **Visual Review Gate** (§7). Build, lint, tests and green CI are not visual approval.

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
- If a value is missing, add it to the API response — never compute it in the UI.

## 7. Visual Review Gate (independent verifier + approver)

A green build, tests, typecheck or CI is **not** visual evidence and never visual approval. Every UI
change needs an independent verifier's grade and a recorded approver decision; **only A+ ships**.
Evidence mechanics — capture matrix, naming, manifest, replacement and URL checks — are in
[`docs/SCREENSHOT_EVIDENCE.md`](./docs/SCREENSHOT_EVIDENCE.md).

### 7.1 Roles

| Role | Owns | Must not |
|---|---|---|
| Implementing agent | Builds the UI, captures screenshots, fixes every verdict item, resubmits | Verify, grade or approve its own visuals |
| Independent verifier | Read-only review of actual screenshots + running UI; one grade and defect list | Edit a changed file, add evidence, or be an implementer of the change |
| Approver | Accepts/rejects the verdict and records the decision | Approve their own implementation or their own verification |

- The verifier is a **separate session** the main agent dispatches after the screenshots exist and authored none of the changed files; a main agent that implemented the change cannot verify or approve it.
- The approver is the main agent (or a named human); approval is a recorded A+ verdict, never a verbal "looks good". If the main agent verified, a different approver is required. No averaging, waivers or self-approval; any UI file change after a verdict voids it.
- The main agent is the **sole git actor**; subagents never commit, push or open PRs.

### 7.2 Evidence first

- **Visual freeze.** No capture until every UI lane reports `VISUAL FREEZE`; a later UI edit voids the freeze and the affected captures.
- **Mechanical pre-checks.** The set must pass automated checks for clipped text/boxes beyond their panel or scrollport, duplicate or missing scroll cues (exactly one visible cue per horizontal scroller), active-toggle styling, duplicate or rounded axis ticks, as-of/latest-month mismatch, transition-count mismatch, `-0.0%`/`NaN`/`undefined`, and blank canvases. The verifier sees only a passing set and still grades the actual PNGs.
- **Selective recapture.** After a blocker fix, recapture only affected states with `--only <state>`; a full-set recapture is required only for a global change.
- The verifier opens every committed PNG **and exercises the running UI** (legend/tooltip, selectors, keyboard/focus, 390 overflow); screenshots alone cannot prove interaction. It uses the app the main agent already runs and starts no server or build.
- Code, tests, build/lint output, DOM dumps and Storybook are supporting evidence only; they do not show layout, legibility, hierarchy or usability.
- Missing, unopened, unreadable or stale (not the final UI HEAD) evidence leaves that state unreviewed → **max B**. No screenshots or no verifier access to the running UI → **F**.

### 7.3 A+ rubric

| Dimension | A+ requires |
|---|---|
| **First read / How to read** | The verifier writes one sentence: "How to read: …". A first-time reader names the axes/rows and current state in ~5 seconds. The sentence must not need a colour legend, hover or a paragraph. Axis/rank direction explicit; every multi-series time/rank series is directly labelled; colour supports, never carries, historical values; legend/tooltip identifies every series and month; no clipped or overlapping labels at 1600 or 390. |
| **Usefulness** | Answers a real trading/research question; data density with hierarchy; no decorative noise; shows lookback, sample size, as-of and units; no forecast/BUY signals. |
| **Hierarchy & spacing** | Section titles, descriptions and body on one consistent 8pt rhythm; no cramped titles; no nested bordered cards; charts fill their panels. |
| **Chart choice** | ECharts for multi-series rank/time series; native SVG only for matrices/heatmaps where it is demonstrably better. |
| **States** | Loaded, loading, error, empty and every selector reviewed at 1600 and 390; no body overflow, letterboxing, unreadable mobile text or fixed-height chart clipping its plot/axis/legend. |
| **Accessibility** | `role`/title/desc, keyboard/focus, contrast, and no colour-only meaning. |
| **Data honesty** | Units, denominators, `n`, cached/as-of labels; no invented values. |

- Score every dimension on every state and viewport. A+ requires all seven clean; there is no "strong overall" average and a miss in any dimension is below A+ (caps in §7.4 still apply).
- **First read is mandatory.** Quote one "How to read" sentence per chart and record `naive first read: checked`; needing a colour legend, hover or a paragraph → **max B**.
- **Direct labels, not colour memory.** Multi-series time/rank charts label series directly; colour is supporting only. Values decodable only by matching colours fail first read. Prefer small multiples, bump charts with direct end labels, or one highlighted series with muted context; never 10 equal lines in one frame.

### 7.4 Grades, caps and automatic fails

| Grade | Meaning |
|---|---|
| **A+** | All seven dimensions clean in every state/viewport; zero defects and zero suggestions. **Only A+ ships.** |
| **A** | Criteria hold but improvements are suggested; still FAIL to ship. |
| **B** | One material defect, or a max-B cap. |
| **C** | Hierarchy failure, several material defects, or a max-C cap. |
| **F** | Misleading, broken, unreadable or unreviewable. |

Caps apply even when everything else is polished:
- More than ~6 line series without hierarchy → **max C**. A grey 10-line bump chart is the canonical case. A multi-series rank/time chart not using ECharts (no documented material advantage) → **max B**.
- Clipped/unreadable 390px labels, or a missing loaded/loading/error/empty/selector state → **max B**.
- A colour matrix needing >6 colours matched across columns (e.g. 10-colour × 180-block rotation), even with tooltips → **max B**. Prefer small multiples, bump charts or direct labels.
- Misleading data, unlabeled axes, no screenshots, or no verifier access to the running UI → **F**.

`A`, `B`, `C` and `F` are all **FAIL** for commit/PR. No "ship with follow-ups", no "accepted debt".

### 7.5 Verdict format

```text
VISUAL VERDICT: <A+ | A | B | C | F> — SHIP: <YES only for A+>
Verifier: <session> (read-only; authored no changed files)
Approver: <main agent / named human> — <approved | rejected>
Scope + HEAD: <sha, routes, selectors/modes>
How to read (one per chart):
- <chart> — "<one sentence>" — naive first read: checked
Screenshots reviewed: <path> — 1600×1000 — <state>; <path> — 390×844 — <state>
Rubric: First read <...> · Usefulness <...> · Hierarchy/spacing <...> · Chart choice <...> · States <...> · Accessibility <...> · Data honesty <...>
Defects:
- <severity> — <file:line> — <screenshot path + x,y region> — <what is wrong> — <required fix>
Required before regrade: <numbered list of every defect and suggestion; "none" only for A+>
```

- The verdict lists every screenshot it relies on with viewport and state, and every non-A+ defect
  names exact file:line (or element/selector), screenshot path + x,y region, and the required fix.
- `looks fine`, `minor`, `acceptable`, `P2`, or a grade with open suggestions is not a verdict.

### 7.6 Loop, record and commit/PR gate

1. The implementer captures every screenshot at the final UI HEAD; the main agent dispatches the verifier (§7.1).
2. The verifier grades and lists every defect and suggestion.
3. The implementer implements **all** of them, recaptures and resubmits. No triage, no waivers.
4. The verifier regrades the fresh screenshots. Repeat until A+.
5. The approver records the grade, verifier, approver and screenshot paths.

- **No `git commit`, `git push`, or PR before A+ is recorded.** Record grade, verifier, approver and every screenshot path in the PR body (or commit message).
- **The PR body must embed the screenshots, not just name local paths.** Use `![alt](https://…)` or `<img src="https://…">` with a URL a reviewer can open (committed raw URL or a GitHub attachment). `.agent-artifacts/...`, `/workspaces/...` and `file://...` do not render.
- The `PR Screenshot Gate` CI check fails a PR body with no embedded screenshot. It also checks each image URL and fails on 404/410; use an immutable commit-SHA raw URL or a GitHub attachment, because feature-branch URLs break when the branch is deleted. For a non-UI change, bypass it with the `skip-screenshot-gate` label or `<!-- screenshot-gate: skip -->` in the body and state why. Do not use the bypass for a UI change.

- Any later UI change — or a user rejection of any chart — voids the A+; re-review at the new HEAD is mandatory even if no code changed.
- Superseded evidence is removed in the same commit, the PR body/comments name only current files, and the 200/404/folder-match checks pass before push (mechanics in the evidence doc at the top).
- The main agent must not merge, PR, or call a UI change done at A/B/C/F or with a missing verdict. Green CI never overrides.

### 7.7 Evidence data authenticity

- **Real data only.** Evidence/PR/review screenshots must show real market symbols and values — `RELIANCE`/`POWERGRID` or the relevant real index (`NIFTY` for the Index Report). Never put `MOCK1`/`MOCK2`, dummy names or fabricated prices in user-facing evidence; E2E mocks (`tests/mocks/apiResponses.ts`) are for interaction tests only. Label index-specific screens by the real index (`NIFTY`), not a dummy label.
- **Viewport captures.** Every capture is a viewport screenshot at **1600×1000** and **390×844** (not full-page), covering every changed mode/selector option plus loaded/loading/error/empty. Read each PNG back before attaching; reject clipped labels and blank canvases. No A+ claim without the independent verifier (§7.1).

