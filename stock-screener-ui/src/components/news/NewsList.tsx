import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { IconBolt, IconRefresh } from "@tabler/icons-react";
import { ActionIcon, Box, Select, Stack, ToolbarRow, Tooltip } from "@/ui";
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
      sx={{ width: "100%", minHeight: 0, flex: 1, display: "flex", flexDirection: "column" }}
      id="news-feed"
      data-testid="news-feed"
    >
      <Box
        data-testid="news-feed-toolbar"
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          bgcolor: "background.paper",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Box sx={{ px: 1.5, pt: 1.25, pb: 0.75 }}>
          <ToolbarRow gap={8}>
            <Box sx={{ minWidth: 0, flex: "0 0 auto", flexBasis: { xs: "100%", sm: "auto" } }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                <Typography variant="subtitle1" fontWeight={700} sx={{ lineHeight: 1.2 }}>
                  Market feed
                </Typography>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    color: "success.main",
                    px: 0.75,
                    py: 0.25,
                    borderRadius: 1,
                    bgcolor: "action.hover",
                  }}
                >
                  <IconBolt size={12} aria-hidden="true" />
                  <Typography variant="caption" fontWeight={700} sx={{ lineHeight: 1 }}>
                    Live
                  </Typography>
                </Box>
              </Box>
              <Typography
                variant="caption"
                color="text.secondary"
                data-testid="news-story-count"
                sx={{ display: "block", mt: 0.25, fontVariantNumeric: "tabular-nums" }}
              >
                {storyLabel} across {visibleSourceNames.length} {visibleSourceNames.length === 1 ? "source" : "sources"}
              </Typography>
            </Box>
            <Box sx={{ flex: 1, minWidth: 0, display: { xs: "none", sm: "block" } }} />
            <Box sx={{ width: { xs: "auto", sm: 180 }, flex: 1, maxWidth: "100%" }}>
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
            <Tooltip title="Refresh news feed">
              <ActionIcon
                variant="light"
                size="sm"
                onClick={onRefresh}
                loading={loading}
                disabled={loading}
                aria-label="Refresh news feed"
                data-testid="news-feed-refresh-btn"
                sx={{ flex: "0 0 auto" }}
              >
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
          </ToolbarRow>
        </Box>
      </Box>

      {loading && !hasGroups ? (
        <Stack spacing={1} sx={{ p: 1.5 }} data-testid="news-loader">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} variant="rounded" height={64} />
          ))}
          <Typography variant="body2" color="text.secondary">
            Loading market headlines…
          </Typography>
        </Stack>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
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
                  sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}
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
