import { Alert, Badge, Button, Box, Collapse, Divider, Skeleton, Stack, Text, Title, Tooltip, ActionIcon } from "@/ui";
import { IconArrowUpRight, IconBulb, IconChartLine, IconChevronDown, IconChevronUp, IconExternalLink, IconNews, IconX } from "@tabler/icons-react";
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
      style={{ display: "block", letterSpacing: "0.08em", lineHeight: 1.4 }}
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
          style={{ padding: 24 }}
          data-testid="article-detail"
        >
          <EmptyState
            icon={
              <Box
                style={{
                  width: 48,
                  height: 48,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 8,
                  color: palette.TEXT_MUTED,
                  backgroundColor: "#121212",
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
            top: 0,
            zIndex: 2,
            paddingLeft: 16,
            paddingRight: 16,
            paddingTop: 12,
            paddingBottom: 12,
            backgroundColor: palette.SURFACE,
            borderBottom: `1px solid ${palette.BORDER}`,
          }}
        >
          <Box className="flex items-start gap-6" style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <Box className="flex-1 min-w-0">
              <Box className="flex items-center gap-4 mb-3 min-w-0" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, minWidth: 0 }}>
                <Text size="xs" fw={800} c="primary" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {selectedArticle.source}
                </Text>
                <Box style={{ width: 3, height: 3, borderRadius: "50%", backgroundColor: palette.TEXT_MUTED }} />
                <Text size="xs" c="dimmed" className="[font-variant-numeric:tabular-nums]">
                  {formatTimeAgo(articleContent?.publishedAt || selectedArticle.publishedAt)}
                </Text>
              </Box>
              <Title
                order={4}
                data-testid="article-title"
                style={{ fontSize: "1.25rem", lineHeight: 1.2, fontWeight: 750, textWrap: "balance" }}
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
                style={{ marginTop: 2, flex: "0 0 auto" }}
              >
                <IconX size={12} />
              </ActionIcon>
            ) : null}
          </Box>
        </Box>

        {articleLoading ? (
          <Box className="flex-1 min-h-0 overflow-auto" style={{ padding: 16 }} data-testid="article-loading">
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
              <Stack className="gap-8" style={{ maxWidth: 920, padding: "24px 16px" }}>
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
                  <Box className="flex items-center flex-wrap" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", paddingTop: 4, paddingBottom: 4, paddingLeft: 4, paddingRight: 4 }}>
                    <Box className="flex items-center gap-2" style={{ color: palette.TEXT_MUTED, display: "flex", alignItems: "center", gap: 4 }}>
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
                      padding: 12,
                      borderRadius: 8,
                      borderLeft: `3px solid ${palette.PRIMARY}`,
                      backgroundColor: "#121212",
                    }}
                  >
                    <Box className="flex items-center gap-3 mb-3" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                      <IconBulb size={16} color="primary" aria-hidden="true" />
                      <SectionLabel>Summary</SectionLabel>
                    </Box>
                    <Text size="sm" style={{ lineHeight: 1.65, textWrap: "pretty" }}>
                      {articleContent.summary}
                    </Text>
                  </Box>
                ) : null}

                {articleContent?.key_points && articleContent.key_points.length > 0 ? (
                  <Box component="section">
                    <SectionLabel>Key Takeaways</SectionLabel>
                    <Stack component="ul" className="list-none" style={{ padding: 0, marginTop: 6, listStyle: "none" }}>
                      {articleContent.key_points.map((point, index) => (
                        <Box
                          component="li"
                          key={`${index}-${point.slice(0, 40)}`}
                          className="flex items-start gap-4"
                          style={{ display: "flex", alignItems: "flex-start", gap: 4 }}
                        >
                          <Box
                            component="span"
                            style={{
                              width: 20,
                              height: 20,
                              display: "grid",
                              placeItems: "center",
                              borderRadius: "50%",
                              backgroundColor: palette.PRIMARY,
                              color: palette.BG,
                              fontSize: 11,
                              fontWeight: 800,
                              flex: "0 0 auto",
                              marginTop: 1,
                            }}
                          >
                            {index + 1}
                          </Box>
                          <Text size="sm" style={{ lineHeight: 1.55, textWrap: "pretty" }}>
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
                    <Box className="flex flex-wrap gap-2 mt-2" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
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
                            {symbol.instrument_key && <IconChartLine size={12} style={{ marginLeft: 4 }} />}
                          </Badge>
                        </Tooltip>
                      ))}
                    </Box>
                  </Box>
                ) : null}

                {articleContent?.trade_ideas && articleContent.trade_ideas.length > 0 ? (
                  <Box component="section">
                    <SectionLabel>Trade Ideas</SectionLabel>
                    <Stack className="gap-2" style={{ marginTop: 12 }}>
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
                  <Box component="section" style={{ paddingTop: 4 }}>
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
                          style={{ marginTop: 4, alignSelf: "flex-start" }}
                        >
                          {showFullContent ? "Hide full article" : "View full article"}
                        </Button>
                        <Collapse in={showFullContent}>
                          <Stack className="gap-4" style={{ marginTop: 16 }}>
                            {articleContent.description.split("\n\n").map((paragraph, index) => (
                              <Text
                                key={`full-${index}-${paragraph.slice(0, 40)}`}
                                size="sm"
                                style={{ lineHeight: 1.7, marginBottom: 0, textWrap: "pretty" }}
                              >
                                {paragraph}
                              </Text>
                            ))}
                          </Stack>
                        </Collapse>
                      </>
                    ) : (
                      <Stack className="gap-4" style={{ marginTop: 16 }}>
                        {articleContent.description.split("\n\n").map((paragraph, index) => (
                          <Text
                            key={`partial-${index}-${paragraph.slice(0, 40)}`}
                            size="sm"
                            style={{ lineHeight: 1.7, marginBottom: 0, textWrap: "pretty" }}
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
            <Box className="flex items-center justify-between gap-4 bg-fin-surface" style={{ minHeight: 48, paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, backgroundColor: palette.SURFACE }}>
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
