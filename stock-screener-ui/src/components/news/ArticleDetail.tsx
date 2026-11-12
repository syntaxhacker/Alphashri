import { Alert, Badge, Button, Box, Collapse, Divider, Skeleton, Stack, Text, Title, Tooltip, ActionIcon } from "@/ui";
import { IconArrowUpRight, IconBulb, IconChartLine, IconChevronDown, IconChevronUp, IconExternalLink, IconNews, IconX } from "../common/Icons";
import * as palette from "@/ui/palette";
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
    <Text
      size="xs"
      fw={700}
      c="dimmed"
      tt="uppercase"
      style={{ display: "block", "letter-spacing": "0.08em", "line-height": 1.4 }}
    >
      {children}
    </Text>
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
        className="flex flex-col flex-1 min-h-0 w-full"
        data-testid="article-detail-region"
      >
        <Box
          className="flex-1 flex items-center justify-center bg-fin-bg"
          style={{ padding: "24px" }}
          data-testid="article-detail"
        >
          <EmptyState
            icon={
              <Box
                style={{
                  width: "48px",
                  height: "48px",
                  display: "grid",
                  "place-items": "center",
                  "border-radius": "8px",
                  color: palette.TEXT_MUTED,
                  "background-color": "#121212",
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
      className="flex flex-col flex-1 min-h-0 w-full"
      data-testid="article-detail-region"
    >
      <Box data-testid="article-detail" style={{ display: "contents" }}>
        <Box
          component="header"
          className="sticky top-0 z-20 bg-fin-surface border-b border-fin-border"
          style={{
            position: "sticky",
            top: "0px",
            "z-index": 2,
            "padding-left": "16px",
            "padding-right": "16px",
            "padding-top": "12px",
            "padding-bottom": "12px",
            "background-color": palette.SURFACE,
            "border-bottom": `1px solid ${palette.BORDER}`,
          }}
        >
          <Box className="flex items-start gap-6" style={{ display: "flex", "align-items": "flex-start", gap: "12px" }}>
            <Box className="flex-1 min-w-0">
              <Box className="flex items-center gap-4 mb-3 min-w-0" style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "6px", "min-width": "0px" }}>
                <Text size="xs" fw={800} c="primary" style={{ "text-transform": "uppercase", "letter-spacing": "0.08em" }}>
                  {selectedArticle.source}
                </Text>
                <Box style={{ width: "3px", height: "3px", "border-radius": "50%", "background-color": palette.TEXT_MUTED }} />
                <Text size="xs" c="dimmed" className="[font-variant-numeric:tabular-nums]">
                  {formatTimeAgo(articleContent?.publishedAt || selectedArticle.publishedAt)}
                </Text>
              </Box>
              <Title
                order={4}
                data-testid="article-title"
                style={{ "font-size": "1.25rem", "line-height": 1.2, "font-weight": 750, "text-wrap": "balance" }}
              >
                {selectedArticle.headline}
              </Title>
            </Box>
            {isMobile ? (
              <ActionIcon
                size="sm"
                aria-label="Close article"
                onClick={onClose}
                data-testid="close-article-btn"
                variant="subtle"
                style={{ "margin-top": "2px", flex: "0 0 auto" }}
              >
                <IconX size={12} />
              </ActionIcon>
            ) : null}
          </Box>
        </Box>

        {articleLoading ? (
          <Box className="flex-1 min-h-0 overflow-auto" style={{ padding: "16px" }} data-testid="article-loading">
            <Stack className="gap-3">
              <Skeleton h={72} className="rounded" />
              <Skeleton w="38%" />
              <Skeleton h={104} className="rounded" />
              <Skeleton h={80} className="rounded" />
              <Text size="sm" c="dimmed">
                Analyzing article...
              </Text>
            </Stack>
          </Box>
        ) : (
          <>
            <Box className="flex-1 min-h-0 overflow-auto">
              <Stack className="gap-8" style={{ "max-width": "920px", padding: "24px 16px" }}>
                {articleError ? (
                  <Alert color="error" variant="filled" data-testid="article-error">
                    {articleError}
                  </Alert>
                ) : null}

                {articleContent?.analysis_status === "failed" ? (
                  <Alert color="warning" variant="filled">
                    This article is queued for analysis and will be updated shortly.
                  </Alert>
                ) : null}

                {articleContent?.analysis_status === "none" ? (
                  <Box className="flex items-center gap-4">
                    <Skeleton w={18} h={18} circle />
                    <Text size="sm" c="dimmed">
                      Analysis will be available once processed.
                    </Text>
                  </Box>
                ) : null}

                {articleContent?.sentiment || articleContent?.impact_score !== undefined ? (
                  <Box className="flex items-center flex-wrap" style={{ display: "flex", "align-items": "center", "flex-wrap": "wrap", "padding-top": "4px", "padding-bottom": "4px", "padding-left": "4px", "padding-right": "4px" }}>
                    <Box className="flex items-center gap-2" style={{ color: palette.TEXT_MUTED, display: "flex", "align-items": "center", gap: "4px" }}>
                      <IconBulb size={15} aria-hidden="true" />
                      <Text size="xs" fw={700}>
                        Signal snapshot
                      </Text>
                    </Box>
                    <Box style={{ flex: 1 }} />
                    {articleContent.sentiment ? <SentimentBadge sentiment={articleContent.sentiment} /> : null}
                    <ImpactScore score={articleContent.impact_score} />
                  </Box>
                ) : null}

                {articleContent?.summary && articleContent.analysis_status !== "failed" ? (
                  <Box
                    data-testid="article-summary"
                    style={{
                      padding: "12px",
                      "border-radius": "8px",
                      "border-left": `3px solid ${palette.PRIMARY}`,
                      "background-color": "#121212",
                    }}
                  >
                    <Box className="flex items-center gap-3 mb-3" style={{ display: "flex", "align-items": "center", gap: "12px", "margin-bottom": "12px" }}>
                      <IconBulb size={16} color="primary" aria-hidden="true" />
                      <SectionLabel>Summary</SectionLabel>
                    </Box>
                    <Text size="sm" style={{ "line-height": 1.65, "text-wrap": "pretty" }}>
                      {articleContent.summary}
                    </Text>
                  </Box>
                ) : null}

                {articleContent?.key_points && articleContent.key_points.length > 0 ? (
                  <Box component="section">
                    <SectionLabel>Key Takeaways</SectionLabel>
                    <Stack component="ul" className="list-none" style={{ padding: "0px", "margin-top": "6px", "list-style": "none" }}>
                      {articleContent.key_points.map((point, index) => (
                        <Box
                          component="li"
                          key={`${index}-${point.slice(0, 40)}`}
                          className="flex items-start gap-4"
                          style={{ display: "flex", "align-items": "flex-start", gap: "4px" }}
                        >
                          <Box
                            component="span"
                            style={{
                              width: "20px",
                              height: "20px",
                              display: "grid",
                              "place-items": "center",
                              "border-radius": "50%",
                              "background-color": palette.PRIMARY,
                              color: palette.BG,
                              "font-size": "11px",
                              "font-weight": 800,
                              flex: "0 0 auto",
                              "margin-top": "1px",
                            }}
                          >
                            {index + 1}
                          </Box>
                          <Text size="sm" style={{ "line-height": 1.55, "text-wrap": "pretty" }}>
                            {point}
                          </Text>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                ) : null}

                {articleContent?.symbols && articleContent.symbols.length > 0 ? (
                  <Box component="section">
                    <SectionLabel>Stocks mentioned</SectionLabel>
                    <Box className="flex flex-wrap gap-2 mt-2" style={{ display: "flex", "flex-wrap": "wrap", gap: "8px", "margin-top": "12px" }}>
                      {articleContent.symbols.map((symbol) => (
                        <Tooltip
                          key={symbol.code}
                          label={symbol.instrument_key ? `View ${symbol.trading_symbol} chart` : "View details"}
                        >
                          <Badge
                            variant="outline"
                            color={symbol.instrument_key ? "primary" : "secondary"}
                            size="sm"
                            onClick={() => onSymbolClick(symbol)}
                            data-testid="symbol-badge"
                            style={{ cursor: "pointer" }}
                          >
                            {symbol.name || symbol.code}
                            {symbol.instrument_key && <IconChartLine size={12} style={{ "margin-left": "4px" }} />}
                          </Badge>
                        </Tooltip>
                      ))}
                    </Box>
                  </Box>
                ) : null}

                {articleContent?.trade_ideas && articleContent.trade_ideas.length > 0 ? (
                  <Box component="section">
                    <SectionLabel>Trade Ideas</SectionLabel>
                    <Stack className="gap-2" style={{ "margin-top": "12px" }}>
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
                  <Box component="section" style={{ "padding-top": "4px" }}>
                    <SectionLabel>Full article</SectionLabel>
                    {hasLlmSummary ? (
                      <>
                        <Button
                          size="sm"
                          onClick={onToggleFullContent}
                          aria-expanded={showFullContent}
                          data-testid="article-toggle-full-content-btn"
                          startIcon={showFullContent ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                          variant="subtle"
                          style={{ "margin-top": "4px", "align-self": "flex-start" }}
                        >
                          {showFullContent ? "Hide full article" : "View full article"}
                        </Button>
                        <Collapse in={showFullContent}>
                          <Stack className="gap-4" style={{ "margin-top": "16px" }}>
                            {articleContent.description.split("\n\n").map((paragraph, index) => (
                              <Text
                                key={`full-${index}-${paragraph.slice(0, 40)}`}
                                size="sm"
                                style={{ "line-height": 1.7, "margin-bottom": "0px", "text-wrap": "pretty" }}
                              >
                                {paragraph}
                              </Text>
                            ))}
                          </Stack>
                        </Collapse>
                      </>
                    ) : (
                      <Stack className="gap-4" style={{ "margin-top": "16px" }}>
                        {articleContent.description.split("\n\n").map((paragraph, index) => (
                          <Text
                            key={`partial-${index}-${paragraph.slice(0, 40)}`}
                            size="sm"
                            style={{ "line-height": 1.7, "margin-bottom": "0px", "text-wrap": "pretty" }}
                          >
                            {paragraph}
                          </Text>
                        ))}
                      </Stack>
                    )}
                  </Box>
                ) : null}
              </Stack>
            </Box>
            <Divider />
            <Box className="flex items-center justify-between gap-4 bg-fin-surface" style={{ "min-height": "48px", "padding-left": "12px", "padding-right": "12px", "padding-top": "6px", "padding-bottom": "6px", display: "flex", "align-items": "center", "justify-content": "space-between", gap: "8px", "background-color": palette.SURFACE }}>
              {articleError && onRetryArticle ? (
                <Button size="sm" onClick={onRetryArticle} data-testid="article-retry">
                  Retry
                </Button>
              ) : (
                <Text size="xs" c="dimmed">
                  {hasLlmSummary ? "AI-assisted summary" : "Source article"}
                </Text>
              )}
              {selectedArticle.sourceUrl ? (
                <Button
                  size="sm"
                  href={selectedArticle.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  endIcon={<IconExternalLink size={12} />}
                >
                  Open Original
                </Button>
              ) : (
                <Button size="sm" endIcon={<IconArrowUpRight size={14} />} disabled>
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
