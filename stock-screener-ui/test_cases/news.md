# NewsPage

- [x] Renders `data-testid="news-page"` on desktop viewport
- [x] Renders `data-testid="news-page"` on mobile viewport
- [x] Renders `NewsList` with news items from `useNewsList`
- [x] Renders `ArticleDetail` panel alongside list on desktop
- [x] Renders article in modal on mobile viewport
- [x] Shows loading state when `useNewsList.loading` is true
- [x] Shows error message when `useNewsList.error` is set
- [x] Calls `fetchArticle` on article click
- [x] Navigates to `/chart/{trading_symbol}` when a symbol with `instrument_key` is clicked
- [x] Opens `window.open` when a symbol without `instrument_key` has a URL
- [x] Handles race condition when rapid article clicks trigger stale fetch (fetchId ref)
- [x] Passes `showFullContent` toggle from `useArticleDetail` to `ArticleDetail`
- [x] Renders source selector

# formatTimeAgo (NewsPage.test.ts)

- [x] Returns "just now" for dates less than 1 minute ago
- [x] Returns "just now" for the current moment
- [x] Returns "{n}m ago" for dates within the last hour
- [x] Returns "1m ago" for exactly 1 minute ago
- [x] Returns "59m ago" for 59 minutes ago
- [x] Returns "{n}h ago" for dates within the last 24 hours
- [x] Returns "1h ago" for exactly 1 hour ago
- [x] Returns "23h ago" for 23 hours ago
- [x] Returns "{n}d ago" for dates within the last 7 days
- [x] Returns "1d ago" for exactly 1 day ago
- [x] Returns "6d ago" for 6 days ago
- [x] Returns localized date string for dates older than 7 days
- [x] Returns localized date string for very old dates
- [x] Returns "Invalid Date" for an invalid date string
- [x] Returns "Invalid Date" for an empty string
- [x] Handles future dates (negative diff) by returning "just now"

# NewsPanel2

- [x] Renders `data-testid="news-toggle-btn"` with "NEWS" text
- [x] Opens news panel (adds "open" class) when toggle button is clicked
- [x] Shows overlay (`data-testid="news-overlay"`) when panel is open
- [x] Closes panel when overlay is clicked
- [x] Loads and displays news items from `fetchNews` API
- [x] Opens article reader with `fetchArticle` when news item is clicked
- [x] Handles source filtering
- [x] Shows error state (`data-testid="news-error"`) when `fetchNews` fails
- [x] Shows empty state (`data-testid="news-empty"`) with "No news available" when no items
- [x] Navigates back from article view to list view
- [x] Saves auto-refresh setting on mount via `saveAutoRefresh`
- [x] Unread count badge on toggle button updates with unread items
- [x] Auto-refresh interval polls and re-fetches news
- [x] WebSocket-connected indicator shown in panel header
- [x] `handleSymbolClick` navigates to chart for mapped symbols or opens external URL
- [x] Last seen ID tracking persists to localStorage
- [x] Read IDs are tracked across sessions via localStorage
- [x] Mark all read marks all current items as read

# NewsList

- [x] Renders `data-testid="news-feed"` container
- [x] Renders "News Feed" title
- [x] Renders refresh button
- [x] Renders source selector
- [x] Shows "No news available" empty state
- [x] Shows loading state with loader
- [x] Shows error state with error message
- [x] Renders news items grouped by source
- [x] `onSourceChange` callback is accepted
- [x] `onArticleClick` callback is accepted
- [x] Calls `onRefresh` when refresh button is clicked
- [x] Calls `onArticleClick` with the correct `NewsItem` when item is clicked
- [x] Calls `toggleSourceExpanded` when source group header is clicked
- [x] Handles undefined `onSourceChange` gracefully
- [x] Handles undefined `onArticleClick` gracefully
- [x] Handles undefined `onRefresh` gracefully
- [x] Renders with empty `sourceData` array
- [x] Renders with undefined `sourceData`
- [x] Renders with null `error`
- [x] Renders with null source in news item
- [x] Renders with empty `sourceNames` array
- [x] Renders with null `selectedArticle`
- [x] Renders with undefined `groupedNewsItems`
- [x] Renders with empty `expandedSources` set
- [x] Handles rapid article clicks (both trigger the callback)

# ArticleDetail

- [x] Shows empty state with icon when no article is selected
- [x] Renders article title when selected
- [x] Renders source badge
- [x] Renders sentiment badge when article content has sentiment
- [x] Renders impact score when article content has impact_score
- [x] Renders summary alert when article content has summary
- [x] Renders "Key Takeaways" section when key_points are present
- [x] Renders "Analyzing article..." loading state
- [x] Renders "Open Original" external link when sourceUrl is present
- [x] `onClose` callback is accepted
- [x] `onToggleFullContent` callback is accepted
- [x] `onSymbolClick` callback is accepted
- [x] Handles undefined `onClose` gracefully
- [x] Handles undefined `onToggleFullContent` gracefully
- [x] Handles undefined `onSymbolClick` gracefully
- [x] Handles undefined `selectedArticle`
- [x] Handles undefined `articleContent`
- [x] Handles null `articleContent`
- [x] Handles empty symbols array
- [x] Handles empty trade_ideas array
- [x] Handles empty key_points array
- [x] Handles undefined summary
- [x] Handles undefined description
- [x] Handles null sourceUrl (hides "Open Original" link)
- [x] Handles null sentiment in content (hides SentimentBadge)
- [x] Handles zero impact_score
- [x] Shows close button on mobile (`isMobile` prop)
- [x] On mobile, clicking close button calls `onClose`
- [x] Toggle full content expand/collapse for description when LLM summary exists

