import { useState, useEffect, useCallback, useRef } from 'react'
import type { NewsItem, NewsSource, ArticleResponse, NewsSymbol } from './news-types'
import { fetchNews, fetchArticle, fetchNewsSources } from '../../api/news'

// LocalStorage keys
const LS_READ_IDS = 'news_read_ids'
const LS_LAST_SEEN_ID = 'news_last_seen_id'
const LS_AUTO_REFRESH = 'news_auto_refresh'

// Auto-refresh intervals in milliseconds
const AUTO_REFRESH_INTERVALS = [
  { label: 'Off', value: 0 },
  { label: '1m', value: 60000 },
  { label: '5m', value: 300000 },
  { label: '10m', value: 600000 },
]

/**
 * Format relative time from ISO timestamp
 */
function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  } catch {
    return ''
  }
}

/**
 * Truncate text to specified length
 */
function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text
  return text.slice(0, maxLength).trim() + '...'
}

/**
 * Get read article IDs from localStorage
 */
function getReadIds(): Set<string> {
  try {
    const stored = localStorage.getItem(LS_READ_IDS)
    if (stored) {
      return new Set(JSON.parse(stored))
    }
  } catch {}
  return new Set()
}

/**
 * Save read article IDs to localStorage
 */
function saveReadIds(ids: Set<string>): void {
  try {
    // Keep only last 500 IDs to avoid storage bloat
    const arr = Array.from(ids).slice(-500)
    localStorage.setItem(LS_READ_IDS, JSON.stringify(arr))
  } catch {}
}

/**
 * News Panel Component
 * Slide-in panel showing news from multiple sources
 */
