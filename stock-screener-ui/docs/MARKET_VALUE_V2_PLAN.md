# Market + Deep Value V2 — one Market surface

> Status: PLAN (not started). V1 shipped: `docs/market-screener.md` §"Market Value view (V1)",
> `docs/DEEP_VALUE_TAB_PLAN.md`. Docs-only; no code, no git in this pass.

## 0. Gate — do not start until V1 is reviewed
V1 = the `Value` view in `src/components/market/MarketMapView.tsx` (`MarketViewToggle`,
`MARKET_VIEW_OPTIONS`) swapping the table for a lazy `ValuePanel` (`embedded`/`market`
props in `src/components/value/ValuePanel.tsx`). It must be signed off in review first.
V2 supersedes that replace-the-table view; no second Value view beside it.

## 1. Goal
One Market surface (`?tab=market`) with optional value columns/filters toggled on the
existing table; value data joins by symbol instead of replacing the table with `ValuePanel`.
Deep Value tab (`?tab=deepvalue`, wired in `src/components/screener/ScreenerPage.tsx`) stays
an alias to the same data + cell registry. Default `?view=table` unchanged; `?view=value` = "value columns on" (replaces today's swap semantics).

## 2. Shared universe descriptor
- Extend `src/config/marketUniverses.ts` `MarketUniverseDescriptor` into one registry for
  MarketUniverse (`src/types/marketScreener.ts`), ValueMarket and `global`, with fields
  `currency`, `tvMarket`, `capTierDefs`, `capUnit`, `units`, `chartable`, `label`.
- `tvMarket`: india→`india`, usa→`america`, global→`global` + explicit country list
  (mirror `api/value_scan/tv_source.py`). `chartable`: NSE/BSE/US in-app, global=false.
- `resolveUniverse()` maps aliases `us|usa|america` to one key; `global` is value-only.
- Derive `MARKET_UNIVERSES` (`src/api/marketScreener.ts`) and `VALUE_MARKETS` (`src/api/valueScan.ts`) from it; no scattered `if (universe === …)`.

## 3. Joined payload
- Join key = normalized symbol. `MarketRow` + value fields (`score`, `subscores`, `peer`,
  `derived`, `flags` from `ValueRow`) → one view row; value fields nullable on no coverage.
- Pick ONE in P1: server join `GET /api/market/snapshot?withValue=1`
  (`api/market_screen/router.py` + `api/value_scan/scoring.py`), OR two requests merged in
  `src/api/marketScreener.ts`. Either way: one cache / one request per market per window
  (Market 15s; value 900s india / 3600s usa+global in `api/value_scan/cache.py`).
- Symbol rules: trim/case-normalize; keep TV `BRK.B` dots; global de-dupe by `description`/
  root symbol, keep `type=="stock"`, pick most-complete fundamentals (`tv_source.py`).
  Never key on `symbol` alone — use exchange+symbol.
- Presets/filters stay server-side in `api/value_scan/filters.py` (percentile gates, peer medians on pre-gate frame).

## 4. Column registry
- One column source on `src/components/common/TanStackTable.tsx`: groups quote
  (`close/change/volume`), technical (`rsi/adx/sma/pos52w`), value (`pe/ps/pb/fcf_yield/
  roe/score`), each with `meta.align` (text left, numbers right, badges/actions center).
  Build `marketColumns.tsx` and `valueColumns.tsx` from shared defs; value off by default.
- Reuse `ValueScoreCell` (`src/components/value/ValueScoreCell.tsx`) and
  `BadgeCell/NumCell/TextCell` (`src/components/common/tableCells.tsx`); no bespoke cells.
- Presets (`VALUE_PRESETS` in `src/api/valueScan.ts`) become filter presets in
  `src/components/market/MarketFilterRail.tsx`, not a second toolbar.

## 5. Saved config v2 + URL
- URL: `?tab=market&view=value&preset=SERIOUS&universe=us`. Add `preset`/`universe` to
  `TAB_OWNED_PARAMS.market` in `ScreenerPage.tsx`; extend `MARKET_VIEWS`/`parseMarketView`
  so `value` = columns-on; keep legacy `?tab=` → path redirects.
- `api/user_configs.py` (flat module, no `user_configs/` package): add `MarketFiltersV2`
  (bump from `MarketFiltersV1` in the same module) adding `view`, `preset`,
  `valueFields[]`, alias-aware `universe`. Migration: v1 reads tolerated
  (`extra="ignore"`), v2 defaults fill new keys, strict-write unknown-key 422 kept.
- Regenerate `openapi.yaml` via `scripts/export_openapi.py`; pass `tests/contract/test_openapi_sync.py`.

## 6. Risks
- Two TV scans / column sets: snapshot (15s) vs value (900/3600s) can disagree on price
  and name. Join on symbol, show `as_of`/stale, never mix a stale score into a live cell.
- Percentile presets vs absolute filters: presets peer-relative (`filters.py`), Market
  gates (cap, price) absolute — label each, never apply preset percentiles to snapshot columns.
- Unit mismatch: `marketCapCr`/`marketCapUsdB` (₹ Cr vs $B) vs `mcap_bn`; format from row
  currency + descriptor (`marketCapOf`, `src/components/value/valueFormat.ts`), not screen name.
- Cache invalidation: value key stays filter-free (cache scored frame, filter in Python);
  bump `MARKET_SNAPSHOT_CACHE_PREFIX` v1→v2 on row-shape change.
- Global: de-dup, currency and `fields_complete` partial-fundamentals badge carried through;
  `chartable=false` → no chart link.

## 7. Phases + tests
- P1 descriptor + aliases (§2): `src/config/marketUniverses.test.ts`, guard `ui-guard`.
- P2 joined payload / one request (§3): `tests/api/test_value_scan/`, contract
  `test_openapi_sync.py`; a new `tests/api/test_market_snapshot.py` is aspirational
  (not written yet).
- P3 column registry + value cell (§4): `marketColumns`/`valueColumns` unit,
  E2E `tests/e2e/market-screener.spec.ts` + `deep-value.spec.ts`.
- P4 URL + saved config v2 (§5): `ScreenerPage`/`useMarketConfig` unit, saved-config
  migration unit, E2E deep-link.
- Exit gate per phase: `npx vitest run <files>`, `.venv/bin/python -m pytest <files> -q`,
  `bun run lint && bun run build`, guard suite, chrome-devtools screenshot at 1600/390 in
  empty/loading/full. No full E2E locally — CI shards only.
