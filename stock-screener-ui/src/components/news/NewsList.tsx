import { IconBolt, IconRefresh } from "../common/Icons";
import { ActionIcon, Box, Skeleton, Select, Stack, Text, ToolbarRow, Tooltip } from "@/ui";
import * as palette from "@/ui/palette";
import type { NewsItem } from "./news-types";
import { NewsListContent } from "./NewsHelpers";
import { SentimentBadge } from "./SentimentBadge";
import { ImpactScore } from "./ImpactScore";

const normalizeSource = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

interface NewsListProps {
  loading: boolean;
  error: string | null;
  selectedSource: string;
  selectedSourceName?: string;
  sourceData: { value: string; label: string }[];
  selectedArticle: NewsItem | null;
  onSourceChange: (value: string) => void;
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
  selectedSourceName,
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
  const hasGroups = Object.keys(groupedNewsItems ?? {}).length > 0;
  const activeSourceName = selectedSource === "all" ? "all" : selectedSourceName ?? selectedSource;
  const normalizedActiveSource = normalizeSource(activeSourceName);
  const visibleSourceNames = sourceNames.filter(
    (source) => activeSourceName === "all" || normalizeSource(source) === normalizedActiveSource,
  );
  const newsItems = visibleSourceNames.flatMap((source) => groupedNewsItems[source] ?? []);
  const storyLabel = `${newsItems.length} ${newsItems.length === 1 ? "story" : "stories"}`;

  return (
    <Box
      className="flex flex-col flex-1 min-h-0 w-full"
      id="news-feed"
      data-testid="news-feed"
    >
      <Box
        data-testid="news-feed-toolbar"
        className="sticky top-0 z-20 bg-fin-surface border-b border-fin-border"
        style={{
          position: "sticky",
          top: 0,
          "z-index": 2,
          "background-color": palette.SURFACE,
          borderBottom: `1px solid ${palette.BORDER}`,
        }}
      >
        <Box style={{ "padding-left": 12, "padding-right": 12, "padding-top": 10, "padding-bottom": 6 }}>
          <ToolbarRow gap={8}>
            <Box style={{ "min-width": 0, flex: "0 0 auto", width: "100%" }}>
              <Box className="flex items-center gap-3" style={{ display: "flex", "align-items": "center", gap: 6 }}>
                <Text size="sm" fw={700} style={{ "line-height": 1.2 }}>
                  Market feed
                </Text>
                <Box
                  className="flex items-center gap-2 rounded-fin"
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: 4,
                    color: palette.POSITIVE,
                    "padding-left": 6,
                    "padding-right": 6,
                    "padding-top": 2,
                    "padding-bottom": 2,
                    "border-radius": 8,
                    "background-color": "#121212",
                  }}
                >
                  <IconBolt size={12} aria-hidden="true" />
                  <Text size="xs" fw={700} style={{ "line-height": 1 }}>
                    Live
                  </Text>
                </Box>
              </Box>
              <Text
                size="xs"
                c="dimmed"
                data-testid="news-story-count"
                className="block mt-2 [font-variant-numeric:tabular-nums]"
                style={{ display: "block", "margin-top": 2, fontVariantNumeric: "tabular-nums" }}
              >
                {storyLabel} across {visibleSourceNames.length} {visibleSourceNames.length === 1 ? "source" : "sources"}
              </Text>
            </Box>
            <Box style={{ flex: 1, "min-width": 0, display: "none" }} />
            <Box style={{ width: "auto", flex: 1, "max-width": "100%" }}>
              <Select
                aria-label="Source"
                size="sm"
                value={selectedSource}
                onChange={(value) => value && onSourceChange(value)}
                data={sourceData ?? []}
                style={{ width: "100%" }}
                data-testid="source-selector"
              />
            </Box>
            <Tooltip label="Refresh news feed">
              <ActionIcon
                variant="light"
                size="sm"
                onClick={onRefresh}
                loading={loading}
                disabled={loading}
                aria-label="Refresh news feed"
                data-testid="news-feed-refresh-btn"
                style={{ flex: "0 0 auto" }}
              >
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
          </ToolbarRow>
        </Box>
      </Box>

      {loading && !hasGroups ? (
        <Stack className="gap-2" style={{ padding: 12 }} data-testid="news-loader">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} h={64} className="rounded" />
          ))}
          <Text size="sm" c="dimmed">
            Loading market headlines…
          </Text>
        </Stack>
      ) : (
        <Box className="flex-1 min-h-0 overflow-auto">
          <NewsListContent
            loading={false}
            error={error}
            newsItems={newsItems}
            selectedSource={activeSourceName}
            selectedArticleId={selectedArticle?.id ?? null}
            itemTestId="news-list-item"
            sourceNames={sourceNames}
            groupedNewsItems={groupedNewsItems}
            expandedSources={expandedSources}
            readIds={new Set()}
            onToggleSource={toggleSourceExpanded}
            onArticleClick={onArticleClick}
            variant="desk"
            renderItemMeta={(item) =>
              item.sentiment || item.impact_score !== undefined ? (
                <Box
                  component="span"
                  className="flex items-center gap-3 min-w-0"
                  style={{ display: "flex", "align-items": "center", gap: 6, "min-width": 0 }}
                >
                  {item.sentiment && <SentimentBadge sentiment={item.sentiment} />}
                  {item.impact_score !== undefined && <ImpactScore score={item.impact_score} compact />}
                </Box>
              ) : null
            }
          />
        </Box>
      )}
    </Box>
  );
}
