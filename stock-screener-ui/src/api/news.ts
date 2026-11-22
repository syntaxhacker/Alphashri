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
import { apiErrorFromResponse, asApiError, isAbortError } from "./apiError";
import { jsonOrThrow } from "./utils/request";
import { API_BASE, WS_BASE } from "./config";

export async function fetchNews(
  source: string | undefined = undefined,
  limit: number = 25,
  signal?: AbortSignal,
): Promise<NewsItem[]> {
  let url = `${API_BASE}/api/news?limit=${limit}`;
  if (source && source !== "all") {
    url += `&source=${source}`;
  }
  let response: Response;
  try {
    response = await fetchWithAuth(url, signal ? { signal } : undefined);
  } catch (error) {
    // Keep the original AbortError: consumers' `isAbortError` guard keys off
    // `name === "AbortError"` and treats it as a silent no-op.
    if (isAbortError(error)) throw error;
    throw asApiError(error, "Failed to fetch news");
  }
  if (!response.ok) {
    throw await apiErrorFromResponse(response, "Failed to fetch news");
  }
  const data: NewsResponse = await jsonOrThrow<NewsResponse>(response, "Failed to fetch news");
  return data.items || [];
}

export async function fetchArticle(url: string): Promise<ArticleResponse | null> {
  try {
    const encodedUrl = encodeURIComponent(url);
    const response = await fetchWithAuth(`${API_BASE}/api/news/article?url=${encodedUrl}`);
    return jsonOrThrow<ArticleResponse>(response, "Failed to fetch article");
  } catch (error) {
    console.error("Failed to fetch article:", error);
    return null;
  }
}

export async function fetchNewsSources(): Promise<NewsSource[]> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/news/sources`);
    const data = await jsonOrThrow<{ sources?: NewsSource[] }>(
      response,
      "Failed to fetch sources",
    );
    return data.sources || [];
  } catch (error) {
    console.error("Failed to fetch news sources:", error);
    return [];
  }
}

export interface NewsWebSocketMessage {
  type: "new_items" | "connected" | "ping";
  source?: string;
  items?: NewsItem[];
  message?: string;
  timestamp?: string;
}

export type NewsWebSocketCallback = (message: NewsWebSocketMessage) => void;

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

export async function fetchSymbolChart(
  symbol: string,
  days: number = 30,
): Promise<SymbolChartData | null> {
  try {
    const response = await fetchWithAuth(
      `${API_BASE}/api/news/symbols/${encodeURIComponent(symbol)}/chart?days=${days}`,
    );
    return jsonOrThrow<SymbolChartData>(response, "Failed to fetch chart");
  } catch (error) {
    console.error("Failed to fetch symbol chart:", error);
    return null;
  }
}

export async function fetchArticlesForSymbol(
  symbol: string,
  limit: number = 10,
): Promise<SymbolArticlesResponse | null> {
  try {
    const response = await fetchWithAuth(
      `${API_BASE}/api/news/symbols/${encodeURIComponent(symbol)}/articles?limit=${limit}`,
    );
    return jsonOrThrow<SymbolArticlesResponse>(response, "Failed to fetch articles");
  } catch (error) {
    console.error("Failed to fetch articles for symbol:", error);
    return null;
  }
}

export async function fetchArticleById(articleId: number): Promise<NewsArticle | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/news/articles/${articleId}`);
    return jsonOrThrow<NewsArticle>(response, "Failed to fetch article");
  } catch (error) {
    console.error("Failed to fetch article by ID:", error);
    return null;
  }
}

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
    return jsonOrThrow<{ total: number; articles: NewsArticle[] }>(
      response,
      "Failed to fetch recent articles",
    );
  } catch (error) {
    console.error("Failed to fetch recent articles:", error);
    return null;
  }
}

export async function searchArticles(
  query: string,
  limit: number = 20,
): Promise<{ query: string; total: number; articles: NewsArticle[] } | null> {
  try {
    const response = await fetchWithAuth(
      `${API_BASE}/api/news/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    );
    return jsonOrThrow<{ query: string; total: number; articles: NewsArticle[] }>(
      response,
      "Failed to search articles",
    );
  } catch (error) {
    console.error("Failed to search articles:", error);
    return null;
  }
}

export async function mapSymbol(symbol: string): Promise<SymbolMapping | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/news/map/${encodeURIComponent(symbol)}`);
    return jsonOrThrow<SymbolMapping>(response, "Failed to map symbol");
  } catch (error) {
    console.error("Failed to map symbol:", error);
    return null;
  }
}

export async function fetchNewsStats(): Promise<NewsStatsResponse | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/news/stats`);
    return jsonOrThrow<NewsStatsResponse>(response, "Failed to fetch stats");
  } catch (error) {
    console.error("Failed to fetch news stats:", error);
    return null;
  }
}
