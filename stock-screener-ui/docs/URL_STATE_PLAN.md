# URL state for the Screener tabs — audit and plan

> Status: **Option A implemented** (`src/components/screener/ScreenerPage.tsx`).
> Option B is specified, not built — it needs a signed-off route change.
> Evidence date: 2026-11-15, `@solidjs/router` **1.0.3**, branch `perf/ui-drag-and-audits`.

The Screener is the app's landing page (`<Route path="/" />` in `src/App.tsx:107`). Its
seven tabs are not routes — they are a `tab` query param on `/`. This document records
exactly what that scheme reads and writes, what it gets wrong, and the two ways out.

---

## 1. Current scheme

### 1.1 The param

`src/components/screener/ScreenerPage.tsx:167-168`

```ts
const [searchParams, setSearchParams] = useSearchParams();
const activeTab = createMemo(() => firstParam(searchParams.tab) || "dashboard");
```

- `tab` is the only param the page reads for routing. Absent `tab` = `dashboard`.
- Tab values (the `Tabs.Tab value=` props, `ScreenerPage.tsx:361-389`):
  `dashboard · screener · deepvalue · fno · market · correlation · config`
- `dashboard` is written as *no param at all* (`?tab=null`), so `/` means Dashboard.
- **`events` is documented as a tab** (`AGENTS.md:309`, `docs/event-radar.md:3`) but there is
  no `value="events"` tab and no `?tab=events` handler. `?tab=events` today silently renders
  Dashboard. That doc/route drift predates this audit; not fixed here (out of scope — the
  Event Radar panel is not mounted by `ScreenerPage` at all).

### 1.2 Every param written or read on `/`

| param | written by | read by | owner |
|---|---|---|---|
| `tab` | `ScreenerPage.tsx:230/232/256` (tab click, Compare) | `ScreenerPage.tsx:168` | `ScreenerPage` |
| `symbols` | `ScreenerPage.tsx:256` (Compare), `CorrelationTab.tsx:152` (Calculate) | `CorrelationTab.tsx:92,96` | **Correlation tab only** |
| `timeframe` | `ScreenerPage.tsx:257`, `CorrelationTab.tsx:155` | `CorrelationTab.tsx:97` | **Correlation tab only** |
| `period` | `ScreenerPage.tsx:257`, `CorrelationTab.tsx:156` | `CorrelationTab.tsx:98` | **Correlation tab only** |
| `screener` | `useScreenerState.ts:110-112` (`onScreenerChange`) | `ScreenerContainer.tsx:8` | Screener profile, orthogonal to tabs |
| `tab` (global read) | — | `api/index.ts:270` | auto-refresh gate |

Two non-router readers of the query string matter because they are invisible to the router:

- `src/api/index.ts:269-271` — the auto-refresh interval reads `window.location.search`,
  and **skips the refresh when `tab` is `config` or `correlation`**. This is a string match on
  the tab names, not a route check.
- `src/pages/chart/ChartView.tsx`, `src/components/sector/SectorPage2.tsx`,
  `src/pages/patterns/*`, `src/components/bots/BotsPage.tsx` all use **`tab` for their own
  purposes** (`/sector`: `dashboard|correlation|rotation`; `/patterns`: `watch|scan`;
  `/bots`: `list|status|performance`). `tab` is a per-route namespace by convention only.

### 1.3 How `setSearchParams` actually behaves

`@solidjs/router@1.0.3`, `node_modules/@solidjs/router/dist/routing.js:167-182`:

```js
const setSearchParams = (params, options) => {
    const to = untrack(() => { … return pathname + mergeSearchString(search, params) + hash; });
    navigate(to, { scroll: false, resolve: false, ...options });
};
```

and `node_modules/@solidjs/router/dist/utils.js:146-167`:

```js
export function mergeSearchString(search, params) {
    const merged = new URLSearchParams(search);
    Object.entries(params).forEach(([key, value]) => {
        if (value == null || value === "" || (value instanceof Array && !value.length)) merged.delete(key);
        else { … merged.set(key, String(value)); }
    });
    …
}
```

Three consequences that drive every defect below:

1. **It merges, it never replaces.** A key you do not mention survives. Deleting requires
   an explicit `null`.
2. **`options` is spread last and `replace` defaults to `false`**, so omitting it *pushes*.
   The page passed `{ replace: true }` on every call.
3. **The pathname is untouched.** The URL never identifies the page; `location.pathname`
   stays `/` for all seven tabs.

---

## 2. Defects

All line numbers are `git show HEAD:./src/components/screener/ScreenerPage.tsx`.

### D1 — Back never returns to the previous tab (severity: high)

`ScreenerPage.tsx:230,232` — `setSearchParams({ tab }, { replace: true })`.

Every tab click overwrites the current history entry. Sequence `screener → market → Back`
lands on whatever page the user was on *before* the Screener, not on `screener`. On the
landing page that is usually the login/auth transition, i.e. Back appears to do nothing or
dumps the user out. A tab strip is navigation; users expect Back to walk it.

### D2 — Params leak across tabs (severity: high)

