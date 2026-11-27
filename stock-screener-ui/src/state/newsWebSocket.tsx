import { createContext, createEffect, createSignal, onCleanup, useContext, type JSX } from "solid-js";
import type { NewsItem } from "../components/news/news-types";
import { WS_BASE } from "../api/config";

interface NewsWebSocketMessage {
  type: "new_items" | "connected" | "ping";
  source?: string;
  items?: NewsItem[];
  message?: string;
  timestamp?: string;
}

export interface NewsWebSocketContextType {
  connected: () => boolean;
  newsItems: () => NewsItem[];
  hasNewArticles: () => boolean;
  clearNewArticlesFlag: () => void;
  addNewsItems: (items: NewsItem[]) => void;
}

const NewsWebSocketContext = createContext<NewsWebSocketContextType | null>(null);

export function useNewsWebSocket(): NewsWebSocketContextType {
  const context = useContext(NewsWebSocketContext);
  if (!context) {
    throw new Error("useNewsWebSocket must be used within a NewsWebSocketProvider");
  }
  return context;
}

function mergeNews(prev: NewsItem[], incoming: NewsItem[]): NewsItem[] {
  const existingIds = new Set(prev.map((i) => i.id));
  const fresh = incoming.filter((i) => !existingIds.has(i.id));
  if (fresh.length === 0) return prev;
  return [...fresh, ...prev].slice(0, 100);
}

export function NewsWebSocketProvider(props: { children?: JSX.Element }) {
  const [connected, setConnected] = createSignal(false);
  const [newsItems, setNewsItems] = createSignal<NewsItem[]>([]);
  const [hasNewArticles, setHasNewArticles] = createSignal(false);

  let ws: WebSocket | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  const clearNewArticlesFlag = () => setHasNewArticles(false);
  const addNewsItems = (items: NewsItem[]) => {
    setNewsItems((prev) => mergeNews(prev, items));
    setHasNewArticles(true);
  };

  createEffect(() => {
    let retryCount = 0;
    const maxRetries = 10;
    const baseDelay = 2000;
    let disposed = false;

    const getRetryDelay = () =>
      Math.min(baseDelay * Math.pow(2, retryCount), 30000) + Math.random() * 1000;

    const scheduleReconnect = () => {
      if (disposed || retryCount >= maxRetries) return;
      retryCount++;
      reconnectTimeout = setTimeout(connect, getRetryDelay());
    };

    const connect = () => {
      if (disposed) return;
      try {
        ws = new WebSocket(`${WS_BASE}/ws/news`);

        ws.onopen = () => {
          setConnected(true);
          retryCount = 0;
        };

        ws.onmessage = (event) => {
          try {
            const data: NewsWebSocketMessage = JSON.parse(event.data);
            if (data.type === "new_items" && data.items) {
              const incoming = data.items;
              setNewsItems((prev) => mergeNews(prev, incoming));
              setHasNewArticles(true);
            }
          } catch (e) {
            console.error("Failed to parse WebSocket message:", e);
          }
        };

        ws.onerror = (error) => {
          console.error("📰 News WebSocket error:", error);
        };

        ws.onclose = (event) => {
          setConnected(false);
          ws = null;
          if (event.code === 1000) return;
          if (retryCount >= maxRetries) {
            console.error("📰 News WebSocket max retries reached, giving up");
            return;
          }
          scheduleReconnect();
        };
      } catch (error) {
        console.error("Failed to create WebSocket:", error);
        scheduleReconnect();
      }
    };

    connect();

    onCleanup(() => {
      disposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    });
  });

  const value: NewsWebSocketContextType = {
    connected,
    newsItems,
    hasNewArticles,
    clearNewArticlesFlag,
    addNewsItems,
  };

  return <NewsWebSocketContext.Provider value={value}>{props.children}</NewsWebSocketContext.Provider>;
}