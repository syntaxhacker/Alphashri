# Settings

## Navigation
- [ ] Sidebar "Settings" nav item is visible
- [ ] Clicking nav-settings navigates to `/settings`
- [ ] Settings page is visible after navigation
- [ ] Direct URL `/settings` loads settings page
- [ ] Active nav state updates when on settings page
- [ ] Navigation from settings to other views works

## Page Rendering
- [x] Settings page container is rendered with `data-testid="settings-page"`
- [x] Page title "Settings" is displayed
- [x] Page description text is displayed
- [x] Broker connection card is rendered with "Upstox Connection" title
- [x] Market Ticker section is displayed

## Broker Connection Card
- [x] Connected status shows green "Connected" badge
- [x] Connected status shows "Expires in Xh Ym" text
- [x] Connected status shows Disconnect button
- [x] Disconnected status shows red "Disconnected" badge
- [x] Disconnected status shows Connect button and helper text
- [x] Null/unknown status shows gray "Unknown" badge
- [x] Expired status (negative expires_in_hours) shows yellow "Expired" badge
- [x] Refresh button is visible and clickable

## Broker Connect/Disconnect Flow
- [x] Clicking Connect button calls connectUpstox API
- [x] Clicking Disconnect button calls disconnectUpstox API
- [x] Successful disconnect shows success notification
- [x] Failed disconnect shows error notification
- [x] Loading state disables buttons (data-loading attribute)
- [x] "upstox=connected" query param triggers success notification
- [x] "upstox=connected" query param triggers status refresh
- [x] Notification duration is 5000ms for both connect and disconnect

## Broker Status Polling
- [x] Broker status is fetched on component mount
- [x] Broker status is polled every 60 seconds
- [x] Polling interval is cleared on unmount

## Market Ticker Toggle
- [x] Market Ticker label is displayed
- [x] Helper text about live indices is shown
- [x] Toggle switch is rendered
- [x] Toggle is unchecked by default
- [x] Switching toggle on calls setShowMarketTicker(true)
- [x] Switching toggle off calls setShowMarketTicker(false)

## Utility: formatExpiresIn
- [x] Formats hours and minutes correctly (e.g., 12.5 → "12h 30m")
- [x] Formats only minutes when less than 1 hour (e.g., 0.5 → "30m")
- [x] Returns empty string for null input
- [x] Handles zero minutes (0.0 → "0m")
