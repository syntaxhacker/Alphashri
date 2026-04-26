import {
  ActionIcon,
  Badge,
  Box,
  Card,
  Collapse,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconRefresh, IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type { NewsItem } from "./news-types";
import { formatTimeAgo } from "../../utils/ui-helpers";
import { SentimentBadge } from "./SentimentBadge";
import { ImpactScore } from "./ImpactScore";

interface NewsListProps {
  loading: boolean;
  error: string | null;
  selectedSource: string;
  sourceData: { value: string; label: string }[];
  selectedArticle: NewsItem | null;
  onSourceChange: (v: string) => void;
  onRefresh: () => void;
  onArticleClick: (item: NewsItem) => void;
  groupedNewsItems: Record<string, NewsItem[]>;
  sourceNames: string[];
  expandedSources: Set<string>;
  toggleSourceExpanded: (source: string) => void;
}

export function NewsList({
  loading,
  error,
  selectedSource,
  sourceData,
  selectedArticle,
  onSourceChange,
  onRefresh,
  onArticleClick,
  groupedNewsItems,
  sourceNames,
  expandedSources,
  toggleSourceExpanded,
}: NewsListProps) {
  return (
    <Stack gap="sm" id="news-feed" data-testid="news-feed">
      <Group justify="space-between" className="news-feed-header">
        <Title order={3}>News Feed</Title>
        <ActionIcon
          variant="light"
          onClick={onRefresh}
          loading={loading}
          data-testid="news-feed-refresh-btn"
        >
          <IconRefresh size={18} />
        </ActionIcon>
      </Group>

      <Select
        value={selectedSource}
        onChange={(v) => v && onSourceChange(v)}
        data={sourceData}
        placeholder="Select source"
        data-testid="source-selector"
      />

      {loading && Object.keys(groupedNewsItems).length === 0 ? (
        <Group justify="center" py="xl" data-testid="news-loader">
          <Loader size="sm" />
          <Text c="dimmed">Loading news...</Text>
        </Group>
      ) : error ? (
        <Text c="red" ta="center" py="xl">
          {error}
        </Text>
      ) : sourceNames.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          No news available
        </Text>
      ) : (
        <Stack gap="sm" className="news-source-groups">
          {sourceNames.map((source) => {
            const items = groupedNewsItems[source];
            const isExpanded = expandedSources.has(source);
            const showSource = selectedSource === "all" || selectedSource === source;

            if (!showSource) return null;

            return (
              <Box key={source} className="news-source-group">
                <Group
                  gap="xs"
                  p="xs"
                  style={{
                    borderRadius: "var(--mantine-radius-sm)",
                    backgroundColor: "var(--mantine-color-default-hover)",
                  }}
                  onClick={() => toggleSourceExpanded(source)}
                  data-testid={`news-source-group-${source}`}
                >
                  {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                  <Text size="sm" fw={600} tt="uppercase">
                    {source}
                  </Text>
                  <Badge size="xs" variant="light" color="gray">
                    {items.length}
                  </Badge>
                </Group>

                <Collapse in={isExpanded}>
                  <Stack gap={4} mt="xs">
                    {items.map((item) => (
                      <Card
                        key={item.id}
                        padding="xs"
                        withBorder
                        style={{
                          backgroundColor:
                            selectedArticle?.id === item.id
                              ? "var(--mantine-color-blue-light)"
                              : undefined,
                        }}
                        onClick={() => onArticleClick(item)}
                        data-testid="news-list-item"
                      >
                        <Stack gap="xs" mb="xs">
                          {(item.sentiment || item.impact_score !== undefined) && (
                            <Group gap="xs" wrap="nowrap">
                              {item.sentiment && <SentimentBadge sentiment={item.sentiment} />}
                              {item.impact_score !== undefined && (
                                <ImpactScore score={item.impact_score} />
                              )}
                            </Group>
                          )}
                        </Stack>
                        <Group justify="space-between" wrap="nowrap" gap="xs">
                          <Text
                            size="xs"
                            fw={selectedArticle?.id === item.id ? 600 : 500}
                            lineClamp={2}
                            flex={1}
                          >
                            {item.headline}
                          </Text>
                          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                            {formatTimeAgo(item.publishedAt)}
                          </Text>
                        </Group>
                      </Card>
                    ))}
                  </Stack>
                </Collapse>
              </Box>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
