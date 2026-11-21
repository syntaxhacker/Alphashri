# PLAN — a first-class Options component reachable from any symbol

> Status: **PLAN ONLY — no code changed.** Awaiting sign-off on the 6 open decisions in §10.
> Scope: one dockable option-chain surface (chain → legs → payoff → probability → quant), plus one
> shared `SymbolActions` cluster that puts an **Options** affordance beside chart / TradingView / copy
> on every screen that names a symbol.
> Explicitly out of scope: inspecting or reusing `src/components/options/**`. This design is fresh.

---

## 0. Why this shape

Today the chain lives at a route (`/options`, `src/pages/options/OptionsContainer.tsx`). A route is
the wrong home for it: the chain is a *question about the row you are looking at* ("what does the
market pay for 24 000 next week?"), and the app already answers exactly that class of question with
a right-hand dock — `SymbolDockProvider` pins a chart for whatever symbol you clicked, on any screen
(`src/components/common/SymbolDockProvider.tsx:37`). The options component should be a second
**mode of that dock**, not a second dock, and not a new page.

Two rules from `docs/UX_PRINCIPLES.md` drive every decision below:

- **§2 one surface per concept** — one chain, one leg store, one payoff. Not a route copy plus a dock copy.
- **§5 hover previews, click pins** — the Options icon opens on **click only**. A hover-triggered
  chain fetch would spend the Upstox budget on mouse paths.

---

## 1. Current-state audit (symbol surfaces only)

### 1.1 What exists

| Component | File | Renders | Gaps |
|---|---|---|---|
| `SymbolLink` | `src/components/common/SymbolLink.tsx` | text (TV link or text-button), optional copy, optional TV icon, optional chart icon | DOM order is **[text] [copy] [TV] [chart]** — chart is last; the four actions are opt-in flags so each caller invents its own subset |
| `ClickableSymbol` | `src/components/common/ClickableSymbol.tsx` | text button, `tvLink=false`, `showChart=false` | no chart icon, no copy, no TV |
| `ClickableSymbolSolid` | `src/components/paper-trading/ClickableSymbolSolid.tsx` | plain `<button>` with `window.location.assign("/chart/…")` | **full page reload**; no dock; no chart/copy/TV |
| `SymbolTvLink` | `src/components/patterns/SymbolTvLink.tsx` | TV text link only (`showChart=false`) | callers then add a *second* separate chart `<a>` (see `MembersDrawer.tsx:262`) |
| `symbolRowProps` | `src/components/common/symbolRowProps.ts` | keyboard activation for whole rows | applies to the row, not the actions |
| icons | `src/components/common/Icons.tsx` | `chart-candle`, `copy`, `external-link`, `check` | **no options/payoff glyph**; nav's Options entry uses `chart-area` (`NavbarNested.tsx:44`) |

Measured footprint: **14 files** render a symbol affordance, **10** `<SymbolLink>` call sites.

### 1.2 Where each screen stands (this is the migration list)

| Screen | File | Chart | TV | Copy | Notes |
|---|---|---|---|---|---|
| Screener table | `components/screener/ScreenerTable.tsx:155` | ✅ | text-only | ⚠️ duplicate — `SymbolLink` **and** a second `CopyButton` at `:174` | consolidate to one copy |
| F&O screener | `components/screener/fnoColumns.tsx:105` | ❌ `showChart={false}` | ✅ text | ✅ | an F&O screen with no chart icon |
| Market screener | `components/market/marketColumns.tsx:116` | ✅ | ✅ icon | ❌ | `tvIcon` adds a 4th slot |
| Deep Value | `components/value/valueColumns.tsx:86` | ✅ | ✅ text | ❌ | non-NSE rows must disable Options, not hide it |
| Patterns card | `components/patterns/PatternCard.tsx:169` | ✅ | ✅ text | ❌ | |
| Patterns list | `components/patterns/PatternListView.tsx:138` | ✅ | ✅ text | ❌ | |
| Patterns matrix | `components/patterns/PatternSymbolMatrix.tsx:129` | ✅ | ✅ text | ❌ | |
| Patterns watch | `components/patterns/WatchView.tsx:732` | ✅ | ✅ text | ❌ | |
| Members drawer | `components/common/MembersDrawer.tsx:252` | ⚠️ separate `<a>` at `:262` | ✅ | ❌ | two affordances for one concept |
| Paper positions | `components/paper-trading/PositionsHelpers.tsx:422` | ❌ | ❌ | ❌ | text click only |
| Paper history | `components/paper-trading/PaperHistoryTable.tsx:387` | ❌ | ❌ | ❌ | |
| Paper watchlist | `components/paper-trading/WatchlistScan.tsx:138` | ❌ | ❌ | ❌ | |
| Bots positions | `components/bots/BotHelpers.tsx:150,265` | ❌ | ❌ | ❌ | bare `<Text>` |
| Sector members | `components/sector/SectorTable.tsx:48` | ❌ | ❌ | ❌ | bare `<Text>` spans |
| Backtest results | `components/backtest/BacktestResultsTable.tsx:25` | ❌ | ❌ | ❌ | bare `<Text>` |
| News "stocks mentioned" | `components/news/ArticleDetail.tsx:244` | ✅ badge+icon | ❌ | ❌ | `onSymbolClick` only |

Understand the count honestly: **16 screens**, not "every screen in the app". Bots, sector and backtest
rows render a bare `<Text>` today; wiring them is part of P1 because leaving three tables behind is
how a "shared" component becomes a second component.

**Verdict:** the affordance set is inconsistent in 3 independent axes (which actions exist, their
order, and the DOM they sit in). Every screen that misses copy is a screen where the user re-types a
ticker; every screen that misses TV is a screen where the user leaves the app to look it up by hand.

### 1.3 The one shared component

```ts
// src/components/common/SymbolActions.tsx   (new; SymbolLink stays as the internal primitive)

export type SymbolAction = "chart" | "options" | "tv" | "copy";

export interface SymbolActionsProps {
  symbol: string;
  /** Exchange for TV symbol + Options eligibility. Default "NSE". */
  market?: string;
  /** Explicit TV symbol override (e.g. "NASDAQ:AAPL"). */
  tvSymbol?: string;
  /** Density. `table` = 18px hit targets, `card` = 20px, `chip` = 16px. */
  variant?: "table" | "card" | "chip";
  size?: "xs" | "sm" | "md";
  /**
   * Which actions to render. **A filter, not an order** — the surviving actions
   * always appear as chart → options → tv → copy. Default: all four.
   */
  show?: SymbolAction[];
  /** Host override for the chart (Patterns keeps its stepper dock). */
  onOpenChart?: (symbol: string) => void;
  /** Host override for options (default: the app dock). */
  onOpenOptions?: (symbol: string) => void;
  /** Force-disable with an explicit reason (non-F&O, non-NSE, F&O list not loaded). */
  disabled?: Partial<Record<SymbolAction, string>>;
  /** Text click behaviour: TV link (default) or a host handler. */
  onTextClick?: (symbol: string, e: MouseEvent) => void;
  /** Test-id prefix; defaults reproduce today's ids exactly. */
  testIdPrefix?: string;
  weight?: number;
  secondary?: JSX.Element;
  className?: string;
}
```

Visual order is **fixed**: `[symbol text] [chart] [options] [tv] [copy]`. There is deliberately no
`order` prop — an app where two tables disagree about where the copy button lives is an app where the
muscle memory does not transfer. `show` can only *remove* actions (a TV-only link, a chip with just a
chart), never permute them.

Migration note: today's order is `[copy][TV][chart]`. Flipping it moves the chart icon from trailing
to leading. **Keep the test ids** (`symbol-chart-<SYM>`, `symbol-copy-<SYM>`, and each caller's
`chartTestId`) so the existing assertions in `SymbolLink.test.tsx` and `ScreenerTable.tsx` do not
churn.

**Keyboard + hover rules**

| Concern | Rule |
|---|---|
| Focus order | natural DOM order = visual order; each action is a real `<button>`/`<a>` (never a `div` with `onClick`) |
| Activation | `Enter` and `Space` (`Space` prevented so the page never scrolls) |
| Tooltips | on hover **and** on `:focus-visible`; label carries the reason when disabled |
| Hover reveal | the cluster is `opacity-0` → `opacity-100` on row hover, but `:focus-visible` **forces** opacity 1 — `visibility:hidden`/`display:none` would make it unreachable by keyboard (see §4 keyboard parity) |
| Row interference | `event.stopPropagation()` on every action (preserves `SymbolLink`'s `stopPropagation ?? true`) |
| No hover side effects | hovering the Options icon fetches nothing; hover preview stays the symbol text's job (300 ms debounce owned by `SymbolDockProvider`) |
| Disabled | `aria-disabled="true"` + `tabIndex={0}` (focusable so the reason is readable), click is a no-op |

**Disabled-state copy (exact strings)**

| Case | Title / tooltip |
|---|---|
| Symbol has no listed F&O | `No listed options for RELIANCE` |
| Underlying not on NSE/BSE | `Options are NSE/BSE only` |
| F&O universe still loading | `Checking derivatives…` (transient; icon is enabled optimistically after 400 ms) |
| Broker token expired | icon enabled; the panel shows `Reconnect Upstox in Settings` (never disable a data affordance for an auth problem the user can fix) |

Eligibility is resolved **without a per-row request** — one session-scoped store
(`src/state/fnoUniverse.ts`) fed by `GET /api/options/fno-underlyings` (~220 symbols + index keys,
1 h TTL, ~6 KB). `chart_patterns/tags.py:71 fno_symbols()` and
`api/market_screen/snapshot.py:75` already compute the same membership server-side, so the endpoint
is a thin re-export, not new logic. Where a row already carries `fno` (`MarketRow.fno`,
`types/marketScreener.ts:39`) the store is not even consulted.

---

## 2. Data layer

### 2.1 Instrument-key resolution

```
symbol ─┬─ is index (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY) ──► NSE_INDEX|Nifty 50 …
        ├─ SENSEX / BANKEX ─────────────────────────────────► BSE_INDEX|SENSEX
        └─ equity ──► NSE_EQ|<ISIN> from the instruments map
```

What exists (`api/options.py`): `get_instrument_key()` (`:151`) hardcodes the 5 indices and resolves
stocks through `_stock_instrument_map()` (`:168`) built from
`../upstox_trader/config_and_utils/nse_instruments.json` (≈43 MB, 1 h TTL).

Three defects to fix in the new endpoint:

1. **Silent wrong-key fallback.** `:161` returns `NSE_INDEX|<symbol>` for an unknown stock. Upstox
   then answers `status:success, data:[]`, and an empty chain is indistinguishable from a dead market
   — the exact failure `get_expiries` documents at `:311`. Replace with `404 {code:"not_fno"}`.
2. **43 MB JSON parse on the event loop.** `get_instrument_key` is sync and called from async routes;
   a cold cache blocks the loop for the whole parse. Move to `asyncio.to_thread` and warm it in the
   lifespan.
3. **Unknown exchange.** `NSE_EQ` is assumed. Carry `exchange` through so the mapper never fabricates
   an NSE key for a BSE-only listing.

### 2.2 Endpoints (one new route, two reused)

| # | Route | Purpose | Cache |
|---|---|---|---|
| **E1 (new)** | `GET /api/options/underlying/{symbol}` | `{symbol, exchange, fno, instrument_key, spot, expiries:[{date, weekly, dte_days, lot_size, tick_size}], default_expiry, market_state}` | 300 s open / 6 h closed, keyed by symbol |
| E2 | `GET /api/options/chain/{symbol}?expiry=YYYY-MM-DD` | the chain (exists), upgraded: normalized DTO, `dte_years_exact`, `as_of`, `stale` | 10 s open / 300 s closed, keyed `(symbol, expiry)` |
| E3 | `GET /api/options/fno-underlyings` | the eligibility set | 1 h |

**Why E1 is one call and not three.** The chain payload's per-strike contract carries no `lot_size`
(verified against the documented `/v2/option/chain` shape), but the payoff, greeks aggregation and
POP **all need lots**. `lot_size` lives only in `/v2/option/contract`. Today's `/expiries/{symbol}`
already calls `/option/contract` and throws the lots away (`api/options.py:320`). E1 keeps them.
Result: **2 requests on first open** (E1 + E2), **1** afterwards.

`expiry_date` must always be sent as `YYYY-MM-DD`. Upstox also accepts relative keywords
(`current_week`, `next_month`, …), but a keyword resolved server-side and cached can disagree with
the label the client is showing. Reject keywords with `400` the way `_validate_expiry` (`:508`)
already does.

### 2.3 Caching, single-flight, budget

```
client  ──10 s poll (focused, visible)──►  E2  ──► in-process cache ──miss──► single-flight ──► Upstox
        ──30 s poll (background chains)──►      10 s open / 300 s closed
                                                 └── stale ≤ 120 s ⇒ serve stale + `stale:true`, refresh async
```

- **Key**: `(symbol, expiry, session_date)`. Including the session date is what prevents an expiry
  rollover at midnight from serving yesterday's frame as today's.
- **Single-flight**: one `asyncio.Lock` per `(symbol, expiry)` — ten concurrent tabs on NIFTY cost one
  upstream call. Concurrency ceiling `Semaphore(4)`; distinct-symbol frames capped at **15** (LRU,
  matching `CACHE_MAX_SYMBOLS` in `api/reports_api/options_report.py:82`).
- **Rate limiting**: every upstream call takes a token from `upstox_trader.rate_limiter`
  under the **`options` slice — 30/min** (global 50/s, 500/min; the four slices sum to 500).
  **That slice is not free.** `start_options_recorder_task` already runs in the lifespan
  (`api_server_fastapi.py:637`) and polls `SENSEX,RELIANCE` every 10 s
  (`options_recorder.py:70,85`), i.e. **≈ 12/min of the 30** is already spent before this
  component asks for anything. Available headroom: **≈ 18/min.**

  | Role | Interval | Calls/min |
  |---|---|---|
  | recorder baseline (existing, not ours) | 10 s × 2 symbols | 12 |
  | focused chain (visible, user is looking at it) | 10 s | 6 |
  | other open chains (max 4 more) | 30 s | 2 each → 8 |
  | E1 expiry/lot refresh (300 s TTL, ≤ 5 symbols) | — | ≤ 1 |
  | **total** | | **≤ 27 of 30** |

  The client caps open chains at **5** (1 focused + 4 background, LRU — the oldest stops
  polling first). The server returns `429 {retry_after}` after a 2 s token wait (pattern
  already in `options_report.py:96`). One chain is ≤ 6 upstream calls/min **regardless of
  user count**, because the cache is server-side. If the recorder is ever widened
  (`OPTIONS_RECORDER_SYMBOLS`), the dock's cadence must drop proportionally — the
  per-slice budget is the shared invariant, and a fan-out that starves the recorder
  creates tape gaps that cannot be backfilled.
- **Abort**: every client request gets an `AbortController` tied to `(symbol, expiry)`; closing the
  dock or switching expiry aborts and drops the in-flight response (`signal.aborted` guard before the
  store write). Closing the dock leaves **0** in-flight requests.
- **Market closed**: one fetch, then no polling. Header shows `MARKET CLOSED · as of 15:30 IST`, and
  `stale` is not shown as an error — a closed market's last print *is* the truth. Gate on
  `isMarketOpenNow()` (`src/state/holidays.ts`) for cash, plus derivatives to 15:40
  (`DERIVATIVES_CLOSE_MIN` in `src/utils/marketClock.ts:22`).

### 2.4 Nearest expiry, and the rollover rule

`nearest = first expiry with date ≥ today`, **except**:

```
today == expiry AND IST now ≥ 15:40  →  default = next expiry,
                                        today's stays in the list, labelled EXPIRED
```

Rationale: after the derivatives close on expiry day the contract no longer trades; defaulting to it
produces a dead chain with live-looking greeks. Expiries are always taken from the upstream listing —
never computed as "next Thursday" (`api/options.py:311` explains why: an invented expiry yields an
empty chain). Holidays are therefore free: the exchange's own shifted date is what we show.

On expiry day before 15:40 the header carries a `0-DTE` badge and the probability panel switches to
its `expiry-day` note (§5.6).

---

## 3. Component tree

New folder — **`src/components/optiondock/`**, deliberately not `src/components/options/`
(the constraint) and not `src/pages/` (it is not a route).

```
src/components/optiondock/
  OptionsDockBody.tsx        the dock's `options` mode content (lazy-loaded by the host)
  OptionsDockPanel.tsx       chrome: header strip, tab bar, legs strip, error/empty states
  OptionChainTable.tsx       thin wrapper over shared TanStackTable (no bespoke table)
  chainColumns.ts            column defs + explicit meta.align (TABLE_CHECKLIST)
  SummaryStrip.tsx           PCR · max pain · ±1σ · ATM IV · DTE · total OI
  LegBuilder.tsx             leg chips, add/remove, buy/sell, lots, premium
  PayoffChart.tsx            ECharts canvas, payoff at expiry + today curve
  ProbabilityPanel.tsx       lognormal density, POP, breakevens, E[P&L]
  GreeksPanel.tsx            net greeks + per-leg contribution
  OiProfile.tsx              horizontal OI bars by strike (CE left, PE right)
  analytics/SurfacePanel.tsx shipped: 2D ECharts heatmap (strike × expiry); + Smile/Term/Prob panels
  optionsDockStore.ts        createSubscriber store: chain frames, legs, selection
src/api/optionChain.ts       (new) typed client: E1/E2/E3 — does NOT touch upstoxOptions.ts
src/utils/optionsMath.ts     (new) pure: payoff, breakevens, lognormal POP, greeks aggregation
src/state/fnoUniverse.ts     (new) session eligibility set
src/components/common/SymbolActions.tsx  (new) §1.3
```

> Implementation note: the payoff canvas is shared — `PayoffChartCore` (`src/components/options-dock/PayoffChartCore.tsx`) is rendered by both `PayoffPanel` and the F&O screener row detail (`FnoRowDetail`), so the row detail reads the same four series, guides and four-cell footer.

There is **no second provider**. `SymbolDockProvider` (`components/common/SymbolDockProvider.tsx`)
gains a mode and lazily renders `OptionsDockBody` for it — the same 420–620 px right rail, the same
pin gesture, the same outlet, the same <1200 px fallback. Concretely:

```ts
// symbolDockContext.ts — additive, no breaking change
interface SymbolDockApi {
  open(symbol, mode?: "chart" | "options"): void;   // was open(symbol)
  mode: () => "chart" | "options";
  // …preview/endPreview/close/pinned/symbol/setOutlet unchanged
}
```

`SymbolActions` calls `dock.open(symbol, "options")`. Both modes share one pin state, so opening
options does not lose the chart's scroll position and vice versa.

Presentation by viewport:

| Viewport | Surface | Height | Chain columns |
|---|---|---|---|
| ≥ 1200 px | right rail, `width: clamp(420px, 36vw, 620px)`, `top: FIN_HEADER_H` | full | 9 CE + 1 strike + 9 PE = 19 |
| Expand (⤢) | full-screen overlay, chain full width, 39-col footer band (legs / payoff / prob / quant) | full | 11 CE + 1 strike + 11 PE = 23 |
| < 1200 px | **bottom sheet**, `height: 62vh`, `left: 0`, drag-to-dismiss, portal to body (same trick as `DeskDock` at `pages/report/DeskDock.tsx:109`) | 62vh | 6 (one side only under 640 px) |

Below 1200 px the chart dock currently navigates to `/chart/:symbol`. Options has no route to fall
back to — which is exactly why the sheet must exist rather than a redirect.

---

## 4. Wireframes

### 4.1 Dock — 480 px (76 columns)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ NIFTY ▾  26 MAR · 2d ▾   24 031.5  +0.42%       [⇱] [✕]                  │
├──────────────────────────────────────────────────────────────────────────┤
│ PCR 1.11 │ PAIN 24 000 │ ±1σ 245 │ IV 13.8 │ DTE 2 │ OI 9.18Cr           │
├──────────────────────────────────────────────────────────────────────────┤
│              CE              │   STRIKE   │              PE              │
│       OI     IV     Δ     LTP│            │     LTP     Δ     IV       OI│
├──────────────────────────────────────────────────────────────────────────┤
│      52L   13.8   .71   177.5│   23 900   │    46.0  -.29   13.8   1.41Cr│
│      70L   13.8   .63   144.0│   23 950   │    62.5  -.37   13.8   1.16Cr│
│      86L   13.8   .55   114.4│  24 000 ◀  │    82.9  -.45   13.8   1.02Cr│
│   1.02Cr   13.8   .47    89.0│   24 050   │   107.5  -.53   13.8      74L│
│   1.24Cr   13.8   .39    67.7│   24 100   │   136.2  -.61   13.8      51L│
│                                    ⋮                                     │
├──────────────────────────────────────────────────────────────────────────┤
│ LEGS                                 4 legs · net credit ₹3 536          │
│ [ S 24200 CE ×1  36.6 ✕ ]  [ B 24500 CE ×1   3.5 ✕ ]                     │
│ [ S 23800 PE ×1  23.1 ✕ ]  [ B 23500 PE ×1   1.8 ✕ ]     [+ leg]         │
├──────────────────────────────────────────────────────────────────────────┤
│ PAYOFF · 26 MAR                     │ PROBABILITY (flat vol 13.8%)       │
│        ┤    ╱──────────────╲        │   ▁▂▄▆█▇▅▃▂▁                       │
│      0 ┼──╱                  ╲──    │   POP 69.7%   (basket)             │
│        ┤╱                      ╲    │   BE 23 745 · 24 254               │
│       └─┬────┬────┬────┬────┬─      │   max +3 536 · −15 964             │
│       23.7k 23.9k 24.0k 24.2k 24.4k │   E[P&L] −13   ±1σ 245             │
└──────────────────────────────────────────────────────────────────────────┘
```

Fixture (used by every number above, and re-used as the §8.1 analytic case): NIFTY spot
`24 031.5`, expiry 2 calendar days, ATM IV `13.8 %` with a quadratic smile
`σ(K) = 13.8 + 0.60·m²` vol points where `m = ln(K/S)/0.02`, lot `65`. The basket is a
**short iron condor**: `S 24 200 CE @ 36.6`, `B 24 500 CE @ 3.5`, `S 23 800 PE @ 23.1`,
`B 23 500 PE @ 1.8`.
- credit `= (36.6 + 23.1 − 3.5 − 1.8) × 65 = ₹3 536`
- breakevens `23 745` / `24 254` (`= short strike ∓ net credit per share, 54.4 pts)`
- max profit `+3 536` (between the shorts) · max loss `−15 964` (`= (24 500 − 24 200 − 54.4) × 65`)
- `POP 69.7 %`, `E[P&L] −13` under flat 13.8 % — i.e. the basket is priced within one tick of
  flat-vol fair value, which is what a coherent model should produce (the smile is where the
  edge would be, and on this basket it is worth almost nothing).
- OI columns over the five visible strikes sum to `4.34 Cr` CE vs `4.84 Cr` PE ⇒ `PCR 1.11`, total
  `9.18 Cr`. Wall placement is deliberately realistic: puts pile up *below* spot, calls *above* it —
  a chain whose biggest CE OI sits at the lowest strike is a data error, not a wall.

Column budget at 480 px: the dock's inner width is 456 px. Each side gets `[OI 44][IV 34][Δ 30][LTP
48] = 156`, the strike column `64`, plus two 1 px rules ⇒ `156 + 64 + 156 + 2 = 378` px of content,
leaving 78 px of breathing room for the OI bar overlay and the ATM marker. Type is 10 px mono,
`tabular-nums` (guard: `src/test/numeric-typography.test.ts`). The ATM row is tinted via
`alpha(palette.PRIMARY, 0.08)` — never a raw hex.

### 4.2 Full screen (⤢) — 1440 px (98 columns)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ NIFTY  26 MAR 2026 · 2d · 0-DTE │ 24 031.5 +0.42% │ PCR 1.11 │ PAIN 24 000 │ ±1σ 245   [⤡] [✕] │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ PAYOFF │ SMILE │ TERM │ SURFACE │ PROB                       [expiry 26 MAR · 2d ▾] [⟳]       │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│                     CE                     │  STRIKE  │                   PE                   │
│     OI   ΔOI   VOL    IV    Δ     LTP      │          │    LTP    Δ    IV   VOL   ΔOI      OI  │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│    52L +1.1L  402k  13.8  .71   177.5      │  23 900  │   46.0 -.29  13.8  514k -0.8L  1.41Cr  │
│    70L +0.4L  366k  13.8  .63   144.0      │  23 950  │   62.5 -.37  13.8  472k +0.6L  1.16Cr  │
│    86L +1.2L  331k  13.8  .55   114.4      │  24 000  │   82.9 -.45  13.8  441k +1.2L  1.02Cr  │
│ 1.02Cr -0.9L  301k  13.8  .47    89.0      │  24 050  │  107.5 -.53  13.8  396k -0.9L     74L  │
│ 1.24Cr +2.1L  264k  13.8  .39    67.7      │  24 100  │  136.2 -.61  13.8  341k +0.4L     51L  │
│                                               ⋮                                                │
├─────────────────────────────────────────────────────────┬──────────────────────────────────────┤
│ LEGS · short iron condor · net credit ₹3 536            │ QUANT · net greeks                   │
│ [ S 24200 CE ×1 @36.6 ✕ ]  [ B 24500 CE ×1 @3.5 ✕ ]     │ Δ  -3.9 sh    Γ  -0.120              │
│ [ S 23800 PE ×1 @23.1 ✕ ]  [ B 23500 PE ×1 @1.8 ✕ ]     │ Θ +4 489 /day  V    -521 /v          │
│                                      [+ CE] [+ PE]      │ OI WALLS  CW 24 100 1.24Cr           │
│ PAYOFF  BE 23 745 · 24 254  max +3 536 · -15 964        │            PW 23 800 1.41Cr          │
│ PROB    POP 69.7%  E[P&L] -13  ±1σ 245 pts              │ MAX PAIN 24 000   PCR 1.11 / 0.98    │
└─────────────────────────────────────────────────────────┴──────────────────────────────────────┘
```

Full screen is a *layout*, not a second implementation: the same `OptionChainTable` and the same
store, with the chain taking the whole width (primary content gets the space — UX principle §1) and
legs / payoff / probability / quant in a fixed 39-column footer band. It adds `ΔOI` per side; the
analytics strip is the same one the dock uses (`PAYOFF / SMILE / TERM / SURFACE / PROB`); all five
tabs fit at 390 px and the strip's `overflow-x-auto` is an overflow guard, not active scroll — tabs
are never dropped.

### 4.3 Narrow — 390 px (< 1200, bottom sheet, 46 columns)

```
┌────────────────────────────────────────────┐
│ ═══════  (drag handle)                     │
│ NIFTY  26 MAR · 2d     24 031  +0.42%      │
│ [ CE ] [ BOTH ] [ PE ]      [⤢] [✕]        │
├────────────────────────────────────────────┤
│ PAYOFF │ SMILE │ TERM │ SURFACE │ PROB    │
├────────────────────────────────────────────┤
│      OI      IV        LTP │       STRIKE  │
│     70L    13.8      144.0 │       23 950  │
│     86L    13.8      114.4 │       24 000  │
│  1.02Cr    13.8       89.0 │       24 050  │
├────────────────────────────────────────────┤
│ 4 legs · credit ₹3 536  ·  POP 69.7%       │
├────────────────────────────────────────────┤
│  ╱────────────╲   BE 23 745·24 254         │
│ ╱              ╲  max +3 536               │
│ ────────────────  E[P&L] -13               │
└────────────────────────────────────────────┘
```

Under 640 px only one side renders (`CE | PE` segmented control) — 5 columns × ~46 px + the 60 px
strike column = ~290 px inside a 358 px content width. Payoff and probability stack vertically; the
sheet never scrolls horizontally.

### 4.4 IV surface tab (P3 — heatmap form)

```
┌────────────────────────────────────────────────────────┬──────────────────────────────────┐
│ SURFACE | 3 expiries × 21 strikes (2d/9d/16d)          │ IV SMILE · 26 MAR                │
├────────────────────────────────────────────────────────┼──────────────────────────────────┤
│         K→23 800 23 900 24 000 24 100 24 200           │  14.6 ┤        ╭─╮               │
│   26 MAR      13.9   13.8   13.8   13.8   13.9         │       │      ╱     ╲             │
│   02 APR      14.4   14.2   14.2   14.3   14.4         │  13.8 ┤────╱         ╲────       │
│   09 APR      14.9   14.6   14.6   14.7   14.9         │       └──┬───┬───┬───┬──         │
│   ATM 24 000 · smile quadratic in ln(K/S)              │        23.8 23.9 24.0 24.1 24.2  │
│   TERM  13.8 (2d) → 14.2 (9d) → 14.6 (16d)             │ skew  PE − CE   +0.6 vp          │
│   term slope +0.4 vp/expiry          [2D heatmap]      │ 25Δ RR    −0.9 vp                │
└────────────────────────────────────────────────────────┴──────────────────────────────────┘
```

The heat cells are the same `σ(K)` the chain's IV column shows for 26 MAR (13.8 at ATM, 13.9 one
strike out) — a surface that disagrees with the table above it is worse than no surface. Term
structure is lifted per expiry, so the ATM ridge rises `13.8 → 14.2 → 14.6`.

