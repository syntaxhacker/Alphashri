# stock-screener-ui — Agent Rules

## ⚠️ Golden Rules
- **NEVER delete or directly modify `db/alphashri.db`** — it contains user accounts, bot state, and trade history. Tests use in-memory SQLite via `test_engine` fixture. If a migration is stuck, use `SKIP_ALEMBIC=1` or ask the user.
- **NEVER commit secrets, API keys, or tokens** to the repo.
- **NEVER push directly to `develop` or `main`** — both are protected shared branches. All work goes through a short-lived feature branch (`feat/…`, `fix/…`, `chore/…`, `docs/…`) pushed to origin, then a PR targeting `develop` (or `develop` → `main` to release). No direct `git push origin develop` / `git push origin main`, ever.
- **NEVER delete report artifacts** — anything under `reports/**` (figures, PNGs, HTML, CSV, JSON, scripts, notes) is kept, even after regeneration. Overwrite in place instead of `rm`-ing first. The user deletes their own reports.

## 🚫 Main Agent — Orchestration Only (ZERO IMPLEMENTATION)

The main agent exists to scope, dispatch, review and integrate. It does not write the code, the tests, the styles, the configs, the generated spec, or the docs that ship with a task.

**The main agent NEVER edits:**
- source code (`src/**`, `api/**`, `trading/**`, `backtest/**`, `db/**`, `scripts/**`, `chart_patterns/**`, `upstox_trader/**`, **any** `.ts`/`.tsx`/`.py`/`.sql`/`.css`)
- tests (`*.test.ts(x)`, `*.spec.ts`, `tests/**`, fixtures)
- styles / theme / palette (`src/tailwind.css`, `src/ui/palette.ts`, `style.css`)
- configs (vite, tsconfig, oxlint/knip, CI workflows, `package.json`, lockfiles, env files)
- generated specs — **`openapi.yaml` is generated, never hand-edited** (see the OpenAPI section)
- deliverable docs (`AGENTS.md`, `SUBAGENT_RULES.md`, `UI_RULES.md`, `PRODUCTION.md`, `docs/**`, feature docs) — unless the task **is** a docs task assigned to the main agent

**The main agent MAY only:**
1. read / search / inspect the tree and diff — no writes
2. scope work and write subagent briefs (template: `SUBAGENT_RULES.md` §10)
3. dispatch subagents and track their file ownership
4. review diffs against the brief and the repo rules
5. run verification commands — `bun run build`, `bun run lint`, `bun run typecheck`, targeted `npx vitest run <file>`, targeted `.venv/bin/python -m pytest <file> -q`, OpenAPI export + drift check, screenshot review
6. integrate by **sending fixes back to the owning subagent**, never by editing the file itself
7. act as the **sole git actor** (branch, commit, push feature branch, PR) — subagents stay read-only on git. For a UI change, no commit/push/PR until an independent verifier records **A+** (`UI_RULES.md` §7).

**Defects go back to the owner.** Every file has an owning subagent session. A defect found in review — a failing assertion, a lint warning, a misaligned column, a stale `openapi.yaml`, a wrong comment — is sent back to the subagent that owns those files with the exact failure output. The main agent must **not** "quick-fix" it, even a one-character fix, even to unblock itself. If the owner is gone, dispatch a new subagent scoped to those files.

**The only exception** is when the owning subagent is blocked or quota-exhausted, or an emergency recovery is required. Then the main agent must, in this order:
1. **ask the user first** and wait for an explicit approval in the same turn
2. state `MAIN-AGENT EXCEPTION: <reason>` in that turn
3. list **every** file it touched

Without both the user's approval **and** the `MAIN-AGENT EXCEPTION:` label, no edit happens. A "small integration fix" is not an exception unless it clears that bar.

**Verification is not implementation.** Running commands and reading their output is allowed and expected. Changing the code under test to make a command pass is implementation — it is forbidden, and it also invalidates the verification.

**Attribution is mandatory.** Every edited file in the main agent's final report must be attributable to a **named subagent session** (files changed by that session, one line each). A file with no owner is a violation, not bookkeeping.

**Violation handling:** if the main agent catches itself about to edit an owned file, it must stop, report `main-agent-edit-blocked`, and hand the file back to its owner. It must not finish the edit and disclose it afterwards.

Everything below in this file describes the work; it does not grant the main agent a licence to perform it.

## Start here

- **[`docs/AGENT_QUICKSTART.md`](./docs/AGENT_QUICKSTART.md)** — commands, folder map, unit/E2E/backend recipes, fixtures. Read this before exploring the tree.
- **[`docs/MAP.md`](./docs/MAP.md)** — task → file location.
- **[`docs/AGRI_DATA_USAGE.md`](./docs/AGRI_DATA_USAGE.md)** — agri mandi data: sources, units, partial days, API/SQLite/release/sync rules. Read before touching agri data or `/agri`.
- **[`TEST_RULES.md`](./TEST_RULES.md)** — test shape, mocks, guards.
- **[`docs/TESTING_INDEX.md`](./docs/TESTING_INDEX.md)** — one index for test rules, speed, performance, agri data, fixtures and test-debt docs.
- **[`docs/TEST_DEBT.md`](./docs/TEST_DEBT.md)** — current backend test-debt clusters, fixed items and how to get a fresh list.
- **[`docs/PERFORMANCE.md`](./docs/PERFORMANCE.md)** — performance budgets, check cadence, measurement methodology.
- **[`docs/DESIGN_SYSTEM_A_PLUS_GATE.md`](./docs/DESIGN_SYSTEM_A_PLUS_GATE.md)** — the live A+ scorecard and continuous-loop contract; read it before any design-system/UI-quality wave.

## Tooling — edit files natively
- Use the native `read` / `edit` / `write` tools for every file read or write. Do **not** shell out to `sed -i`, `python - <<EOF`, `cat >`, `perl -pi`, or `awk` to modify files.
- The shell is for running things: build, tests, git, `grep`/`rg`, `find`. Locate with `grep`/`glob`, then `read` before `edit`.
- Bulk mechanical edits (a rename across 40 files) may use a checked-in script, but the script itself is written with the native tools and reviewed before it runs.

## 🛡️ Agent Git Safety (STRICT — ZERO EXCEPTIONS)
**Destructive git is FORBIDDEN without explicit user `yes` in same turn:** `reset --hard`, `checkout --`, `restore`, `clean -fd`, `branch -D`, `push --force`, `stash` (push/pop/apply/clear/drop), `rebase`, `merge`, `cherry-pick`, `revert`, or any `HEAD`-moving command.

**Before any multi-file/subagent work:**
1. `git status --porcelain` — if dirty, create checkpoint BEFORE work.
2. Subagents are git-forbidden (read-only `status/log/diff` only); main agent is sole git actor.

**Branch & PR policy (non-negotiable):**
- Main/integration agent never commits directly onto `develop` or `main`. Start from the latest `develop`, create `feat/…` / `fix/…` / `chore/…` / `docs/…`, commit there, `git push -u origin <branch>`, then `gh pr create --base develop`.
- Release flow: `develop` → PR → `main`. Never `git push origin main`.
- `git commit` locally is fine; only `git push` of a **feature branch** is allowed without asking. Pushing to shared branches requires explicit user approval and is normally a PR merge instead.
- If already on `develop` with uncommitted work, create the feature branch (`git switch -c <type>/<name>`) before committing — never commit then push `develop`.

