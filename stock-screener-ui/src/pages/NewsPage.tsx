import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useMediaQuery } from "@mantine/hooks";
import {
  Badge,
  Card,
  Collapse,
  Group,
  List,
  Select,
  Stack,
  Text,
  Title,
  Tooltip,
  Loader,
  Anchor,
  Divider,
  ActionIcon,
  Paper,
  Progress,
  Alert,
  ThemeIcon,
  Box,
  ScrollArea,
  Modal,
  CloseButton,
} from "@mantine/core";
import {
  IconRefresh,
  IconExternalLink,
  IconChartLine,
  IconTrendingUp,
  IconTrendingDown,
  IconMinus,
  IconInfoCircle,
  IconTarget,
  IconChevronDown,
  IconChevronRight,
  IconNews,
} from "@tabler/icons-react";
import type { NewsItem, NewsSource, NewsSymbol, TradeIdea } from "../components/news/news-types";
import { fetchNews, fetchArticle, fetchNewsSources } from "../api/news";
import { useNewsSourceGroups, getSourceOptions } from "../components/news/useNewsSourceGroups";

const SOURCE_COLORS: Record<string, string> = {
  moneycontrol: "blue",
  economictimes: "orange",
  livemint: "teal",
  financialexpress: "grape",
  business_standard: "cyan",
  cnbctv18: "red",
};

import { formatTimeAgo } from "../utils/ui-helpers";

const SENTIMENT_CONFIG: Record<string, { color: string; icon: typeof IconTrendingUp }> = {
  BULLISH: { color: "green", icon: IconTrendingUp },
  BEARISH: { color: "red", icon: IconTrendingDown },
  NEUTRAL: { color: "gray", icon: IconMinus },
};

interface ArticleContent {
  headline?: string;
  description?: string;
  source?: string;
  publishedAt?: string;
  sourceUrl?: string;
  symbols?: NewsSymbol[];
  sentiment?: "BULLISH" | "BEARISH" | "NEUTRAL";
  impact_score?: number;
  summary?: string;
  key_points?: string[];
  key_entities?: string[];
  trade_ideas?: TradeIdea[];
}

