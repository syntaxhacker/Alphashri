# LoginForm (LoginForm2.tsx)

- [x] Renders `data-testid="login-form"` with email, password inputs, and submit button
- [x] Renders "Alphashri" header with "Sign in to your account" subtitle
- [x] Shows error alert when `error` is set from `useAuth`
- [x] Calls `login(email, password)` on form submit
- [x] Calls `onSuccess` callback when login succeeds
- [x] Shows loading state on submit button
- [x] Register link is shown when `onSwitchToRegister` is provided
- [x] Clicking register link calls `clearError` then `onSwitchToRegister`

# validateRegistration

- [x] Returns null for valid matching passwords
- [x] Returns null for passwords of exactly 6 characters
- [x] Returns "Passwords do not match" when passwords differ
- [x] Returns password length error for < 6 characters
- [x] Returns password length error for empty string
- [x] Returns mismatch error before length check
- [x] Handles passwords with special characters

# RegisterForm

- [x] Renders `data-testid="register-form"` with all required fields
- [x] Shows error when form validation fails (password mismatch or too short)
- [x] Shows error from `useAuth.error` when API call fails
- [x] Calls `register(email, password, displayName)` on submit
- [x] Calls `onSuccess` callback when registration succeeds
- [x] Login link is shown when `onSwitchToLogin` is provided
- [x] Clicking login link clears errors and calls `onSwitchToLogin`

# AuthProvider2

- [x] Provides `AuthContext` via `AuthContext.Provider`
- [x] Renders `data-testid="auth-provider"` wrapper
- [x] `useAuth` throws if used outside `AuthProvider`
- [x] `getAccessToken` returns token from localStorage
- [x] `fetchWithAuth` adds `Authorization: Bearer` header when token exists
- [x] `fetchWithAuth` does not add header when no token
- [x] `login` calls `/api/auth/login` and stores tokens on success
- [x] `login` stores user data from `/api/auth/me` on success
- [x] `login` returns `{ success: false, error }` on failure
- [x] `register` calls `/api/auth/register` and stores tokens on success
- [x] `register` stores user from `/api/auth/me` on success
- [x] `register` returns error on failure
- [x] `logout` calls `/api/auth/logout` and clears stored tokens/user
- [x] `checkAuth` validates stored token via `/api/auth/me`
- [x] `checkAuth` tries refresh if `/api/auth/me` fails
- [x] `checkAuth` clears auth if refresh fails
- [x] `clearError` sets error state to null
- [x] `isAuthenticated` is true only when user + token exist
- [x] Loading state is managed correctly

# state/auth.ts (legacy subscriber store)

- [x] `getAccessToken` returns token from localStorage
- [x] `getRefreshToken` returns refresh token from localStorage
- [x] `setTokens` stores both tokens
- [x] `clearTokens` removes all auth localStorage keys
- [x] `getStoredUser` returns parsed user from localStorage
- [x] `getStoredUser` returns null on parse failure
- [x] `setStoredUser` stores user in localStorage
- [x] `login` calls `/api/auth/login` and updates state
- [x] `login` fetches user from `/api/auth/me` and updates state
- [x] `login` returns error on failure
- [x] `register` calls `/api/auth/register`
- [x] `logout` calls `/api/auth/logout` and clears state
- [x] `checkAuth` validates token via `/api/auth/me`
- [x] `checkAuth` attempts token refresh on 401
- [x] `checkAuth` clears state if refresh fails
- [x] `fetchWithAuth` adds Authorization header
- [x] `initAuth` runs `checkAuth`
- [x] Subscriber notification works via `subscribe`/`notifyAuth`

# AppLayout

- [x] Renders `data-testid="app-shell"` with header, navbar, and main sections
- [x] Renders app logo with "Alphashri" text
- [x] Renders `MarketTicker` in header
- [x] Renders `NewsPanel2` in header
- [x] Renders `NavbarNested` in navbar
- [x] Passes `activePath` from `useLocation` to `NavbarNested`
- [x] Children are rendered in `AppShell.Main`
- [x] Navbar collapse toggle modifies width between 80 and 200px
- [ ] Uses theme colors for background and text

# NavbarNested

- [x] Renders `data-testid="sidemenu"` container
- [x] Renders navbar links section
- [x] Renders navbar footer
- [x] Renders all non-admin nav items: Screener, News, Backtest, Paper Trading, Replay, Sector Analysis, Strategies, Bots, Options, Settings
- [x] Does not render Admin link for non-admin users
- [x] Renders Admin link for admin users
- [x] Renders UserButton in footer
- [x] Renders theme toggle button
- [x] Renders sidebar collapse toggle when not collapsed
- [x] Hides sidebar collapse toggle when collapsed
- [x] Passes `activePath` to nav links (sets data-active)
- [x] Marks inactive nav links as not active
- [x] Calls `toggleColorScheme` when theme toggle is clicked
- [x] Calls `onToggleCollapse` when collapse toggle is clicked
- [x] Passes `collapsed` prop to nav links
- [x] Renders UserButton with collapsed prop

# NavbarLinksGroup

