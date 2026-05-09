# Options

## Navigation & Container
- [x] Sidebar "Options" nav item navigates to options view
- [x] Direct URL `/options` loads options view
- [x] Options container is rendered with `data-testid="options-container"`
- [x] OptionsPage child component is rendered inside container
- [x] Active tab defaults to "chain"
- [x] Options state (chainData, positions, selectedSymbol, loading, error) is passed to OptionsPage

## Tab Navigation
- [x] Option Chain tab is rendered and clickable
- [x] Positions tab is rendered and clickable
- [x] Greeks tab is rendered and clickable
- [x] Option Chain panel is displayed by default
- [x] Clicking Positions tab shows Positions panel
- [x] Clicking Greeks tab shows Greeks panel
- [x] Clicking Option Chain tab shows chain panel again

## Option Chain Panel - Header & Controls
- [x] Underlying select is visible and populated
- [x] Underlying select triggers data refresh on change
- [x] Expiry select is visible and populated
- [x] Expiry select triggers data refresh on change
- [x] Option Chain title is displayed
- [x] LiveSpotChart mini chart is rendered
- [x] Timestamp badge shows data freshness time
- [x] Timestamp tooltip shows full date/time on hover
- [x] Guide button is visible and opens guide modal
- [x] Guide modal displays "How to Read the Option Chain"
- [x] Guide modal shows Call/PE explanation cards
- [x] Guide modal shows PCR, Max Pain, OI indicator explanations
- [x] Guide modal shows sentiment badge meanings (LB, SB, SC, LU)
- [x] Guide modal shows pro tip
- [x] Guide modal closes on Escape key
- [x] Underlying-expiry selection label shows current selection
- [x] Refresh icon refreshes chain data on click
- [x] Refresh icon is disabled (dimmed) while loading

## Option Chain Panel - Filters
- [x] Option type filter (Both CE/PE, Calls Only, Puts Only) is present
- [x] Option type filter applies filtering to chain table
- [x] Moneyness filter (All, ITM, OTM) is present
- [x] Moneyness filter applies filtering to chain table
- [x] Strike Min number input is present
- [x] Strike Max number input is present
- [x] Strike range filters apply to chain table

## Option Chain Panel - Loading / Error / Empty
- [x] Loading state shows spinner with "Loading option chain..." text
- [x] Error state shows red alert with error message
- [x] Empty state (no strike matrix) shows yellow alert "No options data available"
- [x] Chain data loads and renders when available

## Option Chain Table
- [x] Chain table is rendered with `data-testid="options-chain-table"`
- [x] Table header shows CALLS (CE), STRIKE, PUTS (PE) labels
- [x] Subheader shows column labels: OI, OI CHG, VOL, IV, LTP (per side)
- [x] Each strike row displays strike price prominently
- [x] Strike rows have `data-testid="options-chain-row-{strike}"`
- [x] Strike cells have `data-testid="strike-cell"`
- [x] Strike prices like 23900 and 24000 are visible in table
- [x] ATM row is highlighted with yellow tint
- [x] Auto-scroll to ATM row on load
- [x] CE columns show OI, OI Change, Volume, IV, LTP
- [x] PE columns show LTP, IV, Volume, OI Change, OI
- [x] OI values are formatted with thousand separators
- [x] OI change values are color-coded (green for positive, red for negative)
- [x] OI columns show horizontal bar visualization proportional to max OI
- [x] Tooltip on hover shows full contract details (trading symbol, OI, OI change %, greeks, bid/ask)
- [x] Sentiment badges (LB, SB, SC, LU) appear next to OI change when applicable
- [x] LTP cells show delta progress bar below value
- [x] Moneyness coloring: ITM calls show green tint, ITM puts show red tint
- [x] Scroll actions: Scroll to Top button is present
- [x] Scroll actions: Jump to ATM button is present
- [x] Scroll actions: Scroll to Bottom button is present
- [x] Jump to ATM button scrolls to ATM row smoothly
- [x] Footer shows ITM (In The Money) legend item
- [x] Footer shows ATM (At The Money) legend item
- [x] Footer shows sentiment badge legend (LB, SB, SC, LU)
- [x] Footer shows current spot price

## Chain Summary
- [x] Chain summary panel is visible with `data-testid="chain-summary"`
- [x] PCR value is displayed with correct color coding (>1.2 green, <0.7 red, 0.7-1.2 blue)
- [x] PCR bias text ("Bullish bias" or "Bearish bias") is shown
- [x] Ring progress chart shows CE/Put OI ratio
- [x] Market Range shows expected move lower-upper range
- [x] Support/Resistance strikes are displayed (SUP/RES labels)
- [x] Max Pain value is displayed
- [x] computeStats returns pcr from summary when available
- [x] computeStats returns 0 for all fields when no summary provided
- [x] Resistance strike is found as strike with highest CE OI
- [x] Support strike is found as strike with highest PE OI
- [x] Returns 0 for resistance/support when all OI values are 0
- [x] Expected move is returned from summary
- [x] Expected move returns null when not in summary

## Deep OI Analysis Tab
- [x] OI Analysis view is shown when switching to Analysis tab
- [x] OI Spikes panel lists top 6 OI gainers sorted by change %
- [x] Each spike shows type (CE/PE), strike, activity type badge (Speculative/Positional)
- [x] OI spike values show percentage change and absolute change in thousands
- [x] OI Distribution chart (ECharts bar chart) renders CE and Put OI changes
- [x] Market Context panel shows analysis text about strongest spike
- [x] IV Skew chart renders volatility smile line chart
- [x] IV Skew chart displays "VOLATILITY SMILE (IV SKEW)" title

## Option Alerts (Smart Money)
- [x] Alerts panel displays "LIVE SMART MONEY ALERTS" header
- [x] "Scanning Live" status badge is shown
- [x] Empty state shows "Waiting for unusual activity patterns..."
- [x] Wall alert triggers when OI change > 40% and change > 50000 contracts
- [x] Squeeze alert triggers when price rises and CE OI drops > 20000 above spot
- [x] Volume spike alert triggers when volume > 100000 and OI change > 20%
- [x] Alerts are sorted with Squeeze type first
- [x] Alerts are capped at 5 maximum
- [x] Timeline displays alert items with icon, title, intensity badge, and description
- [x] Profit tip box is displayed at bottom

## Positions Tab
- [x] Positions panel shows "Option Positions" title
- [x] Loading state shows "Loading positions..."
- [x] Error state shows error alert
- [x] Empty state shows "No open positions"
- [x] Position rows show Symbol, Type (CE/PE badge), Strike, Qty, Avg Price, LTP, P&L
- [x] P&L values are color-coded (green for profit, red for loss)

## Greeks Tab
- [x] Greeks panel shows "Greeks Analysis" title
- [x] Greeks panel shows placeholder content

## Utility Functions
- [x] computePcrColor returns green for PCR > 1.2
- [x] computePcrColor returns red for PCR < 0.7
- [x] computePcrColor returns blue for PCR between 0.7 and 1.2 (inclusive)
- [x] computeStats handles empty strike matrix gracefully
- [x] computeStats handles missing market_data gracefully
- [x] computeStats picks first strike when multiple have equal max OI
- [x] computeStats returns all zeros when summary is undefined
