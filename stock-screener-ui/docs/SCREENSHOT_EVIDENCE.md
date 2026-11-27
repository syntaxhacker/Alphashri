# Screenshot evidence for UI PRs

Mechanics for the visual gate in [`UI_RULES.md` §7](../UI_RULES.md#7-visual-review-gate-independent-verifier--approver).
Every PR with user-visible UI changes commits evidence under `docs/screenshots/<feature>/`.

## Capture matrix

| Viewport | States |
|---|---|
| **1600×1000** | loaded, loading, error, empty, plus one capture per selector option / mode / tab touched |
| **390×844** | the same set |

1. Capture at the final UI HEAD from the running app the main agent already started; the verifier starts no server or build. Use the live app, not Storybook or a mocked composite; a mock is allowed only for a state the live app cannot produce, and the manifest records it.
2. Read every PNG back before attaching: reject blank canvas, `undefined`/`NaN`, clipped labels, overlapping controls, a 100px-high chart canvas, and tables clipped without an obvious scroll.
3. For a layout-fit claim, record `getBoundingClientRect()` for the panel/chart/table in the PR.
4. Save PNG only; keep files under 500 KB. `reports/**` is gitignored — never put evidence there.

## Freeze and recapture

- Capture only after every UI lane reports `VISUAL FREEZE`; a later UI edit invalidates the freeze and the affected captures.
- Fix a blocker with `--only <state>`; recapture only the affected states and record their IDs in the PR (an extra manifest field is allowed). Recapture the full matrix only for a global change.

## Mechanical pre-check

Run the capture/check script before attaching. It must fail fast on clipped text/boxes, duplicate or missing scroll cues, active-toggle/axis-tick integrity, as-of/latest and transition-count coherence, placeholders (`-0.0%`/`NaN`/`undefined`), and blank canvases. Canonical checks and thresholds: [`UI_RULES.md` §7.2](../UI_RULES.md#72-evidence-first). Do not attach a set that still fails.

## Naming

New captures use `<feature>-<market>-<years>-<view>-<viewport>.png`.

- `market`: `india` | `america`; `years`: `3y` | `5y` | `10y`; `view`: the tab/chart mode (`rotation`, `lab`, `risk`, …); `viewport`: `1600` or `390`.
- Examples: `sector-history-india-3y-rotation-1600.png`, `sector-history-america-10y-lab-390.png`.
- Route/feature-level captures omit non-applicable parts: `<feature>-<viewport>.png` (`sector-history-390.png`); states use `<feature>-<state>-<viewport>.png` (`sector-history-empty-1600.png`, `sector-history-loading-390.png`).
- Lowercase, hyphen-separated. No spaces, dates, `final`, `v2`, `desktop` or `mobile`.

## Manifest

`docs/screenshots/<feature>/manifest.json` indexes every committed PNG; the folder contains only files in the manifest.

```json
{
  "feature": "sector-history",
  "route": "/sector?tab=history",
  "head": "<git sha the pixels represent>",
  "viewports": [1600, 390],
  "sha256": {
    "sector-history-1600.png": "<64 hex chars>",
    "sector-history-390.png": "<64 hex chars>"
  },
  "states": [
    {
      "id": "overview-default",
      "files": {
        "1600": "sector-history-1600.png",
        "390": "sector-history-390.png"
      },
      "covers": "Overview at the default India / 5Y selection."
    }
  ]
}
```

- `states[].id` names the state/view (`overview-india-3y`, `rotation-america-10y`, `loading`, `error`, `empty`, `lab-movers-mobile`); `files` maps viewport width to filename; `covers` is one sentence.
- `states[].aliasOf` (optional) names the canonical state; an alias file must be byte-identical (same `sha256`) to that state's file for the same viewport and is kept only for an older PR reference.
- `sha256` has one key per committed PNG; `head` is the commit the pixels represent. Extra fields are allowed; these are the minimum.
- Every `states[].files` entry must appear in `sha256` and in the folder; every folder PNG must appear in `sha256` and be referenced by a state.
- Commit `manifest.json` with the PNGs. The repo-wide `*.json` ignore can hide it even when it is untracked, so stage it explicitly with `git add -f docs/screenshots/<feature>/manifest.json` and confirm it is tracked.

## Pre-attach checks

Run `bun run audit:evidence`; it must pass. It validates the manifest schema, exact file coverage, dimensions, ≥8 KiB, SHA-256, alias hashes and a stale `head` against `src/api`.

1. **Hash:** `sha256sum docs/screenshots/<feature>/*.png` matches every `sha256` value.
2. **Duplicates:** no two filenames share a hash unless the extra one is an explicit `aliasOf` state; never add an unreferenced duplicate.
3. **Stale:** `head` is the UI source HEAD the pixels represent; any UI or `src/api` change after capture means recapture and a manifest update.
4. **Folder match:** `sha256` keys == tracked PNGs in the folder == the union of `states[].files`; every `files` map uses the declared `viewports`.
5. **URLs:** `node scripts/check-evidence-urls.mjs <pr>` shows every embedded raw URL returning **200**, every removed filename returning **404**, and the PR set matching the tracked set.
6. **Replacement:** delete superseded images in the same commit and update the PR body/comments so no old filename remains. An orphan, stale or 404 image blocks the PR.

## Attach

**Every user-visible PR body embeds raw image URLs — not just a folder path — for every changed screen, mode/selector and state at 1600×1000 and 390×844.** Use this exact table format, with inline images labelled by screen/state:

```md
| 390 | 1600 |
| --- | --- |
| ![Home 390×844](https://raw.githubusercontent.com/<owner>/<repo>/<full-sha>/stock-screener-ui/docs/screenshots/ui-a-plus/home-390.png) | ![Home 1600×1000](https://raw.githubusercontent.com/<owner>/<repo>/<full-sha>/stock-screener-ui/docs/screenshots/ui-a-plus/home-1600.png) |
```

- One row per changed screen (all 15 primary routes when the change is global — see [`ui-a-plus/README.md`](./screenshots/ui-a-plus/README.md)); add rows for loading/error/empty states and sector sections where applicable.
- Pin every URL to the **final source SHA** (full 40 chars), never a branch or `HEAD`. State the manifest `head`, `sha256` coverage and `audit:evidence` result in the body; if the PR head is one commit after the manifest head with no pixel change, note that explicitly. A visual change after capture voids the evidence.
- Verdict format and the pass/fail gate: [`UI_RULES.md` §7](../UI_RULES.md#7-visual-review-gate-independent-verifier--approver).