**Shipped (2026-11).** The analytics tab strip shipped as `PAYOFF · SMILE · TERM · SURFACE · PROB`
(`AnalyticsTabStrip.tsx`); the analytics body (`AnalyticsPanel.tsx`) owns `SMILE / TERM / SURFACE /
PROB` and the dock's payoff panel owns `PAYOFF`. `SurfacePanel.tsx` renders this grid as an **ECharts
2D `heatmap`**, deliberately *not* `echarts-gl` WebGL — no 3D engine or `[3D]` toggle shipped.
Missing expiry/strike intersections are omitted, never painted as a misleading zero. The sampled
strike columns are capped by `SURFACE_MAX_STRIKES = 21` (`src/config/optionsAnalytics.ts`, the
shipped value behind the "19 strikes" sketch above); expiries default to **3** and clamp to **6** via
`ANALYTICS_DEFAULT_EXPIRIES` / `ANALYTICS_MAX_EXPIRIES` in the same module, mirrored in
`api/options_conventions.py` for `GET /api/options/analytics/{underlying}`.

### Analytics visual contract (shipped 2026-11)

The five tabs keep the `analytics-tab-*` testid prefix; their visible labels are now:

- **PAYOFF · IV BY STRIKE · IV BY EXPIRY · IV MAP · POSITION ODDS**.
- Persistent context on every tab: `symbol · selected expiry · DTE · spot · ATM IV · CLOSED/OPEN`.

