/**
 * News API Client
 */

import type {
  NewsItem,
  NewsSource,
  NewsResponse,
  ArticleResponse,
  SymbolChartData,
  SymbolArticlesResponse,
  SymbolMapping,
  NewsStatsResponse,
  NewsArticle,
} from "../components/news/news-types";
import { fetchWithAuth } from "../state/auth";
import { API_BASE, WS_BASE } from "./config";

/**
 * Fetch latest news from a source
 */
export async function fetchNews(
  source: string | undefined = undefined,
  limit: number = 25,
): Promise<NewsItem[]> {
  try {
    let url = `${API_BASE}/api/news?limit=${limit}`;
    if (source && source !== "all") {
      url += `&source=${source}`;
    }
    const response = await fetchWithAuth(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch news: ${response.statusText}`);
    }
    const data: NewsResponse = await response.json();
    return data.items || [];
  } catch (error) {
    console.error("Failed to fetch news:", error);
    return [];
  }
}

/**
 * Fetch full article content
 */
export async function fetchArticle(url: string): Promise<ArticleResponse | null> {
  try {
    const encodedUrl = encodeURIComponent(url);
    const response = await fetchWithAuth(`${API_BASE}/api/news/article?url=${encodedUrl}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch article: ${response.statusText}`);
    }
    const data: ArticleResponse = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch article:", error);
    return null;
  }
}

/**
 * Fetch available news sources
 */
export async function fetchNewsSources(): Promise<NewsSource[]> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/news/sources`);
    if (!response.ok) {
      throw new Error(`Failed to fetch sources: ${response.statusText}`);
    }
    const data = await response.json();
    return data.sources || [];
  } catch (error) {
    console.error("Failed to fetch news sources:", error);
    return [];
  }
}

/**
 * WebSocket message types for news updates
 */
export interface NewsWebSocketMessage {
  type: "new_items" | "connected" | "ping";
  source?: string;
  items?: NewsItem[];
  message?: string;
  timestamp?: string;
}

export type NewsWebSocketCallback = (message: NewsWebSocketMessage) => void;

/**
 * Create a WebSocket connection for real-time news updates
 * @param onMessage Callback function to handle incoming messages
 * @param onConnect Optional callback when connection is established
 * @param onDisconnect Optional callback when connection is lost
 * @returns WebSocket instance or null if connection failed
 */
export function createNewsWebSocket(
  onMessage: NewsWebSocketCallback,
  onConnect?: () => void,
  onDisconnect?: () => void,
): WebSocket | null {
  try {
    const ws = new WebSocket(`${WS_BASE}/ws/news`);

    ws.onopen = () => {
      onConnect?.();
    };

    ws.onmessage = (event) => {
      try {
        const data: NewsWebSocketMessage = JSON.parse(event.data);
        onMessage(data);
      } catch (e) {
        console.error("Failed to parse WebSocket message:", e);
      }
    };

    ws.onerror = (error) => {
      console.error("📰 News WebSocket error:", error);
    };

    ws.onclose = () => {
      onDisconnect?.();
    };

    return ws;
  } catch (error) {
    console.error("Failed to create WebSocket:", error);
    return null;
  }
}

/**
 * Get chart data for a symbol mentioned in news
 */
export async function fetchSymbolChart(
  symbol: string,
  days: number = 30,
): Promise<SymbolChartData | null> {
  try {
    const response = await fetchWithAuth(
      `${API_BASE}/api/news/symbols/${encodeURIComponent(symbol)}/chart?days=${days}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch chart: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch symbol chart:", error);
    return null;
  }
}

/**
 * Get articles for a specific symbol
 */
export async function fetchArticlesForSymbol(
  symbol: string,
  limit: number = 10,
): Promise<SymbolArticlesResponse | null> {
  try {
    const response = await fetchWithAuth(
      `${API_BASE}/api/news/symbols/${encodeURIComponent(symbol)}/articles?limit=${limit}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch articles: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch articles for symbol:", error);
    return null;
  }
}

/**
 * Get article by ID with symbols
 */
export async function fetchArticleById(articleId: number): Promise<NewsArticle | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/news/articles/${articleId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch article: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch article by ID:", error);
    return null;
  }
}

/**
 * Get recent stored articles
 */
export async function fetchRecentArticles(
  hours: number = 24,
  source?: string,
  limit: number = 50,
): Promise<{ total: number; articles: NewsArticle[] } | null> {
  try {
    let url = `${API_BASE}/api/news/recent?hours=${hours}&limit=${limit}`;
    if (source) {
      url += `&source=${encodeURIComponent(source)}`;
    }
    const response = await fetchWithAuth(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch recent articles: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch recent articles:", error);
    return null;
  }
}

/**
 * Search articles
 */
export async function searchArticles(
  query: string,
  limit: number = 20,
): Promise<{ query: string; total: number; articles: NewsArticle[] } | null> {
  try {
    const response = await fetchWithAuth(
      `${API_BASE}/api/news/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to search articles: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Failed to search articles:", error);
    return null;
  }
}

/**
 * Map a symbol to see how it maps to an instrument
 */
export async function mapSymbol(symbol: string): Promise<SymbolMapping | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/news/map/${encodeURIComponent(symbol)}`);
    if (!response.ok) {
      throw new Error(`Failed to map symbol: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Failed to map symbol:", error);
    return null;
  }
}

/**
 * Get news stats
 */
export async function fetchNewsStats(): Promise<NewsStatsResponse | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/news/stats`);
    if (!response.ok) {
      throw new Error(`Failed to fetch stats: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch news stats:", error);
    return null;
  }
}
