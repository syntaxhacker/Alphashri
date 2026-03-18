import { useState, useEffect, useMemo } from "react";
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
}

export function useNewsSourceGroups({
  newsItems,
  autoExpandCount = 2,
}: UseNewsSourceGroupsOptions): UseNewsSourceGroupsReturn {
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());

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

  useEffect(() => {
    if (sourceNames.length > 0 && expandedSources.size === 0) {
      setExpandedSources(new Set(sourceNames.slice(0, autoExpandCount)));
    }
  }, [sourceNames.length, autoExpandCount]);

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

  return {
    groupedNewsItems,
    sourceNames,
    expandedSources,
    toggleSourceExpanded,
  };
}

export function getSourceOptions(
  sources: { id: string; name: string }[],
): { value: string; label: string }[] {
  return sources.length > 0
    ? [{ value: "all", label: "All Sources" }, ...sources.map((s) => ({ value: s.id, label: s.name }))]
    : [{ value: "all", label: "All Sources" }];
}