`ScreenerPage.tsx:256-259` writes `symbols`, `timeframe`, `period` and then only ever writes
`tab` afterwards. Because `mergeSearchString` merges, after Compare
(`?tab=correlation&symbols=INFY,TCS&timeframe=daily&period=90`) every later tab keeps
`symbols`/`timeframe`/`period`:

```
/?tab=correlation&symbols=INFY,TCS&timeframe=daily&period=90   ← Compare
/?tab=market&symbols=INFY,TCS&timeframe=daily&period=90        ← Market tab, stale params
/?tab=config&symbols=INFY,TCS&timeframe=daily&period=90        ← Config tab, stale params
```

`CorrelationTab.tsx:152` has the same problem in the other direction: pressing Calculate
writes `symbols/timeframe/period` but the tab-change path never removes them.

User-visible harm: a shared/bookmarked URL claims the user is filtering a correlation of
`INFY,TCS` while looking at the Market tab; and re-entering Correlation silently re-hydrates
an old selection from the URL (`CorrelationTab.tsx:95-113`) instead of the store.

### D3 — Same-tab clicks write history for nothing (severity: medium)

`ScreenerPage.tsx:228-234` has no "is this already the active tab" guard. Clicking the
already-active tab pushes/replaces a duplicate entry and re-runs the URL write. (With the old
`replace: true` it merely churned; with a push it would create a no-op Back step, which is why
the guard is required by the fix, not optional.)

### D4 — The URL does not identify the page (severity: medium, the reason Option B exists)

`/` + `?tab=fno` is indistinguishable from `/` to the layout: `AppLayout.tsx:48` computes
`activePath={location.pathname}`, so the "Screener" rail entry is highlighted for every tab —
correct today, but it also means the tab cannot be linked in the rail, cannot get its own
document title, and `Navigate href="/"` from the catch-all (`App.tsx:135`) always drops the
tab.

### D5 — One global param name, three meanings (severity: low, structural)

`tab` also routes `/sector`, `/patterns` and `/bots`. Nothing collides today (different
pathnames), but any code that reads `?tab=` without checking the pathname inherits a
semantic mismatch. `api/index.ts:270` already does exactly that: it is the *Screener's*
auto-refresh gate but reads whatever `tab` is on the URL.

### D6 — Prose/route drift for `events` (severity: low, documentation)

`docs/event-radar.md:3` and `AGENTS.md:309` advertise `/?tab=events`; no tab exists. Recorded
here rather than fixed, because the Event Radar panel is not mounted by `ScreenerPage`.

---

## 3. Option A — keep query params, fix history and param hygiene

**Shape:** `tab` stays a query param on `/`. Tab changes push history; params owned by a tab
are deleted when leaving it; a click on the active tab writes nothing.

Implemented in `src/components/screener/ScreenerPage.tsx`:

```ts
const TAB_OWNED_PARAMS: Readonly<Record<string, readonly string[]>> = {
  correlation: ["symbols", "timeframe", "period"],
};

function tabParamValue(tab: string): string | null {
  return tab === "dashboard" ? null : tab;
}

const writeTab = (tab: string, extra?: Record<string, string>) => {
  const next: Record<string, string | null> = { tab: tabParamValue(tab) };
  for (const [owner, keys] of Object.entries(TAB_OWNED_PARAMS)) {
    if (owner === tab) continue;
    for (const key of keys) next[key] = null;   // null deletes in mergeSearchString
  }
  Object.assign(next, extra);
  setSearchParams(next);                        // no `replace` → pushes
};

const setActiveTab = (tab: string) => {
  if (tab === activeTab()) return;
  writeTab(tab);
};
```

`handleCompare` now writes through the same helper so the Compare jump pushes history and
gets identical cleanup.

**Cost:** ~30 lines in one file, zero route changes, zero nav changes.
**Kept:** every `?tab=…` deep link, every tab value, `screener` and any other unowned param.

**Residual limits:** D4 and D5 remain (the URL still does not identify the page; `tab` still
means three things). Neither is a correctness bug today.

---

## 4. Option B — path-based tabs

**Shape:**

```
/screener              → redirect to /screener/dashboard
/screener/dashboard
/screener/screener
/screener/deepvalue
/screener/fno
/screener/market
/screener/correlation
/screener/config
/                      → <Navigate href="/screener/dashboard" />
```

`ScreenerPage` would read `useParams().tab` instead of `searchParams.tab`; `screener`,
`symbols`, `timeframe` and `period` stay as query params (they are filters, not locations).
This is the correct long-term shape: `tab` stops being overloaded, the rail can link a tab,
and `document.title` becomes derivable from the route.

**Exactly what B breaks — verified, not estimated:**

