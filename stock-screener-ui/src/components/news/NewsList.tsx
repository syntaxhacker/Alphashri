import Box from "@mui/material/Box";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { IconRefresh } from "@tabler/icons-react";
import type { NewsItem } from "./news-types";
import { NewsListContent } from "./NewsHelpers";
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
  const hasGroups = Object.keys(groupedNewsItems ?? {}).length > 0;
  const newsItems = sourceNames.flatMap((source) => groupedNewsItems[source] ?? []);

  return (
    <Box
      sx={{ width: "100%", minHeight: 0, flex: 1, display: "flex", flexDirection: "column" }}
      id="news-feed"
      data-testid="news-feed"
    >
      <CardHeader
        title={<Typography variant="h6">News Feed</Typography>}
        action={
          <IconButton
            size="small"
            edge="end"
            aria-label="Refresh news feed"
            onClick={onRefresh}
            data-testid="news-feed-refresh-btn"
          >
            {loading ? <CircularProgress size={18} /> : <IconRefresh size={18} />}
          </IconButton>
        }
        sx={{ px: 1, py: 1 }}
      />
      <Divider />
      <CardContent sx={{ py: 1 }}>
        <FormControl fullWidth size="small">
          <InputLabel id="news-source-label">Source</InputLabel>
          <Select
            labelId="news-source-label"
            value={selectedSource}
            label="Source"
            displayEmpty
            onChange={(event) => {
              const value = String(event.target.value);
              if (value) onSourceChange(value);
            }}
            data-testid="source-selector"
          >
            {(sourceData ?? []).map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </CardContent>
      <Divider />
      {loading && !hasGroups ? (
        <CardContent>
          <Stack spacing={1} data-testid="news-loader">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} variant="rounded" height={72} />
            ))}
            <Typography variant="body2" color="text.secondary">
              Loading news...
            </Typography>
          </Stack>
        </CardContent>
      ) : (
        <CardContent
          sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 0, "&:last-child": { pb: 0 } }}
        >
          <NewsListContent
            loading={false}
            error={error}
            newsItems={newsItems}
            selectedSource={selectedSource}
            selectedArticleId={selectedArticle?.id ?? null}
            itemTestId="news-list-item"
            sourceNames={sourceNames}
            groupedNewsItems={groupedNewsItems}
            expandedSources={expandedSources}
            readIds={new Set()}
            onToggleSource={toggleSourceExpanded}
            onArticleClick={onArticleClick}
            renderItemMeta={(item) =>
              item.sentiment || item.impact_score !== undefined ? (
                <Box
                  component="span"
                  sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}
                >
                  {item.sentiment && <SentimentBadge sentiment={item.sentiment} />}
                  {item.impact_score !== undefined && <ImpactScore score={item.impact_score} />}
                </Box>
              ) : null
            }
          />
        </CardContent>
      )}
    </Box>
  );
}
