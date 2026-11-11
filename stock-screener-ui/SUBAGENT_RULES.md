# SUBAGENT_RULES.md

Operating contract for subagents working in `stock-screener-ui/`. Read fully before editing.

## 1. Purpose / Hierarchy

| Role | Owns |
|---|---|
| Main agent | Orchestration, brief authoring, review, integration, **only git actor** |
| Subagent | Scoped implementation inside an assigned brief; no user questions |

- Subagents **report blockers to the main agent**, never to the user.
- Subagents do not spawn further subagents.
- Ambiguity in the brief = stop and report, do not guess scope.

### Enforcement

- The main agent must **not** implement normal code tasks; it scopes, dispatches, reviews, integrates, and verifies.
- Main may edit only when a subagent is blocked/quota-exhausted, or a small integration fix is required — and must state that exception.

## 2. Hard Safety (non-negotiable)

- **NEVER** modify `db/alphashri.db`.
- **NEVER** delete anything under `reports/**` — overwrite in place if regeneration is required.
- **No destructive git**, including `reset --hard`, `checkout --`, `restore`, `clean`, `stash` (push/pop/apply/clear/drop), `rebase`, `merge`, `cherry-pick`, `revert`, `branch -D`, `push --force`.
- Subagent git is **read-only**: `git status`, `git log --oneline`, `git diff --stat` only.
- No commits, pushes, or branch changes by subagents.
- **No secrets / API keys / tokens** in code, tests, fixtures, or logs.
- **No DB writes**, migrations, or seed runs.
- **No server restarts**, no `start.sh`, no killing processes.
- No dependency installs, no lockfile edits.

Violation risk → abort and report `blocked: <command>` with the reason.

## 3. Scope Discipline

- Edit **only** files listed in the brief.
- Never touch files owned by another agent or another worktree.
- No broad refactors, renames, formatting sweeps, or drive-by cleanups.
- No new dependencies unless explicitly approved in the brief.
- If a change requires an unlisted file: **stop** and report the exact path + why.
- If tests require a fixture change outside scope: report, do not edit.
- Keep diffs minimal — the smallest change that satisfies the acceptance tests.

## 4. Code Comments — Minimal by Default

- **No unnecessary comments.** Code should read without narration.
- Comment only:
  - non-obvious invariants,
  - bug workarounds with a reference (issue/migration/cause),
  - external constraints (API quirks, SDK limits),
  - safety-critical ordering.
- One line maximum per comment. No paragraphs.
- No changelog comments (`// added X`, `// fix for Y`).
- No commented-out code — delete it.
- Delete comments that are now stale or contradict the code.
- JSDoc/docstring only for **public API contracts** (exported functions, route handlers).

## 5. UI Density / Spacing Rules

Reuse before building:

- `CompactPanel`, `CompactStat`, `CompactStatGrid` (`src/components/common/compact.tsx`)
- `ToolbarRow` for control rows
- `TanStackTable` for all tables (explicit `meta.align` per column — text left, numbers right, badges center)
- Local Tailwind components from `@/ui`

Layout:

- 8pt grid only: outer `16`, inner `8`, gaps `4/8/16`. No raw `6px`.
- Dense cells: table padding `8px 12px 12px`, header `48`.
- No large empty flex gaps; no `ml:auto` to separate unrelated groups.
- Avoid `1fr` tracks that push related label/value pairs apart — cap label and value tracks.
- One border per section. No nested bordered cards; separate with dividers.
- Panels/charts fill their flex parent (`flex: 1`, `autoSize`); no fixed heights inside flex panels.

Verify:

- Desktop **1704px** and a mobile viewport.
- No clipping, overflow, or accidental full-width inputs in rows.
- Inputs in a row get explicit `w={n}` or a flex cell wrapper.
- **Do not add comments to explain spacing.** Fix the layout.

## 6. Implementation + Verification

Context:

- Read the minimum needed; prefer targeted `grep`/`search` over reading whole directories.
- For API surface, read `openapi.yaml` first, not router sources end-to-end.

Checks (targeted only — never the full ~6k suite):

```bash
bun run lint
npx vitest run <touched test files>
.venv/bin/python -m pytest <touched test files> -q
.venv/bin/python -m pytest tests/contract/test_openapi_sync.py -q   # API changes only
npx vitest run src/test/ui-guard.test.ts                            # UI changes
npx vitest run src/ui/inputs/inputs.w-h.test.tsx                    # input changes
```

- UI changes: lint + relevant vitest; **screenshot verification is the main agent's job** — flag it as pending.
- API/route/schema changes: OpenAPI export + sync test.
- Do not run Playwright suites without an explicit file filter.

Return to main:

1. Files changed (paths).
2. Diff summary (per file, 1 line).
3. Commands run.
4. Test/lint output (pass/fail counts, trimmed).
5. Risks (regressions, untested paths).
6. Blockers (what stopped work, exact file/reason).

## 7. Model Routing

| Purpose | Model |
|---|---|
| All subagent work (default) | `opencode/pulse-alpha-free` |
| Fallback only if Pulse is unavailable AND main agent explicitly approves | `opencode/deepseek-v4.1-flash-free` · `opencode/nemotron-3.5-super-vl-free` |

- `opencode/pulse-alpha-free` is the default for **all** subagent work. DeepSeek/Nemotron are fallback-only, used when Pulse is unavailable **and** the main agent explicitly approves — never as the silent default.
- Independent work → background subagents; **max 3 active** at once.
- Free-tier quota may return `Free usage limit reached`.
- On failure or quota exhaustion: main agent takes over the task and states that it did.
- Escalate to a stronger model only for correctness-critical verification, with a stated reason.

## 8. Brief Template

Copy-paste skeleton for dispatch:

```markdown
## Task
<one paragraph: what to build/fix, and why>

## Files allowed
- path/one.tsx
- path/two.test.tsx

## Do not touch
- db/alphashri.db, reports/**, package.json, lockfiles
- <other agents' files>
- no git write commands, no DB writes, no restarts

## Acceptance
- <test file / assertion that must pass>
- <behaviour or screenshot criterion>
- bun run lint clean; targeted vitest green

## Return
files changed · diff summary · commands run · test/lint output · risks · blockers
```

Rules for the author: one task per brief; explicit file lists; measurable acceptance; no implied follow-up work.