| # | Surface | File(s) | What breaks | Fix cost |
|---|---|---|---|---|
| B1 | Route table | `src/App.tsx:107` (`<Route path="/" component={ScreenerContainer} />`) | `/` must become a `<Navigate>`, plus a `/screener/:tab?` route | 2 routes |
| B2 | Rail link + active state | `src/components/layout/NavbarNested.tsx:33` (`link: "/"`); `AppLayout.tsx:48` (`activePath={location.pathname}`) | The Screener entry no longer resolves and `activePath === "/"` is never true, so the rail icon loses its highlight on every Screener tab | prefix match, or point the link at `/screener/dashboard` |
| B3 | Catch-all redirect | `src/App.tsx:135` `<Navigate href="/" />` | Land on `/` → `/screener/dashboard` — must not double-redirect | 1 line |
| B4 | **Auto-refresh gate** | `src/api/index.ts:269-271` reads `window.location.search` for `tab` | Silently stops skipping refresh on the Config/Correlation tabs: the interval starts hammering the screener API while the user is editing config. `pathname` must be read instead | 1 small function |
| B5 | E2E deep links | 43 `?tab=` URLs in 10 files: `tests/e2e/{app,buyer-interest,deep-value,market-screener,screener-interactions,screener-section-labels,screener,screener-url-params,sorting}.spec.ts` + `tests/e2e/helpers/flowsB.ts` | Every `page.goto("/?tab=…")` lands on Dashboard (the tab param would be unread) | mechanical rewrite, 43 sites |
| B6 | E2E `toHaveURL` assertions | `screener-url-params.spec.ts:33,42,55` | Asserts `screener=` survives "across tab switches" — still true under B, but the surrounding `goto` URLs must change | bundled with B5 |
| B7 | E2E back/forward | `tests/e2e/navigation-v2.spec.ts:228-252` | `waitForURL("**/")` after `goBack` from `/strategies` — under B the Screener URL is `/screener/…`, so the wildcard `**/` assertion needs to become `/screener` | 2 assertions |
| B8 | Unit test router mocks | `ScreenerPage.test.tsx` (mocks `useSearchParams` only); `ScreenerContainer.test.tsx` (mocks `useSearchParams`); `src/api/index.test.ts:269-285` (sets `window.location.search` per test) | Every one needs a `useParams`/pathname adapter; `api/index.test.ts` asserts the *old* gating mechanism | ~3 test files |
| B9 | Documented deep links | `docs/event-radar.md:140`, `docs/market-screener.md:5,54,77`, `AGENTS.md:294,309`, `docs/DELETION_LOG.md:6`, `UI_RULES.md:52` | Prose points at `/?tab=…`, some to tabs that do not exist (D6) | docs pass |
| B10 | Other `?tab=` deep links in the wild | bookmarks, issue links, any external tooling | `/` would still work via redirect, but `/?tab=market` would land on Dashboard rather than Market | permanent `?tab=` compatibility redirect, if wanted |

**Not** broken by B: `screener`, and the Correlation filter params (they stay query params).
`/sector`, `/patterns`, `/bots` keep their own `tab` param — they are different pathnames, so
B5 (D5) is only *partially* resolved unless those pages are migrated too.

---

## 5. Recommendation

**Ship Option A now; keep Option B as the target shape.**

Reasoning:

- A removes the two defects that cost users something today (D1 Back, D2 param leak) with a
  ~30-line diff in one file and no route, nav, or test-URL churn.
- B's real prize is D4 (a URL that identifies the page). That is a genuine improvement, but
  its blast radius is B1-B10: a protected route table, a rail active-state that would silently
  lose its highlight (B2), an invisible auto-refresh regression (B4 — the worst of the set,
  because it spikes API load and no test covers it), 43 E2E URLs, and 8 prose links.
- Doing B *after* A is cheap: A's `writeTab` helper already isolates the tab-write, so
  swapping `setSearchParams({ tab })` for `navigate("/screener/" + tab)` is localised. Doing B
  *instead of* A would leave D1/D2 unfixed while the larger migration lands.

Gate for revisiting B: when a tab needs its own title, its own rail entry, or a link that
survives the catch-all redirect. At that point fix B4 first — it is a one-function change and
it is the only item on the list that silently damages production behaviour.

---

## 6. Implemented change (Option A)

File: `src/components/screener/ScreenerPage.tsx`

- `TAB_OWNED_PARAMS` + `tabParamValue` (module scope) — the ownership table and the
  `dashboard → no param` rule, named instead of inlined.
- `writeTab(tab, extra?)` — one `setSearchParams` call per tab change: pushes (no `replace`),
  deletes every foreign tab-owned param via `null`, and accepts Compare's extra params.
- `setActiveTab` — returns early when the tab is unchanged (D3).
- `handleCompare` — routes its write through `writeTab` so Compare pushes and is cleaned up
  the same way (D2).

Behaviour is unchanged for: tab values, `?tab=market` and all other deep links, `screener`,
unowned params, and the mount-on-first-visit panel logic.

Tests (`src/components/screener/ScreenerPage.test.tsx`) record every `setSearchParams` call,
so push-vs-replace is asserted rather than inferred:

| test | fails on old code |
|---|---|
| pushes a history entry on tab change so Back returns to the previous tab | yes |
| does not write the URL when the clicked tab is already active | yes |
| drops correlation-only params when leaving the correlation tab | yes |
| Compare pushes correlation params, which are dropped when leaving the tab | yes |
| keeps the screener profile param across tab changes | no (guards a regression) |
| deep links land on their tab without rewriting the URL | no (guards a regression) |
