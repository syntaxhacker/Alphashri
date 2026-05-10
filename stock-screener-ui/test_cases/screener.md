# Screener — Test Checklist

## ScreenerPage
- [x] Renders without crashing
- [x] Displays loading state when isLoading is true
- [x] Displays error panel with retry button when error is set
- [x] Calls onRefresh when retry button is clicked
- [x] Displays empty state when approachingStocks and touchedStocks are both empty
- [x] Displays approaching section when approachingStocks exist
- [x] Displays touched section when touchedStocks exist
- [x] Renders table view by default (viewMode = "table")
- [x] Switches to heatmap view when viewMode changes to "heatmap"
- [x] Switches back to table view when viewMode changes back to "table"
- [x] Calls onScreenerChange when a different screener is selected in nav
- [x] Renders header with correct title and status props
- [x] Disables header controls when isLoading is true
- [x] Calls onRefresh when refresh button is clicked
- [x] Calls onAutoRefreshChange when auto-refresh value changes
- [x] Calls onProviderChange when provider select changes
- [x] Calls onModeChange when mode select changes
- [x] Computes total stock count correctly for status
- [x] Hides approaching section when approachingStocks is empty
- [x] Hides touched section when touchedStocks is empty
- [x] Shows both sections when both have stocks
- [x] Tabs switch between Screener / Correlation / Config
- [x] Tab value is read from URL search params
- [x] Tab change updates URL search params
- [x] Warning alert renders when warning prop is set
- [x] SelectionBar renders when stocks are selected
- [x] Compare button triggers correlation data fetch and tab switch
- [x] Clears selected symbols when switching to correlation or config tab
- [x] useScreenerSort resets sort column/direction on activeScreener change

## ScreenerNav
- [x] Renders all options from props
- [x] Marks active screener as selected (checked radio)
- [x] Calls onChange with option id when clicked
- [x] Renders tooltip when option has description
- [x] Handles options without descriptions (no tooltip)
- [x] Supports controlled state change via re-render
- [x] Renders correct data-options-count attribute
- [x] Handles single option
- [x] Handles empty options array gracefully
- [x] Renders with a different active screener
- [x] Each option has unique test ID

## ScreenerHeader
- [x] Renders title and status text
- [x] Calls onRefresh when refresh button clicked
- [x] Shows loading state on refresh button when isLoading
- [x] Disables auto-refresh input when loading
- [x] Disables provider select when loading
- [x] Disables mode select when loading
- [x] Calls onAutoRefreshChange when auto-refresh value changes
- [x] Renders provider select with Upstox and INDMONEY options
- [x] Calls onProviderChange when provider changes
- [x] Renders mode select with Intraday and 5D options
- [x] Calls onModeChange when mode changes
- [x] Renders view mode toggle (Table / Heatmap)
- [x] Calls onViewModeChange when Table button clicked
- [x] Calls onViewModeChange when Heatmap button clicked
- [x] Renders all control groups (header-controls, auto-refresh, provider, mode, view)
- [x] Shows Auto-refresh label and sec unit
- [x] Shows Provider label
- [x] Shows Mode label
- [x] Shows View as label on small screens
- [x] Handles zero auto-refresh value
- [x] Handles max auto-refresh value (3600)
- [x] Renders custom title and status
- [x] CompactPanel renders id, className, testId

## ScreenerContent
- [x] Returns ScreenerLoading when isLoading is true
- [x] Returns ScreenerErrorPanel when error is set
- [x] Calls onRefresh from error panel
- [x] Returns ScreenerEmpty when totalStocks is 0
- [x] Renders approaching section with sorted stocks
- [x] Renders touched section with sorted stocks
- [x] Uses section_labels from active screener option
- [x] Falls back to default labels when section_labels missing
- [x] Uses fallback descriptions when section_labels missing
- [x] Sorts approaching stocks by sortColumn and sortDirection
- [x] Sorts touched stocks by sortColumn and sortDirection
- [x] Passes correct columns from getColumnsForScreener
- [x] Passes empty set for touchedSymbols in approaching section
- [x] Passes correct set for touchedSymbols in touched section
- [x] Renders ScreenerStockView with correct viewMode

## ScreenerStockView
- [x] Renders ScreenerHeatmap when viewMode is "heatmap"
- [x] Renders ScreenerTable when viewMode is "table"
- [x] Passes data-testid with section suffix for both views

## ScreenerSection
- [x] Renders CompactPanel with title and description
- [x] Delegates to ScreenerStockView

## ScreenerTable
- [x] Renders table with data-testid
- [x] Renders thead with screener-table-header testId
- [x] Renders tbody with screener-table-body testId
- [x] Renders all stocks as rows
- [x] Renders sortable headers for each column
- [x] Calls onSortChange when sortable header clicked
- [x] Displays sort indicator (data-sorted, data-direction) on sorted column
- [x] Marks touched rows with data-is-touched="true"
- [x] Calls onSymbolClick when stock row clicked
- [x] Calls onSymbolHover on mouse enter and leave
- [x] Renders copy-all-symbols button when stocks exist
- [x] Hides copy-all-symbols button when stocks are empty
- [x] Renders correct number of header columns (columns + checkbox column)
- [x] Renders correct number of body rows
- [x] Handles empty stocks array gracefully
- [x] Handles single stock
- [x] Applies custom className to table
- [x] Checkbox in header for select all
- [x] Select-all checkbox is checked when all visible selected
- [x] Select-all checkbox is indeterminate when some selected

