/**
 * News API Client
 */

import type { NewsItem, NewsSource, NewsResponse, ArticleResponse } from '../components/news/news-types'

const API_BASE = 'http://localhost:8765'

/**
 * Fetch latest news from a source
 */
export async function fetchNews(source: string = 'moneycontrol', limit: number = 25): Promise<NewsItem[]> {
  try {
    const response = await fetch(`${API_BASE}/api/news?source=${source}&limit=${limit}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch news: ${response.statusText}`)
    }
    const data: NewsResponse = await response.json()
    return data.items || []
  } catch (error) {
    console.error('Failed to fetch news:', error)
    return []
  }
}

/**
 * Fetch full article content
 */
export async function fetchArticle(url: string): Promise<ArticleResponse | null> {
  try {
    const encodedUrl = encodeURIComponent(url)
    const response = await fetch(`${API_BASE}/api/news/article?url=${encodedUrl}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch article: ${response.statusText}`)
    }
    const data: ArticleResponse = await response.json()
    return data
  } catch (error) {
    console.error('Failed to fetch article:', error)
    return null
  }
}

/**
 * Fetch available news sources
 */
export async function fetchNewsSources(): Promise<NewsSource[]> {
  try {
    const response = await fetch(`${API_BASE}/api/news/sources`)
    if (!response.ok) {
      throw new Error(`Failed to fetch sources: ${response.statusText}`)
    }
    const data = await response.json()
    return data.sources || []
  } catch (error) {
    console.error('Failed to fetch news sources:', error)
    return []
  }
}
