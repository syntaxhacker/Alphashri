# Market / Home signal sections — native plan (2026-11-24)

Goal: build **signal sections** (VWAP cross, momentum, ORB breakout, RVOL spike, 52W touch) natively in this app, with our own components, our own storage and our own backend adapter. The standalone scanner tool has been removed from the repository; sections are implemented end-to-end in this app, with no imported, mounted or proxied external dashboard. Only the concept names are borrowed.

> **Status (2026-11-25):** P0 done — descriptor types, single registry and starter presets with tests (`src/state/sections/{types,registry,presets}.ts`), and `src/state/sections/config.ts` now implements the `user.sections` savedConfig hook. P1 in flight — `SectionManagerModal.tsx` (CRUD, JSON, validation, 390px list Select) exists with tests, but has no mounted entry point yet. P2 backend adapter present (`api/sections/{service,fields,predicates}.py`, router being wired). P3 in flight — `SectionsView`/`SECTION_TABS` are defined in `MarketScreenerPanel.tsx` but not rendered, and `src/pages/home/homeSectionPanels.ts` currently fails to parse (JSX in a `.ts` file), so the Home picker is not usable. P4 (story / E2E / evidence / raters) not done. The CRUD acceptance cases are recorded in `tests/e2e/market-sections.spec.ts` against the shipped `section-*` testids, each skipped with the missing surface named until its entry point lands; verified TradingView field facts are in `docs/TV_USAGE.md`. This block records status only — the plan below is unchanged.

## What "our components only" means

| Layer | We use |
|---|---|
| UI primitives | local `@/ui` (`Modal`, `ToolbarRow`, `Select`, `Input`, `Button`, `Text`, `Box`, semantic HTML + Tailwind) |
| Tables | shared `src/components/common/TanStackTable.tsx` with explicit `meta.align` |
| Windows | our `WindowManager` + `DockPanelSpec` (the same engine Home already uses) |
| Storage | our `src/state/savedConfig.ts` scopes (`registerSavedConfigScope`, `createSavedConfigStore`, 800ms debounce, hydration latch) |
| Backend | a NEW module under `api/` in this FastAPI app, using our existing market-data helpers (`market_data.market_data`, `api/tv`) |
| Theme/type | `src/ui/palette.ts`, `text-ui-*` only, 12px floor, no raw hex, no `styles={{}}` |

The former standalone tool and its dashboard are gone from the repository; no external dashboard code, iframe, proxy or localhost URL is part of this plan.

## One descriptor per concept

```
SectionDefinition {
  id, name, description,
  concept: "vwap_cross" | "momentum" | "orb_breakout" | "rvol_spike" | "52w_touch",
  side: "long" | "short" | "both",
  conditions: [{ metric, op, value }],
  render: { type: "table" | "cards", columns: [...] },
  refreshSec, enabled, pinned
}
```

A single registry file owns ids, labels, metric options, operator options, defaults and the field map. The modal, the Home picker, the Screener tab and the backend request builder all read that registry — no duplicated `if (concept === ...)` branches and no second vocabulary.

Starter definitions (shipped as defaults, editable): VWAP reclaim, VWAP reject, Momentum 5m + RVOL≥1.5, ORB 15m breakout, 52W touch, RVOL spike ×2.

## ASCII — Section Manager modal (1600)

```
┌─ Signal Sections ───────────────────────────────────────────────────────┐
│ ┌─ LIST 320 ─────────────┬─ EDITOR ──────────────────────────────────┐ │
│ │ [+ New] [Import JSON]  │ Name [ VWAP reclaim                  ]     │ │
│ │ ● VWAP reclaim    ⚙ ⧉ │ Concept [VWAP cross ▾] Side [Long ▾]       │ │
│ │ ● Momentum 5m     ⚙ ⧉ │ ── CONDITIONS ─────────────────────────── │ │
│ │ ○ ORB breakout    ⚙ ⧉ │ close crosses above VWAP          [×]     │ │
│ │ ○ 52W touch       ⚙ ⧉ │ rvol ≥ 1.5x                       [×]     │ │
│ │ ○ RVOL spike      ⚙ ⧉ │ [+ Condition]                            │ │
│ │ ↑↓ reorder  🗑 delete │ ── RENDER ─────────────────────────────── │ │
│ │ [pin to Home]          │ Table ▾ Cols: Symbol Δ% VWAP RVOL         │ │
│ │                        │ [Preview]  [Save]  [Cancel]              │ │
│ └────────────────────────┴────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```
At 390: one column — list becomes a labelled `Select` above the editor; condition rows stack caption + input; Save/Cancel sticky at the bottom. Modal uses our existing focus/escape/dismissal contract.