export default function NewsPage() {
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 768px)");

  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedArticle, setSelectedArticle] = useState<NewsItem | null>(null);
  const [articleContent, setArticleContent] = useState<ArticleContent | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [_articleError, setArticleError] = useState<string | null>(null);
  const [showFullContent, setShowFullContent] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const articleFetchId = useRef(0);

  const sourceData = getSourceOptions(sources);

  useEffect(() => {
    fetchNewsSources()
      .then(setSources)
      .catch((err) => {
        console.error("Failed to fetch news sources:", err);
      });
  }, []);

  const loadNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sourceParam = selectedSource === "all" ? undefined : selectedSource;
      const items = await fetchNews(sourceParam, 50);
      setNewsItems(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load news");
    } finally {
      setLoading(false);
    }
  }, [selectedSource]);

  useEffect(() => {
    loadNews();
  }, [selectedSource]);

  const { groupedNewsItems, sourceNames, expandedSources, toggleSourceExpanded } =
    useNewsSourceGroups({
      newsItems,
      autoExpandCount: 999,
    });

  const handleArticleClick = async (item: NewsItem) => {
    const fetchId = ++articleFetchId.current;
    setSelectedArticle(item);
    setArticleLoading(true);
    setArticleContent(null);
    setArticleError(null);
    setShowFullContent(false);
    if (isMobile) {
      setModalOpen(true);
    }

    try {
      const content = await fetchArticle(item.sourceUrl);
      if (fetchId === articleFetchId.current) {
        setArticleContent(content as ArticleContent);
      }
    } catch (err) {
      if (fetchId === articleFetchId.current) {
        setArticleError(err instanceof Error ? err.message : "Failed to load article");
      }
    } finally {
      if (fetchId === articleFetchId.current) {
        setArticleLoading(false);
      }
    }
  };

  const handleCloseArticle = () => {
    setSelectedArticle(null);
    setArticleContent(null);
    setArticleError(null);
    setModalOpen(false);
  };

  const handleSymbolClick = (symbol: NewsSymbol) => {
    if (symbol.instrument_key && symbol.trading_symbol) {
      navigate(`/chart/${symbol.trading_symbol}`);
    } else if (symbol.url) {
      window.open(symbol.url, "_blank", "noopener,noreferrer");
    }
  };

  const renderSentimentBadge = (sentiment?: string) => {
    if (!sentiment) return null;
    const config = SENTIMENT_CONFIG[sentiment] || SENTIMENT_CONFIG.NEUTRAL;
    const Icon = config.icon;
    return (
      <Badge
        color={config.color}
        variant="light"
        leftSection={<Icon size={12} />}
        data-testid="sentiment-badge"
        size="lg"
      >
        {sentiment}
      </Badge>
    );
  };

  const renderImpactScore = (score?: number) => {
    if (score === undefined || score === null) return null;
    const color = score >= 7 ? "red" : score >= 4 ? "orange" : "gray";
    const label = score >= 7 ? "High impact" : score >= 4 ? "Moderate impact" : "Low impact";

    return (
      <Tooltip label={`Impact Score: ${score}/10`}>
        <Paper withBorder p="xs" radius="md" maw={220} miw={180} data-testid="impact-score">
          <Stack gap={6}>
            <Group justify="space-between" gap="xs" wrap="nowrap">
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                Impact
              </Text>
              <Badge size="sm" color={color} variant="light">
                {score}/10
              </Badge>
            </Group>
            <Progress value={score * 10} color={color} radius="xl" size="lg" />
            <Text size="xs" c={color} fw={600}>
              {label}
            </Text>
          </Stack>
        </Paper>
      </Tooltip>
    );
  };

  const renderTradeIdea = (idea: TradeIdea, idx: number) => {
    const isLong = idea.direction === "LONG";
    return (
      <Card key={idx} padding="md" withBorder data-testid="trade-idea">
        <Group justify="space-between" mb="sm">
          <Badge color={isLong ? "green" : "red"} variant="filled" size="sm">
            {idea.direction}
          </Badge>
          <Text size="sm" fw={600}>
            {idea.symbol}
          </Text>
        </Group>
        <Text size="sm" c="dimmed">
          {idea.reasoning}
        </Text>
      </Card>
    );
  };

  const renderArticleDetail = () => {
    const hasLlmSummary = !!(
      articleContent?.summary ||
      (articleContent?.key_points && articleContent.key_points.length > 0)
    );
    return (
      <Stack gap="sm" data-testid="article-detail" className="article-detail">
        {selectedArticle ? (
          <>
            <Group justify="space-between">
              <Title order={4} data-testid="article-title" lineClamp={2}>
                {selectedArticle.headline}
              </Title>
              {isMobile && (
                <CloseButton onClick={handleCloseArticle} data-testid="close-article-btn" />
              )}
            </Group>

            <Group gap="sm">
              <Badge color={SOURCE_COLORS[selectedArticle.source] || "gray"} variant="light">
                {selectedArticle.source}
              </Badge>
              <Text size="sm" c="dimmed">
                {formatTimeAgo(articleContent?.publishedAt || selectedArticle.publishedAt)}
              </Text>
            </Group>

            {articleLoading ? (
              <Group justify="center" py="xl">
                <Loader size="sm" />
                <Text c="dimmed">Analyzing article...</Text>
              </Group>
            ) : (
              <>
                {articleContent?.sentiment && (
                  <Group gap="sm">
                    {renderSentimentBadge(articleContent.sentiment)}
                    {renderImpactScore(articleContent.impact_score)}
                  </Group>
                )}

                {articleContent?.summary && (
                  <Alert
                    icon={<IconInfoCircle size={16} />}
                    title="Summary"
                    color="blue"
                    variant="light"
                  >
                    <Text size="sm">{articleContent.summary}</Text>
                  </Alert>
                )}

                {articleContent?.key_points && articleContent.key_points.length > 0 && (
                  <Stack gap="sm">
                    <Group gap="xs">
                      <ThemeIcon size="sm" variant="light" color="green">
                        <IconTarget size={14} />
                      </ThemeIcon>
                      <Text size="sm" fw={600}>
                        Key Takeaways
                      </Text>
                    </Group>
                    <List size="sm" withPadding ml="md">
                      {articleContent.key_points.map((point, idx) => (
                        <List.Item key={idx}>
                          <Text size="sm">{point}</Text>
                        </List.Item>
                      ))}
                    </List>
                  </Stack>
                )}

                {articleContent?.symbols && articleContent.symbols.length > 0 && (
                  <Stack gap="xs">
                    <Text size="sm" fw={500}>
                      Stocks mentioned:
                    </Text>
                    <Group gap="xs" wrap="wrap">
                      {articleContent.symbols.map((symbol, idx) => (
                        <Tooltip
                          key={idx}
                          label={
                            symbol.instrument_key
                              ? `View ${symbol.trading_symbol} chart`
                              : `View details`
                          }
                          position="top"
                        >
                          <Badge
                            variant="light"
                            color={symbol.instrument_key ? "blue" : "gray"}
                            size="sm"
                            radius="sm"
                            style={{ cursor: "pointer" }}
                            onClick={() => handleSymbolClick(symbol)}
                            rightSection={
                              symbol.instrument_key ? (
                                <IconChartLine size={12} style={{ marginLeft: 4 }} />
                              ) : undefined
                            }
                            data-testid="symbol-badge"
                          >
                            {symbol.name || symbol.code}
                          </Badge>
                        </Tooltip>
                      ))}
                    </Group>
                  </Stack>
                )}

                {articleContent?.trade_ideas && articleContent.trade_ideas.length > 0 && (
                  <Stack gap="sm">
                    <Group gap="xs">
                      <ThemeIcon size="sm" variant="light" color="orange">
                        <IconTrendingUp size={14} />
                      </ThemeIcon>
                      <Text size="sm" fw={600}>
                        Trade Ideas
                      </Text>
                    </Group>
                    <Stack gap="xs">
                      {articleContent.trade_ideas.map((idea, idx) => renderTradeIdea(idea, idx))}
                    </Stack>
                  </Stack>
                )}

                {articleContent?.description && (
                  <>
                    <Divider />
                    {hasLlmSummary ? (
                      <Stack gap="xs">
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          onClick={() => setShowFullContent((v) => !v)}
                          style={{ alignSelf: "flex-start" }}
                        >
                          {showFullContent ? (
                            <IconChevronDown size={16} />
                          ) : (
                            <IconChevronRight size={16} />
                          )}
                        </ActionIcon>
                        <Text
                          size="xs"
                          c="dimmed"
                          style={{ cursor: "pointer", marginTop: -28, marginLeft: 28 }}
                          onClick={() => setShowFullContent((v) => !v)}
                        >
                          {showFullContent ? "Hide full article" : "View full article"}
                        </Text>
                        <Collapse in={showFullContent}>
                          <Stack gap="sm" mt="xs">
                            {articleContent.description.split("\n\n").map((para, idx) => (
                              <Text key={idx} size="sm">
                                {para}
                              </Text>
                            ))}
                          </Stack>
                        </Collapse>
                      </Stack>
                    ) : (
                      <Stack gap="sm">
                        {articleContent.description.split("\n\n").map((para, idx) => (
                          <Text key={idx} size="sm">
                            {para}
                          </Text>
                        ))}
                      </Stack>
                    )}
                  </>
                )}
              </>
            )}

            {selectedArticle.sourceUrl && (
              <Anchor
                href={selectedArticle.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                size="sm"
              >
                <Group gap={4}>
                  Open Original <IconExternalLink size={14} />
                </Group>
              </Anchor>
            )}
          </>
        ) : (
          <Stack align="center" justify="center" h="100%" py="xl">
            <IconNews size={48} stroke={1} color="var(--mantine-color-dimmed)" />
            <Text c="dimmed" ta="center">
              Select an article from the list to view details
            </Text>
          </Stack>
        )}
      </Stack>
    );
  };

  const renderNewsList = () => (
    <Stack gap="sm" id="news-feed" data-testid="news-feed">
      <Group justify="space-between" className="news-feed-header">
        <Title order={3}>News Feed</Title>
        <ActionIcon
          variant="light"
          onClick={loadNews}
          loading={loading}
          data-testid="news-feed-refresh-btn"
        >
          <IconRefresh size={18} />
        </ActionIcon>
      </Group>

      <Select
        value={selectedSource}
        onChange={(v) => v && setSelectedSource(v)}
        data={sourceData}
        placeholder="Select source"
        data-testid="source-selector"
      />

      {loading && newsItems.length === 0 ? (
        <Group justify="center" py="xl" data-testid="news-loader">
          <Loader size="sm" />
          <Text c="dimmed">Loading news...</Text>
        </Group>
      ) : error ? (
        <Text c="red" ta="center" py="xl">
          {error}
        </Text>
      ) : newsItems.length === 0 ? (
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
                    cursor: "pointer",
                    borderRadius: "var(--mantine-radius-sm)",
                    backgroundColor: "var(--mantine-color-default-hover)",
                  }}
                  onClick={() => toggleSourceExpanded(source)}
                  data-testid={`news-source-group-${source}`}
                >
                  {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                  <Text size="sm" fw={600} style={{ textTransform: "uppercase" }}>
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
                          cursor: "pointer",
                          backgroundColor:
                            selectedArticle?.id === item.id
                              ? "var(--mantine-color-blue-light)"
                              : undefined,
                        }}
                        onClick={() => handleArticleClick(item)}
                        data-testid="news-list-item"
                      >
                        <Stack gap="xs" mb="xs">
                          {(item.sentiment || item.impact_score !== undefined) && (
                            <Group gap="xs" wrap="nowrap">
                              {item.sentiment && renderSentimentBadge(item.sentiment)}
                              {item.impact_score !== undefined &&
                                renderImpactScore(item.impact_score)}
                            </Group>
                          )}
                        </Stack>
                        <Group justify="space-between" wrap="nowrap" gap="xs">
                          <Text
                            size="xs"
                            fw={selectedArticle?.id === item.id ? 600 : 500}
                            lineClamp={2}
                            style={{ flex: 1 }}
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

  if (isMobile) {
    return (
      <Box p="sm" data-testid="news-page" className="news-page">
        <ScrollArea.Autosize mah="calc(100vh - 100px)" offsetScrollbars>
          {renderNewsList()}
        </ScrollArea.Autosize>

        <Modal
          opened={modalOpen}
          onClose={handleCloseArticle}
          title="Article Analysis"
          size="lg"
          scrollAreaComponent={ScrollArea.Autosize}
          data-testid="article-modal"
        >
          {renderArticleDetail()}
        </Modal>
      </Box>
    );
  }

  return (
    <Box
      data-testid="news-page"
      className="news-page"
      style={{
        display: "flex",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Box
        style={{
          width: "35%",
          minWidth: 300,
          borderRight: "1px solid var(--mantine-color-default-border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <ScrollArea h="100%" offsetScrollbars p="sm">
          {renderNewsList()}
        </ScrollArea>
      </Box>

      <Box
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <ScrollArea h="100%" offsetScrollbars p="sm">
          {renderArticleDetail()}
        </ScrollArea>
      </Box>
    </Box>
  );
}
