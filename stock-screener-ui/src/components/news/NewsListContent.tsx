import { Group, Loader, Stack, Text } from "@mantine/core";
import type { NewsItem } from "./news-types";
import { NewsSourceGroup } from "./NewsSourceGroup";

export function NewsListContent({
  loading,
  error,
  newsItems,
  selectedSource,
  sourceNames,
  groupedNewsItems,
  expandedSources,
  readIds,
  onToggleSource,
  onArticleClick,
}: {
  loading: boolean;
  error: string | null;
  newsItems: NewsItem[];
  selectedSource: string;
  sourceNames: string[];
  groupedNewsItems: Record<string, NewsItem[]>;
  expandedSources: Set<string>;
  readIds: Set<string>;
  onToggleSource: (source: string) => void;
  onArticleClick: (item: NewsItem) => void;
}) {
  if (loading && newsItems.length === 0) {
    return (
      <Group justify="center" py="xl" data-testid="news-loading">
        <Loader size="sm" />
        <Text c="dimmed">Loading news...</Text>
      </Group>
    );
  }
  if (error) {
    return (
      <Text c="red" ta="center" py="xl" data-testid="news-error">
        {error}
      </Text>
    );
  }
  if (newsItems.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="xl" data-testid="news-empty">
        No news available
      </Text>
    );
  }
  return (
    <Stack gap="xs" className="news-source-groups">
      {sourceNames.map((source) => {
        const items = groupedNewsItems[source];
        const isExpanded = expandedSources.has(source);
        if (selectedSource !== "all" && selectedSource !== source) return null;
        return (
          <NewsSourceGroup
            key={source}
            source={source}
            items={items}
            isExpanded={isExpanded}
            readIds={readIds}
            onToggle={() => onToggleSource(source)}
            onItemClick={onArticleClick}
          />
        );
      })}
    </Stack>
  );
}
