import { Box, Stack } from "@/ui";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Button from "@mui/material/Button";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Skeleton from "@mui/material/Skeleton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import { IconNews } from "@tabler/icons-react";
import type { NewsItem, NewsSymbol, ArticleResponse } from "./news-types";
import { formatTimeAgo } from "../../utils/ui-helpers";
import { SentimentBadge } from "./SentimentBadge";
import { ImpactScore } from "./ImpactScore";
import { TradeIdeaCard } from "./TradeIdeaCard";
import { EmptyState } from "../common/states";

interface ArticleDetailProps {
  selectedArticle: NewsItem | null;
  articleContent: ArticleResponse | null;
  articleLoading: boolean;
  articleError?: string | null;
  isMobile: boolean;
  showFullContent: boolean;
  onClose: () => void;
  onToggleFullContent: () => void;
  onSymbolClick: (symbol: NewsSymbol) => void;
  onRetryArticle?: () => void;
}

export function ArticleDetail({
  selectedArticle,
  articleContent,
  articleLoading,
  articleError,
  isMobile,
  showFullContent,
  onClose,
  onToggleFullContent,
  onSymbolClick,
  onRetryArticle,
}: ArticleDetailProps) {
  const hasLlmSummary =
    articleContent?.analysis_status === "done" &&
    !!(
      articleContent?.summary ||
      (articleContent?.key_points && articleContent.key_points.length > 0)
    );

  if (!selectedArticle) {
    return (
      <Box
        sx={{ width: "100%", minHeight: 0, flex: 1, display: "flex", flexDirection: "column" }}
        data-testid="article-detail"
      >
        <EmptyState
          icon={<IconNews size={40} stroke={1} />}
          title="Select an article"
          description="Choose an article from the list to view its analysis here."
          data-testid="article-empty"
        />
      </Box>
    );
  }

  return (
    <Box
      sx={{ width: "100%", minHeight: 0, flex: 1, display: "flex", flexDirection: "column" }}
      data-testid="article-detail"
    >
      <CardHeader
        title={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
            <Typography variant="h6" data-testid="article-title" sx={{ flex: 1, minWidth: 0 }}>
              {selectedArticle.headline}
            </Typography>
            <Chip size="small" label={selectedArticle.source} variant="outlined" />
          </Box>
        }
        subheader={`${selectedArticle.source} · ${formatTimeAgo(articleContent?.publishedAt || selectedArticle.publishedAt)}`}
        action={
          isMobile ? (
            <IconButton
              size="small"
              edge="end"
              aria-label="Close article"
              onClick={onClose}
              data-testid="close-article-btn"
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          ) : undefined
        }
        sx={{ px: 1, py: 1, alignItems: "flex-start" }}
      />
      <Divider />
      {articleLoading ? (
        <CardContent>
          <Stack spacing={1}>
            <Skeleton variant="text" width="40%" />
            <Skeleton variant="rounded" height={96} />
            <Skeleton variant="rounded" height={96} />
            <Typography variant="body2" color="text.secondary">
              Analyzing article...
            </Typography>
          </Stack>
        </CardContent>
      ) : (
        <>
          <CardContent sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <Stack spacing={2}>
              {articleError && (
                <Alert severity="error" data-testid="article-error">
                  {articleError}
                </Alert>
              )}

              {articleContent?.analysis_status === "failed" && (
                <Alert severity="warning" icon={false}>
                  This article is queued for analysis and will be updated shortly.
                </Alert>
              )}

              {articleContent?.analysis_status === "none" && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Skeleton variant="circular" width={20} height={20} />
                  <Typography variant="body2" color="text.secondary">
                    Analysis will be available once processed.
                  </Typography>
                </Box>
              )}

              {articleContent?.sentiment && (
                <Stack direction="row" gap={1} align="center" wrap="wrap">
                  <SentimentBadge sentiment={articleContent.sentiment} />
                  <ImpactScore score={articleContent.impact_score} />
                </Stack>
              )}

              {articleContent?.summary && articleContent.analysis_status !== "failed" && (
                <Alert severity="info">
                  <AlertTitle>Summary</AlertTitle>
                  <Typography variant="body2">{articleContent.summary}</Typography>
                </Alert>
              )}

              {articleContent?.key_points && articleContent.key_points.length > 0 && (
                <Stack spacing={0}>
                  <Typography variant="subtitle2" gutterBottom>
                    Key Takeaways
                  </Typography>
                  <List dense disablePadding>
                    {articleContent.key_points.map((point, idx) => (
                      <ListItem
                        key={`${idx}-${point.slice(0, 40)}`}
                        disablePadding
                        sx={{ alignItems: "flex-start" }}
                      >
                        <ListItemText
                          primary={point}
                          slotProps={{ primary: { variant: "body2" } }}
                        />
                      </ListItem>
                    ))}
                  </List>
                </Stack>
              )}

              {articleContent?.symbols && articleContent.symbols.length > 0 && (
                <Stack spacing={1}>
                  <Typography variant="subtitle2">Stocks mentioned</Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    {articleContent.symbols.map((symbol) => (
                      <Tooltip
                        key={symbol.code}
                        title={
                          symbol.instrument_key
                            ? `View ${symbol.trading_symbol} chart`
                            : `View details`
                        }
                      >
                        <Chip
                          variant="outlined"
                          color={symbol.instrument_key ? "primary" : "default"}
                          size="small"
                          clickable
                          label={symbol.name || symbol.code}
                          icon={
                            symbol.instrument_key ? (
                              <ShowChartIcon fontSize="small" />
                            ) : undefined
                          }
                          onClick={() => onSymbolClick(symbol)}
                          data-testid="symbol-badge"
                        />
                      </Tooltip>
                    ))}
                  </Box>
                </Stack>
              )}

              {articleContent?.trade_ideas && articleContent.trade_ideas.length > 0 && (
                <Stack spacing={0}>
                  <Typography variant="subtitle2" gutterBottom>
                    Trade Ideas
                  </Typography>
                  <List dense disablePadding>
                    {articleContent.trade_ideas.map((idea, idx) => (
                      <TradeIdeaCard
                        key={`${idea.symbol}-${idea.direction}-${idx}`}
                        idea={idea}
                      />
                    ))}
                  </List>
                </Stack>
              )}

              {articleContent?.description && (
                <Stack spacing={1}>
                  <Typography variant="subtitle2">Full article</Typography>
                  {hasLlmSummary ? (
                    <>
                      <Button
                        size="small"
                        onClick={onToggleFullContent}
                        aria-expanded={showFullContent}
                        data-testid="article-toggle-full-content-btn"
                        startIcon={
                          showFullContent ? <ExpandLessIcon /> : <ExpandMoreIcon />
                        }
                        sx={{ alignSelf: "flex-start" }}
                      >
                        {showFullContent ? "Hide full article" : "View full article"}
                      </Button>
                      <Collapse in={showFullContent} unmountOnExit>
                        <Stack spacing={1}>
                          {articleContent.description.split("\n\n").map((para, idx) => (
                            <Typography
                              key={`full-${idx}-${para.slice(0, 40)}`}
                              variant="body2"
                              paragraph
                            >
                              {para}
                            </Typography>
                          ))}
                        </Stack>
                      </Collapse>
                    </>
                  ) : (
                    <Stack spacing={1}>
                      {articleContent.description.split("\n\n").map((para, idx) => (
                        <Typography
                          key={`partial-${idx}-${para.slice(0, 40)}`}
                          variant="body2"
                          paragraph
                        >
                          {para}
                        </Typography>
                      ))}
                    </Stack>
                  )}
                </Stack>
              )}
            </Stack>
          </CardContent>
          <Divider />
          <CardActions sx={{ justifyContent: "space-between", px: 1 }}>
            {articleError && onRetryArticle ? (
              <Button size="small" onClick={onRetryArticle} data-testid="article-retry">
                Retry
              </Button>
            ) : (
              <span />
            )}
            {selectedArticle.sourceUrl ? (
              <Button
                size="small"
                href={selectedArticle.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                endIcon={<OpenInNewIcon fontSize="small" />}
              >
                Open Original
              </Button>
            ) : (
              <span />
            )}
          </CardActions>
        </>
      )}
    </Box>
  );
}