# SentimentBadge

- [x] Renders "Bullish" sentiment with green badge
- [x] Renders "Bearish" sentiment with red badge
- [x] Renders "Neutral" sentiment with gray badge
- [x] Renders unknown sentiment as neutral fallback
- [x] Returns null when sentiment is undefined
- [x] Returns null when sentiment is null
- [x] Icon matches sentiment (trending up for Bullish, down for Bearish, minus for Neutral)

# NewsFilterControls

- [x] Renders source select dropdown
- [x] Renders refresh button
- [x] Renders auto-refresh select
- [x] Shows unread badge when unreadCount > 0
- [x] Hides unread badge when unreadCount is 0
- [x] `onSourceChange` callback is accepted
- [x] `onAutoRefreshChange` callback is accepted
- [x] Calls `onRefresh` when refresh button is clicked
- [x] Calls `onMarkAllRead` when unread badge is clicked
- [x] Disables refresh button when loading
- [x] Disables refresh button when isRefreshing
- [x] Renders with empty sourceData array
- [x] Renders with undefined sourceData
- [x] Renders with empty string selectedSource
- [x] Renders with undefined autoRefreshMs
- [x] Hides unread badge when unreadCount is negative
- [x] Handles rapid refresh clicks (all 3 trigger callback)
- [x] Handles undefined onSourceChange gracefully
- [x] Handles undefined onAutoRefreshChange gracefully
- [x] Handles undefined onRefresh gracefully
- [x] Handles undefined onMarkAllRead gracefully

# ImpactScore

- [x] Renders high impact score (>= 7) with red color
- [x] Renders moderate impact score (>= 4 and < 7) with orange color
- [x] Renders low impact score (< 4) with gray color
- [x] Boundary score of 7 renders as "High impact"
- [x] Boundary score of 4 renders as "Moderate impact"
- [x] Shows score/number label (e.g. "8/10")
- [x] Shows progress bar with correct value

# TradeIdeaCard

- [x] Renders LONG trade idea with green badge
- [x] Renders SHORT trade idea with red badge
- [x] Displays reasoning text
- [x] Handles empty reasoning string
- [x] Handles null reasoning
- [x] Handles null symbol
- [x] Handles unknown direction
- [x] Handles empty idea object
- [x] Returns null for null idea

# getSourceOptions (useNewsSourceGroups.test.ts)

- [x] Returns only "All Sources" when sources array is empty
- [x] Returns "All Sources" plus each source option
- [x] Returns "All Sources" with single source

# Backend News API — news_fetch.py

- [ ] `GET /api/news/article` returns article content for a given URL
- [ ] Returns 503 when news API is not available
- [ ] Caches article in Redis with md5 URL hash as key
- [ ] Returns cached article with `from_cache: true`
- [ ] LLM analysis is run when available and content > 100 chars
- [ ] Symbols are enriched via instrument mapper
- [ ] Article is persisted to database
- [ ] `GET /api/news/analyze` runs LLM analysis on article URL
- [ ] Returns 503 when news/LLM API not available
- [ ] Caches LLM analysis result in Redis

# Backend News API — news_search.py

- [ ] `GET /api/news` returns list of news items
- [ ] Filters by source when source param is provided
- [ ] Validates limit (ge=1, le=100)
- [ ] Returns 503 when news API not available
- [ ] Caches "all" results in Redis for 60s
- [ ] `GET /api/news/sentiment/{symbol}` returns sentiment analysis for a symbol
- [ ] Returns cached sentiment result
- [ ] Returns NO_RECENT_NEWS status when no relevant articles found
- [ ] Sentiment score thresholds (>= 30 → BULLISH, <= -30 → BEARISH, else NEUTRAL)
- [ ] Caches sentiment result with smart TTL (full=300s, skim=60s)

# Backend WebSocket — news_ws.py

- [ ] WebSocket `/ws/news` accepts connection and sends "connected" message
- [ ] WebSocket `/ws/sector` accepts connection and sends "connected" message
- [ ] Disconnected clients are cleaned up from connection sets
- [ ] `broadcast` sends JSON to all active connections
- [ ] Failed sends cause disconnection from active set

# Backend Poller — news_poller.py

