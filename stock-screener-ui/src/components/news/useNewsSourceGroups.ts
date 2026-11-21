import { createEffect, createMemo, createSignal } from "solid-js";
import type { NewsItem } from "./news-types";

type Accessor<T> = () => T;
/** Accepts either a plain array or a signal accessor. */
function asAccessor<T>(value: T | Accessor<T>): Accessor<T> {
  return typeof value === "function" ? (value as Accessor<T>) : () => value;
}

interface UseNewsSourceGroupsOptions {
  newsItems: NewsItem[] | Accessor<NewsItem[]>;
  autoExpandCount?: number;
}

interface UseNewsSourceGroupsReturn {
  groupedNewsItems: () => Record<string, NewsItem[]>;
  sourceNames: () => string[];
  expandedSources: () => Set<string>;
  toggleSourceExpanded: (source: string) => void;
  expandAll: () => void;
}

export function useNewsSourceGroups(options: UseNewsSourceGroupsOptions): UseNewsSourceGroupsReturn {
  const { autoExpandCount = 2 } = options;
  const newsItems = asAccessor(options.newsItems);

  const [expandedSources, setExpandedSources] = createSignal<Set<string>>(new Set());
  let hasInitialized = false;

  const groupedNewsItems = createMemo(() => {
    return newsItems().reduce<Record<string, NewsItem[]>>((acc, item) => {
      const source = item.source || "Unknown";
      if (!acc[source]) {
        acc[source] = [];
      }
      acc[source].push(item);
      return acc;
    }, {});
  });

  const sourceNames = createMemo(() => {
    return Object.keys(groupedNewsItems()).sort((a, b) => {
      const aItems = groupedNewsItems()[a];
      const bItems = groupedNewsItems()[b];
      const aTime = aItems[0]?.publishedAt || "";
      const bTime = bItems[0]?.publishedAt || "";
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
  });

  // Only auto-expand on first load, not on every refresh
  createEffect(() => {
    const names = sourceNames();
    if (names.length > 0 && !hasInitialized) {
      hasInitialized = true;
      setExpandedSources(new Set(names.slice(0, autoExpandCount)));
    }
  });

  // Add any new sources to expanded set (don't remove existing ones)
  createEffect(() => {
    const names = sourceNames();
    if (names.length > 0 && hasInitialized) {
      setExpandedSources((prev) => {
        const newSources = names.filter((s) => !prev.has(s));
        if (newSources.length === 0) return prev;
        const next = new Set(prev);
        for (const s of newSources) {
          if (next.size < autoExpandCount) {
            next.add(s);
          }
        }
        return next;
      });
    }
  });

  const toggleSourceExpanded = (source: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedSources(new Set(sourceNames()));
  };

  return {
    groupedNewsItems,
    sourceNames,
    expandedSources,
    toggleSourceExpanded,
    expandAll,
  };
}

export function getSourceOptions(
  sources: { id: string; name: string }[],
): { value: string; label: string }[] {
  return sources.length > 0
    ? [
        { value: "all", label: "All Sources" },
        ...sources.map((s) => ({ value: s.id, label: s.name })),
      ]
    : [{ value: "all", label: "All Sources" }];
}
