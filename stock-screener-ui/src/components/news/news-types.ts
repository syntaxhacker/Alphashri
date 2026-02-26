/**
 * Stock symbol mentioned in an article
 */
export interface NewsSymbol {
  name: string
  code: string
  url: string
}

/**
 * News item interface - represents a single news article
 */
export interface NewsItem {
  id: string
  headline: string
  description: string
  source: string
  sourceUrl: string
  publishedAt: string
  fetchedAt: string
  symbols?: NewsSymbol[]
}

/**
 * News source configuration
 */
export interface NewsSource {
  id: string
  name: string
  url: string
}

/**
 * News API response
 */
export interface NewsResponse {
  items: NewsItem[]
  source: string
  total: number
  fetchedAt: string
}

/**
 * Article content response
 */
export interface ArticleResponse extends NewsItem {
  error?: string
}
