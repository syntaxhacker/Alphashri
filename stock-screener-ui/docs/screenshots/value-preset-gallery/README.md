# Value preset-gallery fix pass — evidence

Worktree: `/workspaces/test-rag/.agent-worktrees/value-filter-redesign/stock-screener-ui`
Branch / HEAD: `feat/value-filter-redesign` @ **`9910d40c`**
App: `http://127.0.0.1:5176` → API `127.0.0.1:8766` (QA login; real value scan).
Captured: 2026-11-27T03:31–03:42Z, after the `b4b6ac4d` commit.

Independent regrade: **A+** at `b4b6ac4d`. Frames were captured before the no-conflict develop merge at `9910d40c`; the Value surfaces are unchanged by that merge. Superseded pre-commit frames were discarded.

## Frames (28, 14 states × 1600/390)

| State | 1600 | 390 |
|---|---|---|
| Market rail → Value filters gallery | `rail-gallery-value-1600.png` | `rail-gallery-value-390.png` |
| Market rail → Mover presets gallery | `rail-gallery-movers-1600.png` | `rail-gallery-movers-390.png` |
| Value gallery (value-first, movers collapsed) | `value-gallery-1600.png` | `value-gallery-390.png` |
| Search no-match (per-section copy, live count) | `value-no-match-1600.png` | `value-no-match-390.png` |
| Deep preset applied (real DEEP gates) | `value-deep-applied-1600.png` | `value-deep-applied-390.png` |
| Value preset applied (SERIOUS) | `value-preset-applied-1600.png` | `value-preset-applied-390.png` |
| Cleared / no preset selected | `value-cleared-1600.png` | `value-cleared-390.png` |
| Mover applied from the Value gallery | `mover-applied-1600.png` | `mover-applied-390.png` |
| Manual bounds filled and reopened | `value-manual-bounds-1600.png` | `value-manual-bounds-390.png` |
| Manual bounds header (`max_pe=15`, `min_roe=18`, `No preset`) | `value-manual-bounds-header-1600.png` | `value-manual-bounds-header-390.png` |
| US mover gallery (`$500B`, no `Cr`) | `us-mover-gallery-1600.png` | `us-mover-gallery-390.png` |
| Loading | `value-loading-1600.png` | `value-loading-390.png` |
| Error (simulated 500) | `value-error-1600.png` | `value-error-390.png` |
| Empty | `value-empty-1600.png` | `value-empty-390.png` |

All PNGs are exactly `1600×1000` or `390×844`. Hashes and byte sizes:
`manifest.json`.

## Measured states

- Real scans: DEEP **20 of 20**, SERIOUS **100 of 115** (row cap 100),
  cleared/no preset **100 of 1975**.
- Manual bounds survived close/reopen as `max_pe=15`, `min_roe=18`; the header
  select remained **No preset**.
- US mover floor copy: **`$500B`**, no `Cr` anywhere in the mover section.
- Rail entries: **24 px** high on desktop (`222×24`) and mobile (`263×24`).
- 390 gallery: **bottom sheet** `390×692` at `y=152` (82dvh capped at 720 px),
  with 152 px of app context above it.
- 390 first view: **2 full value cards + 1 partial** (Serious, Deep, start of
  GARP). This replaces the earlier inaccurate “3 visible” claim.
- Count label: `6 matching presets · 12 in collapsed Market table presets`;
  expanding movers changes it to `18 matching presets`.
- Gate copy: `Not among the furthest 15% below the 52W high` (DEEP).

## State-authenticity notes

- Applied / cleared / gallery / mover / manual-bounds frames use the **real
  value scan** and real market snapshot.
- Loading = the real `/api/value/scan` response delayed in the browser.
- Empty = the real scan payload with `rows/matched/sectors` emptied.
- Error = a synthetic 500 with an explicit “simulated value-scan failure”.
- US mover gallery was captured in the US universe; the app remains on the
  requested `b4b6ac4d` source.

## Verification

- **28/28** frames exist, all dimensions valid, all manifest sha256/byte sizes
  match.
- No page overflow and no duplicate IDs in any of the 28 states (`audits.json`).
- **Feature-scoped axe**: 0 serious/critical in the Value panel and gallery
  states. Whole-page axe: **0** in 27/28 states.
  - Known exception: `mover-applied-390` retains one pre-existing serious
    `scrollable-region-focusable` on the Market breadth strip
    (`.gap-3 overflow-x-auto`). It is outside the Value feature and was present
    before this work; it is not fixed here because the evidence is pinned to
    `b4b6ac4d`.
- **No Value-feature console errors.** Known unrelated console noise:
  - legacy `/api/screener?...screener=52w_high` → 500 on first page boot;
  - `/api/chart-patterns/patterns/lookup` → 422 on a US session (the pattern
    registry is India-only);
  - the intentional `/api/value/scan` 500 used to capture the error state.
  None of the three originates in `src/components/value/**` or the preset
  gallery.

## Tests at this HEAD

```
npx vitest run src/components/value \
  src/components/market/MarketFilterRail.movers.test.tsx \
  src/components/market/MarketFilterRail.value.test.tsx \
  src/components/market/MarketScreenerPanel.test.tsx \
  src/ui/inputs/Select.test.tsx src/test/design-scale.test.ts
# 14 files, 279 tests passed

npx vitest run src/test/design-scale.test.ts
# 8 tests passed

npx oxlint <touched paths>  → clean
bun run typecheck          → 0 errors
```

Raw outputs: `capture.log`, `audits.json`, `metrics.json`,
`vitest-required.log`.
