import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Card,
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
  Container,
  Paper,
  Progress,
  RingProgress,
  Alert,
  ThemeIcon,
} from "@mantine/core";
import {
  IconRefresh,
  IconExternalLink,
  IconArrowLeft,
  IconChartLine,
  IconTrendingUp,
  IconTrendingDown,
  IconMinus,
  IconPoint,
  IconInfoCircle,
  IconTarget,
} from "@tabler/icons-react";
import type { NewsItem, NewsSource, NewsSymbol, TradeIdea } from "../components/news/news-types";
import { fetchNews, fetchArticle, fetchNewsSources } from "../api/news";

const SOURCE_COLORS: Record<string, string> = {
  moneycontrol: "blue",
  economictimes: "orange",
  livemint: "teal",
  financialexpress: "grape",
  business_standard: "cyan",
  cnbctv18: "red",
};

const SENTIMENT_CONFIG: Record<string, { color: string; icon: typeof IconTrendingUp }> = {
  BULLISH: { color: "green", icon: IconTrendingUp },
  BEARISH: { color: "red", icon: IconTrendingDown },
  NEUTRAL: { color: "gray", icon: IconMinus },
};

function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return "";
  }
}

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
  
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>("moneycontrol");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [selectedArticle, setSelectedArticle] = useState<NewsItem | null>(null);
  const [articleContent, setArticleContent] = useState<ArticleContent | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);

  const sourceData = sources.length > 0
    ? sources.map((s) => ({ value: s.id, label: s.name }))
    : [{ value: "moneycontrol", label: "Moneycontrol" }];

  useEffect(() => {
    fetchNewsSources().then(setSources);
  }, []);

  const loadNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchNews(selectedSource, 50);
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

  const handleArticleClick = async (item: NewsItem) => {
    setSelectedArticle(item);
    setArticleLoading(true);
    setArticleContent(null);

    try {
      const content = await fetchArticle(item.sourceUrl);
      setArticleContent(content as ArticleContent);
    } catch (err) {
      console.error("Failed to fetch article:", err);
    } finally {
      setArticleLoading(false);
    }
  };

  const handleBack = () => {
    setSelectedArticle(null);
    setArticleContent(null);
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
    return (
      <Tooltip label={`Impact Score: ${score}/10`}>
        <RingProgress
          size={48}
          thickness={5}
          roundCaps
          sections={[{ value: score * 10, color }]}
          label={<Text size="sm" fw={700}>{score}</Text>}
          data-testid="impact-score"
        />
      </Tooltip>
    );
  };

  const renderTradeIdea = (idea: TradeIdea, idx: number) => {
    const isLong = idea.direction === "LONG";
    return (
      <Card key={idx} padding="md" withBorder data-testid="trade-idea">
        <Group justify="space-between" mb="sm">
          <Badge 
            color={isLong ? "green" : "red"} 
            variant="filled"
            size="sm"
          >
            {idea.direction}
          </Badge>
          <Text size="sm" fw={600}>{idea.symbol}</Text>
        </Group>
        <Text size="sm" c="dimmed">{idea.reasoning}</Text>
      </Card>
    );
  };

  return (
    <Container size="lg" py="md" data-testid="news-page">
      {selectedArticle ? (
        <Stack gap="md" data-testid="article-detail">
          <Group>
            <ActionIcon variant="subtle" onClick={handleBack} data-testid="back-button">
              <IconArrowLeft size={20} />
            </ActionIcon>
            <Title order={4}>Article Analysis</Title>
          </Group>

          <Paper p="md" withBorder>
            <Stack gap="md">
              <Title order={4}>{selectedArticle.headline}</Title>

              <Group gap="md">
                <Badge color={SOURCE_COLORS[selectedArticle.source] || "gray"} variant="light">
                  {selectedArticle.source}
                </Badge>
                <Text size="xs" c="dimmed">
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
                    <Group gap="md">
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
                         <Text size="sm" fw={600}>Key Takeaways</Text>
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
                       <Text size="sm" fw={500}>Stocks mentioned:</Text>
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
                         <Text size="sm" fw={600}>Trade Ideas</Text>
                       </Group>
                       <Stack gap="xs">
                         {articleContent.trade_ideas.map((idea, idx) => renderTradeIdea(idea, idx))}
                       </Stack>
                     </Stack>
                   )}

                  <Divider />

                  {articleContent?.description ? (
                    <Stack gap="sm">
                      {articleContent.description.split("\n\n").map((para, idx) => (
                        <Text key={idx} size="sm">
                          {para}
                        </Text>
                      ))}
                    </Stack>
                  ) : (
                    <Text c="dimmed" ta="center" py="xl">
                      Unable to load article content.
                    </Text>
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
            </Stack>
          </Paper>
        </Stack>
      ) : (
        <Stack gap="md">
          <Group justify="space-between">
            <Title order={2}>News Feed</Title>
            <ActionIcon variant="light" onClick={loadNews} loading={loading}>
              <IconRefresh size={18} />
            </ActionIcon>
          </Group>

          <Group gap="md">
            <Select
              value={selectedSource}
              onChange={(v) => v && setSelectedSource(v)}
              data={sourceData}
              w={200}
              placeholder="Select source"
              data-testid="source-selector"
            />
          </Group>

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
            <Stack gap="sm">
              {newsItems.map((item) => (
                <Card
                  key={item.id}
                  padding="md"
                  withBorder
                  style={{ cursor: "pointer" }}
                  onClick={() => handleArticleClick(item)}
                  data-testid="news-list-item"
                >
                  <Stack gap="xs">
                    <Group justify="space-between" wrap="nowrap">
                      <Text size="sm" fw={500} lineClamp={2} style={{ flex: 1 }}>
                        {item.headline}
                      </Text>
                      <Badge
                        color={SOURCE_COLORS[item.source] || "gray"}
                        variant="light"
                        size="sm"
                      >
                        {item.source}
                      </Badge>
                    </Group>
                    
                    {item.description && (
                      <Text size="xs" c="dimmed" lineClamp={2}>
                        {item.description}
                      </Text>
                    )}
                    
                    <Text size="xs" c="dimmed">
                      {formatTimeAgo(item.publishedAt)}
                    </Text>
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </Stack>
      )}
    </Container>
  );
}
