# UI A+ audit — all-screen wave (2026-11-26)

**Status: BASELINE / IN PROGRESS — not a final verdict.** The grades below are an independent,
**PNG-only** review of the existing app evidence at old HEAD `6b1ef043`. They are the starting point
for this wave, not an A+ claim, not an approval, and not a substitute for the running-UI review.
The full rubric is [`UI_RULES.md` §7](../UI_RULES.md#7-visual-review-gate-independent-verifier--approver)
(§7.3 dimensions, §7.4 caps, §7.5 verdict, §7.6 loop); evidence mechanics are in
[`SCREENSHOT_EVIDENCE.md`](SCREENSHOT_EVIDENCE.md). Neither is reproduced here.

## 1. Scope and exclusions

In scope (15 screens): `/home`, `/screener`, `/news`, `/backtest`, `/paper`, `/strategy-runner`,
`/sector`, `/patterns`, `/strategies`, `/bots`, `/report/index`, `/report/profit`, `/settings`,
`/admin`, `/chart/RELIANCE`.

Excluded by user: `/options`, `/replay`. No grade, fix or evidence requirement in this doc applies
to those two routes.

Two viewports for every in-scope screen: **1600×1000** and **390×844**.

## 2. Baseline table (PNG-only, HEAD `6b1ef043`)

`—` = no baseline PNG evidence, therefore no independent grade yet. Ungraded screens are in scope
and need first capture + grade before any wave-level claim. No defect is inferred for them.

| Screen | Route | 1600 | 390 | Main baseline defect |
|---|---|---|---|---|
| Home | `/home` | B | **C** | 390 keeps desktop side-by-side; chain/heatmap clipped; date text truncated. 1600 chain blank for 744px. |
| Screener | `/screener` | B | **C** | 390 collapses to a two-column 108px results slice; numeric columns off-screen; detached scroll cues. 1600 SECTOR column truncated; empty GROUPS body. |
| News | `/news` | — | — | No baseline evidence. |
| Backtest | `/backtest` | — | — | No baseline evidence. |
| Paper | `/paper` | — | — | No baseline evidence. |
| Strategy runner | `/strategy-runner` | — | — | No baseline evidence. |
| Sector | `/sector` | B | B | 390 summary strip clipped (only top sector visible), Refresh clipped; 1600 large blank panel bodies; MOVE bars have no scale. |
| Patterns | `/patterns` | A+ | **C** | 1600 clean. 390 stats strip clipped; BARS clipped; SCORE/POS/PATTERN badge off-screen; scroll cue 460px from its scroller. |
| Strategies | `/strategies` | — | — | No baseline evidence. |
| Bots | `/bots` | — | — | No baseline evidence. |
| Report index | `/report/index` | B | B | GEX readout orphan wrap; no SIG/spot-line key; 390 first axis tick clipped and first candle at edge. |
| Report profit | `/report/profit` | — | — | No baseline evidence. |
| Settings | `/settings` | — | — | No baseline evidence. |
| Admin | `/admin` | — | — | No baseline evidence. |
| Chart (RELIANCE) | `/chart/RELIANCE` | — | — | No baseline evidence. |

Baseline P0: **Home 390, Screener 390, Patterns 390**, plus the evidence gap below. Patterns 1600
is the only A+ baseline and must not regress.

**Evidence gap (P0):** `docs/screenshots/app/` contains only 10 loaded-state PNGs for 5 of the 15
screens, no loading/error/empty/selector states, and no manifest. Per §7.4 a missing state caps the
grade at **B**; missing evidence/verifier access is **F**. The baseline was PNG-only, so §7.2
running-UI interaction checks are also unverified.

## 3. Fix list (priority × owner lane)

### P0 — blocks any A+ claim

- **Home** — 390: replace the retained desktop side-by-side layout with a mobile stacking; unclip
  the options chain and heatmap; fix truncated date text. (baseline 390 C)
- **Screener** — 390: replace the two-column 108px results slice with a usable full-width result;
  bring numeric columns on-screen; remove detached/duplicate scroll cues. (baseline 390 C)
- **Patterns** — 390: unclip the stats strip and BARS; bring SCORE/POS/PATTERN badges on-screen;
  remove or re-anchor the scroll cue 460px from its scroller. (baseline 390 C)
- **Evidence states** — capture the full state matrix for all 15 screens (§4); the current loaded-only
  set with no manifest is P0.

### P1 — material defects in the baseline

- **Home** — 1600: fix the 744px blank options-chain region. (baseline 1600 B)
- **Screener** — 1600: restore the truncated SECTOR column; populate or give GROUPS an explicit empty
  state. (baseline 1600 B)
- **Report** — `/report/index`: fix the GEX readout orphan wrap; add a SIG/spot-line key; 390 first
  axis tick clipped and first candle at the edge. (baseline B/B)
- **Sector single-page** — 390 summary strip and Refresh clipping; 1600 blank panel bodies; MOVE
  bars need a scale. Complete the single-page acceptance in §6. (baseline B/B)
- **Evidence states** — baseline was PNG-only: the independent verifier must also exercise the
  running UI (legend/tooltip, selectors, keyboard/focus, 390 overflow) per §7.2.

### P2 — suggestions

- None recorded in the baseline. Under §7.4 an otherwise-clean grade with suggestions is **A**, which
  still FAILs to ship; any verifier suggestion must be resolved before an A+ verdict.

## 4. Evidence requirements

- **Matrix:** 15 in-scope screens × 2 viewports (1600×1000, 390×844) × states: `default`/loaded,
  `loading`, `error`, `empty` where meaningful, plus one capture per selector option / mode / tab
  touched. Mark non-applicable states explicitly with a reason; do not silently omit them.
- **Where:** `docs/screenshots/<feature>/` per [`SCREENSHOT_EVIDENCE.md`](SCREENSHOT_EVIDENCE.md),
  with its naming rules. Capture from the running app at the final UI HEAD after visual freeze;
  Storybook or a mocked composite is not acceptable except for states the live app cannot produce,
  and the manifest must record that.
- **Manifest:** `manifest.json` per folder with `head` (final UI HEAD the pixels represent) and a
  `sha256` entry for every PNG; folder files == `sha256` keys == union of `states[].files`. Stage it
  explicitly (`git add -f`) and pass `bun run audit:evidence` and the hash/duplicate/stale/URL checks.
- **Supersede, don't reuse:** the old loaded-only `docs/screenshots/app/` PNGs at `6b1ef043` are
  baseline evidence only; replace them in the same change and keep only current files in circulation.
- **Verifier:** a separate read-only session that authored none of the changed files; it opens every
  PNG, exercises the running UI, writes one grade + defect list per §7.5, and an approver records the
  decision. Implementer never verifies or approves its own visuals.

## 5. Loop / definition of done

1. Fix every P0 and P1 (and any verifier suggestion) → reach visual freeze → recapture affected states
   (`--only <state>` for local fixes; full matrix only for a global change) at the final HEAD →
   independent regrade. Repeat until A+ ([§7.6](../UI_RULES.md#76-loop-record-and-commitpr-gate)).
2. **No A+ claim** while any P0/P1 is open, any in-scope state/viewport is uncaptured, the manifest is
   missing/stale, or there is no independent verdict with `VISUAL VERDICT: A+ — SHIP: YES`.
3. Any UI change after a verdict voids it; re-review at the new HEAD is mandatory. Build, lint, tests
   and green CI are not visual approval. Only A+ ships; A/B/C/F all FAIL.

## 6. Sector single-page acceptance

`/sector` becomes one scrollable page, not a tabbed shell:

- No tabs and no tab-driven conditional mounting; the four sections — **Overview, Rotation,
  Correlation, History** — are all in the DOM as stacked anchors (`#overview`, `#rotation`,
  `#correlation`, `#history`).
- An anchor rail (`data-testid="sector-section-nav"`) navigates to those four sections, tracks the
  active section, is keyboard/focus-visible, and never replaces the content.
- All four sections are stacked and lazy-mounted (defer heavy work until near the viewport), with no
  fixed-height clipping and no large blank card bodies; keep the dense typography and one-border-per-
  section rules of [UI_RULES.md §6](../UI_RULES.md#6-sector-dashboard--rotation-hard-won-rules).
- 390: summary strip fully visible (not only the top sector) and Refresh fully visible; one visible
  scroll cue per horizontal scroller; no horizontal body overflow.
- 1600: MOVE bars carry a scale; signed values are colored; URL state for `kind`/`period`/`min`/
  `group` is preserved; removal of the old `tab`/`dash` state is explicit.
- Evidence: both viewports × loaded/loading/error/empty + selector states, manifest at final HEAD,
  and an independent A+ verdict before Sector is counted done.
