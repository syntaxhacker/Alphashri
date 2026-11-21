# Movers merge — folding the Dashboard tab into Market

Status: **plan of record**. Four agents are implementing this in parallel; nothing here assumes
their code is final. Where a claim depends on in-flight work, the citation says
`worktree` and the statement is a *requirement or a defect*, not a description of shipped code.

Baseline commit for "current state": `7b7f3d43`. Working tree at time of writing contains
8 modified files + 1 new E2E spec (`git status --porcelain`), listed in § 9.

---

## 1. Goal + non-goals

### Goal

1. **One Market screen.** The Screener page has one tab that answers "what is the market doing
   right now", with three lenses on the same workspace:
   `Table` (snapshot grid + filters) · `Map` (treemap of the same rows) · `Movers` (the old
   Dashboard's section grid of gainers/losers/52W/unusual).
2. **Every view opens the chart in the in-flow dock**, never a route change on desktop:
   `dock.open(symbol)` for Table rows, Map tiles and Movers rows alike.
   `/chart/:symbol` remains the fallback below the dock's breakpoint (see § 3.4).
3. **Tabs are query params.** `?tab=` stays the tab namespace on `/screener`; the new
   `?view=` addresses the three Market lenses. No path segments (`/screener/movers` is out).
4. **No chart-view change.** `src/pages/chart/ChartView.tsx` and `SymbolDockProvider` are not
   modified in behaviour other than being *used* by one more row family.

### Non-goals (explicit, so a reviewer does not read them as omissions)

| Not doing | Why |
|---|---|
| Path-segment tabs (`/screener/:tab`) | `docs/URL_STATE_PLAN.md` § 1.3 shows the URL has no page identity today; changing it is a separate migration with 43 E2E deep links to rewrite (`URL_STATE_PLAN.md:223`) |
| Deleting Deep Value / F&O / Correlation / Config | They stay first-class tabs (`ScreenerPage.tsx:359-386`, worktree). The merge removes exactly one tab, Dashboard. |
| Moving scan drill-down ("Open scan") into the Market workspace | `handleOpenScan` still switches to the Screener tab (`ScreenerPage.tsx:274-283`). Deferred: it needs a profile-aware in-place screen, not a tab hop. |
| Merging the two backend endpoints | `/api/market/snapshot` and `/api/screener/dashboard` stay separate (§ 5). One endpoint would need a schema for "rows *and* qualified sections" that neither has today. |
| Touching `db/alphashri.db`, migrations, or the API routers | This change is frontend-only. |

---

## 2. Current state (verified)

### 2.1 Route

| Thing | Where | Note |
|---|---|---|
| `/screener` | `src/App.tsx:114` | `ScreenerContainer` |
| `/` | `src/App.tsx:43-46` | `RootRedirect` → `/screener` + **keeps** `location.search` |
| catch-all → `/screener` | `src/App.tsx:142` | |
| `/chart/:symbol?` | `src/App.tsx:141` | full-page chart, unchanged by this work |

There is no per-tab route. `ScreenerPage` is one component; the tab is read from `?tab=`
(`ScreenerPage.tsx:198`, worktree; HEAD `:188`).

### 2.2 Tab strip

HEAD (`7b7f3d43`) `ScreenerPage.tsx:368-396` renders seven tabs in this order:
`Dashboard · Screener · Deep Value · F&O · Market · Correlation · Config`
(`data-testid` = `tab-dashboard` … `tab-config`).

Worktree now renders six — `Screener · Deep Value · F&O · Market · Correlation · Config`
(`ScreenerPage.tsx:359-386`): the Dashboard entry is gone, and the remaining order is unchanged
except that Dashboard's slot is closed.

Two facts that make this a *merge*, not a rename:

- Dashboard is the **default** at HEAD: `activeTab = firstParam(searchParams.tab) || "dashboard"`
  (HEAD `:188`), and `tabParamValue` erases the default from the URL, so bare `/screener`
  means Dashboard (HEAD `:162-164`). The worktree inverts this to `|| "market"`
  (`:198`, `tabParamValue` at `:172-174`).
- Dashboard owns toolbar controls no other tab has: the universe select
  (`HEAD :344-353`), a "Last close" switch and a refresh button (`HEAD :403-427`). They die
  with the tab and must be re-homed or dropped deliberately (§ 3.2).

### 2.3 Dashboard data source

| Layer | File:line |
|---|---|
| Client | `src/api/screenerDashboard.ts:11` (`/api/screener/dashboard`), `:29-48` URL build |
| Options | `limit` default 8 / max 30, `min_market_cap_cr` default 500, `refresh` (`:14-18`) |
| Types | `src/types/screenerDashboard.ts:60-69` — `sections[] → panels[] → rows[]` + `qualify` |
| Backend | `api/screener_api/dashboard.py:48` (router), `:608-641` (`GET /dashboard`) |
| Sections | `:437-440` — `movers` (gainers, losers, near_52w_high, near_52w_low, most_active, turnover) and `unusual` (volume_surge, gap_up, gap_down, range_expansion) |
| Cache | `:55` 60 s TTL, keyed `universe|limit|mincap` (`:501-502`); prewarm loop `:539-605` |

### 2.4 Market data source

| Layer | File:line |
|---|---|
| Client | `src/api/marketScreener.ts:5` (`/api/market`), `:116-122` URL, `:221-231` fetch + map |
| Session cache | `:39-101` — sessionStorage, keyed by universe, 3 MB cap, instant first paint |
| Universes | `:103-108` — `all_equity`, `nifty500`, `nifty50`, `nse_fo` |
| Hook | `src/components/market/useMarketSnapshotSolid.ts:34-132` — 15 s timeout, 4 s warming hint |
| Backend | `api/market_screen/router.py:12-47`, `api/market_screen/snapshot.py:36` (`ALLOWED_UNIVERSES`), `:64-65` (60 s TTL, 4000 row cap) |

### 2.5 The behavioural split this plan removes

| View | Row click | Citation |
|---|---|---|
| Dashboard | `navigate('/chart/' + symbol)` — leaves the screen | `ScreenerPage.tsx:462-466` (HEAD) passes `props.onSymbolClick`; that is `useScreenerState.ts:119-121` |
| Market | `dock.open(symbol)` — in-flow chart | `MarketScreenerPanel.tsx:235-238` row, `:537-540` map tile, outlet `:555-557` (all HEAD; worktree: `:242-245`, `:568-572`, `:588-589`) |

Same page, same symbol, two different destinations. That inconsistency is the user-visible
reason for the merge: one Market screen must not have two chart contracts.

---

## 3. Target interaction model

### 3.1 One screen, one toolbar

```
/screener?tab=market&view=movers
┌──────────────────────────────────────────────────────────────────────────────┐
│ All NSE ▾   ⌕ search            LIVE  Stale  127 / 3,229   ⟳   [Table|Map|Movers] │  ← 46px band
├──────────────────────────────────────────────────────────────────────────────┤
│                                            │                                 │
│  Movers                                    │   ┌───────────────────────────┐ │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │   │  chart dock (in-flow)     │ │
│  │ Top     │ │ 52W high│ │ Most    │       │   │  symbol · LTP · patterns  │ │
│  │ gainers │ │ /low    │ │ active  │       │   │                           │ │
│  └─────────┘ └─────────┘ └─────────┘       │   │  opened by row / tile /   │ │
│  Unusual Activity                          │   │  movers row; no route     │ │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │   │  change                   │ │
│  │ Volume  │ │ Gap up  │ │ Range   │       │   └───────────────────────────┘ │
│  │ surge   │ │ /down   │ │ expand  │       │        ≥1400px only (§3.4)      │
│  └─────────┘ └─────────┘ └─────────┘       │                                 │
└──────────────────────────────────────────────────────────────────────────────┘

  view=table : [filter rail 240px] [snapshot grid]        [dock]
  view=map   : [filter rail 240px] [treemap]              [dock]
  view=movers: (rail hidden)       [section grid]         [dock]
```

Rules:

1. **One toolbar.** Universe select, search, feed badge, stale badge, result count, refresh and
   the `Table | Map | Movers` segmented control live in the Market band
   (`MarketScreenerPanel.tsx:302` toolbar, `:314` universe, `:334` mode badge, `:365` refresh,
   `:403` toggle — worktree). The Dashboard's own two toolbar rows are suppressed via
   `embedded` (`DashboardView.tsx:624` hides the as-of row; the search/customize/chip row at
   `:669` remains and must fold in — § 7 P3).
2. **Filter rail belongs to Table and Map only.** Movers is a *qualified section* view; a
   snapshot filter cannot express "within 5% of the 52W high". Rail hidden when
   `viewMode() === "movers"` (`MarketScreenerPanel.tsx:492`, worktree).
3. **Movers is a section grid, not a table.** `DashboardView` renders
   `dashboard-section-movers` / `dashboard-section-unusual` with 4-up cards
   (`DashboardView.tsx:745-772`). Do not convert it to `TanStackTable`: the shared table
   requires per-column `meta.align` and a single row shape; sections have per-panel metrics.
4. **Dock always right.** The `ChartDockOutlet` stays a sibling *outside* the view switch
   (`MarketScreenerPanel.tsx:589`, worktree) so switching views never unmounts the chart
   or its `setOutlet` registration (`ChartDockOutlet.tsx:8-11`).

### 3.2 What happens to the Dashboard-only controls

| Control | Decision |
|---|---|
| Universe select (Dashboard copy) | **Removed.** The Market select is the single universe control (`MarketScreenerPanel.tsx:305-314`, worktree); Movers inherits it (`:513`). |
| "Last close" switch | **Removed.** It was declared at HEAD `:406-414` and never bound to chart data — it only changed a tooltip. Dead config; delete rather than port. |
| Refresh button (Dashboard copy) | **Removed.** The Market toolbar refresh (`:365-380`) forwards to `useMarketSnapshotSolid.refresh`; per-view panes remount on `universe` change. Dashboard's `bypassCache` refresh stays reachable *inside* the panel only when not embedded (`DashboardView.tsx:561-566`). |
| `₹500 Cr+` min-mcap chip | **Kept** in the Movers pane (it filters the dashboard request, `min_market_cap_cr`). See § 5.2 — it must not be confused with the rail's `mcapMinCr`. |
| "Customize panels" menu | **Kept** (localStorage, `HIDDEN_PANELS_STORAGE_KEY`, `DashboardView.tsx:59`). |
| ⌘K search focus | **Kept**, but it targets `[data-testid="dashboard-search"]` globally (`DashboardView.tsx:499-514`); outside Movers it is a silent no-op. Move it inside the Movers pane or delete it (§ 8 j). |

### 3.3 Naming

- Tab value: `market` (unchanged).
- View values: `table | map | movers` — one enum, `MARKET_VIEW_OPTIONS`
  (`MarketMapView.tsx:12-17`, worktree) → `MarketViewMode`.
- `MarketView` in the shell (`ScreenerPage.tsx:31-37`, worktree) must be the *same* union. Two
  hand-written unions are a drift source; § 7 P0 requires the shell to import
  `MarketViewMode` from `MarketMapView.tsx` instead of redeclaring it. (Currently it
  redeclares: `MARKET_VIEWS` at `:32`, `parseMarketView` at `:35` — § 9 D3.)

### 3.4 Dock breakpoints (state them, do not discover them)

| Viewport | `dock.open(symbol)` does | Citation |
|---|---|---|
| ≥ 1400 px | Renders into the in-flow `ChartDockOutlet` column | `MarketScreenerPanel.tsx:588-589` (`isWide` at `:125`), `SymbolDockProvider.tsx:161-177` |
| 1200–1399 px | No outlet mounted → fixed right overlay, still no route change | `SymbolDockProvider.tsx:142-159` |
| < 1200 px | `navigate('/chart/:symbol')` | `SymbolDockProvider.tsx:107-114` |

"Every view opens the chart in the dock" therefore means **≥1200 px**. Below that the screen
already navigates today for Table rows; Movers must match, not invent a fourth behaviour.

---

## 4. URL contract

| URL | Renders |
|---|---|
| `/screener` | Market, `table` view (tab param omitted — Market is the default) |
| `/screener?view=map` | Market, treemap |
| `/screener?view=movers` | Market, Movers section grid |
| `/screener?view=table` | Market, table (legal but redundant — see decision D2) |
| `/screener?tab=screener` | Screener tab (unchanged) |
| `/screener?tab=dashboard` | **Redirect** → `/screener?tab=market&view=movers` |
| `/screener?tab=dashboard&view=map` | Redirect as above; the stale `view` is overwritten |

### 4.1 Write mechanics

`setSearchParams` **merges** and only deletes a key when passed `null`
(`docs/URL_STATE_PLAN.md:80-82`). Three writers:

| Write | Call | History |
|---|---|---|
| Tab change | `writeTab(tab)` → `setSearchParams(next)` — no `replace` (`ScreenerPage.tsx:259-267`) | **push** |
| View change | `setSearchParams({ view: v }, { replace: true })` (`ScreenerPage.tsx:488`, worktree) | **replace** |
| `?tab=dashboard` migration | `setSearchParams({ tab: "market", view: "movers" }, { replace: true })` (`:204-209`) | **replace** |
| Leaving Market | `writeTab` nulls `view` via `TAB_OWNED_PARAMS.market = ["view"]` (`:166-168`) | push (with the tab change) |

**Why view writes replace, tab writes push (decision D3).** A view is a *lens* on the same
workspace: Back from `movers` should return to the tab you came from (e.g. Screener), not walk
`Table → Map → Movers → Screener`. A tab is *navigation*: Back must walk it (this is the
regression `docs/URL_STATE_PLAN.md` § D1 fixed, and it is asserted — HEAD
`ScreenerPage.test.tsx:713-727`). The `?tab=dashboard` redirect must also replace, otherwise the
first Back lands on a tab that no longer exists.

Consequence to state in the PR: **there is no history entry per view**. A user who deep-links
`?view=movers`, clicks Table, then presses Back leaves the Market screen. Accepted.

### 4.2 Normalisation requirements (not yet met in the worktree)

| Case | Required | Today |
|---|---|---|
| `?view=table` | Should not be written at all (table is the default). `onViewChange("table")` must write `{ view: null }`. | `:488` writes `view=table` — D2 below |
| `?view=bogus` | Render table **and** normalise the URL to no `view` | `parseMarketView` renders table but leaves `view=bogus` in the URL (`:35-37`) |
| `?tab=dashboard` | One-shot redirect; must not loop | effect returns early when tab ≠ dashboard (`:206-209`) — OK |

---

## 5. Data plan

Both endpoints stay. They answer different questions and must not be conflated.

| | `/api/market/snapshot` | `/api/screener/dashboard` |
|---|---|---|
| Answer | "every row in the universe, filterable" | "the top N names that match a *qualified* condition" |
| Row shape | `MarketRow` — 24 numeric/tag fields (`src/types/marketScreener.ts:7-41`) | `ScreenerDashboardRow` — price, change, sub-metric, spark, a few extras (`src/types/screenerDashboard.ts:15-44`) |
| Row count | up to 4000 (`snapshot.py:65`) | 8 per panel by default, 30 max (`dashboard.py:611`) |
| Extra per panel | — | `qualify` = how many names in the filtered universe meet the rule (`dashboard.py:413-419`) |
| Cache | 60 s + disk stale snapshot (`snapshot.py:64-70`) | 60 s in-process + prewarm (`dashboard.py:55`, `:539-605`) |
| Universe set | `ALLOWED_UNIVERSES` = `all_equity, nifty50, nifty500, nse_fo` (`snapshot.py:36`) | any id accepted by `chart_patterns.universes.get_universe` (`dashboard.py:625-627`) |

### 5.1 Universe mapping

`chart_patterns/universes.py:116-131` resolves exactly: `all_equity`, `nse_fo`, `indices`, and
every key of `CONSTITUENTS` — `nifty50`, `nifty100`, `nifty200`, `nifty500`
(`constituents.py:18-23`). Therefore **all four Market universes are valid dashboard
universes** (`all_equity`, `nifty500`, `nifty50`, `nse_fo`), which is what makes a single
universe control possible. `indices`/`nifty100`/`nifty200` are dashboard-legal but not offered
by the Market select; do not add them in this change.

**Verified defect to fix in this merge (D4).** The Dashboard's own universe list used
`{ value: "NSE_EQ", label: "All NSE" }` (`ScreenerPage.tsx:105`, worktree). `get_universe`
lowercases to `nse_eq`, which is neither `all_equity` nor a `CONSTITUENTS` key → `ValueError`
→ `dashboard.py:640-641` swallows it and returns `{sections: []}`. The old "All NSE" option was
therefore a **silently empty dashboard** (same fail-soft path as
`tests/test_screener_dashboard.py:425-434`). The Market select's `all_equity` is the correct id.

### 5.2 Min-market-cap chip vs the rail's mcap filter

| Control | Scope | Effect |
|---|---|---|
| Movers `₹500 Cr+` chip (`DashboardView.tsx:703-713`) | **Server-side** request param `min_market_cap_cr` (`dashboard.py:612`, applied `:630-635`) | Drops sub-₹500 Cr names before the panels are built — so `qualify` counts exclude them too |
| Table/Map rail "MCap" range (`marketFilters.ts:245-246`, `:154`) | **Client-side** filter on the already-fetched snapshot | Does not change any backend count |

They must stay separate: turning the chip off refetches with `min_market_cap_cr=0`
(`DashboardView.tsx:706-708`), which is a network call; the rail filter is instant. Do **not**
wire the chip to the rail state.

### 5.3 Known divergence between "qualified" sections and the raw snapshot

State this in the UI copy or accept it — but do not try to reconcile it:

1. **Different scans, different frames.** Movers builds from one TV scan capped at 3000 rows
   (`dashboard.py:59`) filtered to the universe (`:627-629`) and the mcap floor (`:630-635`).
   Table/Map come from a separate scan with a different column set (`snapshot.py:38-62`), a
   different cache and up to 4000 rows.
2. **`qualify` is a whole-set count; `rows` is top-N.** "27 qualify" + 8 visible rows is not a
   truncation bug — it is `len(picks)` vs `limit` (`dashboard.py:283-284`, `:413-419`).
   `DashboardView` shows a "Show more" that refetches at limit 30 (`DashboardView.tsx:489`,
   `:281`); the remaining 20% is unreachable by design until the backend grows a cursor.
3. **Timing.** A symbol can appear in Movers with `+3.1%` and in the Table with `+2.9%` inside
   the same minute: the two caches expire independently. Do not "fix" the number; label the
   panes by their own `as_of`.
4. **Field coverage.** Movers rows have no `pos_52w`, `cap_tier`, `adx`, `sma*`; Table rows have
   no `spark`, no `sub_label`, no `qualify`. A row cannot be handed from one pane to the other
   without a refetch — which is exactly why the dock takes a *symbol*, not a row.

### 5.4 Request budget (per Market visit)

| Action | Requests |
|---|---|
| Open Market (table) | 1 × `/api/market/snapshot` |
| Switch to Map | 0 (same rows, client-side) |
| Switch to Movers | 1 × `/api/screener/dashboard` (cached server-side 60 s) |
| Change universe in Table | 1 × snapshot |
| Change universe in Movers | 1 × dashboard |
| Toggle `₹500 Cr+` | 1 × dashboard |
| Row click (any view) | 0 (dock fetches candles, not these endpoints) |

The dashboard chunk must be lazily imported by the Market panel, not statically — the
Screener shell deliberately keeps DashboardView out of the boot chunk
(HEAD `ScreenerPage.tsx:13-18`). The worktree imports it statically in
`MarketScreenerPanel.tsx:47`; § 7 P2 requires `lazy()` there instead.

---

## 6. Component contracts

### 6.1 `DashboardView` (`src/components/screener/DashboardView.tsx`) — owner: Dashboard agent

```ts
export interface DashboardViewProps {
  universe?: string;                          // dashboard universe id (see §5.1)
  onOpenSymbol?: (symbol: string) => void;    // MUST route to dock.open at the call site
  onOpenScan?: (panelId: string) => void;     // still switches to the Screener tab
  embedded?: boolean;                         // host owns as-of + refresh chrome
}
```

Rules:

- `embedded` hides only the as-of/Refresh row (`:624-668`). It must **not** hide the
  search/customize/chip row (`:669-714`) — that row is the pane's own toolbar.
- The component never imports the dock and never navigates. It calls `onOpenSymbol` and lets the
  host decide (`symbolRowProps`, `symbolRowProps.ts:19-35`).
- Keep the row contract: `role="button"`, `tabIndex=0`, Enter/Space activate, and the
  expand-details control stops propagation (`DashboardView.tsx:420-434`).
- `dashboardRowMcapCr` treats `market_cap` as ₹ **crore** and renders `mcap * 1e7`
  (`DashboardView.tsx:99-101`, `:220`). The backend sends `market_cap_basic`, which is rupees.
  This is a live unit bug (inferred magnitude: 10⁷× too large) — fix it in `DashboardView` or in
  `dashboard.py:188` in the same PR, not silently in a later one.

### 6.2 `MarketScreenerPanel` (`src/components/market/MarketScreenerPanel.tsx`) — owner: Market agent

```ts
export interface MarketScreenerPanelProps {
  initialView?: MarketViewMode;               // read once at mount (§6.4)
  onViewChange?: (view: MarketViewMode) => void;
  onOpenScan?: (panelId: string) => void;     // forwarded to DashboardView
}
```

Rules:

- View state is a local signal seeded from `initialView`
  (`MarketScreenerPanel.tsx:121`, worktree); every change calls `props.onViewChange` from the
  toggle handler only (`:403-408`) — one path, no effect mirroring the parent.
- All three views call the *same* `handleRowClick`/`openSymbol`, which sets
  `selectedSymbol` + `dock.open` (`:242-245`, and the Movers branch `:514-518`).
- Toolbar hides search, count, rail toggle and Reset in Movers (`:316`, `:353`, `:381`, `:410`,
  `:492`). Do not hide the view toggle, refresh or badges.
- The `ChartDockOutlet` stays outside the view branch (`:588-590`).
- The dashboard module is a `lazy()` import in this file, not static (see § 5.4).

### 6.3 `MarketViewMode` (`src/components/market/MarketMapView.tsx`)

```ts
export const MARKET_VIEW_OPTIONS = [
  { value: "table", label: "Table" },
  { value: "map", label: "Map" },
  { value: "movers", label: "Movers" },
] as const;
export type MarketViewMode = (typeof MARKET_VIEW_OPTIONS)[number]["value"];
```

Single source. The shell (`ScreenerPage.tsx`) must import this type; it must not redeclare
`MARKET_VIEWS` (§ 3.3).

### 6.4 Ownership + mount semantics

| File | Owner | Contract |
|---|---|---|
| `src/components/screener/DashboardView.tsx` | Dashboard agent | add `embedded`; never navigate |
| `src/components/screener/DashboardView.test.tsx` | Dashboard agent | `describe("DashboardView embedded")` (`:565-599`) |
| `src/components/market/MarketScreenerPanel.tsx` | Market agent | props § 6.2; Movers branch; rail/search gating |
| `src/components/market/MarketScreenerPanel.test.tsx` | Market agent | `describe("MarketScreenerPanel — Movers view")` (`:279-309`) |
| `src/components/market/MarketMapView.tsx` | Market agent | `MARKET_VIEW_OPTIONS` += `movers` (`:12-17`) |
| `src/pages/market/MarketScreenerPage.tsx` | Market agent | forwards `MarketScreenerPanelProps` (must stay a spread) |
| `src/components/screener/ScreenerPage.tsx` | Shell agent | tab default, `?view=` read/write, redirect, drop Dashboard tab/panel |
| `src/components/screener/ScreenerPage.test.tsx` | Shell agent | URL contract tests § 7 |
| `tests/mocks/apiResponses.ts` | E2E agent | `mockDashboardResponse` + `screener/dashboard` route |
| `tests/e2e/movers-view.spec.ts` | E2E agent | 4 specs (exists in worktree) |

`initialView` is **read once**: `createSignal(props.initialView ?? "table")`
(`:121`). The panel stays mounted while the Market tab is active (`<Show>` at
`ScreenerPage.tsx:485`), so a `?view=` change that does not unmount the panel will not be
observed. Since every view write uses `replace` and leaving the tab nulls `view`, the only
externally-visible path is a fresh mount or a deep link — acceptable. Write it into the
component's JSDoc so the next agent does not "fix" it with an effect loop.

---

## 7. Phases, acceptance criteria, test matrix

Every phase must leave `bun run lint` clean and its targeted tests green. **No phase runs the
full suite** (AGENTS.md: local = touched files only).

### P0 — Shell URL contract

Do: default tab `market`; `?view=` parse (`table|map|movers`, default table); redirect
`?tab=dashboard` → `?tab=market&view=movers` with `replace: true`; `TAB_OWNED_PARAMS.market =
["view"]`; remove the Dashboard tab entry and the Dashboard panel `<div>`; import
`MarketViewMode` from `MarketMapView` instead of a local union; forward
`initialView`/`onViewChange`/`onOpenScan`.

State of the tree against this phase: all of it is drafted
(`ScreenerPage.tsx:32-50`, `:166-168`, `:198-209`, `:486-490`), except the union import
(§ 9 D3).

Accept:

- Bare `/screener` renders the Market panel and writes **no** params (`paramWrites` length 0).
- `?tab=dashboard` ends at `tab=market&view=movers`, exactly one `paramWrites` entry, with
  `options.replace === true`.
- Leaving Market (click Screener) removes `view`.
- `tab-dashboard` and `dashboard-panel` test ids are absent from the DOM.
- Panel forwards `?view=movers` (assert via the `MarketScreenerPage` prop capture).

Tests: `npx vitest run src/components/screener/ScreenerPage.test.tsx`
("opens Market on a bare route without writing a tab param", "redirects ?tab=dashboard to the
Market movers view", "forwards ?view= to the Market panel", "defaults the Market panel to the
table view when ?view= is absent", "writes ?view= when the Market panel changes view", "drops
the market view param when leaving the Market tab" — `:580-697`).

### P1 — Panel view wiring

Do: `initialView`/`onViewChange` props (drafted: `MarketScreenerPanel.tsx:109-112`, seeded at
`:121`); forward them from `MarketScreenerPage` (now done — see § 9 D1); normalise `table` → no
`view` (decision D2) and reject unknown values (D5), writing the normalised value back.

Accept: `initialView="movers"` mounts in Movers; clicking `Table` from Movers calls
`onViewChange("table")`; the shell writes `view: null` for table; `?view=bogus` renders table
*and* the URL drops `view` after the first normalisation.

Tests: `src/components/market/MarketScreenerPanel.test.tsx` + the two new shell cases
(`?view=bogus`, `?view=table`).

### P2 — Movers pane chrome + dock + lazy chunk

Do: hide search / result count / rail toggle / Reset in Movers; keep refresh + badges + toggle;
`DashboardView embedded` inside a scroll container; `lazy()` import of `DashboardView`; ensure
the dock outlet is outside the branch; unify row activation to `dock.open`.

Accept:

- In Movers: `market-search`, `market-filter-rail`, `market-result-count`, `market-reset`
  absent; `market-mode-badge`, `market-refresh`, `market-view-toggle` present.
- Switching Table → Movers → Table keeps `chart-dock-outlet` mounted (assert node identity or
  that `symbol-dock` survives the switch with a symbol open).
- Row click in Movers renders `symbol-dock` and the URL stays on the same path/query.
- Market chunk does not import `DashboardView` eagerly (assert the dynamic import in a unit
  test by mocking the module and checking it is not evaluated before Movers is opened).

Tests: `src/components/market/MarketScreenerPanel.test.tsx`,
`src/components/screener/DashboardView.test.tsx` (embedded), plus a dock-spy unit test.

### P3 — Universe + min-mcap + chrome height

Do: delete `DASHBOARD_UNIVERSES` / `DEFAULT_DASHBOARD_UNIVERSE` and the now-unused
`universe`/`onUniverseChange` props on `ScreenerPage` (and their plumbing in
`ScreenerContainer.tsx:20,48-49`), or keep them with a *reader*; fold the Movers
search/customize/chip row into the Market toolbar or drop the redundant section-header row
(21 px, `SPACING_AUDIT.md:82`); fix the `market_cap` unit bug (§ 6.1).

Accept:

- No exported constant in `src/**` that has only its declaration as a reader
  (SUBAGENT_RULES § 8, "dead config").
- The universe value sent to `/api/screener/dashboard` is one of
  `all_equity|nifty50|nifty500|nse_fo` — never `NSE_EQ` (unit test on the request URL).
- **Measured** chrome: `getBoundingClientRect().top` of the first Movers card
  − `.top` of `screener-content`, reported before/after in the commit message. Target ≤ 96 px
  (SPACING_AUDIT's budget); today's Dashboard equivalent is 151 px (`SPACING_AUDIT.md:73-87`,
  which already includes 56 px of page chrome), so the *pane-local* delta to beat is the
  embedded as-of row (24 px + 8 px gap) plus any folded toolbar row.

Tests: `ScreenerPage.test.tsx`, `ScreenerContainer.test.tsx`, `MarketScreenerPanel.test.tsx`.

### P4 — E2E + docs

Do: finish `tests/e2e/movers-view.spec.ts`; add the deep-link + Back cases in
`screener-url-params.spec.ts`; update `docs/market-screener.md` (it still says "default tab
unchanged", line 5, and "open ?tab=market", line 77) and `AGENTS.md` if it names the Dashboard
tab; add a line to `docs/MAP.md` pointing at Market's three views.

Accept — E2E names that must exist and pass:

| Spec | Test |
|---|---|
| `tests/e2e/movers-view.spec.ts` | "renders dashboard sections inside the Market workspace, hides filter rail and search, dock absent before click" |
| | "clicking a dashboard row opens the in-flow symbol dock, not /chart/:symbol" |
| | "tab=dashboard redirects to market view=movers" |
| | "the Dashboard tab button no longer exists" |
| | **(add)** "view=map deep link renders the treemap and writes no history entry" |
| | **(add)** "leaving Market drops the view param" |
| `tests/e2e/market-screener.spec.ts` | existing 7 specs must still pass with `SNAPSHOT_PATH = "/?tab=market"` (line 20) |
| `tests/e2e/screener-url-params.spec.ts` | existing 4 specs + **(add)** "?tab=dashboard lands on Movers with one history entry" |
| `tests/e2e/navigation-v2.spec.ts` | existing nav specs (bare `/` → screener) |

`market-screener.spec.ts:104` asserts the row count with `toHaveCount`, and
`controls.spec.ts:11-13` still clicks `tab-screener` from a bare `/` — both depend on Market
being the default tab, so P0 must land before P4 is judged.

### Full matrix (unit + E2E, by concern)

| Concern | Unit | E2E |
|---|---|---|
| Default tab is Market | `ScreenerPage.test.tsx:580` "opens Market on a bare route without writing a tab param" | `movers-view` "the Dashboard tab button no longer exists" |
| Migration redirect | `:592` "redirects ?tab=dashboard to the Market movers view" | "tab=dashboard redirects to market view=movers" |
| View forwarding | `:648` "forwards ?view= to the Market panel" / `:660` "defaults the Market panel to the table view when ?view= is absent" | "view=map deep link …" **(to add)** |
| View write-back | `:670` "writes ?view= when the Market panel changes view" (map only — add the `table → null` case) | — |
| Param hygiene | `:686` "drops the market view param when leaving the Market tab" | "leaving Market drops the view param" **(to add)** |
| Tab survives views | `:604` "switches from Market to Screener and back" | — |
| Panel-local view | `MarketScreenerPanel.test.tsx:293` "onViewChange callback receives movers" / `:302` "initialView=movers starts in Movers" | — |
| Chrome gating | `:280` "switching to Movers renders the dashboard and hides market search + filter rail" | same, via `toHaveCount(0)` |
| Embedded chrome | `DashboardView.test.tsx:577` "hides the as-of row and refresh button but keeps the toolbar" (+ `:591` the non-embedded counterpart) | "renders dashboard sections …" |
| Dock, not route | dock-spy unit test **(to add)** | "clicking a dashboard row opens the in-flow symbol dock, not /chart/:symbol" |
| Scan drill-down | `ScreenerPage.test.tsx:862` "onOpenScan for near_52w switches profile and opens the Screener tab" + `:886` the gainers variant | — |
| History semantics | `:758` "pushes a history entry on tab change so Back returns to the previous tab" | "?tab=dashboard lands on Movers with one history entry" **(to add)** |
| Min-mcap chip | `DashboardView.test.tsx:515` "liquidity chip toggles min market-cap and refetches" | — |
| Universe id | **(to add)** request URL never carries `NSE_EQ` | — |
| Chrome budget | `ScreenerPage.test.tsx:922` "fits the tab strip and toolbar inside the 96px chrome budget" (declared-frame proxy, not a measurement) | — |

Guards that must stay green (SUBAGENT_RULES § 8): `style-keys`, `no-props-destructure`,
`numeric-typography`, `table-structure`, `ui-guard`, `design-scale`, `theme-single-source`,
`inputs.w-h`.

---

## 8. Risks and open questions

| # | Risk | Resolution in this plan |
|---|---|---|
| a | **Two searches.** Market has `market-search` (snapshot, `MarketScreenerPanel.tsx:316-328`) and Dashboard has `dashboard-search` (row filter over loaded cards, `DashboardView.tsx:669-678`). Neither can express the other's query. | Show exactly one: the market search is hidden in Movers (`:316`), the dashboard search lives only in the Movers pane. State the difference in the placeholder ("Filter loaded panel rows"). **Not yet handled:** `search` is cleared only on universe change (`MarketScreenerPanel.tsx:133-140`), so typing in Table then switching to Movers hides the filter invisibly and Table returns still-filtered with no chip visible in Movers. Requirement: clear `search` (or keep it and surface the chip in Movers) on view change, with a unit assertion. |
| b | **`symbol-dock` on row click.** Today the outlet is only mounted ≥1400 px and only in Market. | Keep the outlet outside the view branch; document the three breakpoints (§ 3.4). Below 1200 px all three views navigate — the existing fallback, not a new one. |
| c | **Scan drill-down still switches tabs.** `onOpenScan` → `setActiveTab("screener")` (`ScreenerPage.tsx:274-283`), which also nulls `view`. | Accepted (non-goal). It must remain *one* write, so the user does not get a `view`-stale Screener URL. Test: after Open scan, `view` is absent. |
| d | **Dashboard chrome height.** Embedded removes 24 px (as-of row) but leaves the 26 px toolbar and the 21 px section header. | P3 folds them; acceptance is a measured number, not "looks fine". |
| e | **Movers rows have no selected-row highlight.** `getRowStyle` is table-only (`MarketScreenerPanel.tsx:281-284`); `DashboardView` has no `selected` prop. | Accept the inconsistency for v1, or lift it into an optional `selectedSymbol` prop on `DashboardView` in P2 if cheap. Do not fake it with a CSS class keyed on the dock's open symbol — that couples the pane to dock internals. |
| f | **⌘K is global and targets a Movers-only input.** | Move the listener inside the Movers branch (or gate on `viewMode()==="movers"`). |
| g | **Two independent caches** can show different prices for the same symbol. | Accepted and documented (§ 5.3). Never cross-check counts between panes. |
| h | **`?view=` on a non-Market tab** (`?tab=screener&view=movers`) is inert but present in the URL. | Normalise: `writeTab` already nulls it when leaving Market; add an assertion that a deep link with both renders Screener and the next tab write drops `view`. |
| i | **A stale bookmark to Dashboard's old universe** is impossible (universe was never in the URL), but a bookmark to `?tab=dashboard` is common. | Redirect is one-shot + replace; test both `?tab=dashboard` and `?tab=dashboard&view=map`. |
| j | **In-flight code may not be final.** | Every contract in § 6 states the requirement, not the current implementation. § 9 lists the exact divergences the integrator must resolve. |

### Decisions recorded (the five this plan commits to)

- **D1 — Market is the default tab; `tab=market` is omitted from the URL.** Bare `/screener`
  is the canonical Market/table URL.
- **D2 — `table` is the default view and is never written.** `onViewChange("table")` writes
  `view: null`; `?view=table` normalises away.
- **D3 — Tab changes push; view changes and the Dashboard migration replace.** Rationale in
  § 4.1 (§ "Back walks tabs, not lenses").
- **D4 — One universe control, using Market ids.** `all_equity | nifty50 | nifty500 | nse_fo`;
  `NSE_EQ` is retired (it silently returned an empty dashboard).
- **D5 — Unknown `view` values degrade to table *and* are rewritten out of the URL** on the
  first write, so a shared link cannot carry a value the UI does not honour.

---

## 9. In-flight divergences the integrator must resolve

Read from the working tree at the time of writing. These are **defects or unresolved choices**,
not a description of the target.

| # | File:line (worktree) | Problem | Severity |
|---|---|---|---|
| D1 | ~~`src/pages/market/MarketScreenerPage.tsx`~~ | **RESOLVED between drafts.** The page now imports `MarketScreenerPanelProps` and spreads props: `export function MarketScreenerPage(props: MarketScreenerPanelProps) { return <MarketScreenerPanel {...props} />; }`. Keep this shape; do not regress it to a no-arg pass-through. The shell's `as unknown as Component<MarketTabProps>` cast (`ScreenerPage.tsx:48-50`) is still the only thing that type-checks, so a future no-arg rewrite would compile and silently drop `?view=`. Add the assertion from § 7 P1 (panel receives `initialView`) as the guard. | closed → watch |
| D2 | `ScreenerPage.tsx:488` | `onViewChange` writes `view` unconditionally → URL carries `view=table`. Contradicts decision D2. The current test at `ScreenerPage.test.tsx:670-684` only asserts `view=map`. | high (URL contract) |
| D3 | `ScreenerPage.tsx:32-37` | `MARKET_VIEWS` / `MarketView` are a locally declared union instead of the imported `MarketViewMode`; `?view=bogus` renders table but stays in the URL. | medium (drift + decision D5) |
| D4 | `ScreenerPage.tsx:102-106` | `DASHBOARD_UNIVERSES` still exports `{ value: "NSE_EQ", label: "All NSE" }` and now has **no reader in `src/` except itself** (`grep` confirms: only the declaration). `NSE_EQ` is not a valid `get_universe` id → the old "All NSE" dashboard silently returned `{sections: []}`. | medium (dead config + wrong id) |
| D5 | `ScreenerPage.tsx:96-98` + `ScreenerContainer.tsx:20,48-49` | `universe`/`onUniverseChange` props are declared and passed but have **no reader** in `ScreenerPage.tsx` (`grep "props.universe"` → nothing). `DEFAULT_DASHBOARD_UNIVERSE` is read only by the container, which feeds props nobody reads. Either delete the pair or wire it to the Market panel's universe. | medium (dead wiring) |
| D6 | `MarketScreenerPanel.tsx:47` | `import { DashboardView }` is static → the dashboard module (sparkline, symbol avatar, sector api) enters the Market chunk, undoing the lazy split the shell was built around (HEAD `ScreenerPage.tsx:13-18`). | medium (perf) |
| D7 | `MarketScreenerPanel.tsx:288` | Table-only `getRowStyle` → Movers rows show no selected highlight even though `selectedSymbol` is set (`:514-517`). | low (UX inconsistency) |
| D8 | `DashboardView.tsx:99-101`, `:220` | `market_cap` is treated as ₹ **crore** and multiplied by 1e7 for display. The backend sends **rupees**: `snapshot.py:215` divides the same TV field by 1e7 to produce `market_cap_cr`, and the dashboard's own mcap floor multiplies by 1e7 before comparing (`dashboard.py:630-635`). The type comment "Market cap in ₹ crore" (`src/types/screenerDashboard.ts:40-41`) is the source of the misconception. Row-detail "Mkt cap" is therefore 10⁷× too large. Fix the type comment + the formatter, or convert server-side. | high (wrong number on screen) |
| D9 | `MarketScreenerPanel.test.tsx:279-309` | Movers tests assert `screener-dashboard` / rail absence but not the **dock** or the URL; the dock contract is asserted only in E2E. Acceptable, but add a dock-spy unit test per § 7. | low |
| D10 | `ScreenerPage.test.tsx:648-697` | The shell tests now cover initialView forwarding, view write-back and param drop. Missing: `?view=bogus` normalisation (decision D5), `?view=table` writing `null` (decision D2), and Movers-row docks-instead-of-navigates. | low |

---

## 10. Rollback

The change is **one view and two query params**; the data layer is untouched.

Revert order (each step is independently safe):

1. `src/components/screener/ScreenerPage.tsx` → restore HEAD: Dashboard tab entry
   (`HEAD :368-370`), Dashboard panel `<div>` (`HEAD :452-470`), `activeTab` default
   (`HEAD :188`), `tabParamValue` (`HEAD :162-164`), drop `market: ["view"]` from
   `TAB_OWNED_PARAMS` (`HEAD :157-159`), remove the redirect effect, restore the universe
   select and the Last-close/Refresh cluster (`HEAD :344-353`, `:403-427`) — or accept their
   loss and keep Dashboard without them (they were dead).
2. `src/pages/market/MarketScreenerPage.tsx` → drop the prop spread (`<MarketScreenerPanel />`)
   and the `MarketScreenerPanelProps` import. This alone freezes the panel in its local view
   state, which is why it is a separate, independently-safe step.
3. `MarketScreenerPanel.tsx` → props optional, `viewMode` signal defaults `"table"`, Movers
   branch removed, rail/search gating removed. Leaving the props in place is harmless: an
   unreferenced optional prop is inert.
4. `MarketMapView.tsx` → drop the `movers` option (the toggle then has two values again).
5. `DashboardView.tsx` → `embedded` can stay (it is additive and covered by its own tests);
   revert only if the chrome change caused a regression.
6. Tests/docs: delete `tests/e2e/movers-view.spec.ts`, drop the new shell/panel cases.

**What must NOT be needed in a rollback:** no DB migration, no API change, no cache flush, no
seed. `/api/screener/dashboard` and `/api/market/snapshot` keep serving their existing shapes,
so a rollback is a frontend-only revert and old `?tab=dashboard` links work again immediately
(the redirect stops existing, the tab returns).

**Post-rollback check:** bare `/screener` → Dashboard; `?tab=dashboard` renders it directly;
`?tab=market` renders the Market table; `?view=` is inert everywhere.
