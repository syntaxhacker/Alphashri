import { useState, useEffect, useMemo, useRef } from "react";
import type { NewsItem } from "./news-types";

interface UseNewsSourceGroupsOptions {
  newsItems: NewsItem[];
  autoExpandCount?: number;
}

interface UseNewsSourceGroupsReturn {
  groupedNewsItems: Record<string, NewsItem[]>;
  sourceNames: string[];
  expandedSources: Set<string>;
  toggleSourceExpanded: (source: string) => void;
  expandAll: () => void;
}

export function useNewsSourceGroups({
  newsItems,
  autoExpandCount = 2,
}: UseNewsSourceGroupsOptions): UseNewsSourceGroupsReturn {
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const hasInitialized = useRef(false);

  const groupedNewsItems = useMemo(() => {
    return newsItems.reduce<Record<string, NewsItem[]>>((acc, item) => {
      const source = item.source || "Unknown";
      if (!acc[source]) {
        acc[source] = [];
      }
      acc[source].push(item);
      return acc;
    }, {});
  }, [newsItems]);

  const sourceNames = useMemo(() => {
    return Object.keys(groupedNewsItems).sort((a, b) => {
      const aItems = groupedNewsItems[a];
      const bItems = groupedNewsItems[b];
      const aTime = aItems[0]?.publishedAt || "";
      const bTime = bItems[0]?.publishedAt || "";
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
  }, [groupedNewsItems]);

  // Only auto-expand on first load, not on every refresh
  useEffect(() => {
    if (sourceNames.length > 0 && !hasInitialized.current) {
      hasInitialized.current = true;
      setExpandedSources(new Set(sourceNames.slice(0, autoExpandCount)));
    }
  }, [sourceNames, autoExpandCount]);

  // Add any new sources to expanded set (don't remove existing ones)
  useEffect(() => {
    if (sourceNames.length > 0 && hasInitialized.current) {
      setExpandedSources((prev) => {
        const newSources = sourceNames.filter((s) => !prev.has(s));
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
  }, [sourceNames, autoExpandCount]);

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
    setExpandedSources(new Set(sourceNames));
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
