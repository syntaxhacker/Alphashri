# Home Monitor Contract (v1)

Status: implementation contract for the Home `Monitor` surface. The Desk
(window manager) stays unchanged; Monitor is a fixed, glanceable layout.

## Backend endpoint

`GET /api/catalysts/today?market=india&sector=all`

Auth: `Depends(get_current_user)` (same bearer token as the rest of the app).

Response (empty sources are explicit; never fabricate a row):

```json
{
  "as_of": "2026-11-19T11:13:00+05:30",
  "market": {
    "nifty": { "last": 25304.2, "change_pct": 0.3 },
    "sensex": { "last": 82300.0, "change_pct": 0.4 },
    "vix": 16.31
  },
  "sector": {
    "id": "all",
    "label": "MARKET",
    "change_pct": 3.75,
    "relative_strength_pct": 3.45,
    "breadth": { "advancing": 12, "declining": 3, "total": 15 }
  },
  "available_sectors": [
    { "id": "all", "label": "MARKET", "count": 3589 },
    { "id": "consumer-durables", "label": "CONSUMER DURABLES", "count": 132 },
    { "id": "technology-services", "label": "TECHNOLOGY SERVICES", "count": 195 }
  ],
  "rows": [
    {
      "symbol": "MARUTI",
      "name": "Maruti Suzuki",
      "sector": "Consumer Durables",
      "kind": "news | event | positioning",
      "headline": "Investor meetings 17-19 Nov; stock near 52-week low",
      "source": "Business Standard",
      "source_url": "https://...",
      "first_seen": "2026-11-19T10:31:00+05:30",
      "event_at": "2026-11-19T09:15:00+05:30",
      "state": "scheduled | breaking | confirmed | fading",
      "score": "high | medium | low",
      "confidence": 0.0,
      "move_pct": 6.5,
      "rel_volume": 2.4,
      "reasons": ["GST small-car demand", "Stock -25% YTD"],
      "invalidates": ["Nifty Auto gives back >1.5%", "Breadth falls below 8/15"]
    }
  ],
  "counts": { "high": 2, "medium": 1, "low": 0, "total": 3 },
  "warnings": ["event_source_unavailable"]
}
```

Rules:

- `available_sectors` is derived from the live snapshot's `sector` field. There
  is no hand-maintained sector or constituent registry; a new sector appears
  when the snapshot returns it. `all`/`MARKET` is always first.
- `rows` may be empty. `warnings` names dead sources; do not 500 on one source.
- `headline` is `null` only for a `positioning` row. A `news`/`event` row
  without a real title is invalid, not an empty-string placeholder.
- `score` is a categorical summary; reasons are mandatory for any non-low row.
- `first_seen` is when this build first saw the item, not the article date.
- `state=confirmed` requires at least one live confirmation (move, volume or
  breadth); otherwise use `scheduled` or `breaking`.
- No investment advice text.

## Frontend API

`src/api/catalysts.ts` exports:

```ts
export type CatalystScore = "high" | "medium" | "low";
export type CatalystState = "scheduled" | "breaking" | "confirmed" | "fading";
export interface CatalystRow { /* mirrors backend snake_case, normalized */ }
export interface CatalystToday { /* mirrors backend */ }
export function fetchCatalystsToday(signal?: AbortSignal): Promise<CatalystToday>;
```

`src/state/catalystStore.ts` exports:

```ts
export interface CatalystStore {
  data: Accessor<CatalystToday | null>;
  loading: Accessor<boolean>;
  error: Accessor<string | null>;
  refresh: () => void;
}
export function useCatalystToday(): CatalystStore;
```

The store is shared by every Home Monitor consumer. Poll at most every 30s,
pause when `document.hidden`, and keep the last good payload while refreshing.
Only one request may be in flight.

## Panel

`src/components/window/panels/catalystRadar.tsx` exports:

```ts
export const CATALYST_RADAR_PANEL: DockPanelSpec;
```

- id: `catalyst.radar`
- title: `CATALYST RADAR`
- `requires: []`
- Uses `useCatalystToday()`; does not fetch directly.
- Uses `TanStackTable` with explicit per-column `meta.align`.
- Row click expands an inline detail (why now / confirmation / invalidates /
  sources). No modal.
- Empty, loading, error and stale states are explicit.

## Home integration

- `src/components/home/SessionPulseBar.tsx` — fixed bar between Home toolbar and
  the workspace. It reads the same catalyst store. No polling of its own.
- `src/components/home/HomeMonitorView.tsx` — fixed CSS grid, not draggable
  windows. It renders `catalyst.radar`, sector leaders, catalyst news, and a
  session checklist. The last three are presentation-only views of the same
  `useCatalystToday()` payload; no duplicate data fetching.
- `HomePage.tsx` gets a `Monitor | Desk` toggle. The existing Desk and saved
  window layouts remain untouched. Monitor is not persisted as window rects.

## Registration

- `src/components/window/panelRegistry.ts`: add `CATALYST_RADAR_PANEL` to
  `WINDOW_PANELS`.
- `src/pages/home/homePanels.ts`: add it to `HOME_PANELS` and add a
  `monitor` preset entry (geometry is for the Desk preset only; the fixed
  Monitor view is separate).

## Constraints

- One store/one poll; no per-panel 5s loops.
- Preserve nullptr/gaps; no zero-filled fabricated measurements.
- Palette only from `src/ui/palette.ts`; no hex literals.
- Table alignment per `TABLE_CHECKLIST.md`.
- Tests: targeted only; no full suite, no dev server, no git writes.
