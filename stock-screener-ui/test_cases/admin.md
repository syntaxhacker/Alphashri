# Admin

## Navigation & Auth
- [x] Admin nav item is not visible for non-admin users
- [x] Admin nav item is visible for admin users
- [ ] Admin page route `/admin` is accessible to admin users only
- [x] API endpoints return 403 for non-admin users

## AdminPage Rendering
- [x] Loading state shows "Loading LLM stats" text with spinner
- [x] Error state shows "Unable to load stats" message
- [x] Successful load shows "LLM Admin Dashboard" title
- [x] Page description text is displayed
- [x] Refresh button is visible with `data-testid="refresh-btn"`

## Stats Display
- [x] Total Runs aggregate stat is displayed
- [x] Total Tokens aggregate stat is displayed (formatted with locale)
- [x] Total Cost aggregate stat is displayed (formatted as $X.XXXX)
- [x] Avg Response Time aggregate stat is displayed (formatted as Xms)
- [x] Warning text is shown when non-fatal error exists in response

## Model Breakdown
- [x] Model Breakdown panel is rendered
- [x] Each model is displayed as a badge with count (e.g., "gpt-4: 50 runs")
- [x] Model breakdown is not rendered when models list is empty

## Recent Runs Table
- [x] "Recent Runs" panel title is displayed
- [x] Empty state shows "No recent runs" when runs array is empty
- [x] Table has `data-testid="runs-table"`
- [x] Column headers: URL, Model, Tokens, Cost, Response Time, Status, Created At
- [x] Run data shows model name (e.g., gpt-4, claude-3)
- [x] Run data shows formatted cost (e.g., $0.0450, $0.0320)
- [x] Run data shows response time (e.g., 1200ms, 1500ms)
- [x] Run data shows status text (e.g., success, pending)
- [x] Status is displayed as color-coded badge (green for success, red for error, yellow for pending)
- [x] Tokens display input+output total formatted with locale (e.g., "1,500")
- [x] Long URLs are truncated to 50 characters with "..."

## Formatter Utilities
- [x] formatCost returns `$X.XXXX` format
- [x] formatResponseTime returns `Xms` format
- [x] formatDateTime returns locale-formatted date string
- [x] formatDateTime handles invalid dates gracefully (returns raw string)
- [x] truncateUrl returns original URL if ≤ 50 chars
- [x] truncateUrl truncates to 50 chars with "..." suffix

## Data Fetching & Refresh
- [x] Stats are fetched from `/api/admin/llm-stats` on mount
- [x] fetchWithAuth is used for authenticated API call
- [x] Refresh button triggers re-fetch of stats
- [x] Refresh button shows loading state while fetching
- [x] Non-ok response shows error with status code

## Backend API: LLM Stats (`GET /api/admin/llm-stats`)
- [x] Returns total_runs, total_tokens, total_cost_usd, avg_response_time_ms
- [x] Returns success_rate as percentage
- [ ] Returns runs_by_model breakdown with count, tokens, cost
- [ ] Returns runs_by_day for last 7 days
- [x] Returns recent_runs (latest 10 runs)
- [ ] Returns empty stats when no LLM runs exist
- [x] Returns 503 when LLM analyzer is not available

## Backend API: Cache Stats (`GET /api/admin/cache-stats`)
- [x] Returns Redis cache statistics
- [x] Requires admin authentication
- [x] Returns 500 on backend error

## Backend API: Cache Stats Reset (`POST /api/admin/cache-stats/reset`)
- [x] Resets Redis cache statistics
- [x] Returns `{"status": "ok", "message": "Cache stats reset"}`
- [x] Requires admin authentication

## Backend API: Cache Keys (`GET /api/admin/cache-keys`)
- [x] Returns top N keys by memory usage
- [x] Supports prefix filter (backtest, news, screener, chart)
- [x] Supports top parameter (1-100, default 20)
- [x] Requires admin authentication

## Backend API: Invalidate Cache Endpoints
- [x] `DELETE /api/cache/backtest` invalidates all backtest cache for a user
- [x] `DELETE /api/cache/backtest/{strategy_id}` invalidates cache for specific strategy
- [x] `DELETE /api/cache/news` invalidates all news cache
- [x] `DELETE /api/cache/screener` invalidates all screener cache
- [x] All invalidation endpoints return deleted count and message
- [x] All invalidation endpoints require admin authentication
- [x] All invalidation endpoints return 500 on backend error
