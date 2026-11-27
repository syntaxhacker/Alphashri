# Visual regression (1600 / 390 pixel baseline)

This is the automated pixel gate in
[`DESIGN_SYSTEM_A_PLUS_GATE.md`](./DESIGN_SYSTEM_A_PLUS_GATE.md). The harness and
CI step landed in `ff939b9a`; it turns the Storybook screenshots into an
assertion: a visual change fails a run instead of only being visible in a diff
review. The 12 baseline PNGs (6 stories × 2 viewports) are generated and
committed under `tests/visual/__screenshots__/`, and `bun run visual:test` passes
**12/12**. **Current status: green.**

## Files

| Path | Role |
| --- | --- |
| `scripts/visual-regression.mjs` | Single entry point, invoked by `bun run visual:test` / `bun run visual:update`. Validates the static build, then runs a dependency-free IHDR/size preflight on all 12 baselines before launching Playwright. Supports `UPDATE_SNAPSHOTS=1` and `--preflight-only`. |
| `tests/visual/visual-regression.spec.ts` | The six Storybook stories, captured full-page at both breakpoints and compared with `toHaveScreenshot`. |
| `tests/visual/playwright.visual.config.ts` | Standalone Playwright config (does **not** use the app's `playwright.config.ts`). Starts its own static server, defines the two viewport projects, pins the diff budget. |
| `tests/visual/__screenshots__/` | **Committed baseline PNGs** (12 files: 6 stories × 2 breakpoints), generated and verified at **12/12** by `bun run visual:test`. See "One-time baseline creation / intentional update" for intentional updates. |

The default `playwright.config.ts` targets `tests/e2e` and the Vite dev server
on `localhost:5173`. This gate deliberately has its own config so it can only
ever capture the static Storybook build.

## How it works

1. `scripts/visual-regression.mjs` requires
   `storybook-static/index.json` to exist and to contain all six target story
   IDs. If it is missing or stale, the script fails with the exact rebuild
   command. There is no dev-server fallback.
2. It then requires all 12 baseline PNGs to be present. A normal run never
   writes a missing baseline (`updateSnapshots: "none"`), so a missing baseline
   is a hard failure, not a silent pass.
3. Every present baseline goes through the **IHDR preflight** described below:
   exact viewport width, height at least the viewport height, and a file size
   of at least 8 KiB. The full list of 12 measurements is printed on a pass;
   a failure is reported as an itemised list. This is skipped when
   `UPDATE_SNAPSHOTS=1` (update mode regenerates the PNGs).
4. The visual config starts a short-lived static server:
   `python3 -m http.server 6133 --bind 127.0.0.1 -d storybook-static`, and waits
   for `/index.json` before the first test. It is torn down at the end of the
   run.
5. For each story/viewport pair the spec opens
   `/iframe.html?id=<story-id>&viewMode=story`, waits for the Storybook root,
   fonts, and network idle, then captures a **full-page** screenshot and
   compares it against the matching PNG in `tests/visual/__screenshots__/`.
6. The diff budget is small: `threshold: 0.1` (~10% per-pixel colour tolerance)
   and `maxDiffPixels: 100`. Anything beyond that fails the test and Playwright
   writes an actual/diff image into `test-results/visual/`.

### Baseline set

| Name | Story ID |
| --- | --- |
| `typography-landing` | `design-system-typography--landing` |
| `overview` | `design-system-overview--overview` |
| `inputs-landing` | `design-system-inputs--landing` |
| `data-display-landing` | `design-system-data-display--family-landing` |
| `overlay-landing` | `design-system-overlay--family-landing` |
| `foundations-landing` | `design-system-foundations--landing` |

Each name is captured for projects `desktop-1600` (1600×1000) and `mobile-390`
(390×844), producing files like
`tests/visual/__screenshots__/overview-desktop-1600.png`.

### Baseline preflight (IHDR dimensions + file size)

`scripts/visual-regression.mjs` reads the first 24 bytes of every baseline
(8-byte PNG signature, IHDR chunk length/type, then big-endian width/height) with
`node:fs` only — no image library, no new dependency. A baseline is accepted
when:

| Project | Width | Height | Minimum size |
| --- | --- | --- | --- |
| `desktop-1600` | exactly **1600** | at least **1000** | 8 KiB |
| `mobile-390` | exactly **390** | at least **844** | 8 KiB |

Width must be exact because it directly proves the right viewport project was
used. Height is a **minimum**, not an exact match: the spec captures with
`fullPage: true`, so a tall landing page is legitimately taller than the
viewport (the committed baselines range from 1600×1000 to 1600×2503 on desktop
and from 390×1788 to 390×5100 on mobile). A height *below* the viewport means
something other than the configured viewport was captured. The 8 KiB floor
catches blank/placeholder files; a bad PNG signature or a missing IHDR chunk is
rejected as well.

A pass prints all 12 files with their measured dimensions and sizes, followed
by `Baseline preflight passed: 12/12`. A failure prints the same list with
`FAIL` rows and exits 1 with an itemised reason for each offending file. The
preflight runs in the normal verify path (and therefore in CI) but is **skipped
when `UPDATE_SNAPSHOTS=1`**, since update mode is what regenerates the files.

`node scripts/visual-regression.mjs --preflight-only` runs the static-build,
story-catalog and baseline checks and exits before starting a static server or
Playwright. It is a fast way to validate the committed PNGs on a machine without
a browser installed.

## Commands

Two package scripts are the entry points (run from `stock-screener-ui/`):

| Script | Command | Purpose |
| --- | --- | --- |
| `bun run visual:test` | `node scripts/visual-regression.mjs` | Verify all 12 baselines (no writes). |
| `bun run visual:update` | `UPDATE_SNAPSHOTS=1 node scripts/visual-regression.mjs` | Create/regenerate the 12 baselines (IHDR preflight skipped). |
| (no package script) | `node scripts/visual-regression.mjs --preflight-only` | Run all pre-browser checks, print the 12 PNG measurements and exit without launching Playwright. |

This gate **runs in CI** on every PR. In the `frontend-lint-typecheck` job,
`Build Storybook` produces the static build, `Install Playwright Chromium`
provides the browser, and the `Verify Storybook visual baseline` step runs
`bun run visual:test` alongside the axe and keyboard gates. That run includes
the IHDR preflight, so a wrong-viewport or suspiciously small PNG fails CI even
if the pixel diff would have matched. A normal run never writes baselines
(`updateSnapshots: "none"`), so the 12 PNGs **must remain committed** to the
repo — otherwise CI fails with a missing-baseline error.
They are now committed and `bun run visual:test` passes **12/12**, so this CI
step passes alongside the axe and keyboard gates.

## Prerequisite

**Only runs when a static Storybook build exists.** `storybook-static/` is
gitignored, so build it locally first with `bun run build-storybook`. In CI the
job's `Build Storybook` step produces it before this gate runs. The harness has
no dev-server fallback and fails with the rebuild command if the build is
missing or stale.

Requires the already-installed `python3`, `@playwright/test`, and Playwright
Chromium browser binaries (`npx playwright install chromium` if absent) for a
full run. `--preflight-only` needs none of those — only Node and the static
build — because it exits before the server and browser are launched.

## One-time baseline creation / intentional update

`bun run visual:update` creates all 12 baselines (six stories × two
breakpoints); this has been done and the PNGs are committed artefacts. For an
intentional update, review the diff and commit the intended PNGs before
`bun run visual:test` can pass for anyone else (including CI). From
`stock-screener-ui/`:

```sh
# 1. fresh static build (storybook-static/ is gitignored) — prerequisite
bun run build-storybook

# 2. first run creates the 12 baselines (later runs regenerate them)
bun run visual:update

# 3. inspect what changed, then commit only the intended PNGs
git status --short tests/visual/__screenshots__
git diff -- tests/visual/__screenshots__
git add tests/visual/__screenshots__
```

`bun run visual:update` sets Playwright's update mode to `all` (and passes
`--update-snapshots`), so existing PNGs are overwritten as well as missing ones
created. The IHDR/size preflight is skipped in this mode — its job is to guard
the *committed* baselines, not to block the very run that creates them — so
verify the regenerated files with `--preflight-only` before committing.
**Review the diff before committing** — an accidental re-baseline is how a
visual regression gets approved by mistake.