**Verdict chips** (top of the analytics body):

- Skew — `PUTS RICH` / `CALLS RICH` / `FLAT`, from the 25Δ call−put IV in **vol points**.
- Term — `BACKWARDATION` / `CONTANGO` / `FLAT`, from the ATM-IV slope per expiry.
- Levels — `MAX PAIN` and quote health `% QUOTED`.

**Per-tab reading rules:**

- **IV BY STRIKE** — strike axis in ₹; CE/PE legend; both 25Δ wings labelled; in-panel expiry chips; footer `WINGS VS ATM`.
- **IV BY EXPIRY** — date axis, point IV labels, band on the selected expiry, near-term premium in vp.
- **IV MAP** — hatched cells for no-quote intersections, highlighted selected-expiry row, `QUOTED %`, colour bar `low IV → high IV`.
- **POSITION ODDS** — profit/loss shading, breakevens, ±1σ band, scenario row, `MODEL flat vol`; skew POP only when the skew series is available.
- Empty states name the missing input, e.g. `0/26 valid IV quotes` — never a blank chart or a painted zero.

**100-point IV cap fix.** `api/options_conventions.py` `IV_MAX` / `SURFACE_IV_MAX` are 100 (were 60), so analytics no longer discards genuine 60–100 prints. KAYNES front expiry now shows ATM IV **79.7**, 25Δ RR **−6.5 vp** (call−put) and wing **+2.9 vp** — chain IV and analytics agree.

