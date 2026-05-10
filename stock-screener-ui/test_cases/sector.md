# Sector Dashboard

## Navigation & Layout
- [x] Sidebar "Sector" nav item navigates to `/sector`
- [x] Sector dashboard view is visible after navigation
- [x] URL contains `/sector` when on sector page
- [x] Page title "Sector Dashboard" is displayed
- [x] Subtitle mentions real-time sector performance
- [x] Page displays properly on desktop (1280×720) viewport
- [x] Page displays properly on tablet (768×1024) viewport
- [x] Page displays properly on mobile (375×667) viewport
- [x] Navigation away from sector view works (back to other views)

## Market Selector (India/US)
- [x] India market toggle button is visible in header
- [x] US market toggle button is visible in header
- [x] Clicking US toggle switches to US market data
- [x] Clicking India toggle switches back to India market data
- [ ] Data refreshes when market toggle changes

## Tabs
- [x] Live Dashboard tab is active by default
- [x] Live Dashboard tab has `aria-selected="true"` by default
- [x] Sector Correlation tab is visible
- [x] Historical Cycles tab is visible
- [x] Clicking Historical Cycles tab shows iframe
- [x] Iframe src contains `/sector/dashboard-modular.html`
- [x] Dashboard content is hidden when on Historical Cycles tab
- [x] Switching back to Live Dashboard tab re-shows table
- [x] Clicking Sector Correlation tab shows correlation components

## Refresh Button
- [x] Refresh button is visible in header
- [x] Refresh button is enabled when not loading
- [x] Refresh button triggers data reload on click
- [ ] Refresh button shows loading state while fetching

## Live Dashboard - Summary Cards
- [ ] Top Sector card displays the top-performing sector name
- [ ] Top Sector card shows avg change value
- [x] Market Breadth card displays UP count badge
- [x] Market Breadth card displays DOWN count badge
- [ ] Weakest Sector card displays weakest sector name
- [ ] Weakest Sector card shows avg change value

## Live Dashboard - Sector Performance Table
- [x] Sector table is visible
- [x] Table header shows "Sector" column
- [x] Table header shows "Change" column
- [x] Table header shows "Movement" column
- [x] Table header shows "A/D Ratio" column
- [x] Table header shows "Strength" column
- [x] Table header shows "Top Movers" column
- [x] Each sector row shows sector name
- [x] Change value is color-coded green for positive / red for negative
- [x] Change value shows +/- prefix
- [x] Movement bar renders with capped width between 0-100%
- [x] A/D Ratio shows advances:declines text
- [x] Strength badge shows correct label (Strong/Neutral/Weak) based on ADX
- [x] Top Movers text is displayed
- [x] Empty state shows "No sector data available" when sectors array is empty

## Live Dashboard - Live Sector Map (Treemap)
- [x] Treemap container is rendered
- [x] Treemap tiles display sector name
- [x] Treemap tiles display percentage change
- [x] Treemap tiles display stock count
- [x] Treemap tiles display advance/decline ratio
- [x] Treemap tiles are color-coded by change intensity (strong/mild/faint green/red/gray)
- [x] Top sector tile spans 2 columns and 2 rows
- [x] Treemap data is sorted by absolute avg change descending
- [x] Zero change sectors use minimum value of 0.01 for sizing
- [x] Treemap does not mutate original sectors array

## Live Dashboard - Real-time Alerts
- [x] Real-time Alerts section is visible
- [x] Empty state shows "Waiting for major movements..." when no alerts
- [x] Alert items display timestamp, sector name, and direction badge
- [x] SURGING alerts show green badge with green-tinted background
- [x] DROPPING alerts show red badge with red-tinted background
- [x] Alert delta is formatted as percentage
- [x] Alerts are capped at 10 items maximum
- [x] Alerts with delta >= 0.3 are detected as SURGING
- [x] Alerts with delta <= -0.3 are detected as DROPPING
- [x] Alerts ignore sectors with no previous data
- [x] Alerts ignore changes below the 0.3 threshold
- [x] Each alert has a timestamp

## Live Dashboard - Interval Movers
- [x] Interval Movers section is visible
- [x] Empty state shows "Collecting baseline for interval moves..." when no movers
- [x] Mover rows show symbol, previous change, current change, and delta
- [x] Delta value is color-coded by PnL color
- [x] Movers with delta >= 0.3 are detected
- [x] Movers with no previous data are ignored
- [x] Results are sorted by absolute delta descending
- [x] Results include prev_change and delta fields

## getMovementBarValue (utility)
- [x] Returns 50% capped value for zero change
- [x] Returns green color for positive change
- [x] Returns red color for negative change
- [x] Caps at 100% for large positive change (>= 3%)
- [x] Caps at 0% for large negative change (<= -3%)
- [x] Handles fractional changes correctly (e.g., 0.5 → 58.33%)

## getStrengthInfo (utility)
- [x] Returns `{label: "Strong", color: "green"}` for ADX > 25
- [x] Returns `{label: "Weak", color: "red"}` for ADX < 15
- [x] Returns `{label: "Neutral", color: "gray"}` for ADX between 15 and 25 (inclusive)
- [x] Handles boundary values: 15.01 → Neutral, 24.99 → Neutral, 25.01 → Strong, 14.99 → Weak
- [x] Handles negative ADX edge case (returns Weak)

## Sector Correlation Tab
- [x] Correlation tab renders heatmap panel with canvas
- [x] Correlation tab renders beta vs benchmark bar chart
- [x] Beta chart displays "Benchmark" text
- [x] Beta chart displays "Beta" label
- [ ] Beta chart shows beta = 1.0 reference line
- [x] Relative Strength table shows Rank, Sector, 5D RS, 1M RS, 3M RS, Beta, 1M Change columns
- [x] Relative Strength table contains Indian sectors (NIFTY 50, NIFTY BANK) for India market
- [x] Relative Strength table contains US sectors (SPY, XLK) for US market
- [x] Rotation timeline chart is visible with "Sector Rotation" text
- [x] Market segmented control switches between India and US in correlation tab
- [x] Lookback period segmented control (5D, 1M, 3M, 6M, 1Y) changes lookback and refreshes data
- [x] Last updated timestamp is displayed as HH:MM:SS AM/PM format
- [ ] Loading state shows "Loading sector correlation..." with spinner
- [ ] Error state shows error message with Retry button
- [ ] Empty data state shows "No correlation data available"

## Data Loading & Polling
- [ ] Initial data load happens on mount
- [ ] Loading state is shown during initial fetch
- [ ] Error state is shown on fetch failure with Retry button
- [ ] Empty panel is shown when response has no sectors
- [ ] Data is polled every 60 seconds after initial load
- [ ] Fast polling (5s) occurs for first 2 poll cycles
- [ ] Abort controller cancels in-flight requests on unmount
- [ ] Previous sector data is tracked across fetches for alert detection
- [ ] Previous stock data is tracked across fetches for mover detection

## Loading & Error States
- [ ] Initial loading shows "Fetching sector performance" text with spinner
- [ ] Error panel shows error message with Retry button
- [ ] Empty data panel shows "No sector data available for this market."
- [ ] Historical Cycles tab does not trigger sector data polling