## Routine verification

```sh
bun run build-storybook   # only needed if storybook-static/ changed
bun run visual:test
```

To check just the committed PNGs (no static server, no browser):

```sh
node scripts/visual-regression.mjs --preflight-only
```

Exit code is the pass/fail signal: `0` means all 12 baselines passed the IHDR
preflight (and, for a full run, matched), non-zero means a dimension/size
violation, a missing precondition, or visual drift.

## Failure messages

| Message | Cause / fix |
| --- | --- |
| `Static Storybook build not found: storybook-static/index.json` | Run `bun run build-storybook`. |
| `... is stale: ... target story/stories are absent` | The build predates a story rename; rebuild with `bun run build-storybook`. |
| `Missing N of 12 baseline screenshot(s) ...` | First run, or someone deleted a PNG. Run the `bun run visual:update` flow above. |
| `Baseline preflight failed: N of 12 PNG(s) are invalid.` + itemised `  - name: reason` rows | A baseline has the wrong width (not 1600/390), a height shorter than 1000/844, is under 8 KiB, or is not a well-formed PNG. Regenerate with `bun run visual:update` and re-check with `--preflight-only`. |
| `Screenshot name ... must have '.png' extension` / comparison failure | Real visual drift, or browser/font environment differs from the one that generated the baselines. Compare the diff image in `test-results/visual/`; only re-baseline if the change is intentional. |

## Scope notes

- The six stories are the same representative landing pages used by
  `scripts/storybook-showcase.mjs` (Typography, Overview, Inputs, Data display,
  Overlay, Foundations), so the pixel gate and the evidence screenshots cover
  the same surfaces.
- Screenshots are full-page (`fullPage: true`) to match the showcase evidence.
  At 390px wide a landing page can be tall; the diff budget is per-image, not
  per-viewport.
- Focus-ring proof and app-route evidence remain separate
  (`scripts/storybook-showcase.mjs`, `tests/e2e/design-evidence.spec.ts`); this
  gate does not replace them.