---

## Colour semantics — side vs level vs contrast (contract)

- **Side coding (CE/PE — non-directional):** CE/calls = `INFO` (blue), PE/puts = `WARNING` (orange), via `OI_CALL` / `OI_PUT`. Applies to OI bars and all side chrome; the smile legend and the bars must agree. Never green/red: OI is not bullish/bearish.
- **Level coding (strike levels — directional meaning):** call wall `CW` = red (`LEVEL_CALL_WALL`, resistance), put wall `PW` = green (`LEVEL_PUT_WALL`, support), max pain `MP` = amber (`LEVEL_MAX_PAIN`), gamma SUP = green (`LEVEL_SUPPORT`), gamma RES = red (`LEVEL_RESISTANCE`). Do not reuse `OI_CALL`/`OI_PUT` for levels — side and level are independent axes, and one row may carry both CW and PW.
- **Chain rows:** CW/PW get a 2px inset rail + 8% tint; MP gets a 7% tint/outline; ATM keeps its amber fill. When CW and PW share a strike, render both rails; badge priority governs only the single visible chip/letter.
- **Contrast:** text ≥ 4.5:1, meaningful graphics ≥ 3:1, decorative hairlines exempt. Compute with `src/utils/contrast.ts` (`relativeLuminance`/`contrastRatio`/`compositeOver`/`pickTextColor`), run `bun run contrast`, and register every new fill/tint/text pair in `src/test/contrast.test.ts`.
- **Why:** `#E8E8E8` on solid green/red OI fills measured ~2.6:1 and vanished at 10px. A 2px solid rail over a low-alpha tint keeps text on the surface — the reference pattern for any new filled cell.

