import {
  Box,
  Stack,
} from "@/ui";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Divider from "@mui/material/Divider";
import Alert from "@mui/material/Alert";
import Collapse from "@mui/material/Collapse";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";
import {
  IconChartLine,
  IconExternalLink,
  IconInfoCircle,
  IconTarget,
  IconTrendingUp,
  IconChevronDown,
  IconChevronRight,
  IconNews,
} from "@tabler/icons-react";
import type { NewsItem, NewsSymbol, ArticleResponse } from "./news-types";
import { SOURCE_COLORS } from "./news-constants";
import { formatTimeAgo } from "../../utils/ui-helpers";
import { SentimentBadge } from "./SentimentBadge";
import { ImpactScore } from "./ImpactScore";
import { TradeIdeaCard } from "./TradeIdeaCard";

interface ArticleDetailProps {
  selectedArticle: NewsItem | null;
  articleContent: ArticleResponse | null;
  articleLoading: boolean;
  isMobile: boolean;
  showFullContent: boolean;
  onClose: () => void;
  onToggleFullContent: () => void;
  onSymbolClick: (symbol: NewsSymbol) => void;
}

export function ArticleDetail({
  selectedArticle,
  articleContent,
  articleLoading,
  isMobile,
  showFullContent,
  onClose,
  onToggleFullContent,
  onSymbolClick,
}: ArticleDetailProps) {
  const hasLlmSummary =
    articleContent?.analysis_status === "done" &&
    !!(
      articleContent?.summary ||
      (articleContent?.key_points && articleContent.key_points.length > 0)
    );

  return (
    <Stack spacing={1} sx={{ p: 1, alignItems: "center", justifyContent: "center", width: "100%" }} data-testid="article-detail">
      {selectedArticle ? (
        <Stack spacing={1} sx={{ width: "100%", alignItems: "center", justifyContent: "center" }}>
          <Card elevation={1} sx={{ width: "100%", p: 1 }}>
            <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, gap: 1, "&:last-child": { pb: 1 } }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
                <Typography variant="h6" sx={{ display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }} data-testid="article-title">{selectedArticle.headline}</Typography>
                {isMobile && <IconButton size="small" onClick={onClose} data-testid="close-article-btn" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><IconInfoCircle size={16} /></IconButton>}
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
                <Chip size="small" label={selectedArticle.source} color={(SOURCE_COLORS as any)[selectedArticle.source] ? "primary" : "default"} variant="outlined" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }} />
                <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{formatTimeAgo(articleContent?.publishedAt || selectedArticle.publishedAt)}</Typography>
              </Box>
            </CardContent>
          </Card>

          {articleLoading ? (
            <Card elevation={1} sx={{ width: "100%", p: 1 }}>
              <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, "&:last-child": { pb: 1 } }}>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
                  <CircularProgress size={20} />
                  <Typography variant="body2" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Analyzing article...</Typography>
                </Box>
              </CardContent>
            </Card>
          ) : (
            <Stack spacing={1} sx={{ width: "100%", alignItems: "center", justifyContent: "center" }}>
              {articleContent?.analysis_status === "failed" && (
                <Card elevation={1} sx={{ width: "100%", p: 1 }}>
                  <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, "&:last-child": { pb: 1 } }}>
                    <Alert severity="warning" icon={<IconInfoCircle size={16} />} sx={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>This article is queued for analysis and will be updated shortly.</Alert>
                  </CardContent>
                </Card>
              )}

              {articleContent?.analysis_status === "none" && (
                <Card elevation={1} sx={{ width: "100%", p: 1 }}>
                  <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, gap: 1, "&:last-child": { pb: 1 } }}>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
                      <CircularProgress size={16} />
                      <Typography variant="body2" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Analysis will be available once processed.</Typography>
                    </Box>
                  </CardContent>
                </Card>
              )}

              {articleContent?.sentiment && (
                <Card elevation={1} sx={{ width: "100%", p: 1 }}>
                  <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, "&:last-child": { pb: 1 } }}>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
                      <SentimentBadge sentiment={articleContent.sentiment} />
                      <ImpactScore score={articleContent.impact_score} />
                    </Box>
                  </CardContent>
                </Card>
              )}

              {articleContent?.summary && articleContent.analysis_status !== "failed" && (
                <Card elevation={1} sx={{ width: "100%", p: 1 }}>
                  <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, "&:last-child": { pb: 1 } }}>
                    <Alert severity="info" icon={<IconInfoCircle size={16} />} sx={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}><Typography variant="body2" sx={{ display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>{articleContent.summary}</Typography></Alert>
                  </CardContent>
                </Card>
              )}

              {articleContent?.key_points && articleContent.key_points.length > 0 && (
                <Card elevation={1} sx={{ width: "100%", p: 1 }}>
                  <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, gap: 1, "&:last-child": { pb: 1 } }}>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
                      <IconTarget size={14} />
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>Key Takeaways</Typography>
                    </Box>
                    <List sx={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", p: 1 }}>
                      {articleContent.key_points.map((point, idx) => (
                        <ListItem key={`${idx}-${point.slice(0, 40)}`} sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
                          <Typography variant="body2" sx={{ display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>{point}</Typography>
                        </ListItem>
                      ))}
                    </List>
                  </CardContent>
                </Card>
              )}

              {articleContent?.symbols && articleContent.symbols.length > 0 && (
                <Card elevation={1} sx={{ width: "100%", p: 1 }}>
                  <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, gap: 1, "&:last-child": { pb: 1 } }}>
                    <Typography variant="body2" sx={{ fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center" }}>Stocks mentioned:</Typography>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, flexWrap: "wrap", width: "100%" }}>
                      {articleContent.symbols.map((symbol) => (
                        <Tooltip key={symbol.code} title={symbol.instrument_key ? `View ${symbol.trading_symbol} chart` : `View details`}>
                          <Chip variant="outlined" color={symbol.instrument_key ? "primary" : "default"} size="small" label={symbol.name || symbol.code} onClick={() => onSymbolClick(symbol)} icon={symbol.instrument_key ? <IconChartLine size={12} /> : undefined} sx={{ display: "flex", alignItems: "center", justifyContent: "center" }} data-testid="symbol-badge" />
                        </Tooltip>
                      ))}
                    </Box>
                  </CardContent>
                </Card>
              )}

              {articleContent?.trade_ideas && articleContent.trade_ideas.length > 0 && (
                <Card elevation={1} sx={{ width: "100%", p: 1 }}>
                  <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, gap: 1, "&:last-child": { pb: 1 } }}>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
                      <IconTrendingUp size={14} />
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>Trade Ideas</Typography>
                    </Box>
                    <Stack spacing={1} sx={{ width: "100%", alignItems: "center", justifyContent: "center" }}>
                      {articleContent.trade_ideas.map((idea, idx) => (
                        <Box key={`${idea.symbol}-${idea.direction}-${idx}`} sx={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
                          <TradeIdeaCard idea={idea} />
                        </Box>
                      ))}
                    </Stack>
                  </CardContent>
                </Card>
              )}

              {articleContent?.description && (
                <Card elevation={1} sx={{ width: "100%", p: 1 }}>
                  <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, gap: 1, "&:last-child": { pb: 1 } }}>
                    <Divider sx={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }} />
                    {hasLlmSummary ? (
                      <Stack spacing={1} sx={{ width: "100%", alignItems: "center", justifyContent: "center" }}>
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
                          <IconButton size="small" onClick={onToggleFullContent} data-testid="article-toggle-full-content-btn" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{showFullContent ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}</IconButton>
                          <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} onClick={onToggleFullContent}>{showFullContent ? "Hide full article" : "View full article"}</Typography>
                        </Box>
                        <Collapse in={showFullContent} sx={{ width: "100%" }}>
                          <Stack spacing={1} sx={{ width: "100%", alignItems: "center", justifyContent: "center", p: 1 }}>
                            {articleContent.description.split("\n\n").map((para, idx) => (<Typography key={`full-${idx}-${para.slice(0, 40)}`} variant="body2" sx={{ display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>{para}</Typography>))}
                          </Stack>
                        </Collapse>
                      </Stack>
                    ) : (
                      <Stack spacing={1} sx={{ width: "100%", alignItems: "center", justifyContent: "center", p: 1 }}>
                        {articleContent.description.split("\n\n").map((para, idx) => (<Typography key={`partial-${idx}-${para.slice(0, 40)}`} variant="body2" sx={{ display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>{para}</Typography>))}
                      </Stack>
                    )}
                  </CardContent>
                </Card>
              )}
            </Stack>
          )}

          {selectedArticle.sourceUrl && (
            <Card elevation={1} sx={{ width: "100%", p: 1 }}>
              <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, "&:last-child": { pb: 1 } }}>
                <Link href={selectedArticle.sourceUrl} target="_blank" rel="noopener noreferrer" sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
                  <Typography variant="body2" sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>Open Original <IconExternalLink size={14} /></Typography>
                </Link>
              </CardContent>
            </Card>
          )}
        </Stack>
      ) : (
        <Card elevation={1} sx={{ width: "100%", p: 1, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, flex: 1, "&:last-child": { pb: 1 } }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><IconNews size={48} stroke={1} /></Box>
            <Typography sx={{ display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>Select an article from the list to view details</Typography>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}
