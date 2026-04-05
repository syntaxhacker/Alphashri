import { useState, useEffect, useCallback } from "react";
import type { NewsItem, NewsSource } from "./news-types";
import { fetchNews, fetchNewsSources } from "../../api/news";

interface UseNewsListOptions {
  wsNewsItems?: NewsItem[];
  addNewsItems?: (items: NewsItem[]) => void;
  isOpen?: boolean;
}

export function useNewsList(options: UseNewsListOptions = {}) {
  const { wsNewsItems = [], addNewsItems, isOpen = true } = options;

  const [localNewsItems, setLocalNewsItems] = useState<NewsItem[]>([]);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [selectedSource, setSelectedSource] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const newsItems = wsNewsItems.length > 0 ? wsNewsItems : localNewsItems;

  const loadNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sourceParam = selectedSource === "all" ? undefined : selectedSource;
      const items = await fetchNews(sourceParam, 50);
      if (wsNewsItems.length > 0 && addNewsItems) addNewsItems(items);
      else setLocalNewsItems(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load news");
    } finally {
      setLoading(false);
    }
  }, [selectedSource, wsNewsItems.length, addNewsItems]);

  useEffect(() => {
    fetchNewsSources().then(setSources).catch(console.error);
  }, []);

  useEffect(() => {
    if (isOpen) loadNews();
  }, [isOpen, selectedSource, loadNews]);

  return { newsItems, sources, selectedSource, setSelectedSource, loading, error, loadNews };
}