---

## 5. Quant methods

All of §5 lives in `src/utils/optionsMath.ts`: **pure, synchronous, no I/O, no store reads**.
Leg changes must cost 0 requests, so this maths is the documented exception to
"backend owns the market-data computation" in `UI_RULES.md` — it is *model* arithmetic over
server-supplied inputs (spot, strikes, premiums, IV), not a re-derivation of market data.
Indicators stay server-side.

### 5.1 Payoff at expiry

For legs `i` with direction `dᵢ ∈ {+1 buy, −1 sell}`, lots `qᵢ`, lot size `Lᵢ`, premium `pᵢ`:

```
intrinsic(S, K, type) = type == CE ? max(S − K, 0) : max(K − S, 0)
PnL(S) = Σᵢ dᵢ · qᵢ · Lᵢ · ( intrinsic(S, Kᵢ, typeᵢ) − pᵢ )
```

Piecewise-linear in `S` with kinks exactly at the strikes, so the curve is exact from
`N+2` points: `{0, all strikes sorted, ∞}`. We still sample 241 points for the chart
(`step = max(spot·0.002, tick)`, clamped to `[spot−3σ, spot+3σ] ∪ [minK−σ, maxK+σ]`) because a
kink that falls between samples puts a visible dog-leg in the line.

- **Breakevens**: on each linear segment `(Kⱼ, Kⱼ₊₁)`, `PnL` is `a·S + b`; a sign change gives
  `S* = −b/a`. Round to tick (`tick_size` from E1), dedupe within 1 tick, drop `S* ≤ 0`.
- **Max profit / loss**: finite iff all legs on one side are bounded by the strike set — `max` /
  `min` over the segment endpoints plus the two tails (`S→0` and `S→∞`). Unbounded short legs report
  `∞` in red, never a number.
- **Premium basis**: `ltp` by default, with a `[mid]` toggle using `(bid+ask)/2`. **Costs are
  excluded in v1** (brokerage/STT/exchange charges/stamp/GST differ per broker and per leg count) —
  the footer says `gross of costs`. Adding an exact per-leg cost model is a P2 backend job, not a
  guess in the UI.

### 5.2 Probability of profit — lognormal

Under risk-neutral zero drift `ln S_T ~ N(ln S₀ − ½σ²T, σ²T)`:

```
T   = (expiry 15:30 IST − now) / (365 × 24 × 3600) seconds   // calendar-year basis
σ   = ATM IV (decimal, from the feed's `option_greeks.iv` at the strike nearest spot)
d(K) = [ ln(K/S₀) + ½σ²T ] / (σ√T)                  ⇒  P(S_T ≤ K) = Φ(d(K))
```

**Calendar 365, not 252.** The feed's IV is itself computed on calendar time; switching to a
252-day basis would inflate ±1σ by `√(365/252) = 1.20` and disagree with the quotes it is derived
from. Consistency with the source beats theoretical purity — and the 20 % gap is exactly the kind of
silent error that makes a POP number useless.

**POP** — profitable set is a union of intervals on `S_T`, obtained from the breakevens in §5.1:

```
POP = Σ_intervals [ Φ(d(K_hi)) − Φ(d(K_lo)) ]
```

(Φ via a checked Abramowitz–Stegun 7.1.26 approximation, `|ε| < 1.5e−7`; unit-tested against known
values at 0, ±1, ±1.96, ±2.576.)

Worked on the §4.1 fixture (short 24 200 CE / long 24 500 CE / short 23 800 PE / long 23 500 PE,
σ = 13.8 %, T = 2/365 = 0.005479 y):
`d(23 745) = −1.169`, `d(24 254) = +0.907` ⇒ `Φ(0.907) − Φ(−1.169) = 0.8179 − 0.1212 = 69.7 %`.
Two breakevens means one profitable interval; a condor on the other side of spot still has one, but
a butterfly has two disjoint ones and the sum runs over both.

**E[P&L]** — model expected value, i.e. the flat-vol fair value of the basket minus premium paid:

```
C(S,K,σ,T) = S₀·Φ(d₁) − K·Φ(d₂),   P(S,K,σ,T) = K·Φ(−d₂) − S₀·Φ(−d₁)
d₂ = −d(K)                d₁ = σ√T − d(K)          // r = 0, and d(K) is the same Φ arg as above
E[PnL] = Σᵢ dᵢ·qᵢ·Lᵢ·( Vᵢ(S₀,Kᵢ,σ,T) − pᵢ )
```

(The sign flip is not cosmetic: `d(K)` is the *tail* probability `P(S_T ≤ K)`, so the call's `d₂`
is `−d(K)` and `d₁ = d₂ + σ√T`. A test asserts `C − P = S − K` at `r = 0` — put-call parity is the
cheapest way to catch a sign error here.)

Label it **`model E[P&L]`**, never `expected profit`: with a flat σ it is a fair-value gap, not a
forecast. The §4.1 fixture comes out at `−13` on a `₹3 536` credit — i.e. the observed premiums are
within one tick of flat-vol fair value. That is the sanity check worth asserting in a test: if the
same basket reports `E[P&L] = +₹2 000` on a 2-day NIFTY condor, the σ or the sign convention is wrong.

**Feed POP vs model POP.** `option_greeks.pop` is per leg and already computed upstream (method not
documented). Show it as a secondary figure in the leg chip and in the panel header
(`POP 69.7% · feed 68.1%`). Never blend the two, and never fall back to the feed's number when our
model is unavailable — a leg with missing IV gets `POP —` and a `flat-vol unavailable` chip.

### 5.3 Expected move

`±1σ_pts = S₀ · σ · √T` (same definition as `calculate_expected_move` at `api/options.py:90`).
Rendered as `±1σ 245` with the arithmetic in the tooltip
(`24 031.5 × 13.8 % × √(2/365) = 245.5`).

> **Two servers currently disagree.** `/api/options/chain` returns `summary.expected_move.range` as
> an arithmetic 1σ; the generic report path uses a **0.61 × straddle** convention that is *not* 1σ —
> reading it as 1σ understates the market's implied range by roughly half. This component computes
> its own 1σ from `(spot, ATM IV, T)` and shows the formula — it reads **neither** field.

### 5.4 Greeks aggregation

Per leg: `sign = dᵢ · qᵢ · Lᵢ`. Net:

| Greek | Aggregate | Unit shown |
|---|---|---|
| Δ | `Σ sign·delta` | shares-equivalent (and `×S₀` = notional) |
| Γ | `Σ sign·gamma` | Δ change per 1 pt move |
| Θ | `Σ sign·theta` | ₹ per calendar day (feed's unit; labelled as-is) |
| V | `Σ sign·vega` | ₹ per 1 vol point |
| IV | premium-weighted mean, per leg shown separately | vol % |

Missing greeks are **not zero**. A leg whose `option_greeks` is absent (`transform_option_contract`
returns `None` at `api/options.py:441`) contributes to premium/PnL but shows `—` in every greek cell
and excludes itself from the net with a `partial greeks` badge. Zero-filling a missing delta turns a
delta-neutral basket into a directional one on paper.

### 5.5 Max pain, PCR, OI walls

- **Max pain**: `argmin_K Σ_strikes OI_ITM(K) × |K_strike − K|` over the CE OI for `K > strike` and
  the PE OI for `K < strike` — the existing `calculate_max_pain` (`api/options.py:110`).
  *Failure mode:* it is an OI-weighted pin, blind to volume, gamma and intraday unwinds; when one
  strike holds > 40 % of total OI it is a single-print artefact. Show a `thin chain` chip when
  `total_oi < 50 000` or when one strike exceeds 40 %.
- **PCR**: `Σ PE OI / Σ CE OI` (and volume PCR beside it). Never render PCR as a signal colour — it
  is a level, and its sign flips meaning with regime.
- **OI walls**: top 3 strikes by OI per side inside ±1 % of spot (`NEAR_BAND_PCT` in
  `api/reports_api/options_report.py:101`), plus `CW`/`PW` chart lines on the same payload. The
  chain table draws a bar per row whose length is `OI / max(OI)` floored at 1 px — one `div` width,
  no canvas, no per-row effect.

### 5.6 Assumptions and their failure modes

| Assumption | Fails when | Mitigation |
|---|---|---|
| Lognormal, flat σ = ATM IV | IV smile: OTM wings are underpriced → POP overstated for far-OTM shorts | state `flat vol` in the panel header; P3 offers a 25Δ skew-blended σ |
| Zero drift, r = 0 | rate/dividend drift; negligible < 30 DTE, ~0.3 % at 1 y | show `r=0` in the footnote; cap the surface horizon at 3 expiries |
| Continuous diffusion | earnings gaps, index rebalance, circuit filters — one gap invalidates "POP 90 %" | if the expiry spans a known earnings date for a stock, badge `event risk` |
| T > 0 | expiry-day close, `T → 0` ⇒ `σ√T → 0` ⇒ 0/1 probabilities | floor `T` at **15 minutes**; show `0-DTE · gamma risk` and put the note above the numbers |
| Premium = LTP | illiquid strike last traded an hour ago | show `stale > 60 s` per leg; `[mid]` toggle; POP uses the same premium the chart uses |
| OI = real positioning | a single player's spread shows as a wall | `thin chain` chip (§5.5) |

---

## 6. Performance budget

| # | Budget | Target | Mechanism that guarantees it |
|---|---|---|---|
| 1 | First chain paint, warm server cache | **≤ 250 ms p50 / 600 ms p95** | server 10 s cache + single-flight; client paints header + 9 skeleton rows at 0 ms |
| 2 | First chain paint, cold upstream | **≤ 1.4 s p95** | E1 ∥ E2 in parallel; 12 s httpx ceiling (`UPSTOX_TIMEOUT_SEC`) |
| 3 | Rows mounted | **≤ 60** of up to 400 | shared `TanStackTable rowWindowSize={60}`; footer stays honest (`showing 60 of 214 · 154 not rendered` per §3 no-dead-ends) |
| 4 | Chain payload | **≤ 220 KB raw / ≤ 40 KB gzip at 260 strikes** | normalized DTO: no per-row duplicate of spot/expiry/underlying; 4 dp rounding; ~700 B/strike |
| 5 | Requests on open | **2** (E1+E2); **1** when E1 cached | `fnoUniverse` + E1 session cache |
| 6 | Requests on expiry change | **1** | chain keyed `(symbol, expiry)`; E1 lot sizes reused |
| 7 | Requests on leg change | **0** | `optionsMath` is pure over the in-memory frame |
| 8 | Per-tick main-thread cost | **≤ 4 ms p95** | `createStore` with **field-level paths** `setChain(strike, "ce", "ltp", v)`; only the cells that read that path re-run. REST poll is 10 s, so a tick is a full-frame patch; when P3 streaming lands, ticks are coalesced to ≤ 4 Hz before they reach the store. |
| 9 | Payoff + POP recompute | **≤ 1.2 ms** for 4 legs / 241 points | gate: recompute only if spot moved ≥ 0.05 % or the leg set changed; preallocated `Float64Array`s, no allocation in the hot loop |
| 10 | Chart redraws | **≤ 1 per data patch**, 1 canvas | ECharts `canvas` renderer, `setOption(…, {notMerge:false, lazyUpdate:true})` on updates (the current `EChart` wrapper uses `notMerge:true` — the payoff needs a merge-mode mount or a local wrapper) |
| 11 | Memory per open chain | **≤ 3 MB**; **≤ 3 frames** retained | LRU on `(symbol, expiry)`; flat arrays; no deep clone of the frame on tick |
| 12 | Legs persistence | **≤ 4 KB** localStorage | 20 symbols × 8 legs max, `options.legs.v1.<SYMBOL>` |
| 13 | In-flight on close | **0** | `AbortController` per `(symbol, expiry)`; `signal.aborted` check before every store write |
| 14 | IV surface (P3) | **≤ 5 chain requests**, explicit open only | 15 min per-expiry cache; never prefetched from the dock |
| 15 | Bundle | **no growth in the entry chunk** | `OptionsDockPanel` is `lazy()` like `PatternFullscreenView` (`SymbolDockProvider.tsx:15`); ECharts stays behind `loadEcharts()` |

### What we will NOT do

1. **No chain fetch per strike.** The contract listing is per-underlying; N strikes = 1 call, always.
2. **No contract endpoint on every open.** Lots/expiries come from E1 with a 300 s cache.
3. **No per-row Solid effects or derived signals.** Row cells read store paths directly; nothing
   subscribes per row.
4. **No payoff/POP recompute on unrelated ticks** (gate #9). A tick on a symbol whose spot barely
   moved must not re-run 241 × N-legs arithmetic.
5. **No option-chain prefetch on hover**, and no prefetch of neighbouring expiries.
6. **No WebSocket in P1/P2.** REST polling at 10 s is the default; streaming is P3 and opt-in.
7. **No client-side greeks recompute.** Missing greeks stay missing (§5.4).
8. **No bespoke table.** Shared `TanStackTable` + `meta.align`; a second chain table is how the two
   copies drift.
9. **No unbounded stores.** 3 chain frames, 5 open chains, 20 saved leg sets.
10. **No `rowWindowSize` as a hard cap** — the footer discloses what is not rendered.
11. **No 3D engine at all** — the shipped surface is a 2D ECharts heatmap; `echarts-gl`/WebGL was
    never added (open decision #4 resolved to (a)).

---

## 7. Scenario matrix

| # | Scenario | Expected behaviour | Guarded by |
|---|---|---|---|
| 1 | Nearest expiry (default) | E1 → `default_expiry` = first ≥ today; one chain request | unit: `pickDefaultExpiry` (rollover table) |
| 2 | Next / far expiry | 1 request; legs kept with their own expiry + a `different expiry` chip on stale legs | component: `LegBuilder` expiry mismatch |
| 3 | Expiry **today**, after 15:40 | default rolls to next; today labelled `EXPIRED`, selectable, no polling | unit: rollover; E2E: `?expiry=today` |
| 4 | Expiry today, before 15:40 | `0-DTE` badge; `T` floored at 15 min; gamma warning above POP | unit: `T` floor |
| 5 | Zero-OI / illiquid strike | row renders with `0` OI and `—` IV; not filtered out; payoff still usable | component |
| 6 | Missing greeks / IV on one leg | `—` everywhere, `partial greeks` badge, leg excluded from net, POP not shown for that leg | unit + component |
| 7 | Stale quote (> 60 s old `ltp`) | per-leg `stale` dot; header `as of 14:52`; `[mid]` available | component |
| 8 | Market closed | one fetch, no poll, `MARKET CLOSED · as of 15:30 IST`; `stale` shown as time, not error | E2E |
| 9 | Non-F&O symbol | Options icon `aria-disabled`, tooltip `No listed options for X`; chart/TV/copy unaffected | unit: `SymbolActions` disabled |
| 10 | Auth expired (401 from E2) | panel error state with `Reconnect Upstox in Settings` + `Retry`; icon stays enabled | component + E2E mock 401 |
| 11 | Rate limited (429) | keep last frame, `Refreshing paused · retry in 8 s` chip, auto-retry once; never blank the chain | component + E2E mock 429 |
| 12 | 200+ strike chain | windowed 60 rows, `showing 60 of 214` footer, `[show all]` + auto-extend on scroll | component (perf) |
| 13 | 4-leg basket (short iron condor) | 2 breakevens (23 745 / 24 254), one profitable interval, POP 69.7 %, both bounds finite (+3 536 / −15 964) | unit: the §4.1 fixture, asserted to the rupee |
| 14 | Buy/sell mix | net premium signed correctly (credit shown `+`, debit `−`); a zero-premium synthetic shows `₹0` not blank | unit |
| 15 | Narrow viewport (< 1200 px) | bottom sheet 62vh; one side only < 640 px; no horizontal scroll | E2E at 390×844 and 1024×768 |
| 16 | Light theme | surface ramp from `palette` (`SURFACE`/`SURFACE_ALT`), OI bars at 12 % alpha, ATM tint legible | screenshot + `theme-single-source.test.ts` |
| 17 | Keyboard only | `Tab` walks text → chart → options → tv → copy; `Enter`/`Space` opens; disabled icon still focusable and announces its reason; `Esc` closes the dock | E2E `page.keyboard` |
| 18 | Reopen after close | legs restored from localStorage per symbol (open decision #3), same expiry, no request until visible | unit: store hydration |
| 19 | Expiry rolls over at midnight while open | cache key includes session date ⇒ no stale frame; header expiry list refreshes on next poll | unit: cache key |
| 20 | Underlying is SENSEX (BSE) | `BSE_INDEX|SENSEX`; lot 20; 0-DTE common; `flow`/premium units differ ⇒ no ₹ crore formatting | mapper contract test |

---

## 8. Testing plan and acceptance criteria

### 8.1 Unit — pure maths (`src/utils/optionsMath.test.ts`)

| Test | Assertion |
|---|---|
| Long call payoff | breakeven `= K + p` exactly; max loss `= −q·L·p`; max profit `∞` |
| Long put | breakeven `= K − p`; max profit `= q·L·(K − p)` |
| **§4.1 fixture** (short 24 200 CE / long 24 500 CE / short 23 800 PE / long 23 500 PE, S=24 031.5, σ=13.8 %, T=2/365, lot 65) | breakevens `23 745` and `24 254` ±0.5; max `+3 536` and min `−15 964` exactly; `POP 69.7 %` ±0.1 pp; `E[P&L]` within ±₹50 of 0 (premiums are flat-vol fair value by construction) |
| POP of a single long call | equals `1 − Φ(d₂)` from an independently-coded Black-76 reference to 1e−6 |
| POP + P(loss) | sums to 1.000 ± 1e−9 for a bounded basket |
| Φ approximation | 0, ±1, ±1.96, ±2.576 vs table values, `|ε| < 2e−7` |
| `T` floor | expiry in 5 min ⇒ `T` = 15 min; negative `T` clamps to the floor, never negative |
| IV = 0 or NaN | POP `—`, no `NaN`/`Infinity` in the curve |
| Premium rounding | 241 samples land on kinks exactly (payoff continuous at every strike) |
| Greeks aggregation | missing greek excluded, `partial` flag set; sum of 4 legs matches hand-computed vector |
| Max pain | 3-strike hand-worked fixture; single-print OI ⇒ `thin chain` flag |

### 8.2 Component (`*.test.tsx`, `npx vitest run <file>` — `vi.mock` needs vitest, not `bun test`)

- `SymbolActions.test.tsx` — order is exactly `[chart][options][tv][copy]`; disabled options carries
  the reason in `aria-label`; `stopPropagation` fires; test ids unchanged from today.
- `OptionChainTable.test.tsx` — 214 rows ⇒ ≤ 60 mounted; `meta.align` per column (text left, numbers
  right, strike centre); missing greeks render `—`; ATM row tinted once.
- `LegBuilder.test.tsx` — add/remove/qty; buy↔sell flip changes the premium sign; expiry mismatch chip.
- `PayoffChart.test.tsx` — option identity changes only when the frame identity changes (no rebuild
  per tick); 4-leg series length 241 × 2 curves.
- `ProbabilityPanel.test.tsx` — POP/BE/E[P&L] formatting; `flat vol` disclosure present; expiry-day note.
- `OptionsDockPanel.test.tsx` — loading → content keeps content (§11 "first load is not a refresh"):
  a 10 s refresh shows a corner chip, never an overlay.
- Error states: 401, 429, 500, empty chain — four distinct renders, calendar-independent.

### 8.3 Contract test for the Upstox mapper

- Backend: `tests/api/test_options_chain_contract.py` — a recorded Upstox `/v2/option/chain` fixture
  (NIFTY 0-DTE + a stock chain) is mapped and asserted field-by-field: every `market_data` key
  present, `option_greeks` `None` when absent (not `{}`), `lot_size` sourced from the contract
  listing, `instrument_key` prefixed `NSE_FO|`.
- Contract test for E1: unknown symbol ⇒ `404 not_fno` (never `NSE_INDEX|<symbol>`); SENSEX ⇒
  `BSE_INDEX|SENSEX`.
- Frontend: `src/api/optionChain.test.ts` — DTO parse, 404/401/429 → typed errors, abort → no throw.

### 8.4 E2E (`tests/e2e/options-dock.spec.ts`, mocked chain via `setupOptionDockMocks(page)`, extending
`tests/mocks/apiResponses.ts` `setupOptionsMocks` with request counting)

1. Open from a screener row → dock shows chain, **≤ 2 requests issued** (route counter).
2. Change expiry → **exactly 1** new chain request.
3. Add two legs → **0** network requests; payoff path appears.
4. 4-leg condor → 2 breakevens rendered (`23 745` / `24 254`), `POP 69.7 %`, net credit `₹3 536`.
5. Close and reopen → legs restored, **0** chain requests until visible.
6. 390×844 → bottom sheet, no horizontal scrollbar (`document.scrollWidth === clientWidth`).
7. Keyboard-only: `Tab` order, `Enter` opens, `Esc` closes.
8. Non-F&O row → options icon disabled, tooltip text exact.
9. 429 on poll → chain stays populated, `retry in` chip appears.

Console-error policy: no new ignore patterns; a deliberate 500 test is the only allowed waiver
(precedent: `tests/e2e/events.spec.ts`).

### 8.5 Guards that must pass untouched

`npx vitest run src/test/ui-guard.test.ts` (no `styles`/`sx`) ·
`src/ui/inputs/inputs.w-h.test.tsx` · `src/test/design-scale.test.ts` (radius/height/9 px floor) ·
`src/test/numeric-typography.test.ts` (`font-mono` + `tabular-nums`) ·
`src/test/table-structure.test.ts` (no new inline `const columns` outside the allowlist — the chain
columns live in `chainColumns.ts` as a factory) · `src/test/theme-single-source.test.ts` (no hex
outside `palette.ts`) · `bun run lint` (0 warnings) · `bun run build`.

### 8.6 Acceptance criteria

1. From **any** of the 16 screens in §1.2, a symbol offers `[chart][options][tv][copy]` in that order.
2. Opening options costs **≤ 2** HTTP requests; changing expiry **1**; changing legs **0**.
3. Nearest expiry is preselected and correct after 15:40 on expiry day.
4. A 4-leg basket produces breakevens within 0.5 pt, exact max P/L bounds, POP within 0.1 pp of the
   closed-form value and `model E[P&L]` in **≤ 1.2 ms**, with the formula visible in the UI.
5. A 214-strike chain mounts **≤ 60** rows and paints in ≤ 600 ms p95 from a warm cache.
6. Closing the dock leaves **0** in-flight requests and no timers (assert `performance.getEntriesByType("resource")`
   stops growing).
7. Every scenario in §7 has a passing test; no `NaN`, `Infinity`, or `0`-for-missing in the UI.
8. Build, lint, and the six guards pass; screenshots at 390 / 1024 / 1440 in empty, loading and full states.

---

## 9. Phases

**P1 — chain + legs + payoff (shippable alone, ~1 surface, no quant claims)**

- `SymbolActions` + `fnoUniverse` + dock `mode` (+ migrate the 16 screens; drop
  `ClickableSymbolSolid`'s full-page reload).
- E1 (new endpoint) + E2 normalization + client cache/abort/polling.
- `OptionsDockPanel`, `OptionChainTable` (9 columns per side), `LegBuilder`, `PayoffChart`,
  `SummaryStrip` limited to `spot · expiry · DTE · ATM IV`.
- localStorage legs (open decision #3), rollover rule, market-closed behaviour.
- Exit: §8.6 items 1, 2, 3, 4 (payoff only), 6, 8.

**P2 — probability + greeks + OI**

- `optionsMath` POP/E[P&L]/expected move; `ProbabilityPanel`; `GreeksPanel`; `OiProfile`;
  max pain / PCR / walls in `SummaryStrip`; `[mid]` premium basis; `stale` per leg.
- Optional backend cost model (per-leg brokerage/STT/exchange/GST) so the payoff can show net.
- Exit: §8.6 items 4 fully, 5, 7.

**P3 — IV surface + streaming**

- `SurfacePanel` (2D ECharts heatmap; no `echarts-gl`/3D), analytics payload fetched once on first
  analytics-tab open and cached per symbol in the store (module LRU of 5), not per-expiry polling.
- Optional: WebSocket market-data v3 (`optionGreeks`) for **one** pinned chain, 500 ms throttle,
  falling back to REST on disconnect. Only after P2 is measured — streaming must not become the
  default path for a dock the user opens for eight seconds.

---

## 10. Open decisions (6)

| # | Decision | Options | **Recommendation** |
|---|---|---|---|
| 1 | Dock host | (a) extend `SymbolDockProvider` with a mode; (b) a second parallel provider | **(a)**. Two providers means two z-indices, two pin states and two closing gestures for one rail — a guaranteed drift. The context change is additive (`open(symbol, mode?)`). |
| 2 | Refresh cadence | (a) 10 s focused / 30 s background REST; (b) 5 s REST; (c) WebSocket now | **(a)**. Focused chain 10 s (6 calls/min), 4 background chains 30 s (2 each), cap 5 chains ⇒ ≤ 15/min on top of the recorder's 12 ⇒ 27 of the 30/min `options` slice. (b) blows the slice at 2 chains. (c) is P3 and opt-in per pinned chain. |
| 3 | Leg persistence | (a) session memory only; (b) localStorage per symbol; (c) server-side saved baskets | **(b)** `options.legs.v1.<SYMBOL>`, ≤ 20 symbols, ≤ 4 KB, purged on expiry change. (c) is the right long-term home but it is a DB + API + migration job that blocks P1 for no user-visible gain at this stage. |
| 4 | IV surface engine | (a) ECharts 2D heatmap + smile/term lines; (b) `echarts-gl` 3D surface (new ~200 KB dependency) | **(a) shipped** — `SurfacePanel.tsx` uses the 2D ECharts `heatmap`; no `echarts-gl`/WebGL dependency and no `[3D]` toggle were added. At 390 px a 3D rotation is strictly worse than a heatmap, and missing intersections are omitted rather than painted as zero. |
| 5 | Default strike window | (a) ±10 % of spot; (b) full chain; (c) ±N% per underlying | **(a)** with `[show all]` + auto-extend on scroll (no dead ends). A 400-strike chain at 60 mounted rows is a scroll tunnel; ±10 % is where the greeks and the liquidity are. Remember the user's last window per underlying. |
| 6 | σ for probability | (a) ATM IV (flat vol); (b) 25Δ-skew-blended σ | **(a)** in P2, with `flat vol` stated in the header and the smile visible in the P3 surface so the user can see the error they are accepting. (b) in P3 as a toggle — it changes the POP number materially on wings and needs its own validation fixture before it becomes the default. |

---

## 11. Known traps for the implementer

1. `EChart` applies `notMerge: true` (`src/components/common/EChart.tsx:50`). A tick would wipe the
   axis annotations. The payoff mount needs merge mode (`notMerge:false, lazyUpdate:true`) — add a
   prop or a local wrapper; do not fork the chart stack.
2. `SymbolLink` is the internal primitive; `SymbolActions` must wrap it rather than re-implement the
   hover/preview contract, or the 300 ms debounce in `SymbolDockProvider.tsx:23,82` will run twice.
3. `ClickableSymbolSolid` uses `window.location.assign` — replacing it with the dock is a behaviour
   change for paper trading; call it out in the commit message, do not bury it in a refactor.
4. `get_instrument_key` is synchronous over a 43 MB JSON. Calling it from the new E1 without
   `to_thread` will reintroduce the event-loop stall documented at `api/options.py:197`.
5. Table alignment: the strike column is **centre**, everything else numbers-**right**, symbol/text
   **left**. The wrapper's `justifyContent` must match `meta.align` (`TABLE_CHECKLIST.md` §5) — a
   centred wrapper inside a right-aligned cell is the recurring bug.
6. Never write `0` where a value is unknown. `_num()` (`api/options.py:385`) already coerces `None`
   to `0.0`; that is right for OI/volume and **wrong** for IV/delta/greeks. The normalizer needs a
   nullable path for greeks, and the UI renders `—` (never `0`, never `NaN`).
7. Do not show `summary.dte` from E2 — it is `(expiry − now).days + 1` (`api/options.py:566`), which
   overstates by up to a day. Use `dte_years_exact` from E1.
8. `TanStackTable`'s `rowWindowSize` is a page size, not a cap (`TanStackTable.tsx:729`); the footer
   must keep saying `showing 60 of 214 · 154 not rendered`.
9. `palette` only. `alpha(palette.POSITIVE, 0.12)` for a bid-side fill, never an rgba literal.
10. `option_greeks` is `None` in the payload when Upstox omits it (`api/options.py:447`), so a
    `?.delta ?? 0` on the client silently invents a delta-neutral leg. Read the *presence* of the
    object, not the truthiness of each field.
11. Don't reuse `useOptionsState`/`optionsStore` (they belong to the `/options` route —
    `src/state/optionsStore.ts`, consumed by `src/hooks/useOptionsState.ts`). A shared store would
    couple the dock's cache/abort lifecycle to a page the user may never open.

## Layout invariants (measured, 2026-11)

The dock is a **flex column**, never a percentage-height tree. Every ancestor's
height comes from flex stretch, so its *specified* height is `auto`; a child
with `height: 100%` therefore resolves against content, not the viewport. That
is how the panel once grew to 1342px inside an 824px outlet and the chain table
to 919px, pushing STRATEGY / LEGS / PAYOFF off-screen and scrolling the outlet
to `y = -199`.

Correct chain:

- `ChartDockOutlet` is `flex flex-col min-h-0 overflow-hidden`; a `style.css`
  rule makes its portal child (`> *`) a column flex box with `flex: 1 1 auto;
  min-height: 0`.
- All three `SymbolDockProvider` wrappers use **`flex-1`**, not `h-full`.
- The panel root is `flex flex-1 min-h-0 w-full flex-col overflow-hidden`.
- The CHAIN `DockSection` is `flex-1` with `min-h-[160px]`; its table scrolls
  internally. The payoff keeps its fixed `206px`; legs/strategy are `shrink-0`.

Verified at 1600×980: outlet 824, panel 824, chain 459 (client 401 / scroll
919), payoff at `y=759`, bottom 964 ≤ viewport.

Other invariants:

- A failed chain refresh keeps the last frame, sets the typed error and
  **reschedules polling**. The panel renders a 26px banner above the table
  (Retry, auth → "Reconnect Upstox in Settings"); the cold full-panel error is
  only for "no chain yet".
- OI bars use `sqrt(oi / max)` with a 2px floor. OI is heavy-tailed — one
  1.44M-OI strike made the linear median bar 3.75px. The printed number is the
  exact value; the bar is a visual rank.
- Zero OI renders `0`; missing IV/delta renders `—`. Never conflate the two.