- [x] Renders nav item label text
- [x] Renders with `data-active` attribute when `active` is true
- [x] Renders without `data-active` when `active` is false
- [x] Renders icon component
- [x] Calls `navigate(link)` and `onNavigate()` when clicked
- [x] Renders with correct `id` based on label
- [x] Handles "Paper Trading" label transformation to `nav-paper`
- [x] Handles "Sector Analysis" label transformation to `nav-sector`
- [x] Renders Tooltip wrapper when collapsed

# UserButton

- [x] Renders `data-testid="user-menu-trigger"` button
- [x] Displays user display name from `window.__ALPHASHRI_USER__`
- [x] Displays user email
- [x] Renders user avatar
- [x] Shows user info (name + email) when not collapsed
- [x] Hides user info when collapsed
- [x] Renders dropdown with logout button
- [x] Calls `window.handleLogout` when logout is clicked
- [x] Applies collapsed styling to trigger button
- [x] Renders without crashing when no global user (falls back to "User"/"user@example.com")
- [x] Does not throw when `window.handleLogout` is not defined

# MarketTicker

- [x] Renders `data-testid="market-ticker"` container
- [x] Fetches ticker data from API on mount
- [x] Displays ticker items after loading (Nifty 50, Bank Nifty, etc.)
- [x] Shows positive change badge with "+" prefix
- [x] Shows negative change badge with "-" prefix
- [x] Displays loading state with skeleton elements
- [x] Handles fetch error and shows "Market data unavailable"
- [x] Displays custom labels for known symbols (^NSEI → "Nifty 50")
- [x] Falls back to raw symbol for unknown tickers
- [x] Shows "Updated:" timestamp
- [x] Orders tickers by priority (^NSEI, ^NSEBANK, GC=F, SI=F, CL=F, USDINR=X)
- [x] Polls every 5 minutes (300000ms)
- [x] Returns null (renders nothing) when market ticker is disabled

# ChatPopup

- [x] Renders floating action button (`data-testid="chat-popup-toggle"`)
- [x] Opens chat window when FAB is clicked
- [x] Shows "Unavailable" badge when health check returns unavailable
- [x] Renders message input field and send button
- [x] Closes chat window when FAB is clicked again
- [x] Displays welcome message "Ask me to analyze a stock!" when no messages
- [x] Calls health check on first open
- [x] Sends user message on Enter key (without Shift)
- [x] Shows loading state with progress bar during analysis
- [ ] Displays agent progress indicators during stream
- [x] Shows tool calls when streaming
- [x] Expands/collapses via max-min buttons
- [x] Conversation history sidebar toggles via history button
- [x] New conversation button creates empty conversation
- [x] Delete conversation removes it from history list
- [x] Switching conversation loads its messages
- [ ] Render reports section when analysis completes
- [ ] Badge shows ticker and decision (BUY/SELL/HOLD)

# E2E — Login

- [x] Shows login form when not authenticated
- [x] Shows register link on login form
- [x] Logs in successfully with valid credentials (redirects to app shell)
- [x] Shows error message with invalid credentials
- [x] Validates email format via HTML5 validation
- [x] Requires password field via HTML5 validation

# E2E — Register

- [x] Switches to register form via link
- [x] Registers new user successfully (redirects to app shell)

# E2E — Logout

- [x] Shows user info in navbar footer
- [x] Logs out when clicking sign out (shows login form)
- [x] Clears tokens on logout

# E2E — Session

- [x] Persists session on page refresh
- [x] Redirects to login when token expired (no refresh)

# E2E — Layout App Structure

- [x] App shell is visible on page load
- [x] App header is visible
- [x] App navbar is visible
- [x] App main is visible

# E2E — Layout Theme Toggle

- [x] Theme toggle button is visible in navbar
- [x] Clicking it toggles between light/dark mode

# E2E — Layout User Menu

- [x] User menu trigger is visible in navbar footer
- [x] Clicking it opens dropdown
- [x] User avatar, display name, email are visible in dropdown
- [x] Clicking logout clears auth and redirects to root

# E2E — Layout Sidebar

- [x] Sidemenu contains all nav links (Screener, News, Backtest, Paper, Sector, Strategies, Bots, Options, Settings)
- [x] App header contains Alphashri logo
- [x] Navbar footer contains user button
- [x] Sidebar collapse toggle collapses sidebar and hides itself
- [x] When collapsed, navbar-links still exists

# E2E — Layout Market Ticker

- [x] Market ticker is visible in header
- [x] Individual ticker items (ticker-nsei, ticker-nsebank, ticker-gcf, ticker-clf) are present
- [x] Market ticker updated timestamp is visible

# E2E — Market Ticker Standalone

- [x] Displays market ticker at the top of page
- [x] Displays all 6 ticker items with labels
- [x] Displays correct ticker labels
- [x] Displays positive changes in green with "+"
- [x] Displays negative changes in red with "-"
- [x] Displays updated timestamp
- [x] Shows error state when API fails (shows "Market data unavailable")
- [x] Shows loading state initially with skeletons
- [x] Auto-refreshes ticker data (test skipped)

# E2E — App Smoke

- [x] Loads main page with title "Alphashri"
- [x] Displays data table
- [x] Displays mock stock data
- [x] Paper trading settings can be updated and persist on refresh
- [x] All settings sections (ORB, Risk Management, Runner Settings, Trading Costs) are displayed
- [x] Settings can be reset to defaults