**CRUD:** Create (New / duplicate ⧉ / import JSON), Read (list + preview), Update (inline editor, draft autosave), Delete (confirm; warns if pinned in Home/Screener), plus pin, reorder, enable/disable and JSON export. Persisted in our `savedConfig` scope `user.sections` v1 — local-first, no implied cloud sync.

## ASCII — condition builder row

```
┌ METRIC ▾ ─────────┬ OP ▾ ────────┬ VALUE ──────┬ ┐
│ rvol              │ ≥             │ 1.5    x    │ ×│
│ close vs vwap     │ crosses up    │ —           │ ×│
└───────────────────┴───────────────┴─────────────┴─┘
AND / OR switch · metrics come from the registry · unknown metric => visible error
```

## ASCII — Home window using a section

```
┌ Home desk ───────────────────────────────────────────────────────────┐
│ DESK  [+ Window ▾: Market │ VWAP reclaim │ Momentum 5m │ Custom…]   │
│ ┌─ VWAP reclaim (12) ─────────┬─ Momentum 5m (7) ─────────────────┐ │
│ │ SYMBOL   Δ%   VWAP   RVOL   │ SYMBOL  Δ5m  RVOL  SIGNAL         │ │
│ │ HDFCBANK +0.8  above  1.7   │ ...                              │ │
│ └─────────────────────────────┴───────────────────────────────────┘ │
│ titlebar ⤡ − □ × · drag to resize · focus raises z                 │
└──────────────────────────────────────────────────────────────────────┘
```
Each user section becomes a `DockPanelSpec` in a dynamic registry consumed by the Home picker — same frame, same keyboard, same persistence.

## ASCII — Market screener Sections tab

```
┌ Screener ────────────────────────────────────────────────────────────┐
│ Dashboard │ Screener │ Correlation │ Sections │ Config  [Manage…]   │
│ ┌─ VWAP reclaim (12) ──────────┬─ Momentum 5m (7) ────────────────┐ │
│ │ shared TanStackTable         │ shared TanStackTable             │ │
│ │ sortable · own scroll        │ sortable · own scroll            │ │
│ └──────────────────────────────┴──────────────────────────────────┘ │
│ [+ Add section]   empty sections collapse to one reason line        │
└──────────────────────────────────────────────────────────────────────┘
```

## TradingView field coverage — measured live (2026-11-24)

Probed `scanner.tradingview.com/{india,america}/scan` via our own `api.tv.scan_raw`
with `ignore_unknown_fields=True`. **Available directly** (non-null in both markets):

`close, open, high, low, change` (day %), `volume`, `relative_volume_10d_calc`,
`average_volume_10d_calc`, **`VWAP`**, `EMA20/EMA50`, `SMA20/SMA50/SMA200`,
`RSI`, `ADX`, `ATR`, `Recommend.All`, `Recommend.MA`, `price_52_week_high/low`,
`Perf.5D`, `Perf.W`, `type`, `exchange`, `update_mode`, `description`.

**Intraday change fields (verified in isolation, 2026-11-24):** TV exposes
**`change|1`, `change|5`, `change|15`, `change|30`, `change|60`** — percentage move
over N minutes. `change_1m`/`change_5m` are NOT fields (they return `None` under
`ignore_unknown_fields=False`); `Perf.1D` is also null. This is already documented
in our `api/tv/columns.py:120-129` (`INTRADAY_CHANGE_FIELDS`), which the first probe
missed. `PriceToVWAP`/`price_to_vwap` are not fields.

This removes almost all indicator computation from our adapter. The backend becomes a
**column selector + typed predicate evaluator over TV fields**, not a calculator.

| Concept | TV fields | Work left in our backend |
|---|---|---|
| Above / below VWAP | `close`, `VWAP` | compare two numbers |
| VWAP cross | `close`, `VWAP` + previous poll | store last `(close, VWAP)` per symbol; compare sign flip. No bar fetch |
| Momentum day | `change`, `relative_volume_10d_calc` | compare against thresholds |
| RVOL spike | `relative_volume_10d_calc` | compare against threshold |
| 52W touch | `close`, `price_52_week_high/low` | distance % calculation |
| EMA cross | `close`, `EMA20`, `EMA50` | compare; no EMA maths |
| Momentum 1m / 5m / 15m | **`change|1` / `change|5` / `change|15`** + `relative_volume_10d_calc` | threshold compare only — **no bar fetch** |
| Momentum 30m / 60m | `change|30` / `change|60` | threshold compare only |
| ORB 15m breakout | `open`, `change|15` (partial proxy) | true 15m high/low still needs 1m bars; offer a labelled `ORB proxy` section from TV fields alone |

