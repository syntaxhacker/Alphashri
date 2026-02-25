/**
 * Common UI Helper Functions
 *
 * Shared utilities for formatting numbers, dates, and rendering UI elements.
 * Used across backtest, paper-trading, and screener components.
 */

// ============================================
// Number Formatting
// ============================================

/**
 * Format a number as Indian currency (₹)
 */
export function formatCurrency(amount: number, precision: number = 0): string {
  return `₹${amount.toFixed(precision)}`
}

/**
 * Format a number with K/L suffixes for large values
 * E.g., 1500 → "1.5K", 150000 → "1.5L"
 */
export function formatNumber(value: number): string {
  const absValue = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (absValue >= 100000) {
    return `${sign}${(absValue / 100000).toFixed(1)}L`
  } else if (absValue >= 1000) {
    return `${sign}${(absValue / 1000).toFixed(1)}K`
  }
  return `${sign}${absValue.toFixed(0)}`
}

/**
 * Format currency with K/L suffix for display in tables
 */
export function formatCurrencyCompact(amount: number): string {
  return `₹${formatNumber(amount)}`
}

/**
 * Format a percentage with optional sign prefix
 */
export function formatPercentage(value: number, precision: number = 2, showSign: boolean = true): string {
  const sign = showSign && value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(precision)}%`
}

// ============================================
// Date/Time Formatting
// ============================================

/**
 * Format date to human readable: "12th Thu Jan 2025 10:30"
 */
export function formatDateTimeHuman(isoStr: string): string {
  if (!isoStr) return '-'

  try {
    const parts = isoStr.split('T')
    const datePart = parts[0]
    const timePart = parts[1]?.replace('Z', '').replace(/\+00:00/g, '').replace(/\+05:30/g, '').substring(0, 5)

    if (!datePart) return '-'

    const [year, month, day] = datePart.split('-')
    const d = parseInt(day)
    const m = parseInt(month) - 1

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    const date = new Date(parseInt(year), m, d)
    const dayName = days[date.getDay()]
    const monthName = months[m]

    const suffix = getOrdinalSuffix(d)

    return `${d}${suffix} ${dayName} ${monthName} ${timePart || ''}`
  } catch {
    return '-'
  }
}

/**
 * Format date compact: "12th Jan 10:30"
 */
export function formatDateTimeCompact(isoStr: string): string {
  if (!isoStr) return '-'

  try {
    const parts = isoStr.split('T')
    const datePart = parts[0]
    const timePart = parts[1]?.replace('Z', '').replace(/\+00:00/g, '').replace(/\+05:30/g, '').substring(0, 5)

    if (!datePart) return '-'

    const [year, month, day] = datePart.split('-')
    const d = parseInt(day)
    const m = parseInt(month) - 1

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const suffix = getOrdinalSuffix(d)

    return `${d}${suffix} ${months[m]} ${timePart || ''}`
  } catch {
    return '-'
  }
}

/**
 * Format date for trade display: "24 Feb 2026, 10:38:36"
 */
export function formatTradeTime(isoStr: string): string {
  if (!isoStr) return '-'

  try {
    const date = new Date(isoStr)

    const day = date.getDate()
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const month = months[date.getMonth()]
    const year = date.getFullYear()

    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')

    return `${day} ${month} ${year}, ${hours}:${minutes}:${seconds}`
  } catch {
    return '-'
  }
}

/**
 * Format duration in minutes to human readable: "2h 30m" or "45m"
 */
export function formatDuration(minutes: number): string {
  if (!minutes || minutes < 0) return '0m'

  const h = Math.floor(minutes / 60)
  const m = minutes % 60

  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  return `${m}m`
}

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, 4th, etc.)
 */
export function getOrdinalSuffix(n: number): string {
  if (n === 1 || n === 21 || n === 31) return 'st'
  if (n === 2 || n === 22) return 'nd'
  if (n === 3 || n === 23) return 'rd'
  return 'th'
}

// ============================================
// Class/Style Helpers
// ============================================

/**
 * Get CSS class for positive/negative values
 */
export function getPnLClass(value: number): 'positive' | 'negative' | '' {
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return ''
}

/**
 * Get color for P&L value
 */
export function getPnLColor(value: number): string {
  if (value >= 0) return '#00E676'  // Green
  return '#FF1744'  // Red
}

/**
 * Get exit reason color
 */
export function getExitReasonColor(reason: string): string {
  switch (reason) {
    case 'TP': return '#00E676'  // Green
    case 'SL': return '#FF1744'  // Red
    case 'EOD': return '#FFEA00' // Yellow
    default: return '#FFEA00'
  }
}

// ============================================
// Sort Helpers
// ============================================

/**
 * Render sort indicator arrow
 */
export function renderSortIndicator(column: string, sortColumn: string, sortDirection: 'asc' | 'desc'): string {
  if (column !== sortColumn) return ''
  return sortDirection === 'asc' ? ' ▲' : ' ▼'
}

/**
 * Get sort direction when clicking a column
 */
export function getNextSortDirection(currentColumn: string, clickedColumn: string, currentDirection: 'asc' | 'desc'): 'asc' | 'desc' {
  if (currentColumn !== clickedColumn) {
    return 'desc'  // Default to descending for new column
  }
  return currentDirection === 'asc' ? 'desc' : 'asc'
}

// ============================================
// Time Normalization (for chart candle matching)
// ============================================

/**
 * Normalize time string for matching
 * Handles various formats and converts all times to IST for consistent matching
 */
export function normalizeTime(time: string): string {
  if (!time) return ''

  try {
    // Parse the time string as UTC timestamp
    const date = new Date(time)

    // Get the UTC timestamp and convert to IST (add 5h 30m)
    const istTime = new Date(date.getTime() + (5.5 * 60 * 60 * 1000))

    // Format as YYYY-MM-DDTHH:MM in IST
    const year = istTime.getUTCFullYear()
    const month = String(istTime.getUTCMonth() + 1).padStart(2, '0')
    const day = String(istTime.getUTCDate()).padStart(2, '0')
    const hours = String(istTime.getUTCHours()).padStart(2, '0')
    const minutes = String(istTime.getUTCMinutes()).padStart(2, '0')

    return `${year}-${month}-${day}T${hours}:${minutes}`
  } catch {
    // Fallback to simple normalization
    return time
      .replace(/\+00:00$/, '')
      .replace(/\+05:30$/, '')
      .replace(/Z$/, '')
      .substring(0, 16)
  }
}

// ============================================
// Empty/Loading States
// ============================================

/**
 * Render empty state HTML
 */
export function renderEmptyState(message: string, icon: string = '📊'): string {
  return `
    <div class="empty-state">
      <div class="empty-icon">${icon}</div>
      <p>${message}</p>
    </div>
  `
}

/**
 * Render loading state HTML
 */
export function renderLoadingState(message: string = 'Loading...'): string {
  return `
    <div class="loading-state">
      <p>${message}</p>
    </div>
  `
}
