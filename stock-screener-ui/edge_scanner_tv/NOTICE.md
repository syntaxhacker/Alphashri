# Attribution

`edge_scanner_tv/dashboard-v2/` is vendored verbatim (zero modifications) from
[simonro/edge-scanner](https://github.com/simonro/edge-scanner) (MIT licensed),
including its `package.json`/`package-lock.json` dependency tree.

It renders charts with TradingView Lightweight Charts™ (Apache-2.0,
(c) TradingView, Inc.) — the library's attribution logo is left enabled, as
its license requires.

Our backend (`server.py`, `store.py`, engine modules) is original code written
for this repo. It implements a wire-compatible subset of edge-scanner's
`/api/*` + `/ws/alerts` API; no edge-scanner Python code is vendored.

## Dashboard fork (timezone switcher)

`dashboard-v2/src` is upstream except these minimal display-timezone edits
(upstream hardcodes `America/New_York`):

- `lib/time.ts` — active zone (`ET` | `IST`, persisted in `localStorage`
  `edge-tz`, default `ET` = upstream behavior); RTH/pre-market windows per
  zone (ET 04:00/09:30–16:00, IST 09:00/09:15–15:30). All exported helper
  names unchanged, so no consumer logic was touched.
- `components/TopBar.tsx` — ET/IST toggle (applies on reload) + dynamic
  clock label.
- `windows/clock/ClockWindow.tsx`, `windows/chart/ChartWindow.tsx`,
  `windows/scanner/ScannerWindow.tsx`,
  `windows/setupcheck/SetupCheckWindow.tsx` — clock/session labels follow
  the active zone (no logic changes).
- `lib/chartMath.ts` — comment-only update.