export default function NewsPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [newsItems, setNewsItems] = useState<NewsItem[]>([])
  const [sources, setSources] = useState<NewsSource[]>([])
  const [selectedSource, setSelectedSource] = useState('moneycontrol')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Article view state
  const [selectedArticle, setSelectedArticle] = useState<NewsItem | null>(null)
  const [articleContent, setArticleContent] = useState<ArticleResponse | null>(null)
  const [articleLoading, setArticleLoading] = useState(false)

  // Unread tracking
  const [readIds, setReadIds] = useState<Set<string>>(getReadIds)
  const [lastSeenId, setLastSeenId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LS_LAST_SEEN_ID)
    } catch {
      return null
    }
  })

  // Auto-refresh
  const [autoRefreshMs, setAutoRefreshMs] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(LS_AUTO_REFRESH)
      return stored ? parseInt(stored, 10) : 0
    } catch {
      return 0
    }
  })
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Calculate unread count (articles newer than last seen, not yet read)
  const unreadCount = newsItems.filter(item => {
    if (readIds.has(item.id)) return false
    // If no lastSeenId, all are unread until panel is opened
    return true
  }).length

  // Load sources on mount
  useEffect(() => {
    fetchNewsSources().then(setSources)
  }, [])

  // Load news function
  const loadNews = useCallback(async (isAutoRefresh = false) => {
    if (isAutoRefresh) {
      setIsRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)

    try {
      const items = await fetchNews(selectedSource, 30)
      setNewsItems(items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load news')
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [selectedSource])

  // Initial load when panel opens
  useEffect(() => {
    if (isOpen) {
      loadNews()

      // Mark current top article as last seen
      if (newsItems.length > 0 && newsItems[0].id !== lastSeenId) {
        const newLastSeenId = newsItems[0].id
        setLastSeenId(newLastSeenId)
        try {
          localStorage.setItem(LS_LAST_SEEN_ID, newLastSeenId)
        } catch {}
      }
    }
  }, [isOpen, selectedSource])

  // Auto-refresh effect
  useEffect(() => {
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current)
      autoRefreshRef.current = null
    }

    if (autoRefreshMs > 0) {
      autoRefreshRef.current = setInterval(() => {
        loadNews(true)
      }, autoRefreshMs)
    }

    return () => {
      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current)
      }
    }
  }, [autoRefreshMs, loadNews])

  // Save auto-refresh setting
  useEffect(() => {
    try {
      localStorage.setItem(LS_AUTO_REFRESH, autoRefreshMs.toString())
    } catch {}
  }, [autoRefreshMs])

  // Handle article click
  const handleArticleClick = async (item: NewsItem) => {
    // Mark as read
    const newReadIds = new Set(readIds)
    newReadIds.add(item.id)
    setReadIds(newReadIds)
    saveReadIds(newReadIds)

    setSelectedArticle(item)
    setArticleLoading(true)
    setArticleContent(null)

    try {
      const content = await fetchArticle(item.sourceUrl)
      setArticleContent(content)
    } catch (err) {
      console.error('Failed to fetch article:', err)
    } finally {
      setArticleLoading(false)
    }
  }

  // Handle back to list
  const handleBack = () => {
    setSelectedArticle(null)
    setArticleContent(null)
  }

  // Close panel
  const handleClose = () => {
    setIsOpen(false)
    setSelectedArticle(null)
    setArticleContent(null)
  }

  // Handle symbol click
  const handleSymbolClick = (symbol: NewsSymbol) => {
    window.open(symbol.url, '_blank', 'noopener,noreferrer')
  }

  // Mark all as read
  const handleMarkAllRead = () => {
    const newReadIds = new Set(readIds)
    newsItems.forEach(item => newReadIds.add(item.id))
    setReadIds(newReadIds)
    saveReadIds(newReadIds)
  }

  // Cycle auto-refresh interval
  const cycleAutoRefresh = () => {
    const currentIndex = AUTO_REFRESH_INTERVALS.findIndex(i => i.value === autoRefreshMs)
    const nextIndex = (currentIndex + 1) % AUTO_REFRESH_INTERVALS.length
    setAutoRefreshMs(AUTO_REFRESH_INTERVALS[nextIndex].value)
  }

  const currentRefreshLabel = AUTO_REFRESH_INTERVALS.find(i => i.value === autoRefreshMs)?.label || 'Off'

  return (
    <>
      {/* Toggle Button */}
      <button
        className="news-toggle-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="Open news panel"
      >
        NEWS
        {unreadCount > 0 && !isOpen && (
          <span className="news-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {/* Overlay */}
      {isOpen && (
        <div
          className="news-overlay visible"
          onClick={handleClose}
        />
      )}

      {/* Panel */}
      <div className={`news-panel ${isOpen ? 'open' : ''}`}>
        {selectedArticle ? (
          // Article View
          <div className="news-article">
            <div className="news-article-header">
              <button className="news-article-back" onClick={handleBack}>
                {'<'} Back
              </button>
              <button className="news-close-btn" onClick={handleClose}>
                x
              </button>
            </div>

            <div className="news-article-title">
              {selectedArticle.headline}
            </div>

            <div className="news-article-meta">
              {articleContent?.source || selectedArticle.source} | {formatTimeAgo(articleContent?.publishedAt || selectedArticle.publishedAt)}
            </div>

            {/* Stock Symbols Section */}
            {articleContent?.symbols && articleContent.symbols.length > 0 && (
              <div className="news-symbols">
                <div className="news-symbols-label">Stocks mentioned:</div>
                <div className="news-symbols-list">
                  {articleContent.symbols.map((symbol, idx) => (
                    <button
                      key={idx}
                      className="news-symbol-tag"
                      onClick={() => handleSymbolClick(symbol)}
                      title={`View ${symbol.name} on Moneycontrol`}
                    >
                      {symbol.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="news-article-content">
              {articleLoading ? (
                <div className="news-loading">Loading article...</div>
              ) : articleContent?.description ? (
                articleContent.description.split('\n\n').map((para, idx) => (
                  <p key={idx} style={{ marginBottom: '12px' }}>
                    {para}
                  </p>
                ))
              ) : (
                <div className="news-empty">
                  Unable to load article content.
                </div>
              )}
            </div>

            <div className="news-article-link">
              <a
                href={selectedArticle.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#00ff9d', fontSize: '11px' }}
              >
                Open Original {'->'}
              </a>
            </div>
          </div>
        ) : (
          // List View
          <>
            <div className="news-header">
              <span className="news-title">
                NEWS
                {isRefreshing && <span className="news-refreshing-indicator">...</span>}
              </span>
              <button className="news-close-btn" onClick={handleClose}>
                x
              </button>
            </div>

            <div className="news-toolbar">
              <select
                className="news-source-select"
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                {sources.length === 0 && (
                  <option value="moneycontrol">Moneycontrol</option>
                )}
              </select>

              <button
                className="news-refresh-btn"
                onClick={() => loadNews()}
                disabled={loading}
                title="Refresh news"
              >
                {loading ? '...' : 'R'}
              </button>

              <button
                className={`news-autorefresh-btn ${autoRefreshMs > 0 ? 'active' : ''}`}
                onClick={cycleAutoRefresh}
                title={`Auto-refresh: ${currentRefreshLabel}`}
              >
                {currentRefreshLabel}
              </button>

              {unreadCount > 0 && (
                <button
                  className="news-markread-btn"
                  onClick={handleMarkAllRead}
                  title="Mark all as read"
                >
                  {unreadCount} unread
                </button>
              )}
            </div>

            <div className="news-list">
              {loading && newsItems.length === 0 ? (
                <div className="news-loading">Loading news...</div>
              ) : error ? (
                <div className="news-empty">{error}</div>
              ) : newsItems.length === 0 ? (
                <div className="news-empty">No news available</div>
              ) : (
                newsItems.map((item) => {
                  const isUnread = !readIds.has(item.id)
                  return (
                    <div
                      key={item.id}
                      className={`news-item ${isUnread ? 'unread' : ''}`}
                      onClick={() => handleArticleClick(item)}
                    >
                      <div className="news-item-headline">
                        {isUnread && <span className="news-unread-dot" />}
                        {item.headline}
                      </div>
                      {item.description && (
                        <div className="news-item-desc">
                          {truncateText(item.description, 120)}
                        </div>
                      )}
                      <div className="news-item-meta">
                        <span>{item.source}</span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