- [ ] NEWS_SOURCES and fetch functions are loaded from moneycontrol-scraper module
- [ ] Falls back gracefully when news_api module is missing
- [ ] LLM analyzer is optional (continues without it)
- [ ] `news_startup_prefetch` runs after 30s delay
- [ ] `news_poller_task` polls sources every 60s
- [ ] Initializes last_seen_ids per source
- [ ] Detects new items via ID comparison
- [ ] Skips articles without URL or short headlines (<30 chars)
- [ ] Skips duplicate articles (already in DB)
- [ ] Persists new articles with LLM analysis
- [ ] Broadcasts new items via WebSocket
- [ ] Separately broadcasts high-impact items (impact_score >= 8)
- [ ] `sector_poller_task` polls sector data for india and america every 60s
- [ ] Invalidates cache on new article save

# Backend Tests — test_news_persistence.py

- [ ] `save_article` creates new article, calls `add` and `commit`
- [ ] `save_article` does not add duplicate for existing URL
- [ ] `get_article_by_url` returns matching article
- [ ] `get_article_by_url` returns None for not found
- [ ] `get_articles_for_instrument` returns articles linked to instrument key
- [ ] `get_articles_for_instrument` returns empty list when none found
- [ ] `get_articles_for_symbol` returns articles for symbol
- [ ] `get_recent_articles` returns recent articles within time window
- [ ] `get_recent_articles` filters by source
- [ ] `get_symbols_for_article` returns symbol mentions
- [ ] `get_mapped_symbols_for_article` returns mapped symbols
- [ ] `search_articles` returns matching results
- [ ] `get_article_stats` returns total, mentions, mapped symbols, mapper stats
- [ ] `cleanup_old_articles` deletes articles older than given days
- [ ] Singleton: `get_persistence_service` returns same instance
- [ ] Symbols are mapped via instrument mapper on save

# Backend Tests — test_news_instrument_mapper.py

- [ ] `MappingResult.to_dict` returns all fields
- [ ] `MappingResult.is_mapped` is True when trading_symbol is set
- [ ] `MappingResult.is_mapped` is False when trading_symbol is null
- [ ] Exact match returns same trading_symbol with method=exact, confidence=1.0
- [ ] Exact match is case-insensitive
- [ ] Exact match strips `.NS` suffix
- [ ] Variation match "M&M" maps to "MM"
- [ ] Variation match "L&T" maps to "LT"
- [ ] Unknown symbol returns not mapped
- [ ] Empty symbol returns not mapped
- [ ] Null symbol returns not mapped
- [ ] Fuzzy match (1-char typo) maps with method=fuzzy, confidence >= 0.8
- [ ] Fuzzy match partial name maps correctly
- [ ] `map_symbols` batch processes all symbols in array
- [ ] `get_instrument_key` returns correct key
- [ ] `get_instrument_key` returns null for unknown
- [ ] `_normalize_symbol` upper-cases and strips suffixes
- [ ] `get_stats` returns eq_instruments and fuzzy_threshold
- [ ] `get_mapper` singleton returns same instance
- [ ] `map_news_symbol` delegates to mapper instance
- [ ] `map_news_symbols` delegates to mapper instance
- [ ] Special characters in symbol are stripped/matchable
- [ ] Purely numeric symbols are not matched
- [ ] Very long symbols (100 chars) are not matched
- [ ] Whitespace around symbol is stripped before matching

# E2E — News Panel Basic Functionality

- [x] Shows news toggle button with "NEWS" text on page load
- [x] Opens panel when toggle button is clicked
- [x] Closes panel when close button is clicked
- [x] Closes panel when overlay is clicked

# E2E — News Panel Content Display

- [x] Displays news source selector
- [x] Displays refresh button
- [x] Displays news items
- [x] Shows headlines for news items
- [x] Marks unread items with visual indicator

# E2E — Source Switching

- [x] Allows switching news sources via dropdown
- [x] Selected source is reflected in input value

# E2E — Refresh

- [x] Reloads news when refresh button is clicked
- [x] Refresh button is disabled while loading
- [x] Refresh button becomes enabled after load completes

# E2E — News Page Full Page View

- [x] Navigates to /news page
- [x] Displays news page header
- [x] Displays source selector
- [x] Displays news list items

# E2E — Sentiment Display

- [x] Displays BULLISH sentiment badge
- [x] Displays BEARISH sentiment badge

# E2E — Impact Score Display

- [x] Displays impact score ring

# E2E — Article Detail

- [x] Opens article detail on click
- [x] Displays summary in article detail
- [x] Displays "Key Takeaways" section
- [x] Displays "Trade Ideas" section
- [x] Displays LONG trade idea with green badge
- [x] Displays "Stocks mentioned" section
- [x] Shows close button in article detail on mobile
- [x] Returns to news list when clicking back

# E2E — Search

- [x] Filters news by search query

# E2E — Source Filtering

- [x] Filters news by source

# E2E — Loading States

- [x] Shows loading indicator while fetching news

# E2E — Responsive Design

- [x] Displays correctly on mobile viewport (375x667)
- [x] Displays correctly on tablet viewport (768x1024)
- [x] Displays correctly on desktop viewport (1920x1080)
