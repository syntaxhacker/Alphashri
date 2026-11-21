# Changelog — 2026-11-16

Branch: `feat/market-sector-multiselect` · 96 commits · 2026-11-16
Grouped by area, not by commit.

## Sorting / tables
- 3-state sort cycle: ascending → descending → clear (third click clears, not the second) — `03fb6121`
- Nulls sort last in both directions; sorts by underlying value, not formatted text — `76eda9ed`, `c10b0504`
- Controlled sort honours a late saved-config prop without fighting uncontrolled state — `5c6915b2`
- Saved per-table scopes (`table.<id>`) for sort + column prefs, capped at the DB column's 64 chars — `76529d8c`, `c8b73a14`
- Load more reaches windowed rows; a poll refresh no longer undoes it — `0cfb9e2a`, `32101459`
- Trade-history and paper trade/position sorts persist; one comparator for every backtest trade sort — `cdae0d2b`, `8b31b3a1`, `e7500340`

## Market / screener
- Grid sort and nulls persist across the screener; missing values stay null — `9aefe826`
- Inactive tabs unmount: only the active tab exists in the DOM — `31eed7c8`
- Symbol body opens the in-app chart; the arrow opens TradingView — `11748d5c`, `b7062fcd`
- Options-chain action restored in the F&O symbol cell — `d818f5e3`
- PATTERNS column from stored 1D hits; batch lookup of stored hits for table rows — `8d400460`, `e9a8c77a`
- Heatmap sort moved next to Color by; stale badge decays with the clock — `beb0d0ec`, `301a4bdf`

## Options
- Flex-sized dock keeps the payoff visible; sqrt-scaled OI bars — `48bf8b16`
- One-sided CE|PE chain below 640px; chain resets to strike order — `d37f3540`, `5e221d32`
- Escape closes the chart dock; maximize is modal (a11y) — `0397084f`, `48f63b6b`
- Failed refresh keeps polling and says why; a painted chain explains why it stopped — `602b6272`, `4ba469b9`
- Theme-aware chain chrome, solid OI bars, keyboard-sortable sticky header; POP follows IV/DTE — `5076abe5`, `8e98cd99`
- P1 dock (chain, legs, payoff, probability); 11 strategy presets built from the live chain — `e6ec94cb`, `7696aa99`
- Toast stylesheet loaded and theme-following — `0ac5d466`

## Patterns / data
- Candle-frame identity stops enrichment outliving its frame; shipped T2 shape confirmed — `fc49791f`, `628fda4d`
- `close_bar_date` exposed from the candle frame; decides dated-close vs live source — `143da4a3`, `e69334f0`
- Dated close from one bar pair with live LTP beside it; refresh action on the page — `a45ffcba`, `7560cfed`
- Fresh close never paired with a stale bar date; refresh keeps the user's selected hit — `e5baddfb`, `b5887c3f`
- Batch quotes at 20 with a neutral dash for a missing change — `17798887`

## Layout / report
- Depth view fills tall panels and scrolls short ones — `59c13f9d`
- No ghost ladder column; side rail keeps the right track (US report ladder/grid) — `05f9f5d1`
- No dead 20% pane without a pattern; closed news panel is inert — `5402492d`
- Dock outlet collapses when no dock is open — `f27d6a4d`
- Dock close span / titled modal always closable — `d3d1209b`
- Ui: theme reactivity, aria names, menu dismissal, keyboard highlight — `a0fb74bc`

## Tests / infra
- E2E: sort cycle, saved-sort hydration, persistence, dock span — `19ff0962`
- E2E: F&O symbol actions; stale hit loses to the fresh chart bar — `bbfc8725`, `96dd2242`
- E2E: 390px one-sided chain and desktop toggle; payoff footer four cells below the chart — `bc31def0`, `a7c06099`
- Removed three flaky pattern-test order dependencies — `a98413cd`
- tsc down to 347; new type errors cleared — `e387dca8`, `875b02ff`
- Lint 0 warnings / 0 errors — (verified, no commit)

## Verified
- 5,706 unit tests pass
- 34 E2E sweep pass
- 966 chart_pattern tests pass
- 20/20 live pattern sweep
- KAYNES 3430 / −1.55 with live LTP
- 52W ascending range shown
