import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import { IconArrowUpRight, IconBulb, IconNews } from "@tabler/icons-react";
import { Box, Stack } from "@/ui";
import type { ArticleResponse, NewsItem, NewsSymbol } from "./news-types";
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="overline"
      color="text.secondary"
      fontWeight={700}
      sx={{ display: "block", letterSpacing: "0.08em", lineHeight: 1.4 }}
    >
      {children}
    </Typography>
  );
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
    Boolean(articleContent.summary || articleContent.key_points?.length);

  if (!selectedArticle) {
    return (
      <Box
        sx={{ width: "100%", minHeight: 0, flex: 1, display: "flex", flexDirection: "column" }}
        data-testid="article-detail-region"
      >
        <Box
          sx={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: 3,
            bgcolor: "background.default",
          }}
          data-testid="article-detail"
        >
          <EmptyState
            icon={
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 1,
                  color: "text.secondary",
                  bgcolor: "action.hover",
                }}
              >
                <IconNews size={26} stroke={1.4} />
              </Box>
            }
            title="Your reading desk is ready"
            description="Select a headline to open the full story, catalysts, and AI-assisted market brief."
            data-testid="article-empty"
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{ width: "100%", minHeight: 0, flex: 1, display: "flex", flexDirection: "column" }}
      data-testid="article-detail-region"
    >
      <Box data-testid="article-detail" sx={{ display: "contents" }}>
        <Box
          component="header"
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            px: { xs: 1.5, sm: 2 },
            py: 1.5,
            bgcolor: "background.paper",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75, minWidth: 0 }}
              >
                <Typography
                  variant="caption"
                  color="primary.main"
                  fontWeight={800}
                  sx={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
                >
                  {selectedArticle.source}
                </Typography>
                <Box sx={{ width: 3, height: 3, borderRadius: "50%", bgcolor: "text.disabled" }} />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatTimeAgo(articleContent?.publishedAt || selectedArticle.publishedAt)}
                </Typography>
              </Box>
              <Typography
                variant="h4"
                data-testid="article-title"
                sx={{
                  fontSize: { xs: "1.25rem", sm: "1.5rem" },
                  lineHeight: 1.2,
                  fontWeight: 750,
                  textWrap: "balance",
                }}
              >
                {selectedArticle.headline}
              </Typography>
            </Box>
            {isMobile ? (
              <IconButton
                size="small"
                aria-label="Close article"
                onClick={onClose}
                data-testid="close-article-btn"
                sx={{ mt: 0.25, flex: "0 0 auto" }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            ) : null}
          </Box>
        </Box>

        {articleLoading ? (
          <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 2 }} data-testid="article-loading">
            <Stack spacing={1.5}>
              <Skeleton variant="rounded" height={72} />
              <Skeleton variant="text" width="38%" />
              <Skeleton variant="rounded" height={104} />
              <Skeleton variant="rounded" height={80} />
              <Typography variant="body2" color="text.secondary">
                Analyzing article...
              </Typography>
            </Stack>
          </Box>
        ) : (
          <>
            <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <Stack spacing={2} sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: 920 }}>
                {articleError ? (
                  <Alert severity="error" data-testid="article-error">
                    {articleError}
                  </Alert>
                ) : null}

                {articleContent?.analysis_status === "failed" ? (
                  <Alert severity="warning" icon={false}>
                    This article is queued for analysis and will be updated shortly.
                  </Alert>
                ) : null}

                {articleContent?.analysis_status === "none" ? (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Skeleton variant="circular" width={18} height={18} />
                    <Typography variant="body2" color="text.secondary">
                      Analysis will be available once processed.
                    </Typography>
                  </Box>
                ) : null}

                {articleContent?.sentiment || articleContent?.impact_score !== undefined ? (
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      flexWrap: "wrap",
                      py: 0.5,
                      px: 0.5,
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "text.secondary" }}>
                      <IconBulb size={15} aria-hidden="true" />
                      <Typography variant="caption" fontWeight={700}>
                        Signal snapshot
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1 }} />
                    {articleContent.sentiment ? <SentimentBadge sentiment={articleContent.sentiment} /> : null}
                    <ImpactScore score={articleContent.impact_score} />
                  </Box>
                ) : null}

                {articleContent?.summary && articleContent.analysis_status !== "failed" ? (
                  <Box
                    data-testid="article-summary"
                    sx={{
                      p: 1.5,
                      borderRadius: 1,
                      borderLeft: 3,
                      borderColor: "primary.main",
                      bgcolor: "action.hover",
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75 }}>
                      <IconBulb size={16} color="primary" aria-hidden="true" />
                      <SectionLabel>Summary</SectionLabel>
                    </Box>
                    <Typography variant="body2" sx={{ lineHeight: 1.65, textWrap: "pretty" }}>
                      {articleContent.summary}
                    </Typography>
                  </Box>
                ) : null}

                {articleContent?.key_points && articleContent.key_points.length > 0 ? (
                  <Box component="section">
                    <SectionLabel>Key Takeaways</SectionLabel>
                    <Stack component="ul" spacing={0.75} sx={{ listStyle: "none", p: 0, mt: 0.75 }}>
                      {articleContent.key_points.map((point, index) => (
                        <Box
                          component="li"
                          key={`${index}-${point.slice(0, 40)}`}
                          sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}
                        >
                          <Box
                            component="span"
                            sx={{
                              width: 20,
                              height: 20,
                              display: "grid",
                              placeItems: "center",
                              borderRadius: "50%",
                              bgcolor: "action.selected",
                              color: "primary.main",
                              fontSize: 11,
                              fontWeight: 800,
                              flex: "0 0 auto",
                              mt: 0.15,
                            }}
                          >
                            {index + 1}
                          </Box>
                          <Typography variant="body2" sx={{ lineHeight: 1.55, textWrap: "pretty" }}>
                            {point}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                ) : null}

                {articleContent?.symbols && articleContent.symbols.length > 0 ? (
                  <Box component="section">
                    <SectionLabel>Stocks mentioned</SectionLabel>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 0.75 }}>
                      {articleContent.symbols.map((symbol) => (
                        <Tooltip
                          key={symbol.code}
                          title={symbol.instrument_key ? `View ${symbol.trading_symbol} chart` : "View details"}
                        >
                          <Chip
                            variant="outlined"
                            color={symbol.instrument_key ? "primary" : "default"}
                            size="small"
                            clickable
                            label={symbol.trading_symbol || symbol.name || symbol.code}
                            icon={symbol.instrument_key ? <ShowChartIcon fontSize="small" /> : undefined}
                            onClick={() => onSymbolClick(symbol)}
                            data-testid="symbol-badge"
                          />
                        </Tooltip>
                      ))}
                    </Box>
                  </Box>
                ) : null}

                {articleContent?.trade_ideas && articleContent.trade_ideas.length > 0 ? (
                  <Box component="section">
                    <SectionLabel>Trade Ideas</SectionLabel>
                    <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                      {articleContent.trade_ideas.map((idea, index) => (
                        <TradeIdeaCard
                          key={`${idea.symbol}-${idea.direction}-${index}`}
                          idea={idea}
                        />
                      ))}
                    </Stack>
                  </Box>
                ) : null}

                {articleContent?.description ? (
                  <Box component="section" sx={{ pt: 0.5 }}>
                    <SectionLabel>Full article</SectionLabel>
                    {hasLlmSummary ? (
                      <>
                        <Button
                          size="small"
                          onClick={onToggleFullContent}
                          aria-expanded={showFullContent}
                          data-testid="article-toggle-full-content-btn"
                          startIcon={showFullContent ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                          sx={{ mt: 0.5, alignSelf: "flex-start" }}
                        >
                          {showFullContent ? "Hide full article" : "View full article"}
                        </Button>
                        <Collapse in={showFullContent} unmountOnExit>
                          <Stack spacing={1.25} sx={{ mt: 1 }}>
                            {articleContent.description.split("\n\n").map((paragraph, index) => (
                              <Typography
                                key={`full-${index}-${paragraph.slice(0, 40)}`}
                                variant="body2"
                                sx={{ lineHeight: 1.7, mb: 0, textWrap: "pretty" }}
                              >
                                {paragraph}
                              </Typography>
                            ))}
                          </Stack>
                        </Collapse>
                      </>
                    ) : (
                      <Stack spacing={1.25} sx={{ mt: 1 }}>
                        {articleContent.description.split("\n\n").map((paragraph, index) => (
                          <Typography
                            key={`partial-${index}-${paragraph.slice(0, 40)}`}
                            variant="body2"
                            sx={{ lineHeight: 1.7, mb: 0, textWrap: "pretty" }}
                          >
                            {paragraph}
                          </Typography>
                        ))}
                      </Stack>
                    )}
                  </Box>
                ) : null}
              </Stack>
            </Box>
            <Divider />
            <Box
              sx={{
                minHeight: 48,
                px: 1.5,
                py: 0.75,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
                bgcolor: "background.paper",
              }}
            >
              {articleError && onRetryArticle ? (
                <Button size="small" onClick={onRetryArticle} data-testid="article-retry">
                  Retry
                </Button>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  {hasLlmSummary ? "AI-assisted summary" : "Source article"}
                </Typography>
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
                <Button size="small" endIcon={<IconArrowUpRight size={14} />} disabled>
                  No source link
                </Button>
              )}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}
