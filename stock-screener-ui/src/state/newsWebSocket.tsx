import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { NewsItem, NewsWebSocketMessage } from "../components/news/news-types";

const WS_BASE = "ws://localhost:8765";

interface NewsWebSocketContextType {
  connected: boolean;
  newsItems: NewsItem[];
  hasNewArticles: boolean;
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

export function NewsWebSocketProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [hasNewArticles, setHasNewArticles] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearNewArticlesFlag = useCallback(() => {
    setHasNewArticles(false);
  }, []);

  const addNewsItems = useCallback((items: NewsItem[]) => {
    setNewsItems((prev) => {
      const existingIds = new Set(prev.map((i) => i.id));
      const newItems = items.filter((i) => !existingIds.has(i.id));
      if (newItems.length === 0) return prev;
      return [...newItems, ...prev].slice(0, 100);
    });
  }, []);

  useEffect(() => {
    const connectWebSocket = () => {
      try {
        const ws = new WebSocket(`${WS_BASE}/ws/news`);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("📰 News WebSocket connected");
          setConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const data: NewsWebSocketMessage = JSON.parse(event.data);
            if (data.type === "new_items" && data.items) {
              setNewsItems((prev) => {
                const existingIds = new Set(prev.map((i) => i.id));
                const newItems = data.items!.filter((i) => !existingIds.has(i.id));
                if (newItems.length === 0) return prev;
                return [...newItems, ...prev].slice(0, 100);
              });
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
          console.log(`📰 News WebSocket disconnected (code: ${event.code})`);
          setConnected(false);
          // Reconnect after 5 seconds
          reconnectTimeoutRef.current = setTimeout(connectWebSocket, 5000);
        };
      } catch (error) {
        console.error("Failed to create WebSocket:", error);
        // Retry after 5 seconds
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 5000);
      }
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  const value: NewsWebSocketContextType = {
    connected,
    newsItems,
    hasNewArticles,
    clearNewArticlesFlag,
    addNewsItems,
  };

  return <NewsWebSocketContext.Provider value={value}>{children}</NewsWebSocketContext.Provider>;
}
