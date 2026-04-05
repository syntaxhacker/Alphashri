import { useState } from "react";
import type { NewsItem } from "./news-types";
import { getReadIds, saveReadIds } from "./NewsLocalStorage";

export function useNewsReadState(newsItems: NewsItem[]) {
  const [readIds, setReadIds] = useState<Set<string>>(getReadIds);

  const markAsRead = (id: string) => {
    const next = new Set(readIds);
    next.add(id);
    setReadIds(next);
    saveReadIds(next);
  };

  const markAllRead = () => {
    const next = new Set(readIds);
    newsItems.forEach((item) => next.add(item.id));
    setReadIds(next);
    saveReadIds(next);
  };

  const unreadCount = newsItems.filter((item) => !readIds.has(item.id)).length;

  return { readIds, markAsRead, markAllRead, unreadCount };
}
