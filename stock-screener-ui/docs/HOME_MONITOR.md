# Home Monitor

Home has two surfaces over the same data:

- **Desk** — the existing window manager. Free-form, draggable, saved per tab.
- **Monitor** — a fixed, glanceable layout for "what changed and what is on deck".
  It is not persisted as window rects and has no drag/resize affordances.

The `Monitor | Desk` toggle in the Home toolbar switches between them. Switching
does not modify saved Desk layouts, and Monitor ignores the saved window config.
The Desk's presets still work exactly as before.

Implementation contract: [HOME_MONITOR_CONTRACT.md](./HOME_MONITOR_CONTRACT.md).

## Fixed layout

Monitor is a CSS grid, top to bottom:

1. **Session pulse bar** — index levels/change, VIX, sector lead, and the counts
   of high/medium/low catalyst rows. It reads the shared catalyst store; it does
   not poll on its own.
2. **Catalyst radar** — `catalyst.radar`, the dense table of today's scheduled
   and breaking items, with an inline detail (why now / confirmation / what
   invalidates it / sources). Built on `TanStackTable`.
3. **Context column** — sector leaders and the catalyst-news list, both derived
   from the same payload as the radar. This is intentionally not the general
   News API: only headlines that produced a catalyst row appear here.
   The sector selector is populated from the live snapshot, not a hardcoded
   list; `MARKET` is the default and `Consumer Durables`, `Technology Services`,
   `Finance`, etc. are whatever the snapshot currently reports.
4. **Session checklist** — the operator's pass through the session, not an order
   queue.

The radar still mounts the registered `catalyst.radar` spec, so it is the same
panel on the Desk and in Monitor. The leader/news summaries are presentation-only
views of `useCatalystToday()`; no Monitor component fetches directly.

## Data contract

One endpoint, one store:

- `GET /api/catalysts/today?market=india` (bearer auth, same token as the app).
- `src/api/catalysts.ts` — typed fetch, normalizes snake_case into `CatalystRow`.
- `src/state/catalystStore.ts` — `useCatalystToday()` exposes `data`, `loading`,
  `error`, `refresh`. The store polls at most every 30s, pauses while
  `document.hidden`, keeps the last good payload while refreshing, and allows
  only one in-flight request.

A row carries `symbol`, `kind` (`news | event | positioning`), `headline`,
`source`/`source_url`, `first_seen`, `state`
(`scheduled | breaking | confirmed | fading`), `score`, `confidence`, optional
`move_pct`/`rel_volume`, and — for any non-low row — `reasons` plus
`invalidates`. `first_seen` is when this build first saw the item, not the
article date.

`counts` and `warnings` travel with the payload. `rows` may be empty.

## Sources and warnings

- A dead upstream is reported in `warnings` (for example
  `event_source_unavailable`) and named in the UI. It is never rendered as an
  empty-but-healthy result and never turns into a 500.
- An empty `rows` array means "nothing qualified"; a warning means "we could not
  check a source". The two states are shown differently on purpose.
- Confirmed state requires at least one live confirmation (move, volume or
  breadth). Without one the row stays `scheduled` or `breaking`.
- Missing measurements stay missing. Do not substitute `0` for an absent
  `move_pct`, `rel_volume` or `confidence`.

## Desk vs Monitor

| | Desk | Monitor |
|---|---|---|
| Layout | draggable windows, saved per tab | fixed grid, not persisted |
| Presets | Trading / Research / Macro / Monitor / Minimal | none |
| Entry | `Home → Desk` | `Home → Monitor` |
| Panel source | window registry | same specs, fixed cells |

The **Monitor** preset is a Desk layout, not the fixed view: it opens a new Desk
tab with `catalyst.radar` wide on the left, `market.heatmap` beneath it, and
`sector.heatmap` above `news.feed` on the right. Use it when you want the radar
back in a free-form desk; the fixed Monitor view stays one toggle away.

## Guardrail: monitor, not advice

Monitor is a monitor. It surfaces dated catalysts, live confirmation and the
levels that would invalidate a read. It does not size positions, does not emit
buy/sell language, and must not add recommendation text to a row, the pulse bar
or an empty state. Every claim on screen is traceable to a source and a time.