## Structured TV payload → library field mapping (verified 2026-11-24)

The popup-screener payload uses structured columns
(`{"id":"Change","params":{"resolution":"TimeResolution30"}}`). Neither the public
`/scan` endpoint nor `tradingview_screener.Column` accepts that shape here — the
structured body returns `400 json parse error`. `Column` is name-only
(`column.py:49-56`). We translate each UI concept to the library's flat field name:

| Popup payload column | Library `select()` field | Meaning |
|---|---|---|
| `TickerUniversal` | `ticker` (auto), `name`, `description` | symbol |
| `Price` | `close` | last price |
| `Change` `TimeResolution30` | `change\|30` | 30-min % move |
| `ChangeAbs` `TimeResolution1D` | `change_abs` | day absolute change |
| `Change` `TimeResolution15` | `change\|15` | 15-min % move |
| `VolumeChange` `TimeResolution5` | `volume_change\|5` | 5-min volume change % |
| `Volatility` `Interval1W` | `Volatility.W` | weekly volatility |
| `Performance` `Interval1W` | `Perf.W` | weekly performance |
| `RelativeVolume` `TimeResolution1D` | `relative_volume_10d_calc` | relative volume |
| `AverageVolume` `Interval10D` | `average_volume_10d_calc` | 10d average volume |
| `MarketCap` | `market_cap_basic` | market cap |

Library call shape (verified):
```python
count, df = (Query().set_markets(market).select(*FIELDS)
             .where(Column("average_volume_10d_calc") > 100_000, Column("close") > 10)
             .limit(100).get_scanner_data())
```
`df` includes `ticker` automatically. Coverage probe: `change|1|5|15|30|60`,
`volume_change|5|15`, `VWAP`, `Volatility.D/W`, `Perf.W`, `change_abs`,
`average_volume_10d_calc`, `market_cap_basic`, `type`, `exchange`, `update_mode`
are 100% non-null in both India and America (relative/average volume 99/100 in
America). `relative_volume_5d_calc` / `relative_volume_1d_calc` do **not** exist.

**New free section:** "Volume surge 5m" from `volume_change|5` — no computation.

**Live-data guard:** the library probe returned `update_mode = delayed_streaming_900`
for all rows in this environment. Live sections must require `streaming`; delayed
rows get a visible delay badge and cannot feed "next minute" style sections.

## Data flow — entirely inside this app

```
TV scanner (ONE request per universe per cache window, union of active fields)
        │  close, change|1|5|15, VWAP, rvol, EMA/RSI/ATR, 52w, update_mode, ...
        v
NEW api/sections adapter — select columns + evaluate predicates; NO indicator math
        │  Upstox 1m fetch ONLY for true ORB sections (everything else is TV-only)
        v
SectionDefinition (savedConfig) ──> typed flags ──> shared TanStackTable
        │                                             │
        └──> our DockPanelSpec ──> our Home window ────┘
```
Rules: **no indicator math in Solid components** (`UI_RULES.md`); exactly **one TV request per market per cache window** (existing invariant) — user conditions are applied in Python after the fetch; `update_mode` must be selected and rows with `delayed_*` excluded from "live" sections, with a visible delay badge instead.

## Phases + acceptance

| Phase | Scope | Gate |
|---|---|---|
| P0 | descriptor types + single registry + starter presets | one source of truth; no duplicate concept branches; pure registry tests |
| P1 | CRUD modal + `user.sections` savedConfig + JSON import/export | create/edit/duplicate/delete/persist/reload; Escape + focus; 1600 & 390 screenshots read back |
| P2 | our own `api/sections` adapter: TV column union + predicate evaluation; Upstox 1m only for true ORB | parity tests vs hand-calculated TV fields; one TV request per market per window (assert via mock); no raw key; spec regenerated + drift test |
| P3 | Home windows + Screener Sections tab consume descriptors | add/remove/pin works in both; one table primitive; no nested bordered cards; keyboard order |
| P4 | Storybook story for modal states, E2E CRUD + persistence, evidence + three independent raters | all guards green; no P0/P1 |

## Risks / honesty

- Sections that need bar history (VWAP/ORB) are unavailable on snapshot-only payloads; the definition must name its required field family and show a reason-based empty state, never fabricated values.
- Local-first storage: no cross-device sync until a backend scope is added — don't imply otherwise.
- A deleted definition pinned in Home/Screener must degrade to a named empty state, not crash.
- With the standalone tool removed, we do not inherit an alert engine; our adapter must implement the concepts from our own data, and its outputs must be tested against fixtures.
