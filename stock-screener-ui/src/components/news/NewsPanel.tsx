import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  CloseButton,
  Group,
  Indicator,
  Overlay,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  Title,
  Anchor,
  Card,
  Divider,
  Tooltip,
  Loader,
} from "@mantine/core";
import {
  IconRefresh,
  IconArrowLeft,
  IconExternalLink,
  IconNews,
  IconChartLine,
} from "@tabler/icons-react";
import type { NewsItem, NewsSource, ArticleResponse, NewsSymbol } from "./news-types";
import { fetchNews, fetchArticle, fetchNewsSources } from "../../api/news";
import { useNewsWebSocket } from "../../state/newsWebSocket";

const LS_READ_IDS = "news_read_ids";
const LS_LAST_SEEN_ID = "news_last_seen_id";
const LS_AUTO_REFRESH = "news_auto_refresh";

const AUTO_REFRESH_INTERVALS = [
  { label: "Off", value: "0" },
  { label: "1m", value: "60000" },
  { label: "5m", value: "300000" },
  { label: "10m", value: "600000" },
];

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

function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + "...";
}

function getReadIds(): Set<string> {
  try {
    const stored = localStorage.getItem(LS_READ_IDS);
    if (stored) {
      return new Set(JSON.parse(stored));
    }
  } catch {}
  return new Set();
}

function saveReadIds(ids: Set<string>): void {
  try {
    const arr = Array.from(ids).slice(-500);
    localStorage.setItem(LS_READ_IDS, JSON.stringify(arr));
  } catch {}
}

