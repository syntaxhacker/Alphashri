# shared

## DataTable
- [x] renders children
- [x] passes striped, highlightOnHover, withTableBorder, withColumnBorders, stickyHeader
- [x] passes dataTestId, className, styles
- [x] passes through verticalSpacing and horizontalSpacing
- [x] scrollable wraps in ScrollArea with flex={1}
- [x] scrollable=false renders plain table
- [x] defaults striped=true, highlightOnHover=true, withTableBorder=false, withColumnBorders=false, stickyHeader=false

## SortableHeader
- [x] renders label text
- [x] shows up arrow when sorted ascending
- [x] shows down arrow when sorted descending
- [x] hides arrow when not the active sort column
- [x] calls onSort with columnKey on click
- [x] does not call onSort when sortable=false
- [x] does not set inline cursor style
- [x] renders children prop
- [x] renders with custom testId
- [x] renders extraContent alongside the label
- [x] renders both children and extraContent

## BadgeComponents

### SideBadge
- [x] renders BUY with green color and arrow
- [x] renders SELL with red color and arrow
- [x] renders LONG as green without arrow
- [x] renders SHORT as red without arrow
- [x] renders lowercase as uppercase with arrow
- [x] renders with data-testid
- [x] renders with custom size
- [x] renders unknown side without arrow

### ExitReasonBadge
- [x] renders TP with green color
- [x] renders SL with red color
- [x] renders stop_loss as SL with red
- [x] renders target as Target with green
- [x] renders trailing_stop as Trail with orange
- [x] renders eod with orange
- [x] renders unknown reason as-is
- [x] renders with data-testid
- [x] renders with custom size

### StatusBadge
- [x] renders Running when running=true
- [x] renders Running with PID when running=true and pid provided
- [x] renders Stopped when running=false
- [x] renders with data-testid
- [x] renders with custom size
- [x] renders "Unknown (Redis unavailable)" when statusUnknown=true

## PnlText
- [x] renders positive value with + prefix
- [x] renders negative value with - prefix
- [x] renders zero as +0
- [x] renders custom children instead of default text
- [x] renders with data-testid
- [x] renders as span when span=true
- [x] renders with custom font weight
- [x] renders with custom size
- [x] renders with margin left

## PnlBadge
- [x] renders positive value as badge
- [x] renders negative value as badge
- [x] renders zero as +0
- [x] renders custom children
- [x] renders with data-testid
- [x] renders with custom size

## TableEmptyState
- [x] renders message text
- [x] renders correct test id (table-empty-state)
- [x] renders icon when provided
- [x] renders action when provided
- [x] renders without icon or action

## TableLoadingState
- [x] renders with default message "Loading..."
- [x] renders correct test id (table-loading-state)
- [x] renders custom message
- [x] shows spinner by default
- [x] hides spinner when showSpinner=false
- [x] renders children instead of message

## ClickableSymbol
- [x] renders symbol as clickable Anchor
- [x] navigates to /chart/{symbol} on click
- [x] calls onClick when provided
- [x] stops click propagation when stopClickPropagation=true
- [x] shows preview chart on hover when showPreview=true
- [x] hides preview chart on mouse leave
- [x] debounces hover preview with timeout

## CompactPage
- [x] renders children
- [x] renders string title
- [x] renders string description
- [x] renders actions
- [x] renders without header when no title, description, or actions
- [x] renders ReactNode title directly

## CompactPanel
- [x] renders children
- [x] renders string title
- [x] renders string description
- [x] renders action
- [x] sets testId
- [x] renders without header when no title, description, or action
- [x] scrollable wraps children in scrollable Box

## CompactStat
- [x] renders label and value
- [x] renders string hint
- [x] renders number hint
- [x] renders ReactNode hint
- [x] does not render hint when not provided

## CompactStatGrid
- [x] renders children

## ChatPopup
- [x] renders floating action button
- [x] opens chat window when FAB is clicked
- [x] closes chat window when FAB is clicked again
- [x] shows availability status on first open
- [x] shows unavailable badge when service not available
- [x] shows welcome message when no messages
- [x] calls health check on first open
- [x] has message input field
- [x] has send button
- [x] expands to full screen mode
- [x] history sidebar loads conversations
- [x] deletes conversation from history
- [x] starts new conversation from history
- [x] switches conversation from history
- [x] sends messages and receives responses
- [x] streams analysis with progress events
- [x] renders markdown content via react-markdown

## CorrelationHeatmap
- [x] renders ECharts heatmap with matrix data
- [x] shows loading state
- [x] shows "No correlation data available" when no data
- [x] renders with testId
- [x] uses custom valueFormatter when provided
- [x] supports dark mode theme

## states.tsx (InlineLoader, EmptyState, ErrorAlert, EmptyCompact)
- [x] InlineLoader renders Loader component
- [x] InlineLoader renders data-testid
- [x] EmptyState renders title and description
- [x] EmptyState renders emoji
- [x] EmptyState renders without description
- [x] ErrorAlert renders error message
- [x] ErrorAlert renders custom title
- [x] ErrorAlert renders close button when onClose provided
- [x] ErrorAlert renders retry button when withRetry=true
- [x] EmptyCompact renders inside CompactPanel

## PreviewChartProvider
- [x] provides context functions without crashing
- [x] shows hover preview after 300ms debounce
- [x] hides hover preview on hide call
- [x] shows expanded panel on toggle
- [x] collapses expanded panel on collapse call
- [x] collapses when same symbol toggled again
- [x] HoverPreview shows symbol, timeframe badge, loading state
- [x] HoverPreview renders ECharts container when data loaded
- [x] HoverPreview shows "No data" when no candles
- [x] ExpandedPanel shows timeframe Select
- [x] ExpandedPanel shows OR minutes Select
- [x] ExpandedPanel has close button
- [x] ExpandedPanel has "Open Full Chart" link
- [x] ExpandedPanel shows loading state
- [x] ExpandedPanel shows "No data available" when empty
- [x] ExpandedPanel changes timeframe and refetches data

## previewChart.ts (legacy module)
- [x] showPreviewChart debounces and creates hover container
- [x] hidePreviewChart clears hover timer and hides container
- [x] toggleExpandedChart creates expanded panel
- [x] collapseChart clears expanded panel
- [x] navigateToFullChart uses history API
- [x] setPreviewTimeframe updates expanded chart
- [x] setPreviewOrMinutes updates expanded chart
- [x] initPreviewChartHandlers attaches to window
