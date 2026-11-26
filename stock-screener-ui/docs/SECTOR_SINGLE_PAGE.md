# Sector Analysis — single-page redesign

One scrollable page replaces the four-tab shell. All capabilities stay, stacked
in a fixed order; an in-page anchor rail replaces the tab bar.

## Composition

`SectorPage` owns one scrollport (`#sector-page`, `data-testid="sector-tab-content"`)
inside the bounded `sector-analysis-view` root. Children, in order:

1. **Overview** (`sector-section-overview`) — summary context bar (top sector,
   market breadth, weakest sector, dashboard view toggle, heatmap controls),
   the existing dashboard table/heatmap, alerts, interval movers and top gainers.
2. **Rotation** (`sector-section-rotation`) — existing `RotationTab`.
3. **Correlation** (`sector-section-correlation`) — existing `SectorCorrelationTab`.
4. **History** (`sector-section-history`) — existing lazy `SectorHistoryTab` chunk.

`<SectorSectionNav>` renders `<nav aria-label="Sector sections">` with four real
anchors (`#overview`, `#rotation`, `#correlation`, `#history`). The rail is
sticky under the toolbar, scrolls horizontally at 390 (never wraps into rows),
and marks the current section with `aria-current="location"`. Every section
wrapper has `tabindex="-1"` and `scroll-margin-top: 48px` so the sticky rail
never covers its heading.

## Lazy-mount rules

- Overview mounts on the initial render; sector performance is fetched once on
  mount and shared by all sections (market-switch and refresh keep their
  abort/supersede semantics). Hash navigation does not trigger a refetch.
- Rotation/Correlation/History start unmounted behind a lightweight
  `role="status"` skeleton (`sector-section-<id>-skeleton`; History keeps
  `sector-history-lazy-fallback`).
- An `IntersectionObserver` rooted on `#sector-page` (`rootMargin: 600px`)
  mounts a section as it approaches. The first user scroll also mounts the
  remaining sections, so the page works without `IntersectionObserver`.
- Anchor activation force-mounts its target *before* `scrollIntoView` and
  focuses the target with `preventScroll: true`. No keyboard trap.

## URL behaviour

- No `?tab=` state and no tab URL writes. Other query params (`market`, `dash`,
  rotation/correlation/history params) are preserved.
- On mount, a legacy `?tab=` is mapped (`dashboard→overview`, others unchanged),
  removed from the query string, and written as the hash. Unknown `tab` values
  and unknown hashes resolve to `#overview`.
- Anchor clicks push a hash; `hashchange`/`popstate` re-sync the active chip,
  remount the target and focus it.

## Responsive / visual acceptance

- 1600 and 390: no page-level horizontal overflow; the rail scrolls, sections
  stack, only the table keeps its own horizontal scroller.
- The 390 header wraps instead of clipping; Refresh stays visible (`shrink-0`).
  All three summary groups (top sector, breadth, weakest sector) are readable —
  the strip wraps into lines, with no `overflow-hidden`/mid-word ellipsis.
- Sparse/empty panels collapse to content height (bounded scroll areas with
  `max-h-*`), never reserve a large blank body.
- MOVE bars carry a numeric signed delta (`Δ +2.50%`) and the table header shows
  the `MOVE −3% · 0 · +3%` scale at both widths.
- The 390 summary name truncates with a full-value `title` instead of breaking
  a word mid-glyph.
- The history rotation chart is contained by its panel (explicit height,
  `overflow-hidden`, positioned EChart host) and cannot paint over the section
  heading or the rank heatmap. Quadrant labels sit beside the 50/50 crosshair,
  away from the month axis.
- The history "As of" date and the rank summary's current month are derived from
  the newest month with rank data in the payload, never from a stale metadata
  `as_of`.

## Tests / evidence plan

- `src/components/sector/SectorPage.test.tsx`: no tablist; four ordered section
  wrappers with `tabindex="-1"`; anchor hrefs/aria-current; legacy and unknown
  `?tab=` mapping; deep hash; force-mount + scroll + focus; first-scroll mount;
  one fetch per mount, market-switch abort; wrapped summary/clipped-header
  checks; collapsed panel bodies; MOVE scale.
- `src/components/sector/SectorTableComponent.test.tsx`: numeric MOVE delta.
- Run `npx vitest run src/components/sector src/pages/sector` and
  `bun run typecheck`.
- E2E/capture lane owns `tests/e2e/sector*.spec.ts` and refreshes the 1600/390
  screenshots after this change (tab-role locators must become anchor locators).