export default function NewsPanel() {
  const navigate = useNavigate();

  // Get WebSocket state from context
  const {
    connected: wsConnected,
    newsItems: wsNewsItems,
    hasNewArticles,
    clearNewArticlesFlag,
    addNewsItems,
  } = useNewsWebSocket();

  const [isOpen, setIsOpen] = useState(false);
  const [localNewsItems, setLocalNewsItems] = useState<NewsItem[]>([]);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [selectedSource, setSelectedSource] = useState("moneycontrol");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedArticle, setSelectedArticle] = useState<NewsItem | null>(null);
  const [articleContent, setArticleContent] = useState<ArticleResponse | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);

  const [readIds, setReadIds] = useState<Set<string>>(getReadIds);
  const [lastSeenId, setLastSeenId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LS_LAST_SEEN_ID);
    } catch {
      return null;
    }
  });

  const [autoRefreshMs, setAutoRefreshMs] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(LS_AUTO_REFRESH);
      return stored || "0";
    } catch {
      return "0";
    }
  });
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Merge WebSocket news items with local items, preferring WS items
  const newsItems = wsNewsItems.length > 0 ? wsNewsItems : localNewsItems;

  const unreadCount = newsItems.filter((item) => {
    if (readIds.has(item.id)) return false;
    return true;
  }).length;

  useEffect(() => {
    fetchNewsSources().then(setSources);
  }, []);

  // Clear pulse animation when panel opens
  useEffect(() => {
    if (isOpen) {
      clearNewArticlesFlag();
    }
  }, [isOpen, clearNewArticlesFlag]);

  const loadNews = useCallback(
    async (isAutoRefresh = false) => {
      if (isAutoRefresh) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const items = await fetchNews(selectedSource, 30);
        // If we have WS items, add the fetched items to the context
        if (wsNewsItems.length > 0) {
          addNewsItems(items);
        } else {
          setLocalNewsItems(items);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load news");
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [selectedSource, wsNewsItems.length, addNewsItems],
  );

  useEffect(() => {
    if (isOpen) {
      loadNews();

      if (newsItems.length > 0 && newsItems[0].id !== lastSeenId) {
        const newLastSeenId = newsItems[0].id;
        setLastSeenId(newLastSeenId);
        try {
          localStorage.setItem(LS_LAST_SEEN_ID, newLastSeenId);
        } catch {}
      }
    }
  }, [isOpen, selectedSource]);

  useEffect(() => {
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }

    const ms = parseInt(autoRefreshMs, 10);
    if (ms > 0) {
      autoRefreshRef.current = setInterval(() => {
        loadNews(true);
      }, ms);
    }

    return () => {
      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current);
      }
    };
  }, [autoRefreshMs, loadNews]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_AUTO_REFRESH, autoRefreshMs);
    } catch {}
  }, [autoRefreshMs]);

  const handleArticleClick = async (item: NewsItem) => {
    const newReadIds = new Set(readIds);
    newReadIds.add(item.id);
    setReadIds(newReadIds);
    saveReadIds(newReadIds);

    setSelectedArticle(item);
    setArticleLoading(true);
    setArticleContent(null);

    try {
      const content = await fetchArticle(item.sourceUrl);
      setArticleContent(content);
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

  const handleClose = () => {
    setIsOpen(false);
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

  const handleMarkAllRead = () => {
    const newReadIds = new Set(readIds);
    newsItems.forEach((item) => newReadIds.add(item.id));
    setReadIds(newReadIds);
    saveReadIds(newReadIds);
  };

  const sourceData =
    sources.length > 0
      ? sources.map((s) => ({ value: s.id, label: s.name }))
      : [{ value: "moneycontrol", label: "Moneycontrol" }];

  const currentRefreshLabel =
    AUTO_REFRESH_INTERVALS.find((i) => i.value === autoRefreshMs)?.label || "Off";

  return (
    <>
      <Indicator
        color={hasNewArticles ? "green" : "red"}
        size={16}
        label={unreadCount > 99 ? "99+" : unreadCount}
        disabled={unreadCount === 0 || isOpen}
        offset={4}
        className={hasNewArticles ? "news-badge-pulse" : undefined}
      >
        <Button
          variant="filled"
          color="blue"
          size="sm"
          onClick={() => setIsOpen(!isOpen)}
          data-testid="news-toggle-btn"
          title="Open news panel"
          leftSection={<IconNews size={16} />}
        >
          NEWS
        </Button>
      </Indicator>

      {isOpen && (
        <Overlay
          color="#000"
          backgroundOpacity={0.5}
          onClick={handleClose}
          zIndex={100}
          data-testid="news-overlay"
          className="news-overlay"
        />
      )}

      <Box
        pos="fixed"
        top={0}
        right={isOpen ? 0 : -400}
        w={400}
        h="100vh"
        bg="var(--mantine-color-body)"
        className={`news-panel ${isOpen ? "open" : ""}`}
        id="news-panel"
        style={{
          zIndex: 200,
          transition: "right 0.3s ease",
          borderLeft: "1px solid var(--mantine-color-default-border)",
          display: "flex",
          flexDirection: "column",
        }}
        data-testid="news-panel"
      >
        {selectedArticle ? (
          <Stack gap={0} h="100%" className="news-article-view" data-testid="news-article-view">
            <Group
              p="sm"
              justify="space-between"
              className="news-article-header"
              style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
            >
              <Button
                variant="subtle"
                size="sm"
                leftSection={<IconArrowLeft size={14} />}
                onClick={handleBack}
                data-testid="news-article-back-btn"
              >
                Back
              </Button>
              <CloseButton onClick={handleClose} />
            </Group>

            <ScrollArea flex={1} p="md" className="news-article-content">
              <Stack gap="md">
                <Title order={4} data-testid="news-article-headline">{selectedArticle.headline}</Title>

                <Text size="sm" c="dimmed" data-testid="news-article-meta">
                  {articleContent?.source || selectedArticle.source} |{" "}
                  {formatTimeAgo(articleContent?.publishedAt || selectedArticle.publishedAt)}
                </Text>

                {articleContent?.symbols && articleContent.symbols.length > 0 && (
                  <div className="news-article-symbols" data-testid="news-article-symbols">
                    <Text size="sm" c="dimmed" mb="xs">
                      Stocks mentioned:
                    </Text>
                    <Group gap="xs">
                      {articleContent.symbols.map((symbol, idx) => (
                        <Tooltip
                          key={idx}
                          label={
                            symbol.instrument_key
                              ? `View ${symbol.trading_symbol} chart`
                              : `Open ${symbol.code} on Moneycontrol`
                          }
                        >
                          <Badge
                            variant="light"
                            color={symbol.instrument_key ? "blue" : "gray"}
                            style={{ cursor: "pointer" }}
                            onClick={() => handleSymbolClick(symbol)}
                            data-testid={`news-symbol-${symbol.code}`}
                          >
                            {symbol.name || symbol.code}
                            {symbol.instrument_key && (
                              <IconChartLine size={12} style={{ marginLeft: 4 }} />
                            )}
                          </Badge>
                        </Tooltip>
                      ))}
                    </Group>
                  </div>
                )}

                <Divider />

                {articleLoading ? (
                  <Group justify="center" py="xl">
                    <Loader size="sm" />
                    <Text c="dimmed">Loading article...</Text>
                  </Group>
                ) : articleContent?.description ? (
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

                {selectedArticle.sourceUrl && (
                  <Anchor
                    href={selectedArticle.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="sm"
                  >
                    <Group gap={4}>
                      Open Original <IconExternalLink size={12} />
                    </Group>
                  </Anchor>
                )}
              </Stack>
            </ScrollArea>
          </Stack>
        ) : (
          <Stack gap={0} h="100%" className="news-list-view" data-testid="news-list-view">
            <Paper withBorder p="sm" mb="xs" id="news-panel-header" data-testid="news-panel-header">
              <Group justify="space-between">
                <Group gap="xs">
                  <Text fw={600}>NEWS</Text>
                  {wsConnected && (
                    <Tooltip label="Live updates connected">
                      <Box w={6} h={6} bg="green" style={{ borderRadius: "50%" }} data-testid="news-ws-indicator" />
                    </Tooltip>
                  )}
                  {isRefreshing && <Loader size="sm" />}
                </Group>
                <CloseButton
                  onClick={handleClose}
                  className="news-close-btn"
                  data-testid="news-close-btn"
                />
              </Group>
            </Paper>

            <Paper withBorder p="sm" id="news-panel-controls" data-testid="news-panel-controls">
              <Group gap="xs">
                <Select
                  size="sm"
                  value={selectedSource}
                  onChange={(v) => v && setSelectedSource(v)}
                  data={sourceData}
                  style={{ flex: 1 }}
                  className="news-source-select"
                  data-testid="news-source-select"
                />

                <Tooltip label="Refresh">
                  <ActionIcon
                    variant="light"
                    size="sm"
                    onClick={() => loadNews()}
                    loading={loading}
                    className="news-refresh-btn"
                    data-testid="news-refresh-btn"
                  >
                    <IconRefresh size={14} />
                  </ActionIcon>
                </Tooltip>

                <Select
                  size="sm"
                  value={autoRefreshMs}
                  onChange={(v) => v && setAutoRefreshMs(v)}
                  data={AUTO_REFRESH_INTERVALS}
                  w={60}
                  data-testid="news-auto-refresh-select"
                />

                {unreadCount > 0 && (
                  <Badge
                    variant="light"
                    color="blue"
                    style={{ cursor: "pointer" }}
                    onClick={handleMarkAllRead}
                    data-testid="news-unread-badge"
                  >
                    {unreadCount} unread
                  </Badge>
                )}
              </Group>

              <ScrollArea flex={1} className="news-items-container">
                {loading && newsItems.length === 0 ? (
                  <Group justify="center" py="xl" data-testid="news-loading">
                    <Loader size="sm" />
                    <Text c="dimmed">Loading news...</Text>
                  </Group>
                ) : error ? (
                  <Text c="red" ta="center" py="xl" data-testid="news-error">
                    {error}
                  </Text>
                ) : newsItems.length === 0 ? (
                  <Text c="dimmed" ta="center" py="xl" data-testid="news-empty">
                    No news available
                  </Text>
                ) : (
                  <Stack gap={0} className="news-items-list">
                    {newsItems.map((item) => {
                      const isUnread = !readIds.has(item.id);
                      return (
                        <Card
                          key={item.id}
                          padding="sm"
                          className={`news-item-card ${isUnread ? "unread" : ""}`}
                          style={{
                            cursor: "pointer",
                            borderLeft: isUnread
                              ? "3px solid var(--mantine-color-blue-6)"
                              : undefined,
                          }}
                          onClick={() => handleArticleClick(item)}
                          data-testid="news-item"
                        >
                          <Group gap="xs" wrap="nowrap">
                            {isUnread && (
                              <Box
                                w={6}
                                h={6}
                                bg="blue"
                                style={{ borderRadius: "50%", flexShrink: 0 }}
                              />
                            )}
                            <Stack gap={4} flex={1}>
                              <Text
                                size="sm"
                                fw={isUnread ? 600 : 400}
                                lineClamp={2}
                                className="news-item-headline"
                              >
                                {item.headline}
                              </Text>
                              {item.description && (
                                <Text size="sm" c="dimmed" lineClamp={2} className="news-item-desc">
                                  {truncateText(item.description, 120)}
                                </Text>
                              )}
                              <Text size="sm" c="dimmed" className="news-item-meta">
                                {item.source}
                              </Text>
                            </Stack>
                          </Group>
                        </Card>
                      );
                    })}
                  </Stack>
                )}
              </ScrollArea>
            </Paper>
          </Stack>
        )}
      </Box>
    </>
  );
}