## StockRow
- [x] Renders row with correct test ID
- [x] Applies "approaching" class when isTouched is false
- [x] Applies "touched" class when isTouched is true
- [x] Renders symbol link with copy button
- [x] Calls onSymbolClick when symbol link clicked
- [x] Calls onSymbolHover on mouse enter and leave of symbol link
- [x] Shows touched badge when isTouched is true
- [x] Hides touched badge when isTouched is false
- [x] Renders score badge with correct score value
- [x] Renders numeric cells for number-type columns
- [x] Renders all column cells (one per column)
- [x] Handles missing optional day_change gracefully (shows "-")
- [x] Handles missing optional rsi gracefully (shows "-")
- [x] Renders copy symbol button
- [x] Renders sector as plain text
- [x] Handles stock with minimal/missing optional fields
- [x] Score badge has correct color class
- [x] Numeric cells have correct color class
- [x] Shows preview chart on hover via PreviewChartProvider

## ScreenerHeatmap
- [x] Renders heatmap grid with all stocks
- [x] Displays stock symbol on each card
- [x] Displays sector for each stock
- [x] Shows "Unknown sector" when sector is empty
- [x] Shows score badge for stocks with numeric score
- [x] Does not show score badge when score is not a number
- [x] Shows "Touched" badge for stocks in touchedSymbols
- [x] Hides "Touched" badge for non-touched stocks
- [x] Calls onSymbolClick when card clicked
- [x] Calls onSymbolHover on mouse enter and leave
- [x] Displays up to 4 numeric metric columns per card
- [x] Renders metric with color tone based on value
- [x] Handles empty stocks array
- [x] Handles single stock
- [x] Handles large number of stocks (10+)
- [x] Handles missing optional rsi
- [x] Handles missing optional stoch_k

## ScreenerLoading
- [x] Renders with default "Loading screener" title
- [x] Renders with custom message
- [x] Renders loader component
- [x] Has correct test ID
- [x] Handles empty string message
- [x] Applies custom className

## ScreenerEmpty
- [x] Renders with default message "No results found"
- [x] Renders with custom message
- [x] Renders icon (IconDatabaseOff)
- [x] Has correct test ID
- [x] Handles empty string message
- [x] Applies custom className

## ScreenerErrorPanel
- [x] Displays "Screener failed to load" title
- [x] Displays error message text
- [x] Renders Retry button
- [x] Calls onRefresh when Retry clicked

## ScreenerSidePanel
- [x] Shows active screener name and description
- [x] Shows indicator badges when activeOption has indicators
- [x] Renders filter inputs for each filter in profile
- [x] Renders number input for number-type filters
- [x] Renders select for select-type filters
- [x] Apply Filters button triggers fetchData
- [x] Sort button shows default sort column with direction arrow
- [x] Calling sort toggles direction on same column

## ScreenerSummary
- [x] buildSummaryItems returns items with string values
- [x] buildSummaryItems returns items with numeric values
- [x] buildSummaryItems handles empty array
- [x] buildSummaryItems handles single item
- [x] getTone returns mantine color variable when color is set
- [x] getTone returns default text color when color is undefined
- [x] getTone returns default text color when color is not set
- [x] Renders CompactStatGrid with CompactStat items
- [x] Generates sequential test IDs based on index

## SelectionBar
- [x] Renders when selectedSymbols length > 0
- [x] Returns null when selectedSymbols is empty
- [x] Shows selected count badge
- [x] Clear button calls clearSelectedSymbols
- [x] Compare button is disabled when selectedSymbols < 2
- [x] Compare button calls onCompare when clicked

## CorrelationTab
- [x] Renders main container with data-testid
- [x] MultiSelect for symbols
- [x] Calls searchSymbols on search input
- [x] Timeframe SegmentedControl switches Daily / Intraday
- [x] Period Select changes based on timeframe
- [x] Calculate button triggers fetchCorrelationData
- [x] Calculate button disabled when less than 2 symbols
- [x] Shows loading state on calculate button
- [x] Shows error Alert when error is set
- [x] Shows meta stats (Date Range, Data Points, Symbols, Timeframe) when meta exists
- [ ] Initializes symbols/timeframe/period from URL search params
- [ ] Updates URL search params on calculate
- [x] Renders CorrelationMatrix panel
- [x] Renders CorrelationChart panel

## CorrelationMatrix
- [x] Renders container when loading
- [x] Renders container when empty
- [x] Renders container with valid data
- [x] Renders with multiple symbols (5x5 matrix)
- [x] Loading state takes priority over empty state
- [x] Hides empty overlay when data present

