import {
  Box,
  Stack,
} from "@/ui";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
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
    <Stack spacing={1} sx={{ p: 1, alignItems: "center", justifyContent: "center", width: "100%" }} id="news-feed" data-testid="news-feed">
      <Card elevation={1} sx={{ width: "100%", p: 1 }}>
        <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, gap: 1, "&:last-child": { pb: 1 } }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
            <Typography variant="h6" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>News Feed</Typography>
            <IconButton size="small" onClick={onRefresh} data-testid="news-feed-refresh-btn" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              {loading ? <CircularProgress size={18} /> : <IconRefresh size={18} />}
            </IconButton>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
            <Select size="small" value={selectedSource} onChange={(e) => { const v = String(e.target.value); if (v) onSourceChange(v); }} displayEmpty sx={{ minWidth: 160, display: "flex", alignItems: "center", justifyContent: "center" }} data-testid="source-selector">
              {sourceData.map((o) => (<MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>))}
            </Select>
          </Box>
        </CardContent>
      </Card>

      {loading && Object.keys(groupedNewsItems).length === 0 ? (
        <Card elevation={1} sx={{ width: "100%", p: 1 }}>
          <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, "&:last-child": { pb: 1 } }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Loading news...</Typography>
            </Box>
          </CardContent>
        </Card>
      ) : error ? (
        <Card elevation={1} sx={{ width: "100%", p: 1 }}>
          <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, "&:last-child": { pb: 1 } }}>
            <Typography color="error" sx={{ display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>{error}</Typography>
          </CardContent>
        </Card>
      ) : sourceNames.length === 0 ? (
        <Card elevation={1} sx={{ width: "100%", p: 1 }}>
          <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, "&:last-child": { pb: 1 } }}>
            <Typography variant="body2" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>No news available</Typography>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={1} sx={{ width: "100%", alignItems: "center", justifyContent: "center" }}>
          {sourceNames.map((source) => {
            const items = groupedNewsItems[source];
            const isExpanded = expandedSources.has(source);
            const showSource = selectedSource === "all" || selectedSource === source;

            if (!showSource) return null;

            return (
              <Card key={source} elevation={1} sx={{ width: "100%", p: 1 }}>
                <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, gap: 1, "&:last-child": { pb: 1 } }}>
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%", cursor: "pointer", bgcolor: "action.hover", borderRadius: 1 }} onClick={() => toggleSourceExpanded(source)} data-testid={`news-source-group-${source}`}>
                    {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    <Typography variant="caption" sx={{ fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", textTransform: "uppercase" }}>{source}</Typography>
                    <Chip size="small" label={String(items.length)} variant="outlined" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }} />
                  </Box>

                  <Collapse in={isExpanded} sx={{ width: "100%" }}>
                    <Stack spacing={1} sx={{ mt: 1, width: "100%", alignItems: "center", justifyContent: "center" }}>
                      {items.map((item) => (
                        <Card key={item.id} elevation={1} sx={{ width: "100%", p: 1, cursor: "pointer", bgcolor: selectedArticle?.id === item.id ? "primary.light" : undefined, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }} onClick={() => onArticleClick(item)} data-testid="news-list-item">
                          <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, width: "100%", gap: 1, "&:last-child": { pb: 1 } }}>
                            {(item.sentiment || item.impact_score !== undefined) && (
                              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
                                {item.sentiment && <SentimentBadge sentiment={item.sentiment} />}
                                {item.impact_score !== undefined && <ImpactScore score={item.impact_score} />}
                              </Box>
                            )}
                            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
                              <Typography variant="caption" sx={{ fontWeight: selectedArticle?.id === item.id ? 600 : 500, display: "flex", alignItems: "center", justifyContent: "center", flex: 1, textAlign: "center" }}>{item.headline}</Typography>
                              <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap" }}>{formatTimeAgo(item.publishedAt)}</Typography>
                            </Box>
                          </CardContent>
                        </Card>
                      ))}
                    </Stack>
                  </Collapse>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
