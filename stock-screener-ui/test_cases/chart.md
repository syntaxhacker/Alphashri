# Chart — Test Checklist

## ChartView
- [x] Renders chart view container with data-testid
- [x] Fetches chart data on mount with symbol from URL params
- [x] Shows loading state while data is being fetched
- [x] Shows error state with retry button when fetch fails
- [x] Renders timeframe selector
- [x] Changes timeframe when selector changes (re-fetches data)
- [x] Renders OR minutes selector
- [x] Changes OR minutes when selector changes (re-fetches data)
- [x] Shows toggle for pivots visibility
- [x] Toggles pivots checkbox on/off
- [x] Shows toggle for 52W high visibility
- [x] Navigates back when back button clicked
- [x] Displays chart footer with candle count, timeframe, OR, 52W high
- [x] Initializes echarts instance when data loads
- [x] Disposes echarts instance on component unmount
- [x] Shows retry button in error state
- [x] Navigates back to screener when symbol param is missing
- [x] Renders ChartError when symbol is empty

## chartRenderer — buildChartOption
- [x] Returns null for empty candles array
- [x] Returns null for undefined candles
- [x] Builds a valid option object for preview size
- [x] Builds valid option with correct initial series count (3 base: candle + OR high + OR low)
- [x] Uses dark theme colors by default (#0a0a0a background)
- [x] Uses light theme colors when isDark is false (#ffffff background)
- [x] Includes title for non-preview sizes (expanded, full)
- [x] Omits title for preview size
- [x] Includes legend for non-preview sizes
- [x] Omits legend for preview size
- [x] Includes dataZoom for non-preview sizes
- [x] Includes slider dataZoom for full size (2 dataZoom entries)
- [x] Includes pivot series when showPivots is true (6 series total)
- [x] Does not include pivot series when showPivots is false
- [x] Includes 52W high line when show52wHigh and high_52w provided
- [x] Correct grid dimensions for preview (left: 40, right: 15)
- [x] Correct grid dimensions for full (top: 50, left: 50)
- [x] X-axis labels hidden for preview
- [x] X-axis labels shown for non-preview with rotation
- [x] Tooltip trigger is "axis"
- [x] Candlestick series has bullish/bearish colors
- [x] ORB high line is dashed blue
- [x] ORB low line is dashed darker blue
- [x] 52W high line is dotted orange
- [x] Disables animation for preview size
- [x] Enables animation for non-preview sizes
- [x] Y-axis formatter adds ₹ prefix

## chartRenderer — buildORBLine
- [x] Returns all nulls when orb_zones is empty
- [x] Returns all nulls when orb_zones is undefined
- [x] Maps high ORB levels to matching dates
- [x] Maps low ORB levels to matching dates
- [x] Uses date_raw as key when available
- [x] Handles multiple orb zones across different dates
- [x] Returns null for dates without matching zone

## chartRenderer — buildPivotSeries
- [x] Returns empty array when pivot_levels is empty
- [x] Returns empty array when pivot_levels is undefined
- [x] Builds R1, PP, S1 series for matching dates
- [x] Series names are "R1", "PP", "S1"
- [x] Handles multiple pivot levels across dates
- [x] Returns null for dates without matching pivot

## chartRenderer — formatTimeLabel
- [x] Extracts time part from ISO string (T separator)
- [x] Extracts time part with seconds (strips seconds)
- [x] Returns original value if no T separator
- [x] Returns original value if empty string
- [x] Handles time part only after T

## chartRenderer — formatTooltip
- [x] Returns empty string when no candlestick param found
- [x] Returns empty string when candle index is out of bounds
- [x] Renders tooltip with date, time_str, O, H, L, C labels
- [x] Shows positive change percentage for bullish candle
- [x] Shows negative change percentage for bearish candle
- [x] Handles zero open price

## PreviewChartProvider
- [x] Provides context functions without crashing
- [x] Shows hover preview after debounce (300ms)
- [x] Hides hover preview on hidePreviewChart call
- [x] Shows expanded panel on toggleExpandedChart call
- [x] Collapses expanded panel on collapseChart call
- [x] Collapses when same symbol toggled again (toggle expands then collapses)
- [x] Removes hover DOM on hide
- [x] Removes expanded DOM on collapse
- [x] Fetches chart data for hover preview
- [x] Fetches chart data for expanded panel
- [x] HoverPreview renders symbol, timeframe label, and echarts container
- [x] HoverPreview shows loading state
- [x] HoverPreview shows "No data" when candles empty
- [x] ExpandedPanel renders symbol with candle count
- [x] ExpandedPanel has timeframe/orMinutes selects
- [x] ExpandedPanel has close button
- [x] ExpandedPanel has "Open Full Chart" link
- [x] Changing timeframe in expanded refetches data
- [x] Changing OR minutes in expanded refetches data
- [x] Expands initializes echarts on data
- [x] Hover initializes echarts on data
- [x] Error handling with deduped notifications

## previewChart (legacy module)
- [x] showPreviewChart creates hover container on body
- [ ] Positions hover container near mouse cursor
- [ ] Adjusts position near screen edges
- [ ] Shows loading state then renders chart
- [x] hidePreviewChart hides hover container
- [x] Debounce delay (300ms) before showing hover
- [ ] Does not show hover when expanded mode is active
- [x] toggleExpandedChart creates expanded panel DOM
- [x] toggleExpandedChart collapses if same symbol clicked again
- [ ] Expanded panel has timeframe/or minutes selects
- [ ] Expanded panel has close button via × or backdrop click
- [x] Collapsing hides expanded container and disposes echarts
- [x] navigateToFullChart navigates via history API + popstate
- [x] setPreviewTimeframe changes timeframe and re-fetches
- [x] setPreviewOrMinutes changes OR and re-fetches
- [ ] Error in fetch shows error message in container
- [x] initPreviewChartHandlers registers window-level functions

## useECharts
- [x] Returns chartRef, chartInstance, and setChartOption
- [x] Initializes chart on first setChartOption call
- [x] Initializes chart without theme (null theme)
- [x] Registers click handler when onChartClick provided
- [x] Does not register click handler without onChartClick
- [x] Calls setOption with not-merge flag (true) and resizes
- [x] Does nothing when echarts library not available
- [x] Adds window resize listener on mount
- [x] Adds ResizeObserver when available
- [x] Handles multiple setChartOption calls
- [x] Retains click handler reference across option updates
- [x] Disposes chart instance on unmount

## TradingChart
- [x] Renders chart container ref
- [x] Shows Loader when isLoading is true
- [x] Forwards zoomToTradeByTime and zoomToTradeByIndex via imperative handle
- [x] Calls buildChartOption with input
- [x] Calls setChartOption from useECharts
- [x] Handles trade click via scatter series click
- [x] Extracts time strings from candle data for zoom references

## E2E
- [x] Chart page loads with symbol from navigation
- [x] Candlestick chart renders with correct data
- [x] Timeframe selector changes data granularity
- [x] Pivot toggle hides/shows pivot lines
- [ ] 52W high toggle hides/shows 52W line
- [x] Chart footer shows correct stats
- [x] Back button navigates to previous page
- [x] Error state shows retry option
