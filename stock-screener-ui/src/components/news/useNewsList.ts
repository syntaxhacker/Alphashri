import { createEffect, createMemo, createSignal, onMount } from "solid-js";
import type { NewsItem, NewsSource } from "./news-types";
import { fetchNews, fetchNewsSources } from "../../api/news";

type Accessor<T> = () => T;
/** Accepts either a plain value or a signal accessor — React-call sites pass plain values. */
function asAccessor<T>(value: T | Accessor<T> | undefined, fallback: T): Accessor<T> {
  if (typeof value === "function") return value as Accessor<T>;
  return () => (value ?? fallback);
}

export interface UseNewsListOptions {
  wsNewsItems?: NewsItem[] | Accessor<NewsItem[]>;
  addNewsItems?: (items: NewsItem[]) => void;
  isOpen?: boolean | Accessor<boolean>;
}

export function useNewsList(options: UseNewsListOptions = {}) {
  const wsNewsItems = asAccessor(options.wsNewsItems, []);
  const isOpen = asAccessor(options.isOpen, true);
  const addNewsItems = options.addNewsItems;

  const [localNewsItems, setLocalNewsItems] = createSignal<NewsItem[]>([]);
  const [sources, setSources] = createSignal<NewsSource[]>([]);
  const [selectedSource, setSelectedSource] = createSignal("all");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const newsItems = createMemo(() => (wsNewsItems().length > 0 ? wsNewsItems() : localNewsItems()));

  const loadNews = async () => {
    setLoading(true);
    setError(null);
    try {
      const sourceParam = selectedSource() === "all" ? undefined : selectedSource();
      const items = await fetchNews(sourceParam, 50);
      if (wsNewsItems().length > 0 && addNewsItems) addNewsItems(items);
      else setLocalNewsItems(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load news");
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    fetchNewsSources().then(setSources).catch(console.error);
  });

  createEffect(() => {
    // Track the source so switching sources re-fetches even while open.
    selectedSource();
    if (isOpen()) void loadNews();
  });

  return { newsItems, sources, selectedSource, setSelectedSource, loading, error, loadNews };
}
