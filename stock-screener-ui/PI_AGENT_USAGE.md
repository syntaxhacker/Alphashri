# PI Agent Usage — running subagents in parallel

Ultra-simplified. Full rules live in [`SUBAGENT_RULES.md`](./SUBAGENT_RULES.md).

## The idea

Each agent gets a **different file**. Same file twice = both agents corrupt each other.

## Three rules

1. **One agent, one file set.** Write the list of files it may touch into its brief.
2. **Nobody runs git or a build.** Agents only read/edit + run targeted tests. You commit.
3. **You verify.** An agent's "done" is a claim, not a fact. Read its diff.

## The call

```js
subagent({
  workflow: "parallel",
  args: { tasks: [
    { agent: "worker", cwd: "/abs/repo", task: "Read /tmp/brief-A.md and execute it." },
    { agent: "worker", cwd: "/abs/repo", task: "Read /tmp/brief-B.md and execute it." },
  ]},
})
```

Returns immediately — it runs in the background and wakes you when done.

## Keep briefs in files, not in `task`

`args` dies above **16 KiB**, and a good brief is longer than that. So:

```
write  /tmp/brief/common.md   # shared rules, theme mapping, verify commands, report format
write  /tmp/brief/A.md        # this agent's files + its bug list
write  /tmp/brief/B.md
write  /tmp/brief/C.md
```

Then each `task` is one line: `Read /tmp/brief/A.md and execute it.`

## Every brief has the same 5 sections

```md
## YOUR FILES (the whole write scope)
src/ui/foo.tsx
Do not edit anything else.

## Bugs to fix
1. <bug> — <file:line> — <the fix>

## Hard rules
No git · no build · no dev server · keep the public API · native read/edit/write only

## Verify
npx oxlint <your files>
npx vitest run <the guards for your scope>

## Report
files touched · one line per bug · exact commands with pass/fail counts · anything not done
```

The `Do not edit anything else` line and the explicit file list are what make parallel safe.
The report contract is what makes the result checkable.

## Split by file, not by topic

Good — no overlap:

| agent | files |
|---|---|
| A | `Select.tsx`, `MultiSelect.tsx` |
| B | `TextInput.tsx`, `NumberInput.tsx` |
| C | `Checkbox.tsx`, `KitPoc.tsx` |

Bad — both need `types.ts`:

| agent | files |
|---|---|
| A | `Select.tsx`, `types.ts` |
| B | `NumberInput.tsx`, `types.ts` |

When a fix spans everyone (e.g. a colour-token change), give each agent the **same mapping table**
in `common.md` and let each apply it to its own files.

## After the wave (you, not the agents)

```bash
git status --porcelain          # what did they actually touch?
git diff                        # read it
bun run lint && bun run build
npx vitest run <guards> <affected specs>
```

Then commit on a feature branch. Agents never commit.

## Model

Default for every agent: `opencode/nemotron-3.5-super-vl-free` (`$0`).
Free tiers hit `Free usage limit reached` mid-task and leave a half-edited tree —
when that happens, finish that piece yourself and say so.

## Time budget — the wave that timed out

An agent has a **30-minute wall clock**. One of three blew through it on its last step and was
reported as `failed` even though its edits were complete and correct.

What ate the clock, in order:

1. **`npx tsc --noEmit | grep -c` in every brief.** Minutes on this repo, and it answers nothing
   actionable.
2. **A whole-directory `npx vitest run src/ui`** (40 files / 264 tests) as a per-agent check.
3. **Me running the same suites at the same time.** Two vitest runs on one box starve each other
   and both look hung.

Rules of thumb:

- Brief: name the **specific test files**, not a directory, and skip full `tsc` for a subagent.
- While a wave runs, **don't run heavy suites yourself** — do it once, after, as the gate.
- A `failed` child may still have landed its work. **Check `git status` before rerunning anything.**

## Worked example (2026-11, `/poc/kit` audit)

Found 16 UI-kit bugs → created `fix/ui-kit-poc` → 3 briefs (`/tmp/ui-kit-fix/{common,A,B,C}.md`)
→ one `parallel` call → reviewed the diff, ran build + guards, committed.