**PR cycle (end-to-end, verified 2026-11-16):**
1. Branch from the latest `develop`; never commit on `develop`/`main`.
2. Pre-PR gate: `bun run lint`, `bun run build`, `bun run typecheck`, targeted unit + E2E for the touched areas, the unconditional filesystem-scanning guards, and the test/perf/evidence audits in `## Integration & audit gates` when the change is a data path or UI work.
3. `git push -u origin <branch>`, then `gh pr create --base develop`. The body lists areas changed, behaviour changes (auth, migrations), verification commands/counts, and a test plan.
4. Wait for checks. PR-to-`develop` runs **E2E Smoke (22)** + frontend unit on changed test files only/lint + the **662-test Python fast tier across 6 shards** (`unit and not slow`) + GitGuardian; **E2E Full (16 shards) never runs on PR-to-develop**. Push to `main` / the 02:00 nightly schedule instead run the full **8,987-test exclusion sweep** (`not (slow or slow_testcontainers or integration or contract or e2e or testcontainers or postgres)`) across the same 6 shards — that is the debt alarm, not a PR gate (the full suite carries a known ~230-failure debt and is not a gate until green). Frontend unit on PR-to-develop gates only changed test files; the full 4-shard Vitest suite runs on PR-to-main/nightly. Full E2E is deliberately main-only: it runs on push to `main`, on PR-to-`main`, and on the 02:00 nightly schedule, because 16 shards are slow and the smoke set is the accepted gate for feature branches. There is **no `workflow_dispatch` trigger** in `test.yml`, so a branch cannot request the full suite — treat smoke plus the touched test files as the gate, and let the release PR to `main` run the rest.
5. **UI evidence and visual gate.** For user-visible UI changes, the implementer captures **1600×1000** and **390×844** screenshots for every changed mode/selector and loaded/loading/error/empty state, commits them under `docs/screenshots/<feature>/` with a manifest, and embeds the raw URLs in the PR body. An independent verifier grades the actual PNGs + running UI; the main agent records A+ as approver and is the sole git actor. **No `git commit`, `git push`, or PR before A+**; only A+ ships and a user rejection voids it. Superseded evidence is removed in the same commit, with PR body/comments naming only current files and the 200/404/folder-match checks passing. Capture/naming/manifest/replacement **and PR-body raw-URL table format**: `docs/SCREENSHOT_EVIDENCE.md`; gate: `UI_RULES.md` §7; evidence data authenticity: [`UI_RULES.md` §7.7](./UI_RULES.md#77-evidence-data-authenticity).
6. Merge with `gh pr merge <n> --merge` (preserves commit messages/measurements; do not squash a multi-commit bundle unless the user asks). Never `--admin`/bypass.
7. `git switch develop && git pull --ff-only`; verify the merge commit and that the key files/fields actually landed.
8. Delete the merged branch with `git branch -d <branch>` and `git push origin --delete <branch>` — only after step 7 verifies. An ancestor `feat/…` branch is also redundant; confirm before deleting it.
9. One PR per branch. If a branch contains multiple independent features, ask whether to split; a single bundle PR is allowed only when the user explicitly says so, and its body must say that it is a bundle.

**Release (develop → main; convention `v0.1.0`, `v0.2.0`):**
1. Open a PR `develop` → `main`. PR-to-`main` runs the **full E2E suite (16 shards)** — wait for it, not just smoke.
2. Merge with `gh pr merge <n> --merge` (keep the release merge commit).
3. Tag the `main` merge commit (annotated, matching the existing style):
   `git switch main && git pull --ff-only`
   `git tag -a vX.Y.Z -m "Alphashri vX.Y.Z — <one-line summary>"`
   `git push origin vX.Y.Z`
4. Create the GitHub Release: `gh release create vX.Y.Z --title "Alphashri vX.Y.Z" --generate-notes` (target `main`; no binaries unless asked).
5. Sync `main` back into `develop` through a `main` → `develop` PR; never commit or push directly to `develop`. Merge it after CI so develop contains the release merge/tag commit.
6. Verify: `gh release list`, `git log --decorate -1 vX.Y.Z`, and both branches contain the release commit.
7. Versioning is semver: features → minor, fixes → patch. Latest release: `v0.2.0` (2026-11-11).

**Subagents may not touch branch state or GitHub:** no `git branch`, `switch`, `checkout`, `add`, `commit`, `push`, and no `gh pr create/merge`. A subagent that needs a branch stops and reports; the main agent is the only PR actor. A branch pushed by a subagent is a contract violation — surface it.

**Subagent contract:** Agents launched via `Task` are read-only + edit (file writes allowed), but **STRICTLY FORBIDDEN** from any `bash` git command that can disturb other agents in same env p — including `stash` (push/pop/apply/clear/drop), `reset`, `checkout`, `restore`, `clean`, `rebase`, `merge`, `cherry-pick`, `revert`, `branch -D`, `push --force`. Allowed subagent git: `status`, `log --oneline`, `diff --stat` (read-only). If a subagent proposes `stash/reset/clean/checkout/rebase`, main agent must reject and surface to user.

**Violation handling:** If destructive command is about to run, abort, report `blocked: <command>`, wait for explicit approval. On accidental `reset --hard`, run `git reflog --oneline | head` + `git fsck --lost-found` and report, do not auto-recover without user.

## Stack
SolidJS 1.9 + Vite 8 + Tailwind CSS 4 + TypeScript. Backend: FastAPI (Python).

## Commands
- `./start.sh` — starts both API (uvicorn) and UI (vite) together, auto-activates `.venv`. Background mode (reload on, uses `watchfiles`). Modes: `dev` (foreground, reload), `prod` (foreground, no reload), `restart [prod]`, `stop`, `status`, `logs`, `bots start|stop|status`. During market hours the 52W range batch now runs a prompt initial job quickly after startup (see the 52W section). Logs to `logs/alphashri.log`.
- `bun run dev` — dev server only (proxy /api → localhost:8765)
- `bun run build` — production build
- `bun run lint` — oxlint (0 warnings/errors required before commit)
- `bun run test` — vitest --run (use `npx vitest run <file>` for targeted tests, NOT `bun test` which lacks vi.mock support)
- `bun run storybook` — Storybook dev server on port 6006 (local primitive/component visual review)
- `bun run build-storybook` — static Storybook build; regenerates `storybook-static/index.json` consumed by `src/test/storybook-catalog.test.ts`
- `bun run audit:components` — regenerate `docs/COMPONENT_AUDIT.md` (component/style + story-import audit)
- `bun run audit:typography:check` — type-floor / no-private-font-size guard (also runs in CI)
- `bun run visual:test` / `bun run visual:update` — Storybook pixel baselines at 1600 & 390 (12 PNGs; needs `bun run build-storybook` first)
- `bun run audit:evidence` — gate on committed `docs/screenshots/**` existence + 1600/390 dimensions
- `bun run evidence:all` — capture real-app route screenshots (requires running server)
- `APP_A11Y=1 npx playwright test tests/e2e/app-a11y.spec.ts` — App-route axe/a11y step
- `source .venv/bin/activate && python -m pytest tests/` — backend tests

## Storybook / design-system catalog

Storybook is live and checked in via its config (`.storybook/main.ts`, `.storybook/preview.ts`) and stories in `src/stories/design-system/*.stories.tsx` (plus any co-located `*.stories.tsx`). Run `bun run storybook` for interactive review and `bun run build-storybook` before relying on the static catalog guard (`npx vitest run src/test/storybook-catalog.test.ts` skips itself when `storybook-static/` is absent).

- Six Storybook stories are pixel-baselined at 1600/390 against 12 committed PNGs (`visual:test` / `visual:update`, after `bun run build-storybook`) — a primitive-level guard, not the real-app PR evidence below.
- Read [`docs/COMPONENT_AUDIT.md`](./docs/COMPONENT_AUDIT.md) for the generated, honest story/coverage counts (`bun run audit:components` regenerates it). The catalog is **primitive-level** — tokens, layout/input/feedback primitives and a few shared widgets — not a claim that every audited module is covered or visually reviewed.
- Full setup, groups and link policy: [`STORYBOOK.md`](./STORYBOOK.md).
- Storybook is a review aid, not a substitute for the real app: the PR screenshot rule above still requires **1600 and 390** captures (plus every changed mode/selector/empty/loading/error state) committed under `docs/screenshots/<feature>/`, each PNG read back before claiming done. The catalog guard only checks catalog integrity (entry counts, unique ids/titles, no duplicate `(title,name)`, Overview `?path=/story/...` links resolve).

## Python Environment
- **Version**: pinned via `.python-version` (3.12.13) — pyenv reads this automatically
- **Virtual env**: `.venv/` (created with `uv venv --python 3.12.13`)
- **Package manager**: `uv` (faster than pip) — install deps with `uv pip install -r <requirements.txt>`
- **Dependencies**: `../requirements.txt` (root) + `api/requirements.txt` (API-specific)
- **Note**: `nautilus-trader` is **no longer a dependency** (removed 2026-11-22). Backtests run on the pure-Python engine in `backtest/sim/`; `BACKTEST_ENGINE=nautilus` is opt-in A/B and requires reinstalling the package.
- **`start.sh`**: auto-activates `.venv` before starting uvicorn; always use `./start.sh` to run both services. Logs saved to `logs/alphashri.log`.
- **Start with DeepSeek**: pass env vars inline to use DeepSeek for TradingAgents analysis:
  ```bash
  DEEPSEEK_API_KEY=sk-xxx OPENAI_API_KEY=sk-xxx OPENAI_BASE_URL=https://api.deepseek.com ./start.sh
  ```
  Or add keys to `.env` or `.env.dev` — `config.py` auto-loads them via `load_dotenv()`.
- **Test login**: email `qa@test.com` / password `qa123`
- **Get token for curl**:
  ```bash
  TOKEN=$(curl -s -X POST http://localhost:8765/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"qa@test.com","password":"qa123"}' | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"
  )
  curl -H "Authorization: Bearer $TOKEN" http://localhost:8765/api/trading-agents/health
  ```

## TradingAgents Chat Bot
- **Chat endpoint** (`/api/trading-agents/chat`): Conversational AI using DeepSeek via LiteLLM. Uses function calling to detect stock analysis requests. Returns `should_analyze` field when a stock ticker is detected.
- **Analyze endpoint** (`/api/trading-agents/analyze`): Runs full multi-agent analysis (market, news, fundamentals analysts) via TradingAgents framework. Takes 60-120s. First call slow, subsequent calls served from file cache.
- **Stream endpoint** (`/api/trading-agents/stream/{ticker}`): SSE streaming with progress, tool_call, report, and complete events. Uses `json.dumps()` for data serialization (critical: sse_starlette 3.4.1 does NOT auto-serialize dicts to JSON — must call `json.dumps()` manually).
- **File cache**: Results stored at `experiments/data/analysis_cache/{TICKER}_{DATE}.json` with 24h TTL. Checked by both analyze and stream endpoints before running analysis.
- **Providers**: Chat uses OpenRouter free model (`openai/gpt-oss-20b:free`) if DeepSeek key not available. Analysis uses DeepSeek via LiteLLM (`deepseek/deepseek-chat`).
- **No auth required** on chat, analyze, and stream endpoints (get_current_user had compatibility issues with this router). Conversation history endpoints use hardcoded user_id=3.
- **Chat history**: Conversations and messages stored in `chat_conversations`/`chat_messages` tables. CRUD endpoints at `/api/trading-agents/conversations`.
- **No UI consumer**: the Chat Popup (`ChatPopup.tsx`, its `Markdown.tsx` renderer and tests) was removed on 2026-11-21 — these endpoints are currently called only by curl/tests, so a missing caller is expected.

## Tailwind 4 Financial Theme Rules
Single source is `src/ui/palette.ts`; `src/tailwind.css` mirrors it (guarded by `theme-single-source.test.ts`).

- **Never hardcode a hex outside `palette.ts`.** The guard scans every `.ts`/`.tsx` and fails on any `#RRGGBB`.
- **Derive tints, never restate them:** `alpha(palette.POSITIVE, 0.12)`, not `"rgba(0,200,83,0.12)"`. Three separate green/red pairs had accumulated and disagreed about what "positive" means.
- **Surface ramp** (each adjacent step ≥1.15:1, asserted): page `BG #000000` → panel `SURFACE #13161C` → raised `SURFACE_ALT #1F242D`, hairline `BORDER #2C313B`. Page == panel means the panel does not exist — that was the real cause of "everything looks the same".
- **Radius** `4` (small) / `6` (controls) / `10` (large); `--radius-fin: 6px` is the control alias. **Control heights** `xs 24 · sm 30 · md 34 · lg 38`. **Type floor is 12px** on the `text-ui-*` scale; no private `font-size` literals. All four are guarded by `design-scale.test.ts` — see `SUBAGENT_RULES.md § 7.1` and `docs/TYPOGRAPHY.md`.
- Use the local `@/ui` components (`Box/Flex/Stack/Group/Center/Grid/SimpleGrid/Paper/Card/ScrollArea`) + `CompactPanel/CompactStat/CompactStatGrid` (`components/common/compact.tsx`). They render semantic HTML + Tailwind.
- 8pt grid: outer `16`, inner `8`, table `8px 12px 12px`, header `48`, gaps `xs4 sm8 md16` — no raw `6px` slop
- `TanStackTable` `src/components/common/TanStackTable.tsx` `ROW_ESTIMATED 28` `cell 8/12/12` `sticky shadow` — dense but scannable (12px)
- Reference the local `@/ui` types; use `className`/Tailwind utilities, never `sx`; `size="sm"` inputs/buttons, `size="xs"` badges/tables only
- Tables — fin-app alignment is mandatory (text left, numbers right, badges/actions center; explicit `meta.align` per column, wrapper must match): rules + placement map in [TABLE_CHECKLIST.md](../TABLE_CHECKLIST.md)

## Contrast rules (MANDATORY)

- Use **`src/utils/contrast.ts`** for every filled cell, badge, chip or chart
  label. Do not re-implement WCAG maths in a component.
- **Text ≥ 4.5:1**, **meaningful graphics ≥ 3:1**. Decorative hairlines are
  exempt. Never put text directly on a solid saturated fill — use
  `pickTextColor(fill)` or a low-alpha tint + solid rail.
- Run **`bun run contrast`** and add every new fill/tint/text pair to
  `src/test/contrast.test.ts`. A filled cell you cannot read at 100% zoom is a
  bug, not a style choice.
- Follow **`docs/COLOR_SEMANTICS.md`** for side-vs-level token mapping and row
  highlight patterns. Do not invent colours or reuse a token for a different
  meaning.
- Screenshot the full/empty/loading states at **1600 and 390** before calling a
  colour change done.

## UI Revamp Rules (MANDATORY — read before touching any tab/page)
Full rules: [UI_RULES.md](./UI_RULES.md). Checklist to tick for every revamp: [UI_CHECKLIST.md](./UI_CHECKLIST.md).
Judgement rules for any screen: [docs/UX_PRINCIPLES.md](./docs/UX_PRINCIPLES.md) — in-flow over overlay, one surface per concept, no dead ends, keyboard parity, measure before claiming.
1. **`@/ui` is local semantic HTML + Tailwind.** Mantine-only props (`styles`) are dropped. Never pass `styles={{...}}` (guard test fails). Inputs honor `w`/`h`; when `w` is set the input stops being full-width.
2. **Inputs default to `fullWidth`.** In a row, give each an explicit `w={n}` or wrap it in a flex cell (`<Box className="flex-1 min-w-0">` + `style={{ width: "100%" }}`). Accidental full-width selects are a bug.
3. **Control rows use `<ToolbarRow>`** (from `@/ui`) — it forces `align-items:center` + explicit gap. `Group` defaults to `align-items: stretch`; if used for controls, pass `align="center"`.
4. **No nested bordered cards**; one border per section, inner separation via dividers. Panels/charts fill their flex container (`autoSize`, no fixed heights in flex panels).
5. **Verify visually, not just build.** After any UI change: `bun run build && bun run lint`, then a chrome-devtools screenshot at a real viewport in empty/loading/error/full states, then run the guard suite listed once in `SUBAGENT_RULES.md §8` (do not keep a second copy here) plus the feature's unit tests and its E2E spec.
   Build/lint do NOT catch alignment bugs — the screenshot is part of the definition of done.
   **DEFAULT TO VISUAL CHECKS FOR DATA-DRIVEN UI — do not wait to be asked.** Green unit/lint/tsc/E2E is not evidence that a screen works. On 2026-11-18 the Market heatmap's colour-by feature shipped 323 passing tests, a clean build, clean lint and `tsc 321` while **selecting any non-default metric threw `Cannot read properties of undefined (reading 'trim')` and blanked the whole screener**. Every test fed day-change-shaped inputs; the crash needed a 0–1 metric *and* a real render. `AGENTS.md` already said the screen must be verified — it was still skipped, so treat it as a hard gate, not advice:
   - **Screenshot every state of the control you touched**, not just the default: for a selector/dropdown, one shot per option. A default-only shot is what hid this bug.
   - **`read` the PNG back and look at it.** A screenshot you never opened proves nothing. Check that tiles/labels/legend show *plausible* values, not just that pixels exist — "every tile reads 1%" and "counter says 13, 12 tiles drawn" are only visible by eye.
   - **Distrust a suspiciously small PNG** (the crashing frame was 45KB vs ~105KB for working ones) and any error text in the frame (`hit an error`, `undefined`, `NaN`).
   - **Exercise the non-default branches explicitly**: every option in a metric/mode selector, empty result, and a value that is 0/negative/undefined in the data. Those are where the branch-only bugs live.
   - A crash found by eye that the suite missed means the suite has a **missing range case** — add the regression test (per `TEST_RULES.md §0`, prove it fails first), do not just fix the crash.
6. **A page is not "done" until it is measured, not eyeballed.** The Index Report chrome was 800px above the chart (walls card 475px) with the chart permanently below the fold, and it survived review because nothing measured it. If a fix claims "now it fits", take the `getBoundingClientRect()` numbers before/after and put them in the commit message.
7. **Visual Review Gate.** Build, lint, tests, typecheck and green CI are not visual approval. An independent verifier grades the actual PNGs + running UI; the main agent records A+ as approver and is the sole git actor. Only A+ ships; a user rejection voids it and any later UI change is re-reviewed. Roles, seven-dimension rubric, caps and verdict: [`UI_RULES.md` §7](./UI_RULES.md). Capture/naming/manifest/replacement: [`docs/SCREENSHOT_EVIDENCE.md`](./docs/SCREENSHOT_EVIDENCE.md).

## State Management
- All stores in `src/state/` — custom `createSubscriber` pattern + `useStoreSubscription` hook
- Solid `createStore` slices in `src/state/store/` (appSlice, notificationsSlice) — legacy, minimal usage
- Never call `useState` for data that lives in a store

## Component Patterns
- Page-level routing components in `src/pages/<feature>/` (e.g., `pages/chart/ChartView.tsx`, `pages/sector/SectorPage.tsx`)
- Shared components: `SortableHeader`, `BadgeComponents`, `PnlText`, `DataTable`, `compact.tsx`, `states.tsx` in `src/components/common/`
- Shared utilities: `formatNumber`, `formatSignedPnl`, `formatPercentage`, `formatCurrencyCompact`, `formatTimeOnly`, `formatElapsed`, `getPnLTextColor`, `getNextSortDirection`, `sortByField` in `src/utils/ui-helpers.ts`
- Config/constants/theme consolidated in `src/config/` (constants.ts, theme.ts, backtestDefaults.ts)
- ECharts: never wrap chart container in `ScrollArea` — ECharts needs explicit dimensions via `flex: 1` on a flex parent
- **List keys**: never use `symbol` alone as key — always composite (`${strategy_id}-${symbol}`) or unique ID. Positions can have same symbol across strategies.

## Decoupling / no hardcoding
- **One descriptor per concept.** Universes (India/US), currencies/units, cap tiers, exchange filters, market sources, labels and limits live in a config/registry — never as scattered `if (universe === …)` branches or duplicate literals.
- **Derive display from data metadata.** A row carries `currency`/units; formatting (₹ vs $, Cr vs B) reads that, not the screen name.
- **Inject, don't inline.** Backend adapters receive thresholds/exchanges/field maps from the descriptor; UI receives labels/options from the same source.
- **One contract per payload.** Import shared types/pure modules across layers; do not restate a DTO or formula in a component.
- **No magic route strings, IDs, keys or limits** in components/tests; use the constants/registry.
- **Data is the same everywhere.** Centralize it (levels module, snapshot store, analytics client); a new consumer reuses it instead of re-deriving.

## Folder Structure
```
src/
  api/          # one module per feature, typed calls over fetchWithAuth (src/state/auth.ts)
  assets/       # static assets (svg, images)
  components/   # feature UI; common/ holds shared widgets (TanStackTable, tableCells, compact)
  config/       # constants, theme, backtestDefaults, colors, patternCatalog, tvSymbols
  hooks/        # useFetch, usePolling, useStoreSubscription, useScreenerState, useOptionsState, …
  pages/        # route entry points (21 of 28 routes; 7 live under components/ — see docs/MAP.md)
  state/        # createSubscriber stores; state/store/ holds Solid createStore slices
  test/         # shared guard specs (style-keys, no-react, design-scale, …)
  test-utils/   # shared render/test helpers
  types/        # TypeScript type definitions
  ui/           # local design system (Box/Flex/Paper/inputs) + palette.ts = single colour source
  utils/        # pure helpers (chartUtils, color, marketClock, reportParsers, …)
```

**Agent navigation map: `docs/MAP.md`** — "to do X, go to Y", verified paths, and the two things named "patterns".

## Replay Trading
- Components: `src/components/replay/` — page-level feature, uses SSE from `api/replay_api.py`
- Cache: `experiments/data/replay_cache/{date}/{symbol}.pkl` (gitignored)

## Live Price Streaming (SSE)
- **Backend**: `api/paper/live_stream.py` — `GET /api/paper/live/stream`
  - Reads open positions from DB → resolves instrument keys via `instruments` table (fallback to JSON file)
  - Connects to Upstox `MarketDataStreamerV3` WebSocket (`wss://api.upstox.com/v3/feed/market-data-feed`)
  - Mode: `ltpc` (LTP + close price only, max 5000 instrument keys per connection)
  - Streams `event: price` with `{symbol, ltp, ltq, instrument_key, ts}` via SSE
  - Uses `threading.Queue` bridge between WS thread and async SSE generator
  - 30s heartbeat if no data; auto-cleanup on client disconnect
- **Frontend**: `src/hooks/useLivePrices.ts` — `fetch` + `ReadableStream` (supports auth headers, unlike `EventSource`)
  - `<LivePriceUpdater />` component in `PaperTradingView2.tsx` subscribes to live prices
  - On each tick, updates `current_price` + recalculates P&L for matching positions via `setPositions()`
  - Falls back to 20s polling on disconnect/error
- **Price vs Polling**: WebSocket delivers first tick in ~30ms vs REST ~174ms. Live ticks stream at ~4/sec during market hours.

## Behavioural guards (UI)
- **Toasts**: `solid-notifications/index.css` must stay imported in `src/main.tsx`, and `.sn-*` must not be restyled. Details: [docs/NOTIFICATIONS.md](./docs/NOTIFICATIONS.md).
- **Options dock sizing**: use flex for height, never percentage heights or `h-full` through a flex-stretched chain. Details: [docs/OPTIONS_CHAIN_COMPONENT_PLAN.md](./docs/OPTIONS_CHAIN_COMPONENT_PLAN.md).

## CSS
- `style.css` holds only flash animations + `box-sizing` + body tokens; `divider` is no longer used as text color (was grey wash — win/loss same)
- Semantic P&L: `success #16A34A` / `error #DC2626` distinct, `toast` left-border `success/error/warning/info`, `table th` `paper + text.secondary`
- Remove dead CSS classes when removing old components (verify with grep before deleting)
- No CSS modules — global CSS + Tailwind utilities; no `sx` overrides

## Backend (Python)
- Single source of truth for IST timezone: `config.IST` (root `config.py`, re-exported in `stock-screener-ui/config.py`)
- Use `datetime.now(config.IST)` everywhere, never `datetime.now()` without tz
- Pandas date filtering: use `pd.Timestamp(date_str, tz=config.IST)` not raw strings — Timestamp vs string comparison raises TypeError
- **Daily bars are stamped 18:30 UTC of the PREVIOUS calendar day** (IST midnight = 18:30Z the day before). Never format `df.index[-1]`'s UTC date for display — it names the wrong session. Convert to IST first: `frame_last_date()` and `fmt_date()` are the correct references. This produced a live "charts show two-day-old data" report on 2026-11-18 when the data was one session old.
- `fetch_intraday_data_v3` for today, `fetch_historical_data_v3` for past dates
- API routes in `stock-screener-ui/api/`, DB models in `db/models.py`
- **Trades endpoint** (`/api/paper/trades`): queries PostgreSQL first, falls back to journal files. The `get_trades` and `_get_trades_from_db` functions handle this.
- **Chart endpoint** (`/api/paper/chart/{symbol}`): has a known timezone mismatch bug in hosted runs — `fetch_historical_data_v3` returns data with UTC index but filtering uses `config.IST` (UTC+5:30), causing 0 rows after date filter. Works in some local runs because the runtime config differs. Investigate: compare `df_1m_full.index.tz` vs `config.IST` in the affected environment.
- **Local dev data**: prod DB can be dumped to local SQLite via `python scripts/dump_prod_to_local.py`. Note: trades have `user_id=1` in prod, local user may be different — update `user_id` after dump.
- **Trading costs**: `backtest/costs.py:calculate_trading_costs()` is the single source of truth. Both `runner_signals.py` and `paper_portfolio.py` use it — never use flat `trade_value * 0.0006`.
- **Background screener tasks** (prewarm + 52W range batch) are started in the lifespan and gated to market hours. The 52W batch now does a prompt initial run shortly after `start.sh` (during market hours) rather than waiting the full interval — see the dedicated 52W section for agent behavior around this.

## Backtest Engine (`backtest/sim`)

- Backtests no longer use `nautilus_trader`. `backtest/sim/` registers the 14 `nautilus_trader.*` module paths the strategies import, so no strategy file changed. ~890 lines replace a ~600 MB Cython dependency.
- `BACKTEST_ENGINE` is read once when `backtest/strategies/__init__.py` is imported: `sim` (default) or `nautilus` (opt-in A/B). A `nautilus` request without the package raises a named `RuntimeError` instead of silently leaving strategies unavailable.
- Semantics the engine must keep: fill at the signal bar's **close**, one `on_bar` per frame row in index order, `ts_event` = raw index nanoseconds with **no** timezone conversion (`get_ist_time()` converts later), and each strategy's own same-bar SL/TP priority.
- Parity is guarded by `tests/test_backtest_shim_parity.py` (both engines in separate subprocesses over one frozen frame, field-by-field diff, plus an IST session-window assertion). The real-engine leg skips when the package is absent, so the shim invariants still run.
- `pyarrow` is still required (`scripts/wall_replay/hist_convert.py`); it was never a nautilus-only dependency.

## Signal Generator Architecture

```
BaseSignalGenerator (base_signals.py)
  ├── SRBreakoutSignalGenerator (sr_breakout_signals.py)
  ├── EMACrossSignalGenerator (ema_cross_signals.py)
  └── Base52WSignalGenerator (week52_utils.py)  ← swing base, is_eod_exit_time() → False
        ├── Week52ChaserSignalGenerator (week52_chaser_signals.py)
        ├── Week52TargetSignalGenerator (week52_target_signals.py)
        └── Blind52WSignalGenerator (blind_52w_signals.py)

ORBSignalGenerator (orb_signals.py)  ← extends BaseSignalGenerator (no longer standalone)
```

### Shared helpers on BaseSignalGenerator
- `_calc_sl_tp(side, entry_price, sl_pct=None, tp_pct=None)` → `(sl, tp)` tuple — handles LONG/SHORT formulae
- `_safe_float(market_data, key, default=0.0)` — safely extracts float from dict (handles None)
- `_format_exit_note(reason, pnl_pct)` → `"reason (PnL: +x.xx%)"` — standardizes exit note formatting
- `_calc_pnl_pct(side, entry, current)` — handles LONG/SHORT sign, div-by-zero guard

### 52W swing strategies (Base52WSignalGenerator)
- `is_eod_exit_time()` always returns `False` (swing = multi-day holds, no EOD exit)
- `_extract_exit_kwargs(kwargs, current_price)` — extracts `days_in_position`, `max_holding_days`, `highest_price_since_entry`, `entry_52w_high`, `trailing_stop_pct` with instance-aware defaults

### DRY rules for signal generators
- Always use `_calc_sl_tp()` for SL/TP arithmetic, never inline
- Always use `_safe_float()` for market_data extraction, never `get(..., 0) or 0`
- Always use `_format_exit_note()` for exit signal notes
- Always use `_calc_pnl_pct()` for PnL calculations, never inline formula

### SR Breakout strategy specifics
- `max_distance_from_r1_pct=5.0` — skips entries where price is >5% above R1 (prevents late breakout entries)
- `breakout_buffer_pct=1.0` — minimum breakout trigger threshold (was 0.1%, now meaningful)
- `eod_entry_cutoff_minutes=15` — blocks entries within 15 min of EOD exit (prevents wasted trades)
- `max_consecutive_losses=3` — pauses strategy for the day after 3 consecutive losses
- Uses **candle-close breakout detection**: checks last 3 completed 1-min candles for R1 cross instead of live LTP
- Scan interval: **5s** (globally reduced from 60s for faster signal detection)

## Strategy Config Pipeline
- **DB Model** (`db/models/bot.py:StrategyConfig`) → **Dataclass** (`trading/config_loader.py:StrategyConfigData`) → **Dict** (`runner.config`) → **SignalGenerator** / **RiskManager**
- All strategy params flow through this pipeline. Adding a new param requires touching all 4 layers + API models + CRUD + migration.
- `base_signals.py` is the abstract base for ALL signal generators — owns `sl_pct`, `tp_pct`, `eod_exit_hour/minute`, `is_eod_exit_time()`, `_calc_sl_tp()`, `_safe_float()`, `_format_exit_note()`, and `_calc_pnl_pct()`. Each subclass overrides before `super().__init__()`.
- **ORB** now extends `BaseSignalGenerator`. SL/TP passed as constructor args from `StrategyRunner`.
- Each strategy has its own per-generator SL/TP defaults. Config comes from DB (seed_qa_data.py), not hardcoded here.
- **StrategyRunner.ORB** passes individual params (not config dict): `self.config['sl_pct']`. All other strategies pass the full dict.
- **DB model defaults** (`sl_pct=1.0, tp_pct=1.5`) apply when creating a new StrategyConfig row via API without explicit values.
- **`CompletedTrade`** now carries `sl_price`/`tp_price` from the position (fix: `portfolio_core.py:close_position()` sets them). Previously always stored 0.0.
- **Risk params**: `risk_per_trade_pct`, `max_capital_per_trade_pct` flow from `runner.config` → `global_risk_manager.validate_trade()`.
- **ORB Best strategy**: optimized via autoresearch (PF=1.61 on 5-min benchmark). Key params: `sl_pct=1.0`, `tp_pct=1.5`, `breakout_buffer_pct=0.3`, `cooldown_minutes=75`, `eod_exit=(15,0)`, `enable_shorts=False`, `min_or_range_pct=0.8`. Validated on 13 days with replay engine (PF=1.19). TP rarely hit — real edge is SL1.0 + 75min cooldown + 15:00 EOD exit.
- **Hardcoded values audit** (all strategy-specific values are now configurable):
  - `runner_core.py:run(interval=5)` — global scan interval. Safe to keep but impacts all strategies.
  - `trading/utils.py:FORCE_EXIT=(15,10)` — global safety-net exit, NOT strategy-specific. Was 15:30 until NSE's Closing Auction Session (Aug 2026) made 15:30 non-continuous, so a forced market order there would execute in the auction; it now sits inside continuous trading. `MARKET_CLOSE=(15,30)` is still the session close and `CONTINUOUS_CLOSE=(15,15)` the end of continuous trading. A strategy's own `eod_exit_hour/minute` takes precedence.
  - `runner_signals.py:178` — `day_change_pct > 2.0` ORB skip filter. Generic safety, could be config in future.
  - `week52_chaser_signals.py:128-132` — ADX<25, RSI 50-70 filters. 52W-specific, could be config.
  - `runner_signals.py:581` — `0.8` daily loss alert multiplier. Could be global risk param.
  - Fibonacci pivot constants in `sr_breakout_signals.py` — mathematical constants, never change.

## Telegram Notifications
- Module: `trading/telegram_notifier.py` — all calls are non-blocking via `ThreadPoolExecutor`
- The separate `upstox_trader/screeners/tv_alerts.py` Telegram system is **unrelated** — that's for TradingView screener webhooks

## Bot Architecture
- Bot runs as **separate subprocess** via `runner_cli.py` — NOT in the API process
- API and bot communicate via: **DB** (positions/trades/runtime state), **Redis** (heartbeat/status/PID)
- State persistence: `persist_state()` in `runner_core.py` writes to `BotRuntimeState` + `StrategyRuntimeState` DB tables. No JSON snapshot files.
- API reads bot state via `api/bot_state.py:get_bot_state()` — queries DB + Redis, returns same shape as old snapshot
- Bot's in-memory `SharedPortfolioManager` is the source of truth for open positions — the API reads from DB
- **Close All Positions**: API closes positions directly from DB (no command file). If bot is running, it detects the closed positions next cycle.
- **Scan items**: persisted to `bot_runtime_states.scan_items` DB column. `/api/bots/{bot_id}/scan` reads from DB first, Redis as fallback.
- **Position restore on restart**: `_load_positions_from_db()` in `runner_core.py` — force-closes positions from previous day with `FORCE_CLOSE` reason. `low_price` resets to `entry_price`.
- **Force exit**: `trading/utils.py:FORCE_EXIT=(15,10)` is the global safety-net exit — NOT 15:30 market close (see the Closing Auction Session note in the hardcoded-values audit). `runner_core` gates its main loop on `is_force_exit_time()`, so bots stop scanning at 15:10.
- **Orphan bot stop**: `get_bot_pid()` reads PID from Redis key `bot:{user_id}:{bot_id}:pid` (24h TTL), sends SIGTERM
- **Pipe deadlock fix**: bot stdout goes directly to log file (not PIPE) — prevents buffer fill on uvicorn reload
- **Crash notification**: bot's `run()` wraps main loop in try/except, sends Telegram alert with open positions count + P&L on crash
- **`_TimestampedConsole`**: prepends `[HH:MM:SS]` to all bot log lines

## Market Data Auth
- **Market data endpoints** (`/api/chart/preview`, `/api/paper/chart`, `/api/backtest/run`) use `UpstoxAPI` with `UPSTOX_API_KEY`/`UPSTOX_API_SECRET` — **no OAuth broker token needed**
- **`/api/market/snapshot` is app-auth protected** (route `Depends(get_current_user)`) so an anonymous `force=1` cannot trigger a full TV scan; the UI sends the normal bearer token. It is still **not** broker-OAuth gated.
- **Options + broker endpoints** (`/api/options/*`, `/api/brokers/*`) require OAuth access token via `get_shared_broker_token('upstox')` — user must connect broker in Settings
- **Live price streaming** (`/api/paper/live/stream`) also requires OAuth access token (uses `MarketDataStreamerV3` SDK)
- Never gate market data behind broker OAuth check

## Upstox Token Storage (DB-first)
- **Primary**: `broker_connections` table via `get_shared_broker_token('upstox')` (post-OAuth)  
- **Fallback 1**: `.upstox_token.json` file in project root 
- **Fallback 2**: `UPSTOX_ACCESS_TOKEN` env var
- `upstox_auth.py`'s `UpstoxAuthHandler.load_token()` checks DB → file. `save_token()` still writes to file for backward compat.
- `UPSTOX_CONFIG` dict in root `config.py` only has `api_key`/`api_secret` (removed `access_token`)
- Stale file-only patterns fixed: `sector_data.py` uses `UpstoxAuthHandler`, `upstox_auth_refresh.py` checks DB first

## Upstox Data Debugging
- `scripts/test_upstox_data.py` — quick V3 API health check: tests LTP + intraday for 5 symbols, detects Cloudflare 1015 blocks and token expiry
- Run with: `python scripts/test_upstox_data.py` (no venv needed, uses only `requests`)
- Common errors:
  - **HTTP 429 / Cloudflare 1015** — IP/network blocked by Cloudflare WAF. Wait or use VPN.
  - **HTTP 401** — expired token. Re-authenticate via OAuth login.
  - **HTTP 404** — check instrument key format or market hours
- Token file: `.upstox_token.json` in project root

## Benchmark
- `scripts/benchmark_upstox_data.py` — benchmarks REST LTP V3 vs WebSocket V3 MarketDataStreamerV3
- Usage: `source .venv/bin/activate && python scripts/benchmark_upstox_data.py`
- Token resolution: DB → file → env var (loads dotenv from `.env`)
- Loads 15 liquid NSE_EQ symbols from 56MB instruments JSON
- REST: tests 1-symbol and 15-symbol batch (5 iterations each, reports avg/min/max)
- WS: connects `MarketDataStreamerV3` in `ltpc` mode, collects 15s of ticks, reports first-tick latency + tick cadence

## Market Research Scripts (TV scanner + yfinance)
- `scripts/market/` — **read-only** market research tools. No API keys, no auth, no DB writes, no broker calls.
- **`dukascopy-node` is a devDependency on purpose — do not delete it.** knip reports it as unused because the only consumers reach it from inside Python f-strings (`require('dukascopy-node')` in `scripts/smc_tick_eval.py:42`, `experiments/timeless_reversion.py:447`, `experiments/research/nq_lrl_liquidity/render_sep15_ict_audit.py`), which knip cannot parse. It is dev-only (research tooling, never imported by `src/`), which is why it lives in `devDependencies` and is listed under `ignoreDependencies` in `knip.json`. Removing it breaks the `timeless_reversion` family at default settings.
  - `tv_client.py` — shared client: TradingView scanner wrapper (`scan` / `scanner_frame`), options straddle-implied move (`implied_move`), earnings history (`earnings_table`)
  - `us_earnings.py` — earnings prints: est vs reported, surprise %, day-1/5d/20d reaction, per-name post-earnings drift tally ("does the market pay for beats?"), forward calendar + implied moves
  - `us_scorecard.py` — business quality + earnings quality + **peer-relative** value scorecard for ~110 US large caps. Deliberately no price/technical inputs (no SMA/RSI/gap) — it scores earnings history, margins, growth, FCF, cash, dividend and multiples *relative to each name's own peer bucket*
  - `screens.py` — the three composite screens: `--mode quality` (quality-at-a-discount; `--universe sp500` for the >$15bn proxy), `--mode ai-resilient` (excludes industries where generative AI is a direct substitute), `--mode tradable` (liquid + volatile + sold off)
  - `correlations.py` — 6-month daily-return correlation + beta matrix vs a reference/benchmark, plus a "best diversifiers" list (the check that stops you adding the same factor twice)
  - `ai_infra.py` — neoclouds / GPU miners / networking / power / storage / data-centre REITs panel. Shows FCF yield and debt because these names are usually unprofitable and cash-burning — a low P/S is not value here
  - `session_shape.py` — intraday session shape + after-hours move with the **session-date pinning fix** (the after-hours trap that mis-read IBM/TSLA/META)
  - `qa_value_engine.py` — runs the production `api/value_scan` scoring engine against the live universe (sanity-check the ranking before trusting the UI)
  - `ai_value.py` — value screen over the AI complex (accelerators, memory/HBM, interconnect/optics, power, foundry/semicap, AI software) with an explicit "expensive end" contrast table
  - `india_session.py` — next-session NSE setup: index close, classic pivots + fibs, Nifty 50 breadth, mcap-weighted sector rotation, and watchlists built with the **same filters** as `upstox_trader/screeners/modes/pre_breakout.py` and `upstox_trader/intraday_breakout_scanner.py`
  - `futures_cue.py` — global cue snapshot: NQ/MES/ES/YM/RTY, crude, GIFT Nifty, cash indices, VIX, and the QQQ/NDX weight×change contribution table
- Run with the project venv: `.venv/bin/python scripts/market/<script>.py` (needs `tradingview_screener`, `yfinance`, `requests`, `pandas` — all already in `requirements.txt`)
- Useful flags: `us_scorecard.py --peer-bucket "Semicap equipment" --top 20` · `us_earnings.py --days 4 --implied` · `ai_value.py --bucket "AI memory/HBM"` · `india_session.py --watchlists-only`
- Data sources: TradingView public scanner `https://scanner.tradingview.com/{market}/scan` (markets: `america`, `india`, `futures`) + Yahoo Finance option chains.
  - Symbol conventions: `NSE:NIFTY`, `NSE:BANKNIFTY`, `NSE:INDIAVIX` · GIFT Nifty = `SGX:NI1!` (in the `futures` market) · US index futures = `CME_MINI:NQ1!`, `CME_MINI:MES1!`, `CBOT_MINI:ES1!` · crude = `NYMEX:CL1!`
- **Gotchas (learned the hard way — read before trusting output):**
  - The `futures` scanner market rejects `CME_MINI` as a market name — use market `futures` with `CME_MINI:*` tickers.
  - TV returns `null` for unsupported columns → they arrive as NaN, not 0. Never treat NaN as a value.
  - yfinance after-hours rows: filtering `h.index.hour >= 16` without also pinning the **session date** silently mixes in the *previous* day's post-close bars. Always group by session date first.
  - `yfinance.get_earnings_dates()` leaves `Reported EPS` as NaN for ~15 minutes after a print — treat a NaN surprise as "not yet ingested", not "missed".
  - `get_earnings_dates()` returns a `DatetimeIndex`; call `.reset_index()` before column access or the field name changes to `index`.
- These scripts are for analysis only — never wire them into the API, bots, or the UI without a separate review.

## Deep Value tab (seriously undervalued stocks — India / USA / Global)
- **Where**: a new tab inside the Screener page (`?tab=deepvalue`), next to Dashboard / Screener / Correlation / Config. Wired in `src/components/screener/ScreenerPage.tsx`; the panel lives in `src/components/value/`.
- **Why a tab and not a rail entry**: the existing screener pipeline (`api/screener_api/screener_scan.py` → `trending_upside.fetch_trending_stocks`) is **NSE/Upstox-centric** (live Upstox prices, 52w touch logic, NSE symbols). US/global names have no Upstox quote path, so Deep Value owns its own data path end-to-end.
- **Backend**: `api/value_scan/` — `tv_source.py` (scanner I/O), `scoring.py` (pure scoring), `filters.py` (pure filters/presets), `cache.py` (redis), `router.py` (`GET /api/value/scan`). Router is registered in `api_server_fastapi.py` in the standard try/except block.
- **Data source**: TradingView public scanner, **markets**: `india` → `…/india/scan`, `usa` → `…/america/scan`, `global` → `…/global/scan` with an explicit country list.
- **Scoring**: 0-100 = 4 sub-scores (value / quality / growth / health, 25 each), each **peer-relative to the row's own sector bucket** (median computed on the **full pre-gate frame** — computing medians after the gates makes the ranking self-referential). Sub-scores and peer medians travel in the row payload so the UI can explain a row without recomputing.
- **Hard quality gates** (a name that fails is excluded, not just penalised): P/E band, EPS growth, ROE, positive FCF, D/E, market cap, volume, and price vs SMA200 (default ON = "cheap *and* basing"). Presets: `SERIOUS` / `DEEP` / `GARP_VALUE` / `YIELD` / `TURNAROUND` / `NO_GATE` — ids, labels, descriptions and gates live once in `api/value_scan/presets.json`; `api/value_scan/filters.py` loads its gates from there and `src/api/valuePresets.generated.ts` is generated from the same file by `scripts/gen_value_presets.py`. No preset is applied by default (UI selector starts empty, API `preset` param defaults to `None`).
- **Field coverage (measured — `scripts/market/field_coverage.py`)**: `india` and `america` expose 53 usable columns. **Not available anywhere: `total_cash`, `total_cash_flow_ttm`, `enterprise_value`, `price_ebitda_ttm`, `price_enterprise_value_ebitda_ttm`, `price_target`, `analyst_rating`, `total_analyst_opinions`, `basic_average_shares`.** So: no net-cash filter (use `debt_to_equity_fq` + `current_ratio` + FCF), no EV multiples, no analyst target column in v1.
- **`global` gotchas** (measured): `global` is **not** a stocks market — it returns 0 rows for stocks and only works for futures. Global stocks need an explicit country list (16 markets → ~88k names). The same company is listed on many exchanges (NVDA appeared 8+ times with different currencies and P/Es) and ~20% of rows are `type: "dr"` → **de-duplicate by root symbol, keep `type == "stock"`, keep the listing with the most non-null fundamentals**. Market cap on a foreign listing is already in the primary currency (USD) → no FX maths. Global fundamentals coverage is ~85-90% → the response carries `fields_complete` for a "partial fundamentals" badge.
- **Performance invariants (unit-tested)**: exactly **1 HTTP request per market per cache window** — user filters are applied in Python, never pushed to the network. The redis cache stores the **scored frame per market** (NOT the filtered result; key must not include filters) with TTL 900 s (india) / 3600 s (usa/global), a `_try_acquire_lock` stampede guard and stale-while-revalidate.
- **Table rule**: the panel MUST use the shared `src/components/common/TanStackTable.tsx` with explicit `meta: { align }` per column (text left, numbers right, score/flags centre) — see `TABLE_CHECKLIST.md`. No bespoke table component.
- **Charts/links**: `/chart/:symbol` is Upstox/NSE-backed, so chart links are only rendered for NSE/BSE rows; other markets show the TV symbol instead of a broken link.
- **Tests**: `tests/api/test_value_scan/` (pure scoring/filters + mocked scanner + router), `src/components/value/*.test.tsx`, `src/api/valueScan.test.ts`, `src/hooks/useValueScan.test.ts`, `tests/e2e/deep-value.spec.ts` (mocked via `setupValueScanMocks`). Guards: `npx vitest run src/test/ui-guard.test.ts` + `npx vitest run src/ui/inputs/inputs.w-h.test.tsx`.

## Event Radar (scheduled corporate catalysts + intraday tripwire)

- **Where**: tab in the Screener page (`?tab=events`, `src/components/events/`); backend `api/event_radar/`; full write-up in [docs/event-radar.md](./docs/event-radar.md).
- **Why**: Oracle announced its Investor Day on 2026-10-23 and the stock still ran ~+12% intraday on 2026-10-28. The gap was memory, not analysis — nothing carried "ORCL has a dated catalyst".
- **4 layers**: (1) recurring-event memory (`recurring` flag + `seed` precedence) · (2) SEC EDGAR full-text, **scheduled events only** · (3) Yahoo per-symbol RSS wires/IR · (4) intraday 1-min tripwire. TradingView has no investor-day type; yfinance `Ticker.calendar` only has earnings/dividends.
- **EDGAR policy**: queries restricted to investor/analyst/CMD/strategy/R&D day (`guidance`, `business_update`, annual-meeting queries were dropped as noise); 8-K `items` filtered to 7.01/8.01; filing text fetched for the real date+headline (document date → confidence 0.8, filed-date fallback → 0.4 + verify note, `MAX_ENRICH_PER_RUN=40`); titles pass `strip_filing_boilerplate` (peels `Item 7.01…`, `Section 7—…`, `EX-99.1`, `*.htm`) and never return a bare exhibit label. Result: 153 → **20** rows per 7-day window.
- **Dedupe**: `SOURCE_PRECEDENCE` `seed 5 > edgar 4 > ir 3 > wire 2 > tv 1`, keyed on `(symbol, event_date, event_type)`.
- **Tripwire thresholds** (`contract.py`, echoed to the UI tooltip): `4σ` robust MAD, `8×` same-minute volume, `1.0%` floor, `30 min` per-symbol cooldown, **5** baseline sessions (Yahoo caps 1-min history at 8 days). Regression test proves it fires on ORCL at 14:19–14:25 ET.
- **Poller** (`poller.py`, started in the lifespan): calendar every 1800 s + immediate on start; tripwire every 60 s inside US cash hours only (`13:30–20:00 UTC`, deliberate DST approximation); daily Telegram digest on the first tick at/after **07:30 ET**, immediate Telegram only on tripwire fires.
- **Env**: `EVENT_RADAR_TRIPWIRE_SYMBOLS` (**empty = tripwire disabled**, opt-in), `EVENT_RADAR_MARKET` (`us` default), `EVENT_RADAR_CONTACT` (SEC UA).
- **Endpoints**: `GET /api/events/calendar|today|anomalies`, `POST /api/events/refresh`. Upstream failures return structured 502/503 (`event_source_unavailable`), never an unhandled 500.
- **DB**: `corporate_events` + `event_anomalies`, migration `ev1a2b3c4d5e` (down `tf2a2b3c4d5e`); `db/database.py` runs `alembic upgrade head` at startup.
- **Frontend invariants (both cost time)**: use `useSyncExternalStore` for `eventsStore` — the `subscribe` + `forceUpdate` pattern silently stopped re-rendering the lazy panel inside `Suspense`; and keep **calendar and anomaly errors in separate slots** — a shared field let a healthy anomaly response erase a calendar 500.
- **Tests**: `tests/api/test_event_radar/` (319 pass), `src/api|state|hooks/events*.test.*`, `src/components/events/*.test.tsx`, `tests/e2e/events.spec.ts` (7 pass, mocked via `setupEventsMocks`) — the deliberate-500 test is the only one allowed to waive Chromium's "Failed to load resource" console noise. Guards: `npx vitest run src/test/ui-guard.test.ts` + `src/ui/inputs/inputs.w-h.test.tsx`.

### Learnings (2026-10 market-research work — every one of these cost time)

- **`america` includes OTC/foreign listings** (`IPOAF`, `SGIOF`, `CILJF`…). Every US screen must filter `exchange in {NASDAQ, NYSE, AMEX}`.
- **`global` is not a stocks market.** Use an explicit country list. De-duplicate by **`description`** (the company), not by ticker — Ageas SA/NV trades under 4 different tickers across Amsterdam/Paris/Milan/Brussels. There is also a **`country`** column: use it to drop US-domiciled names from GLOBAL (they belong to the USA tab).
- **`free_cash_flow_ttm` coverage is market-dependent and brutal: ~3.5% of Indian names (69/1974) vs ~85-90% in the US.** A hard FCF gate therefore empties India. The engine treats a metric as **UNAVAILABLE for the whole bucket when coverage < 25%** (`MIN_METRIC_COVERAGE`), redistributes its points, and skips its gates. This was the single biggest bug: India returned 2 names until coverage-awareness was added.
- **Absolute thresholds do not travel between markets.** `P/E ≤ 12 + P/S ≤ 1.5` passed **3 of 677** US names and **2 of 1974** Indian ones. Presets are now **percentile gates** (cheapest 35% of the name's own sector bucket), and percentiles are computed on the **pre-gate frame** — computing peer medians after the gates makes the ranking self-referential.
- **Cache the scored frame per market, never per filter combination** — otherwise the hit rate collapses. User filters are applied in Python after the fetch; exactly **1 HTTP request per market per cache window**.
- **pandas gotcha:** `Series.name` is the index name, not a column called `"name"`. `row.name` returns an int/None — always use `row["name"]` (this crashed a screen once).
- **yfinance `prepost=True` trap:** pin the **session date** before splitting regular vs after-hours, or you silently mix in the *previous* day's post-close bars. And the **first hour of after-hours is a liquidity vacuum**: on 2026-10-21 IBM printed **+7.9%** then finished AH **−4.6%**, TSLA went **+2.2% → −3.3%**, META **+7.2% → +2.0%**. Never judge a print from a 16:15 snapshot.
- **TV's futures feed is delayed 10 minutes** (`update_mode = delayed_streaming_600`). Never quote it as live.
- **Futures-vs-cash basis is a *stress* gauge, not a forecast:** a normal Dec basis is **+0.3% to +0.5%**. On 2026-10-21 NQ sat at +0.36% (no crash priced) and the index still fell **3.2%** the next day on an Iran/oil headline. Basis prices **known** risk, never headlines.
- **Earnings-day tails are fat:** APP printed **−19.7%** on two separate earnings days in 2026. A −6% stop cannot protect through an earnings gap — **size for the tail (a −20% day), never for the stop.**
- **Screen artifacts to exclude by hand:** preferred-share lines (`ALL/PH`, `ALL/PI` show P/E 0.3), one-off EPS gains (`LYFT` P/E 2.4; `AU` EPS +9,057%), and buyback-inflated ROE (`HRB` 707%).
- **NSE APIs are blocked in this environment (403/404)** — take the Nifty 50 constituent list from Wikipedia instead of `get_nifty_stocks_from_nseindia()`. India also has **BSE duplicate rows with different tickers** (`M_M`, `J_KBANK`) → keep NSE only.
- **Do not inspect `app.routes` to check router registration in this FastAPI version.** Included routers are stored as `_IncludedRouter` wrappers (no `.path`), so a naive `[p.path for p in app.routes if "value" in p.path]` returns `[]` even when the route works. Verify with `TestClient(app).get(...)` — never by path introspection.

## API Docs (Swagger / OpenAPI)
- **Live docs**: FastAPI serves them by default on the API process — `http://localhost:8765/docs` (Swagger UI), `/redoc` (ReDoc), `/openapi.json` (raw schema). They are public in production (no auth to view; auth is still required to call protected routes). `api_server_fastapi.py` prints the `/docs` URL on startup.
- **Auth in the UI**: the schema declares one HTTP bearer scheme, `bearerAuth` (`api/auth.py`). Use **Authorize** with the `access_token` from `POST /api/auth/login`; Swagger adds `Authorization: Bearer <token>` to try-it-out requests. 122+ of ~281 operations are protected.
- **Schema metadata** lives in `api_server_fastapi.py`: `OPENAPI_TAGS` (ordered tag groups + descriptions) and `_API_DESCRIPTION` (markdown quickstart). `version` comes from `APP_VERSION` (default `0.1.0`).
- **Checked-in spec**: `openapi.yaml` at the repo root is generated, not hand-written — **never edit it by hand**. Regenerate after any route/schema change:
  ```bash
  .venv/bin/python scripts/export_openapi.py          # write openapi.yaml
  .venv/bin/python scripts/export_openapi.py --check  # exit 1 when stale
  ```
- **Drift guard**: `tests/contract/test_openapi_sync.py` fails when `openapi.yaml` differs from `app.openapi()`, when any operation is missing a tag, when `bearerAuth` disappears, or when the path count drops below the floor. Run:
  ```bash
  .venv/bin/python -m pytest tests/contract/test_openapi_sync.py -q
  ```
- **Adding an endpoint**: always pass `tags=[...]` (pick an existing tag from `OPENAPI_TAGS`, or add a new tag entry there with a description), add `summary=`, and set `response_model=` where practical. Then run the export script and the drift test in the same commit.
- **Not in the schema**: WebSocket routes (`/ws/orderflow`, `/ws/nifty/*`) never appear in OpenAPI; document them in the router docstring instead.
- **Agent rule — API discovery starts at the schema, not the source**: to learn endpoints, params or response shapes, read `openapi.yaml` (or `GET /openapi.json`) first and filter to the tag. Do **not** read `api/**/*.py` end-to-end just to discover a route — that is the failure this section exists to prevent. Only open a router file when the schema is demonstrably incomplete (then add `summary`/`description`/`response_model` and re-export), or when debugging handler behaviour after the call shape is already known.
- **Agent rule — never hand-type a token**: protected routes (`security: [{'bearerAuth': []}]`, padlock in Swagger) return `401` without `Authorization: Bearer`. Mint a real one with the QA account instead of copying a token literal from a prompt or previous run (that token will be rejected as invalid):
  ```bash
  TOKEN=$(curl -s -X POST http://localhost:8765/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"qa@test.com","password":"qa123"}' \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))")
  ```
  Public reads that need no token: `/api/chart-patterns/symbol/{symbol}`, `/api/chart-patterns/results`, `/api/chart-patterns/timeframes`, `/api/chart-patterns/patterns`, `/api/chart-patterns/market-status`, `/api/market-ticker`, `/health`. Auth-gated: `/api/chart-patterns/detect`, `/api/chart-patterns/scan`, `/api/paper/*`, `/api/bots*`, `/api/screeners*`.

## Index Report — generic underlyings (SENSEX / RELIANCE)

- **Routing**: NIFTY uses `/api/reports/nifty/*` (recorder, tape, replay, bursts). SENSEX/RELIANCE use the generic namespace `/api/reports/options/{symbol}/live|tape|chain10s|replay|snapshot|bursts`; never call the NIFTY recorder for another symbol.
- **Candles**: the generic `live` payload (and `?candles=1`) can return `intraday: []`/`candles: []`, and a cold fetch may return the previous session. `src/pages/report/niftyChartData.ts` owns the fallback:
  - `sessionDateOf(report)` = `report.date || report.market.session_date`
  - `candlesFromTape(rows, sessionDate)` builds 1-min OHLC from consecutive tape spots (`open = prev spot`, `close = current`), skipping invalid spots
  - `candlesFromSpotPoints(points, sessionDate)` builds **true 1-min OHLC from the 10-second chain snapshots** (6 points/minute during session): `open` = first spot, `close` = last spot, `high`/`low` = extremes — so **wicks exist**. This is the **preferred** source when the 10s chain is available; the tape fallback (`candlesFromTape`) produces no wicks.
  - `selectBaseCandles(...)` = intraday > EOD candles > tape/spotPoints, each session-filtered; `clipToAsOf` applies the replay playhead
  - This prevents the two-day chart (previous session + today's tape → overnight jump).
- **Flow windows**: NIFTY gets `flow_window` server-side; generic underlyings don't. `src/pages/report/niftyFlowRead.ts` `flowWindowFromTape(rows)` derives the 5m/15m CE−PE OI windows from `tape.rows` (`ce_oi`/`pe_oi` must survive `normalizeTapeRow`). `NiftyReportPanel` uses `report.flow_window ?? flowWindowFromTape(tapeRows)` for the strip, `FLOW FLIP` badge, chart dot and heatmap line.
- **Generic live poll**: NIFTY uses a WebSocket (`useNiftyReportStream`) for live updates. **Generic underlyings (SENSEX/RELIANCE) have no WebSocket** — they poll the generic `/options/{symbol}/live` + tape + bursts endpoints every **~15 s** in live mode (see `NiftyReportPanel.tsx` lines 1487–1550). Each poll uses an `AbortController` with a 15 s timeout.
- **Units**: `control.flow_bias` is ₹ crore for NIFTY only; generic underlyings use a different premium unit, so `NiftyFlowWindows showSessionValue={symbol === "NIFTY"}` hides the amount and keeps the verdict.
- **Walls**: the decision strip's `MAX-OI CALL/PUT` and the chart's `CW/PW` lines use the **walls payload** (`fetchOptionsWalls`) — the same source as the walls card. `report.walls` is only a fallback. The chart adds dotted `NEAR CW/PW` for `wallsNear` when it differs.
- **0-DTE**: SENSEX expiry can be today; its tape starts when the recorder starts, so heatmap/flow history may be only a few minutes at the open. Show what exists; never fabricate earlier minutes.
- **Tests**: `niftyChartData.test.ts`, `niftyFlowRead.test.ts`/`NiftyFlowWindows.test.tsx`, `NiftyChartPanel.test.tsx`, `niftyOiHeatmap.test.ts(x)`, `NiftyReportPanel.test.tsx`.

## niftyChartData.ts — pure chart data helpers

- `sessionDateOf(report)` — extracts the session date from `report.date` or `report.market.session_date`
- `isOnSession(time, sessionDate)` — guards candle inclusion to the correct session
- `candlesFromTape(rows, sessionDate)` — last-resort spot path: folds consecutive 1-min tape spots into bars where `high`/`low` never exceed the body (no wicks). Kept only when 10s chain is absent.
- `candlesFromSpotPoints(points, sessionDate)` — **builds true 1-min OHLC from 10s chain** (6 points/min). `open` = first spot, `close` = last, `high`/`low` = extremes (wicks). Filters to `sessionDate`, drops non-finite/non-positive spots, sorts by `t`, groups by minute key (`t.slice(0,16)`). **Preferred over tape fallback** whenever chain feed is available.
- `selectBaseCandles(report, tapeCandles, sessionDate)` — priority: intraday > EOD candles > tape/spotPoints (each session-filtered). A source whose rows all fall outside the session is skipped entirely.
- `clipToAsOf(candles, asOf)` — stops the series at the replay playhead (ISO string comparison).

## niftyFlowRead.ts — two-layer flow read

- **Layer 1 (1-minute read)**: `OiPoint`, `FlowRead`, `readFlow`, `rollingRead`, `premiumResidual` — reads the dominant side of the 1-minute OI move, using premium change as tiebreaker (OI direction alone is ambiguous).
- **Layer 2 (Rolling 5m/15m OI windows + flip lifecycle)**: `flowWindowFromTape`, `classifyFlowLeg`, `detectFlowFlip`, `detectFlipChange`, `loadStoredFlip`, `saveStoredFlip`, `sessionTone` — derives 5m/15m CE/PE OI windows from a generic underlying's tape (NIFTY gets `flow_window` server-side; generic underlyings compute it here). The flip watcher seeds on first sight and only reports a real sign change / newly-disagreeing 5m leg afterwards. Persisted per symbol/mode/date with 30-min TTL.

## Chart Cache
- `api/paper/chart_cache.py` — pickle-based disk cache at `experiments/data/chart_cache/{date}/{symbol}.pkl`
- Returns `(df, is_cached)` tuple — chart response includes `"cached": true/false`
- Cache is checked **before** any fetch (intraday or historical)
- **Today's data**: 60-second TTL via `.meta` file — prevents stale pre-market data poisoning
- **Historical dates**: no TTL — data never changes
- Today's intraday fetch that returns empty (pre-market) does NOT fall through to historical — returns empty to avoid caching wrong day's data
- Pre-market cache poisoning fix: when `date == today` and `fetch_intraday_data_v3` returns None/empty, early return (no fallback to historical)

## Chart-patterns caching
- **Candle cache** (`chart_patterns/candles.py`): disk at `experiments/data/pattern_cache/candles/{tf}/{SYMBOL}.pkl` (+ `.meta`). Cleared via `clear_cache(symbols?, timeframe?)`.
  - **Session-aware**: today's data has a 60s TTL while the market is open (`TODAY_TTL_SECONDS`, `trading.utils.is_market_open()`). When closed, the entry is pinned to `meta["session"]` = `_last_completed_session()` (last NSE session past 15:30 IST, walking back over weekends/holidays) — weekends/holidays never churn the cache. Historical/`as_of_date` files never expire. Lookback variants (`SYMBOL.lb250.pkl`) are namespaced so they never poison the default cache.
- **Scan freshness** (`chart_patterns/scan.py`): a non-forced scan for a universe/timeframe whose last completed job is still fresh is a no-op (`_is_fresh`, `SCAN_FRESH_SECONDS`, default 300s, env `PATTERN_SCAN_FRESH_SEC`) — fresh = younger than TTL while open, same completed session while closed. `force: true` always recomputes. Frontend store additionally auto-refreshes combos whose `last_scan_at` is older than `STALE_SCAN_MINUTES` (30) (`src/state/chartPatterns.ts`).
- **Force refresh**: `POST /api/chart-patterns/scan` with `refresh: true` clears the candle cache for the scope + timeframe and forces the scan. UI: "Force refresh" button in the patterns results toolbar → store `forceRefresh()` → `triggerScan(true, { refresh: true })` → `startScan` (`src/api/chartPatterns.ts` `ScanRequest.refresh`).

## 52W Range Screener Background Job
- The 52W range batch job (`compute_52w_ranges_task`) and screener prewarm task are started from the FastAPI lifespan.
- Both are gated to market hours via `_is_market_hours()` (delegates to the canonical `trading.utils.is_market_open()` for precise 9:15-15:30 IST trading days + holidays; always use `config.IST`; has a simple hour fallback).
- **Key `start.sh` behavior**: The range batch now performs a *prompt initial run* shortly after startup (during market hours) instead of sleeping the full interval first. This ensures that running `start.sh` when ranges are stale triggers an observable batch quickly (previous behavior waited up to 1 hour). After the initial run, it follows the normal `SCREENER_52W_INTERVAL_SEC` (default 3600, overrideable).
- Scheduled runs use daily staleness refresh (`--skip-updated-today`): symbols whose `updated_at` is already today are skipped. The first run each day refreshes the full NSE_EQ universe (~5-15 min at 3 workers × 0.35s delay). Subsequent hourly runs find everything fresh and no-op in ~1s. Mid-day restarts only refresh symbols not yet updated today.
- The admin 52W panel shows the last job result from Redis (status usually stays "completed"). The live progress bar is only shown while the job status is actively "running" — because normal runs are so fast, it is rarely visible on the panel's 5s poll. Use "Clear cache + DB" followed by a manual "Run batch" (or full refresh) if you need to observe the progress UI.
- "Latest DB update" (max row `updated_at`) only moves forward when the script actually inserts or changes range data for a symbol (not on every job execution).
- Prewarm keeps the 52w_high screener (and others) responsive during market hours.
- Logs for the jobs appear in `logs/alphashri.log`.

## Trade Entry Reason Pipeline
- Signal generators set `signal.notes` with detailed calculations (ORB: range%, SL%, ATR, ADX, RSI; SR Breakout: pivot type, buffer%; EMA Cross: gap, SL%; 52W Chaser: ADX, RSI; 52W Target: SL%, trail%)
- `runner_signals.py:453` stores `signal.notes` in `position.metadata['entry_reason']`
- On trade close, `position.metadata['entry_reason']` → `CompletedTrade.reason` → `_persist_trade_to_db` → `Trade.reason` column
- Exit notes include PnL% and price level: "Stop loss hit ₹1340.00 (PnL: -0.40%)"
- `CompletedTrade` has `reason`, `peak_price`, `low_price`, `sl_price`, `tp_price` fields — propagated from `SharedPosition` in `portfolio_core.py:close_position()`
- `signal.notes` can be `None` — always use `signal.notes or ''` when assigning to scan items

## Paper Trading UI Defaults
- **Trade history**: defaults to "Today" filter (`filterFromDate`/`filterToDate` = today) instead of all-time
- **Field naming**: `PaperPosition` and `PaperTrade` both use `stop_loss`/`take_profit` — never `sl_price`/`tp_price`
- **Close All button**: in positions header, calls `POST /api/bots/{bot_id}/close-all` with current prices, shows loading state + error alert
- **Expandable trade rows**: click to expand with TradeStats (SL, TP, Peak, Low, Costs, Gross/Net P&L) and TradeNotesEditor (editable Reason + Notes with Save)
- **PATCH endpoint**: `PATCH /api/paper/trades/{trade_id}` — update notes/reason, max 500 chars

## Deployment & Production

**Railway is not in use.** Do not reference, propose, or plan around Railway, `railway` CLI, Railway URLs, or Railway deploy checks. The project is currently run personally/locally. The Railway sections in [PRODUCTION.md](./PRODUCTION.md) are historical notes only and must not be treated as the current architecture.

GitHub Actions may be used for scheduled batch compute, but it cannot write to a local SQLite file. Any Actions-based refresh needs an explicitly agreed durable target (a remote Postgres/Redis/object store, a checked-in handoff, or a self-hosted runner on the personal machine) — never an assumed hosted backend.

## Agri data (mandi prices)
- Read **[`docs/AGRI_DATA_USAGE.md`](./docs/AGRI_DATA_USAGE.md)** before touching agri data, `/agri`, or `/api/agri/*`. Be honest about sources, ₹/quintal + qtl units and partial days: a commodity missing from a partial day keeps its own latest date — never advance every key, never invent a price, MSP or OHLC.
- **NEVER write to or delete `reports/agri/agri_prices.db`** by hand — it is a read-only local cache; only the importer/collector and `scripts/sync_refresh_assets.py` own writes.

## Testing
- Frontend: vitest, files co-located as `*.test.ts` / `*.test.tsx`
- Backend: pytest, files in `stock-screener-ui/tests/`
- Run both before committing
- **Read `TEST_RULES.md`** before writing or modifying any test — covers assertion conventions, mock patterns, accordion interaction, data-testid naming, and coverage requirements
- **E2E tests**: Never run the full E2E suite (`npx playwright test` without file filter) — it takes >10min. Only run spec files that failed in CI. Use `--workers=4` (runner has 4 vCPU) and `--output=/tmp/...` to avoid clobbering. Verify locally before pushing.

### CI E2E architecture (learnings — 2026-09)
- **20 shards max.** GitHub Free allows **20 concurrent jobs**; the repo is public so `ubuntu-latest` = 4 vCPU/16 GB. More shards than 20 just queue. `workers: 4`.
- 16 shards use a measured file-duration planner (`scripts/ci/plan_e2e_shard.py` + `perf/e2e-file-durations.json`), so shard test time is balanced; the 20-job GitHub cap still applies.
- **No `waitForTimeout`.** Use web-first assertions (`expect(...).toBeVisible()`), `expect.poll(...)`, `page.waitForResponse/Function`. Fixed sleeps are the #1 source of slowness and flakes.
- **No pixel screenshot tests.** `toHaveScreenshot` was removed (env-sensitive, redundant with DOM assertions). Storybook **does** exist (see "Storybook / design-system catalog" above) — use it for primitive-level visual review; wire a visual-diff tool only if automated diffing is actually needed. PR screenshots still come from the real app at **1600 and 390** (rule 5 of the PR cycle), not from Storybook alone.
- **No `globalSetup`.** `playwright.setup.ts` was deleted — it launched a browser to write a `storageState` file nothing read. Auth is seeded per-page via `loginAsTestUser` (`addInitScript`).
- **Backend in CI**: set `CI_MODE=1` so `api_server_fastapi` skips news/Redis/background tasks and creates the SQLite schema from models (`SKIP_ALEMBIC=1` leaves it empty otherwise).
- **Readiness probe**: `/health` also supports `HEAD`; wait with `wait-on http-get://127.0.0.1:8765/api/health` (plain `http://` uses HEAD).
- **`setup-uv` cache requires a lockfile**: the repo has no `uv.lock`, so `enable-cache: true` **fails** unless you set `cache-dependency-glob: "**/requirements.txt"`.
- **Unit jobs don't gate E2E**: E2E runs in parallel (no `needs`). PR-to-`develop` gates only changed frontend test files (no transitive closure); the full suite runs on push / PR-to-`main`. Full builds run 4 Vitest `--shard=N/4` jobs; PR-to-develop keeps the single changed-test-file job.
- **Dedupe push vs PR**: workflow `concurrency.group = ${{ github.workflow }}-${{ github.head_ref || github.ref_name }}` cancels the duplicate run for the same branch.

### Running Targeted Tests (Fast)
Use glob patterns to run only the changed feature's tests during development:
```bash
bun test -- --run src/components/screener/Correlation  # component tests only
bun test -- --run src/state/correlation.test.ts         # state tests only
bun test -- --run src/components/screener/CorrelationMatrix.test.tsx  # single file
source .venv/bin/activate && python -m pytest tests/test_correlation.py -v  # backend
```
**Do NOT run the full suite locally** (~8,987 backend in the full exclusion sweep / ~6,500 frontend
cases, 8 cores, >15 min backend). It starves the API/tape writer during market hours and the
feedback is too slow to be useful — which is how tests stop being run at all. Local = the touched
files only (or `npx vitest run --changed`). The full pass belongs to CI (Python 6 shards × 4
workers; E2E 16 shards × 4 workers). Run it locally only for a `develop → main` release check.

**Scope the test run to the change, not to the suite.** "Verify" does not mean "run everything":

| Change | Run this |
|---|---|
| One source file edited | `npx vitest run <that file's test>` + `npx tsc --noEmit \| grep -c "error TS"` (must not rise) + `npx oxlint <dir>` |
| Config / docs / JSON only (`knip.json`, `AGENTS.md`, a `.md`) | **No test run.** Validate the file parses and, if it drives tooling, run that tool once (`npx knip`, `--frozen-lockfile` check). Nothing under `src/` changed, so a suite run proves nothing. |
| A file deleted | Run the specs that imported it (grep for the path first), not the suite. The deleted spec's own cases are the only legitimate drop in the total. |
| Dependency removed from `package.json` | `bun install --frozen-lockfile` (must pass) + `bun run build` + one import smoke of the affected module. Do **not** run the suite. |
| A shared module (`src/ui/`, `src/state/`, a store) | Its own directory's suite only — `npx vitest run src/ui/` etc. |
| Test infrastructure (`test-utils/`, `vitest.config.ts`, `setupFiles`) | `npx vitest run src/test/` — this one is a genuine exception, since everything depends on it |

Corollary for subagents: state the **narrow** command in the brief and require the exact count
back — never "run the suite to be safe". A 10k-case run while other agents are writing is also
worthless as evidence, because a difference may come from their edits (this happened: three
full-suite runs reported three different totals, none attributable).

**Note**: Use `npx vitest run <file>` for tests using `vi.mock` — `bun test` does not support `vi.mock`.
```bash
npx vitest run src/components/common/SymbolAutocomplete.test.tsx  # use vitest for vi.mock tests
```

### Backend Test Gotchas
- **`@patch` decorator ordering**: When using `@patch` as a decorator on test methods, mock arguments are injected **before** pytest fixtures. Order is bottom-to-top for decorators, left-to-right for args:
  ```python
  @patch('module.b')  # mock_b — second arg
  @patch('module.a')  # mock_a — first arg
  def test_foo(self, mock_a, mock_b, client, db):  # mocks first, then fixtures
      ...
  ```
  Getting this wrong causes `fixture 'mock_X' not found` errors.

## Ephemeral filesystems and task artifacts

Container/sandbox rebuilds erase `/tmp`. In Codespaces (or any environment whose workspace lives under `/workspaces/`), **never** put worktrees, virtualenvs, fixtures, screenshots, benchmark output or reusable scripts in `/tmp`:

- Worktrees: `/workspaces/react/.agent-worktrees/<task>/`.
- Everything else (venvs, fixtures, captures, logs, benchmark JSON): `/workspaces/react/.agent-artifacts/<task>/`.
- Both sit outside the repo, so they never dirty `Alphashri/`.
- `/tmp/opencode` is allowed only outside Codespaces, or for single-use files regenerated by a committed script in one command.
- Anything that must survive belongs in the repo (committed code/docs/evidence) or under `.agent-worktrees` / `.agent-artifacts`. Clean up only the task's own artifact dir after the PR is merged and evidence is committed.
- Perf scripts default to the workspace artifact dir when `CODESPACES=true` (`/workspaces/react/.agent-artifacts/chart-perf`), fall back to `/tmp/opencode/chart-perf`, and honour `CHART_PERF_ARTIFACT_DIR`.

### Codespaces git authentication

In Codespaces, do not trust the default `origin` credential or VS Code `askpass.sh` — it can resolve to another account or hang on an invisible username prompt. Before any push, verify with `env -u GITHUB_TOKEN -u GH_TOKEN gh auth status`, and run `gh pr create/view/checks/merge` the same way so the CLI uses that account. Push feature branches with prompts disabled and explicit token auth; never print, commit or log the token:

```bash
TOKEN=$(env -u GITHUB_TOKEN -u GH_TOKEN gh auth token)
GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false git push "https://x-access-token:${TOKEN}@github.com/<owner>/<repo>.git" HEAD:refs/heads/<feature-branch>
```

If a push shows no progress for >30s and an `askpass.sh` child exists, kill it; do not wait.

## Performance budgets and checks

- **Last checked: 2026-11-25**
- **Next check: 2026-12-02**
- Short index + measurement methodology: [docs/PERFORMANCE.md](./docs/PERFORMANCE.md). Machine-readable budgets: [`perf/budgets.json`](./perf/budgets.json) (test/wall budgets), [`perf/api_budgets.json`](./perf/api_budgets.json) (API latency budgets) and [`perf/chart_ui_budgets.json`](./perf/chart_ui_budgets.json) (interactive chart/UI, initial targets). Detail docs: [docs/TESTING_SPEED.md](./docs/TESTING_SPEED.md), [docs/API_LATENCY.md](./docs/API_LATENCY.md), [docs/CHART_PERFORMANCE.md](./docs/CHART_PERFORMANCE.md), [`scripts/test/run_changed.py`](./scripts/test/run_changed.py).

  **Denominators (do not mix):** **~9,237** node ids collected with no marker filter → **8,987** after the full exclusion marker (`-m "not (slow or … or postgres)"`, push/nightly sweep) → **662** in the PR fast tier (`-m "unit and not slow"`). The 662-test tier is the PR gate; the 8,987 sweep is a push/nightly debt alarm.

| Surface | Budget |
|---|---|
| Backend PR fast tier (662 tests, `-m "unit and not slow"`, 6 shards × `-n 4`) | **< 5 min** wall per shard |
| Backend full exclusion sweep (8,987 tests, push / nightly) | **< 20 min** wall per shard |
| Backend per-test fixture setup | **p95 < 50 ms** |
| Backend test collection (`pytest --collect-only -q`) | **< 30 s** |
| Frontend changed-only (`vitest run --changed`) | **< 2 min** |
| Frontend full suite | **≤ 10 min on a 16 GB runner; ≤ 25 min on an 8 GB host with `--maxWorkers=1`** |
| API warm reads | per-endpoint **warm p95** budgets in [`perf/api_budgets.json`](./perf/api_budgets.json) (e.g. health 100 ms, login 500 ms, agri filters 500 ms), measured in [docs/API_LATENCY.md](./docs/API_LATENCY.md) |
| API cold agri filter path | **API_COLD** exception = the `cold` budget for `agri_filters` in [`perf/api_budgets.json`](./perf/api_budgets.json): **10,000 ms**. Other routes have `cold: null` (INFO, not enforced). See the known current breach in [docs/API_LATENCY.md](./docs/API_LATENCY.md) |

### Interactive UI & chart performance (mandatory for chart work)

Any change to chart/canvas rendering, indicators, overlays, S/R zones, timeframe handling, pattern-chart data mapping, or data-dense UI must follow [`docs/CHART_PERFORMANCE.md`](./docs/CHART_PERFORMANCE.md) and the machine-readable initial targets in [`perf/chart_ui_budgets.json`](./perf/chart_ui_budgets.json). Before a chart PR is called done, run `bun run perf:chart:fixtures` (refresh real POWERGRID.NS fixtures), `bun run perf:chart:matrix` (11 TFs × 1600/390 functional matrix), and `bun run perf:chart`; put the measured **median/p95 numbers** and the verdict in the PR/evidence, never "looks fast". Budgets are initial targets pending baseline: a miss is an optimization task and re-measure, not a doc edit. Required exception format is in the chart doc.

The fast tier is the PR gate because the full suite carries a known **~230-failure debt** and is **not a gate until green**; the 8,987-test sweep is a debt alarm on push/nightly, not a branch blocker.

**If a budget is not met, do not lower it silently.** Optimize the code/test, mark the slow test (correct marker/category), or record an explicit exception with **owner + date** in the relevant budget file — `perf/budgets.json` for wall/test budgets, `perf/api_budgets.json` for API latency (API budget changes must also update the contract test; see [docs/API_LATENCY.md](./docs/API_LATENCY.md)). Update **last-checked** and **next-check** on every review, even when no number changed.

Mandatory commands (run the narrow one, never a full sweep as a PR gate):
```bash
# Fast changed-test runner (backend, local) — see docs/TESTING_SPEED.md
.venv/bin/python scripts/test/run_changed.py --dry-run   # preview selection, runs nothing
.venv/bin/python scripts/test/run_changed.py             # map diff -> tests, run them
# Nightly full exclusion sweep (the CI debt alarm, not a PR gate)
.venv/bin/python -m pytest -o addopts="" \
  -m "not (slow or slow_testcontainers or integration or contract or e2e or testcontainers or postgres)" \
  -n 4 --dist loadfile -q --tb=short
# Frontend changed-only
bun run test:fast          # or: npx vitest run --dir src --changed
# API benchmark / warm-p95 check — see docs/API_LATENCY.md
.venv/bin/python scripts/bench_api.py --in-process --mode warm           # report (exits 0)
.venv/bin/python scripts/bench_api.py --in-process --mode warm --enforce # gate (exits 1 on FAIL)
# Interactive chart/UI — requires a preview server on 127.0.0.1:4174; see docs/CHART_PERFORMANCE.md
bun run perf:chart:fixtures   # real POWERGRID.NS 11-TF fixtures + backend indicator timings (network)
bun run perf:chart:matrix     # 11 TFs × 1600/390 functional matrix; writes PNGs + JSON
bun run perf:chart            # budget gate (exit 1 on blockers; add -- --report for report-only)
```

## Integration & audit gates

Large features fail at the seams, not in the lanes. A green lane report is not an integrated PR. Run these audits only when subagent lanes are quiet, and record the actual numbers in the PR body.

### 1. Test audit
- Every P0/P1 review finding gets a regression test named for the failure mode. A fix without a failing-first test does not close the finding.
- UI features need a **composed render test**: render the real page; mock only the network module and the shared chart wrapper. Mocking every visual proves wiring, not composition.
- Async data needs an **abort/stale test**: switch market while a request is in flight; a late response must not overwrite the new market, and unmount must abort.
- Every new tab/route gets its own Playwright spec (loaded, loading, error, empty, selector changes) with web-first assertions and no `waitForTimeout`.
- `--changed` misses filesystem-scanning guards. Run them unconditionally on every PR: `theme-single-source`, `design-scale`, `style-keys`, `numeric-typography`, `ui-guard`, `table-structure`, `no-props-destructure`. Add new scanners to this list and to CI.
- After backend model/route changes, run `python scripts/export_openapi.py` and `pytest tests/contract/test_openapi_sync.py`; never hand-edit `openapi.yaml`.
- A full suite is justified only for a large cross-cutting refactor. On a <16 GB host use `--maxWorkers=1`; two 8 GB forks get killed. A worker exit is an infrastructure error, not a pass: rerun the missing files and get a clean file count.
- Subagent test counts cover their files only. The integrated count comes from the main agent after the last lane lands.

### 2. Performance audit
- Measure before and after; never report only a code-review estimate. Build production (`bun run build`), serve `vite preview`, and profile the real route.
- Frontend record: first chart, mode toggle, time-window switch, DOM nodes, canvases, observers/listeners, long tasks, heap, and the lazy chunk's raw/gzip size. Confirm the feature is not in the initial route chunk.
- Backend record: upstream call count/concurrency, shared-resource parse/download count, cache key/TTL/schema, single-flight, `force`, stale fallback, payload raw/gzip, event-loop offload, cold/warm p95.
- Add budgets before optimizing; if a budget is missed, optimize or record a dated exception — never lower it silently.
- Keep the measured baseline in this file or [`docs/PERFORMANCE.md`](./docs/PERFORMANCE.md) so the next agent can detect a regression.

### 3. Evidence audit
- Curate, don't accumulate: one state per mode at 1600 and 390, plus the required loading/error/empty. Target ≤24–30 files; no duplicate hashes.
- Re-read every PNG before attaching. Reject clipped axes/labels, missing scroll hints, overlapping ticks, `-0.0%`, blank canvases, and tables clipped without an affordance.
- Manifest + sha256 + `head`; `bun run audit:evidence`; `node scripts/check-evidence-urls.mjs <pr>` for 200/404/tracked-set match.
- Replace superseded files in the same commit; PR body/comments name only the current set. Any UI change voids A+ and requires a full recapture + regrade.

### 4. Large-refactor orchestration
- Dependency order: foundation lanes first (shared math, chart base, matrix primitives), then consumer lanes, then tests/evidence/docs. Do not let consumers invent their own primitives.
- One owner per file set; list new files explicitly. Docs and rules are a separate lane.
- At least 10 agents total for a large multi-file refactor; run them in waves sized to the host (3–5 active) and never two owners on one file.
- Reserve one integration lane for cross-file wiring (API type → UI prop → tests). Product defects go back to the owning lane; the main agent merges and verifies, and is the sole git actor.
- Remove agent artifacts (`*.log`, `tsc-*.txt`, `run-*.txt`) from the repo root before the first commit.
- Do not commit lane-by-lane before A+ on UI work; one coherent commit/PR after the integrated gates and regrade.

### 5. Fast path (same gates, fewer passes)

Use this when several lanes feed one PR. It compresses passes, never gates.

1. **One full suite, at the end.** Scoped tests run per lane while agents work; no full suite
   between waves. On a <16 GB host use one worker. The final full suite (or CI equivalent) is
   non-negotiable.
2. **Visual freeze before capture.** No capture until every UI lane reports `VISUAL FREEZE`;
   capture the final set once. A blocker fix recaptures only the affected states via
   `--only <state>`, never the whole set.
3. **Mechanical checks before the verifier.** Run the automated visual invariants owned by
   `UI_RULES.md` §7.2; the verifier sees only a set that already passes.
4. **Canonical fixtures, sliced by lookback.** One longest-window fixture per feature, sliced to
   3Y/5Y/10Y; slice coherence is asserted per
   [`TEST_RULES.md` §2](./TEST_RULES.md#test-process-rules-fast-path).
5. **One owner per shared file.** Pre-assign shared files and list `OWN` / `DO NOT TOUCH` in
   every brief; ownership and integration lanes are defined in
   [`SUBAGENT_RULES.md` §3](./SUBAGENT_RULES.md#fast-path-dispatch-contract).
6. **Serialize heavy work.** One build, one preview, one capture. Stop dev/preview before the
   full suite; never run Vitest + Playwright + preview together on one host.
7. **Fast runbook.** Relative budgets, not task logs.

| Phase | Gate | Owner · budget |
|---|---|---|
| Scope | Shared files assigned; `OWN` / `DO NOT TOUCH` | Main · ~5% |
| Lanes | Dependency-ordered; scoped tests green per lane | Lane owners · ~40% |
| Integration | Typecheck + targeted tests + build | Integration lane · ~20% |
| Full verification | One full suite + feature E2E | Main · ~20% |
| Visual gate | Freeze → capture → mechanical checks → independent verifier | Implementer + verifier · ~10% |
| Ship | Blockers fixed, changed states recaptured, regrade, commit/push/PR, evidence URL check | Main · ~5% |

8. **Do not cut:** final full suite or CI equivalent, independent verifier, 1600/390 captures for changed states, unconditional filesystem guards, A+ gate.
9. **Quality-preserving time optimization.** When a gate is slow, optimize the process first —
   batch or automate the check, reuse the last valid result, run it selectively, or move it to
   CI. Measure where the wall time actually goes; prefer incremental deterministic checks over
   repeated full passes. Never remove or weaken a gate for speed; rule 8 is not tradeable.

Capture mechanics and manifest/URL checks: [`docs/SCREENSHOT_EVIDENCE.md`](./docs/SCREENSHOT_EVIDENCE.md). Gate roles, rubric and verdict: [`UI_RULES.md` §7](./UI_RULES.md#7-visual-review-gate-independent-verifier--approver).

## Mutation Testing
- See [MUTATION_TESTING.md](./MUTATION_TESTING.md) for advanced testing guide

## Agent Fleet / Subagent Routing
- **Default and only subagent model: `opencode-go/hy4-flash-free` ("Hy4 flash Free" under OpenCode Go).** Every subagent call MUST pass `model: "opencode-go/hy4-flash-free"` explicitly; omitting the model (which falls back to a harness default) is a violation. Do not use `opencode/nemotron-3.5-super-vl-free`, `opencode/hy4-flash-free`, DeepSeek, or any other provider/model. Model routing is owned by `SUBAGENT_RULES.md §9` — that section is authoritative; do not keep a second copy of the pool here.
- **Always dispatch subagents in the background by default** (`background: true`). Do not wait on a foreground subagent unless the user explicitly asks for a blocking result. Keep working on non-overlapping integration/tests; merge when each lane reports.
- Free-tier quota is finite — if a free model returns `Free usage limit reached`, report it and retry later or escalate that one agent, stating why.
- Escalate a single agent to a stronger model **only** for correctness-critical work (adversarial verification, final holdout) and state why.
- Long-running loop protocol (waves, ledger, gates, **fill-honesty audit**) lives in the **`non-stop`** skill.

### Continuous improvement loop (MANDATORY for graded goals)

Use this for any task with a measurable gate — the A+ design system, coverage, performance,
accessibility, a migration, or “keep improving until X”. Do not run a one-shot edit and call it
finished because time is up or CI is green on one lane. The loop runs until the gate is met.

1. **Write the gate before touching code.** A durable scorecard names every dimension, its target,
   the evidence that proves it, and the current measured value. For the design system that is
   [`docs/DESIGN_SYSTEM_A_PLUS_GATE.md`](./docs/DESIGN_SYSTEM_A_PLUS_GATE.md); for another domain,
   create the equivalent tracked doc. Ephemeral task breakdowns may stay in an untracked `plan.md`,
   but findings, measurements and decisions belong in the tracked doc so a context loss does not
   erase the work.
2. **Keep a live lane list.** At the start of every turn, read the ledger and state the list:
   `DONE / RUNNING / BLOCKED` per lane, with the exact files or metric owned. Never re-dispatch a
   lane that is already running, and never let two lanes own the same file set.
3. **Dispatch in dependency-ordered waves.** One agent, one file set, one measurable outcome. For a
   large multi-file refactor use **at least 10 agents total** across foundation → consumer →
   verification waves, keeping 3–5 active at once so file ownership and memory stay sane. Never let
   two owners touch one file. Pass the model explicitly (`model: "opencode-go/hy4-flash-free"`). Give
   each a self-contained brief with the token/API contract,
   the target mapping, verification commands and a required before/after count. The main agent keeps
   working on non-overlapping review, gates or evidence while they run.
4. **Integrate small, verify by lane.** Review each report, run its targeted tests/typecheck/lint,
   then commit that lane on its own. Do not accumulate a 2,000-line unverified branch. A lane report
   without exact test counts is rejected.
5. **Report progress every time — not just at the end.** Every status update to the user includes:
   the gate and the **last independently certified score**; the **current measured value** (not an
   opinion); the lane list; the concrete next gate; and any blocker. Use the honest form
   “8.0 certified / 9.0 required” rather than a self-awarded A+.
6. **Run the integrated gates only with lanes quiet.** Then: typecheck, lint, affected tests, the
   browser/a11y/visual evidence, and a fresh screenshot read-back at 1600 and 390 for UI work. A
   passing unit test is not visual evidence.
7. **Use one independent verifier, not the implementers.** The verifier scores the gate from source,
   tests, catalog and screenshots; the main agent records the verdict as approver. Self-scoring does
   not count. Do not average multiple raters and do not target A++ — only A+ ships.
8. **If any dimension is below target, or any P0/P1 remains, launch the next wave.** Fix the actual
   gap, re-run the gates, re-rate. Never lower a target, add an allowlist, delete a failing test,
   hide text/overflow, or mark “accepted debt” to clear the gate.
9. **Definition of done is evidence, not effort.** Done means: every in-scope dimension at or above
   target, zero P0/P1, integrated gates green, evidence recaptured at the final HEAD, and independent
   raters agree. Until then the task stays open, even past a requested deadline.

### Subagent contract (enforced by the main agent)
- **One agent, one file set.** Every prompt lists the exact files the agent owns; it must not edit anything else. Parallel agents share one worktree, so overlapping scopes corrupt each other. Test-only agents may create test files but must not edit sources.
- **Read-only git.** Subagents never run `add`, `commit`, `checkout`, `switch`, `stash`, `reset`, `clean`, `rebase`, `merge` or `push`. The main agent is the only git actor.
- **No builds, no servers.** Agents run only their targeted tests (`npx vitest run <file>`, `.venv/bin/python -m pytest <file> -q`). `bun run build`, `./start.sh`, dev servers and browser/devtools sessions belong to the main agent.
- **Protected paths.** Never edit `db/alphashri.db`, `.github/workflows/test.yml`, or unrelated files already dirty in the worktree.
- **Return contract.** Report changes, files touched, the exact test command with pass/fail counts, and anything not done. A report without test counts is rejected.
- **Review gate.** The main agent reviews each diff and reopens the owning subagent for product gaps. Reserve one integration lane for cross-file wiring (API type → UI prop → tests); cross-file stitching is not a product fix. Main runs the integrated suite + `oxlint` + `bun run build` + the UI guards before committing. Agents never commit.
- **Free model pool:** owned by `SUBAGENT_RULES.md §9` — use the pool listed there, one model per independent scope.

### CPU budget — check before heavy tests (MANDATORY)
Vitest spawns a worker per file and a worker pool can saturate the box; a stranded worker once held **8.4 GB** and pushed an 8-core machine to **3% idle / load 72**, which silently turns every other gate into a timeout.

- **Before** running a full suite, `bun run test`, Playwright, or anything that fans out: check `cat /proc/loadavg` and `top -bn1 | grep "^%Cpu"`.
- **Required floor: ≥30% idle** (or load average below core count). If it is lower, **wait** — sleep in short increments (10–20 s) up to a minute — and re-check before starting. Report the number you waited for.
- Prefer targeted runs (`npx vitest run <file>`, `-p no:xdist`) over full sweeps; that is the cheap way to stay under the budget.
- **After** any cancelled or failed test run, confirm nothing was orphaned: `pgrep -af "vitest|pytest|playwright"`. A cancelled lane's worker keeps consuming CPU and memory and will corrupt the next run's timing.
- Never run two full suites concurrently (across lanes too), and never run Playwright at `--workers` above what idle CPU can absorb.

### Subagent wait policy (MANDATORY)
- Never `sleep`, poll, or repeatedly inspect a running subagent's files/processes. It reports automatically when it finishes.
- While an agent runs, do independent work. If nothing is independent, end the turn.
- A backgrounded shell is not a reason to poll either; wait for its completion notification.

### Browser / screenshot policy (MANDATORY)
- Never resize or emulate the user's live browser/page (`resize_page`, `emulate` viewport). Leave their viewport exactly as-is.
- Viewport checks belong in Playwright's isolated browser; screenshots of the live browser are taken only at its current size.

### Comment policy
- Comments explain **why**, never **what**. No narration (`// set the value`), no docstrings that restate the signature, no changelog comments.
- Keep a comment only where the code is surprising: a non-obvious constraint, a workaround, an ordering/protocol requirement.
- Prefer a clear name over a comment. In tests, one short line above a non-obvious fixture is enough — do not annotate every assertion.

## Committing (SMALL COMMITS ALWAYS)
**Rule: Commit small, commit often — on a feature branch. Pushing a feature branch is fine; pushing `develop`/`main` is forbidden.**

- **Branch first:** on `develop`, `git switch -c <type>/<name>` before committing. Never commit then push `develop`.
- **UI gate first:** no commit or push for a UI change until the independent verifier records **A+** (`UI_RULES.md` §7.6). WIP commits do not bypass this.
- **Size:** One logical change per commit, max ~80-120 lines / one `src/ui/*` group / one component family.
- **Frequency:** After each green checkpoint (`bun run build` + `bun run lint` pass, or `bun run test` + `bun run typecheck` pass for UI). Do not accumulate >30 min or >100 lines without a commit.
- **Format:** Conventional `type: scope` — `feat`, `fix`, `refactor`, `chore`. No `Co-authored-by` line unless user asks.
- **Push policy:** `git push -u origin <feature-branch>` is allowed. Pushing `develop`/`main` requires explicit user approval and is normally a PR merge (`gh pr create --base develop`).
- **Checkpoint type:** Use `wip:` prefix if not yet green: `wip: tailwind scaffold — Box/Stack`.
- **Safety net:** Before any `reset`/`clean`, `git stash push -m "pre-<task>"` or commit — never lose working tree.
- Lint + build must pass: `bun run lint && bun run build`

## DB Backups (local SQLite)
- `scripts/backup_db.py` writes **consistent** snapshots (SQLite online backup API, safe while bots/API write) to `backups/db/alphashri_<YYYYmmdd_HHMMSS>.db`, then prunes copies older than the retention window.
- **Automatic**: `db_backup_task()` in the API lifespan creates one backup per calendar day (`skip_if_today`), then re-checks every `DB_BACKUP_INTERVAL_SEC` (default 6h). Started by `./start.sh`.
- **Manual**: `python scripts/backup_db.py` (also `--retention-days 3`, `--backup-dir /path`, `--skip-if-today`, `--quiet`).
- Env: `DB_BACKUP_ENABLED=0` to disable, `DB_BACKUP_DIR` (default `backups/db`), `DB_BACKUP_RETENTION_DAYS` (default 7), `DB_BACKUP_INTERVAL_SEC` (default 21600).
- `backups/` is gitignored. Skipped automatically when `DATABASE_URL` is not `sqlite://` (e.g. Postgres) and in `CI_MODE`.

## DB Migrations (Alembic)
- Location: `db/migrations/versions/`
- Chain: `e5f6a7b8c9d0` → `f6a7b8c9d0e1` (add notes) → `g7b8c9d0e1f2` (add peak/low price) → `2026_04_16_add_reason_to_trades` → `2026_04_20_snapshot_to_db` (BotRuntimeState, StrategyRuntimeState, Position new columns)
- **Validation**: `python scripts/validate_migrations.py` — CI runs this automatically on PRs touching `db/migrations/**`
- **Rule**: `down_revision` must be the actual revision ID (e.g., `'h8b9c0d1e2f3'`), never the filename
- **How to find parent revision**: Look at the parent migration file's `revision = '...'` variable, not its filename
- Trade model columns: `notes` (String 500), `reason` (String 500), `peak_price` (Float), `low_price` (Float), `bot_id` (Integer FK)
- `Trade.to_dict()` includes all columns including `bot_id`, `peak_price`, `low_price`
- Position model has NO `peak_price`/`low_price` — restore defaults to `entry_price`. Position HAS `strategy_type`, `peak_price`, `low_price`, `metadata_json` columns (added in snapshot-to-DB migration).

## Changelog (MANDATORY)

- **One file per day:** `changelog/YYYY-MM-DD.md` (newest first in `changelog/README.md`). There is no monolithic root changelog.
- Every completed task or PR appends to **today's** file under `Added`, `Changed`, `Fixed`, `Removed`, `Data / Ops`.
- Mention user-facing behavior, data/recorder changes, migrations and deliberate non-changes; do not duplicate the full commit message.
- Update it before the final response or commit. A task is not complete until the day’s changelog and `reports/index.html` are both current.
- If a change is intentionally not recorded (e.g. private scratch), say why in the entry.

## Reports Index (MANDATORY)

- **`reports/index.html` is the single entry point.** Whenever a report HTML is added, renamed or removed under `reports/**`, regenerate it:
  ```bash
  .venv/bin/python scripts/market/reports_index.py
  .venv/bin/python scripts/market/reports_index.py --check
  ```
- **Never hand-edit `reports/index.html`.** The scanner owns titles, groups, source windows and links; extend its registry in `scripts/market/reports_index.py` if a new report needs custom metadata.
- A new report is not done until the index `--check` passes, every link resolves, and the index renders at 1600 and 390 with no overflow.
- If a report must stay out of the index, add an explicit exclusion in the scanner and say why; do not silently leave a dead/orphan HTML.
- **Never delete report artifacts** — overwrite in place; the user removes their own reports.

## Stock EDA Reports (research skill)

- Reusable procedure for producing a volume / big-player / fundamentals EDA report for any NSE ticker:
  **`.prime/agent/skills/stock-eda-report/`** (Prime Agent skill `stock-eda-report`).
- One-shot generator (run from repo root, project venv):
  ```bash
  .venv/bin/python .prime/agent/skills/stock-eda-report/scripts/generate_stock_eda_report.py --symbol NETWEB
  ```
  Or reuse cached CSVs with `--daily-csv` / `--minute-csv`. Output → `reports/<SYMBOL>_EDA/`
  (self-contained HTML + Markdown + figures + CSVs).
- Reference thresholds & formulas: `.prime/agent/skills/stock-eda-report/references/analyses-and-thresholds.md`.
- Data sources: Upstox V3 candles (`market_data.market_data.fetch_candles`) + `yfinance` (`TICKER.NS`
  for earnings, results, ownership, analyst). A worked example exists at `reports/NETWEB_EDA/`.

## Earnings History & Event Playbook (research skill)

- Reusable earnings-reaction study + pre-results plan for any NSE ticker:
  **`.prime/agent/skills/earnings-history/`** (Prime Agent skill `earnings-history`).
- One-shot generator (run from repo root, project venv):
  ```bash
  .venv/bin/python .prime/agent/skills/earnings-history/scripts/earnings_history.py \
    --symbol MANKIND --next-date 2026-10-26
  ```
  Output → `reports/earnings/<SYMBOL>/` (`_earnings_history.md`, `_earnings_events.csv`, `.json`).
- Computes: EPS surprise vs **T+1** move, beat rate, **beat-and-fade rate**, gap vs intraday fade,
  pre-20d run-up, T+5/T+10 drift, expected move (last 8 events + ATR), SMAs/RSI/MACD/ADX, ±1×/±2× levels.
- Preparation procedure: `references/earnings-play-checklist.md` (10 steps, quality-of-earnings checks,
  scenario table, execution rules). Worked example: `references/mankind-q2fy27-playbook.md`.
- Always pass `--next-date` from the **BSE/NSE board-meeting filing** — vendor dates drift
  (yfinance said 29 Oct for Mankind Q2 FY27; the filing says 26 Oct).
- Tests: `.venv/bin/python -m pytest .prime/agent/skills/earnings-history/tests -q`.

## Failure modes (read before debugging "wrong data")

- Never let a failure surface as `None`/`0`/empty — blanket-`except` and silently-`None` fields hide it. Log with context, keep it observable; a `None` field is a failure, not a cue to fall back.
- Avoid confusing an empty result with a failed one: a job where every unit failed is `failed`, never `completed`, and a gate must not reuse "0 results" as success.
- Measure cache staleness in sessions, not calendar days.
- Never trust a type annotation for a payload shape — verify against the live response.
- Verify a suspected upstream failure against the raw source before concluding "no data".
- A green suite proves the code, not the screen: render data-driven screens and look.

## Timezone / date helpers

- Reuse these; do not fork (several competing copies exist).
- Backend: `config.IST` (only constant); `frame_last_date()` (IST session date of a frame's last bar), `fmt_date()` (IST display date).
- Frontend: `TZ_IST`, `sessionDateKey()`, `istChartTime` (Intl, explicit `timeZone`), `istClock`.
- Two open/closed implementations: `isMarketOpenIst()` (holiday-unaware) vs `isMarketOpenNow()` (holiday + session window). Use the holiday-aware one for user-facing gates; `isMarketClosedToday()` answers only "is today a holiday".

## Backend ↔ frontend vocabulary parity (MANDATORY)

When a backend `Literal` mirrors a frontend registry (`colorBy`, universes, views), a frontend widening silently breaks writes — add a parity test that parses the TS source and asserts the backend accepts every frontend id. Extend the existing pattern in `tests/api/test_user_configs.py`; don't hand-maintain a second list. Keep legacy ids accepted on write (old saved rows) and normalise on read.

## When the running process is stale

`start.sh` runs without `--reload`. After editing `api/**`, run `./start.sh restart` before testing or debugging — the source can be correct while the server runs old code. Confirm with a real request, not by reading the file. Symptom: an error lists values that no longer exist in the source.

## Gates are only trustworthy with lanes quiet

Run test/typecheck/E2E gates when no other lane is writing; re-run before believing a red result. A failure that passes in isolation, or whose count changes between runs, is a concurrent edit — verify before fixing.

## Release PRs and red-CI recovery (MANDATORY lessons)

Use this when fixing CI on an open PR or merging a release:

- **Check every open PR and its base first.** A `develop → main` release PR runs the full E2E suite; do not confuse it with green PR-to-`develop` smoke checks.
- **Merge small, independent fixes first and the large design wave last.** Between merges, re-query `mergeable`/`mergeStateStatus`; GitHub recomputes after every base merge.
- **A feature branch that conflicts with `develop` must be updated.** Merge `origin/develop` into the feature branch, keep both changelog sections, rerun typecheck/lint + the affected suites, wait for fresh checks, then merge.
- **`gh pr checks` output can hide failures.** Always summarize by state (`... | awk -F'\t' '{print $2}' | sort | uniq -c`) and inspect every non-pass line. `E2E Full` is intentionally skipped on PRs to `develop`; it is mandatory on PRs to `main`.
- **Never trust a local `vite preview` after source edits.** Rebuild, start/restart preview, and wait until `curl 127.0.0.1:5173` returns 200. A stale `dist` makes axe/e2e pass locally while CI fails. Do not put `pkill …` and `bun run preview` in one background shell — the new server can be killed by the same command.
- **App-route axe failures are usually real semantics.** Scrollable regions need `role`, `aria-label` and `tabIndex=0`; do not put `aria-label` on a span wrapping an icon button; pass a native `<button>` (not a component wrapper) to `MenuTarget` so the trigger is not a button nested inside a fallback button.
- **Full frontend runner memory:** 4 forks × 8 GB exceeds a 16 GB runner. Keep `maxWorkers: 2` in `vitest.config.ts`; split mega test files (one heavy render per file if necessary) instead of raising `maxDiff`/ignoring worker errors.
- **Visual baselines must not depend on host fonts.** Bundle the WOFF2 faces used by a dense typography specimen (or use fixed-size specimens); regenerate only the affected baselines. Never raise `maxDiffPixels` to hide font drift.
- **E2E mocks must mirror the request.** A static preview fixture with two legs made the replay page correctly re-fetch a one-leg structure and fail a “zero extra requests” assertion. Build preview/echo mocks from the request body, not a fixed sample.
- **Intentional design changes require stale-test updates.** The 12px floor changed old `11px` assertions and the A++ hero hides stat cells behind `MORE STATS`; update the assertion to the new contract, never lower the floor or re-open the old UI just to satisfy a stale test.
- **Definition of green is the head SHA.** Confirm every required check passes on the current PR head after the last commit; then merge. After merging #266/#267/#269 etc., sync local `develop`, verify the merge commits, and confirm no open PRs remain.
- **Report the final order and merge commits** (`#266` → `#267` → `#268`, then any CI-recovery PR), plus the exact checks. Do not call a release green from a local run.

## Known Issues / Deferred
- **Replay system name→ID migration** (Phase 3) — deferred, known limitation
- **Portfolio summary compact redesign** — mentioned but not started
- **52W daily data caching** — fetches 400 days per chart request with no caching
- **52W range batch progress in admin UI**: The first daily run refreshes all stale symbols (~5-15 min at 3 workers × 0.35s delay), so the progress bar is visible during that window. Subsequent hourly runs are fast (everything already fresh → no-op in ~1s). Use the admin panel's "Clear cache + DB" or adjust `SCREENER_52W_INTERVAL_SEC` to control freshness.
- **`_filter_to_date_or_recent` timezone bug** — see [PRODUCTION.md](./PRODUCTION.md) (known production issue)
- **TradingAgents auth**: `get_current_user` dependency has compatibility issues with this router (langgraph_sdk/chaining chainlit interference). All trading_agents endpoints use no auth or hardcoded user_id=3 for now.
- **Analysis speed**: Multi-agent analysis takes 60-120s (15+ DeepSeek LLM calls). First analysis on any ticker is slow, subsequent requests are instant from file cache.
- **TypeScript is clean.** `bun run typecheck` (TypeScript 7 native) reports **0 errors**; `bun run typecheck:ratchet` also reports 0. CI gates both. Do not reintroduce the old bare `npx tsc --noEmit | grep -c` check (it measured help output). Type-aware lint is report-only: `bun run lint:types` (138 warnings at the 2026-11-22 baseline, not a PR gate).
- **Index Report chart focus (LEVEL 1/2)** — specified in [docs/INDEX_REPORT_REDESIGN.md](./docs/INDEX_REPORT_REDESIGN.md) but not built. The walls card is now 5-column and 216px (was 475px single-column), so the chart is visible; the drawer and focus mode are still pending.
