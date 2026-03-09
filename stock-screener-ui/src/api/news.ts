/**
 * News API Client
 */

import type {
  NewsItem,
  NewsSource,
  NewsResponse,
  ArticleResponse,
} from "../components/news/news-types";
import { fetchWithAuth } from "../state/auth";

const API_BASE = "http://localhost:8765";
const WS_BASE = "ws://localhost:8765";

/**
 * Fetch latest news from a source
 */
export async function fetchNews(
  source: string = "moneycontrol",
  limit: number = 25,
): Promise<NewsItem[]> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/news?source=${source}&limit=${limit}`);
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
      console.log("📰 News WebSocket connected");
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

    ws.onclose = (event) => {
      console.log(`📰 News WebSocket disconnected (code: ${event.code})`);
      onDisconnect?.();
    };

    return ws;
  } catch (error) {
    console.error("Failed to create WebSocket:", error);
    return null;
  }
}