## CorrelationChart
- [x] Renders chart container even when normalized is null
- [x] Renders chart container even when symbols are empty
- [x] Renders chart container when data is valid
- [x] Hides empty overlay when data is present
- [x] Handles symbols with no matching data in normalized
- [x] Calls setChartOption with valid data
- [x] Does not call setChartOption with empty data
- [x] Shows loading overlay when isLoading
- [x] Shows "No chart data" when not loading and no data

## filters (sortStocks)
- [x] Returns stocks unchanged when sortColumn is null
- [x] Does not mutate the original array
- [x] Sorts by symbol ascending
- [x] Sorts by symbol descending
- [x] Sorts by score ascending and descending
- [x] Sorts by tv_price, upstox_price, broker_diff
- [x] Sorts by high_52w, to_52w_high
- [x] Sorts by time_to_52w using days (defaults to 999 when undefined)
- [x] Sorts by recent_return_5d, perf_w
- [x] Sorts by day_change (undefined defaults to 0)
- [x] Sorts by rsi (undefined defaults to 0)
- [x] Sorts by stoch_k, wick_close_pct, volume_surge, atr_pct
- [x] Sorts by adx, interest_score, gap_pct, premarket_change
- [x] Sorts by impact_score, market_cap_b, volume_m
- [x] Sorts by sector (localeCompare)
- [x] Returns 0 for unknown column (maintains order)
- [x] Handles empty array
- [x] Handles single element array

## filters (handleSort)
- [x] Toggles direction to asc when same column sorted and current is desc
- [x] Sets new column with desc direction when different column
- [x] Toggles direction on same column

## filters (renderSortIndicator)
- [x] Renders empty indicator when column not sorted
- [x] Renders asc arrow when sorted ascending
- [x] Renders desc arrow when sorted descending

## filters (renderSortableHeader)
- [x] Renders label, data-column attribute, and sort-indicator
- [x] Includes className when provided
- [x] Includes tooltip title when provided
- [x] Omits tooltip when empty string
- [x] Omits tooltip when not provided

## ScreenerConfigView
- [x] Renders side panel with configs list
- [x] Highlights active screener with blue background and border
- [x] Shows active badge for current screener
- [x] Edit button opens edit modal with prefilled form
- [x] Delete button opens delete confirmation modal
- [x] Create button opens create modal
- [x] Create form validates name and columns required
- [x] Create form has indicator checkboxes (RSI, ADX, Volume, etc.)
- [x] Toggling indicator adds/removes filter inputs
- [x] Filter inputs render as NumberInput or Select based on type
- [x] Default sort column and direction selects
- [x] Create calls createScreener API on submit
- [x] Edit calls updateScreener API on submit
- [x] Delete calls deleteScreener API on confirm
- [x] Deleting active screener navigates to "trending"
- [x] Preview panel shows loading/empty/data states
- [ ] Preview refreshes on screener change with debounce
- [x] Preview has sortable table
- [x] Cancel button closes modal and resets form

## useScreenerState
- [x] Loads screeners and fetches data on mount when screenerOptions empty
- [x] Fetches data on mount when screenerOptions already exist
- [x] Uses provider and mode from state.data when available
- [x] Falls back to defaults when state.data is null
- [x] Returns approachingStocks from state.data?.approaching
- [x] Returns touchedStocks from state.data?.touched
- [x] Returns empty arrays when state.data is null
- [x] Returns screenerOptions from state
- [x] Returns activeScreener from state
- [x] Returns isLoading from state
- [x] Returns error from state
- [x] Returns autoRefreshSeconds from state
- [x] Returns provider from state.data or defaults to upstox
- [x] Returns mode from state.data or defaults to intraday
- [x] onRefresh calls fetchData with current provider, mode, activeScreener
- [x] onAutoRefreshChange calls setAutoRefreshSeconds and setupAutoRefresh
- [x] onProviderChange fetches data with new provider
- [x] onModeChange fetches data with new mode
- [x] onScreenerChange sets active screener and fetches data
- [x] onSymbolClick navigates to /chart/{symbol}
- [x] onSymbolHover is a no-op placeholder
- [x] Handles missing data gracefully
- [x] Handles undefined approaching/touched in data

## ScreenerContainer
- [x] Renders ScreenerPage
- [x] Passes screener options from hook
- [x] Passes active screener from hook
- [x] Passes loading state from hook
- [x] Passes all required props from useScreenerState

## E2E
- [x] Page loads and displays stock data
- [x] Navigation between screeners works
- [x] View mode toggle (table/heatmap)
- [x] URL params are persisted on navigation
- [x] Screener ID from URL is used on page load
- [x] Section labels reflect active screener's configuration
- [x] Approaching/Touched label customization
- [ ] Selecting stocks via checkbox
- [ ] Compare button opens correlation tab
- [x] Copy symbol buttons work
- [x] Sortable headers change sort direction
- [x] Refresh button triggers data reload
- [x] Provider/mode switches change data source
- [x] Buyer interest screener loads with correct columns
