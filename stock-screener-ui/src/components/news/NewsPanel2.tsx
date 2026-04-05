import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Indicator,
  Overlay,
  Paper,
  ScrollArea,
  Stack,
} from "@mantine/core";
import { IconNews } from "@tabler/icons-react";
import type { NewsItem, NewsSource, ArticleResponse, NewsSymbol } from "./news-types";
import { fetchNews, fetchArticle, fetchNewsSources } from "../../api/news";
import { useNewsWebSocket } from "../../state/newsWebSocket";
import { useNewsSourceGroups, getSourceOptions } from "./useNewsSourceGroups";
import {
  getReadIds,
  saveReadIds,
  getStoredLastSeenId,
  saveLastSeenId,
  getStoredAutoRefresh,
  saveAutoRefresh,
} from "./NewsLocalStorage";
import {
  ArticleView,
  NewsFilterControls,
  NewsListContent,
  NewsListHeader,
} from "./NewsHelpers";

function useLocalNews(wsNewsItems: NewsItem[], addNewsItems: (items: NewsItem[]) => void, selectedSource: string, isOpen: boolean) {
  const [localNewsItems, setLocalNewsItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const newsItems = wsNewsItems.length > 0 ? wsNewsItems : localNewsItems;

  const loadNews = useCallback(async (isAutoRefresh = false) => {
    if (isAutoRefresh) setLoading(true);
    else setLoading(true);
    setError(null);
    try {
      const sourceParam = selectedSource === "all" ? undefined : selectedSource;
      const items = await fetchNews(sourceParam, 50);
      if (wsNewsItems.length > 0) addNewsItems(items);
      else setLocalNewsItems(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load news");
    } finally {
      setLoading(false);
    }
  }, [selectedSource, wsNewsItems.length, addNewsItems]);

  useEffect(() => {
    if (isOpen) loadNews();
  }, [isOpen, selectedSource, loadNews]);

  return { newsItems, loading, error, loadNews };
}

function useArticleReader(readIds: Set<string>) {
  const [selectedArticle, setSelectedArticle] = useState<NewsItem | null>(null);
  const [articleContent, setArticleContent] = useState<ArticleResponse | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [articleError, setArticleError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  const handleArticleClick = useCallback(async (item: NewsItem) => {
    const fetchId = ++fetchIdRef.current;
    const newReadIds = new Set(readIds);
    newReadIds.add(item.id);
    setSelectedArticle(item);
    setArticleLoading(true);
    setArticleContent(null);
    setArticleError(null);
    try {
      const content = await fetchArticle(item.sourceUrl);
      if (fetchId === fetchIdRef.current) setArticleContent(content);
    } catch (err) {
      if (fetchId === fetchIdRef.current) {
        setArticleError(err instanceof Error ? err.message : "Failed to load article");
      }
    } finally {
      if (fetchId === fetchIdRef.current) setArticleLoading(false);
    }
  }, [readIds]);

  const handleBack = useCallback(() => {
    setSelectedArticle(null);
    setArticleContent(null);
    setArticleError(null);
  }, []);

  return { selectedArticle, articleContent, articleLoading, articleError, handleArticleClick, handleBack };
}

function useAutoRefresh(loadNews: (isAutoRefresh: boolean) => void, autoRefreshMs: string) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
    const ms = parseInt(autoRefreshMs, 10);
    if (ms > 0) {
      autoRefreshRef.current = setInterval(() => {
        setIsRefreshing(true);
        loadNews(true).finally(() => setIsRefreshing(false));
      }, ms);
    }
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [autoRefreshMs, loadNews]);

  useEffect(() => {
    saveAutoRefresh(autoRefreshMs);
  }, [autoRefreshMs]);

  return isRefreshing;
}

export default function NewsPanel2() {
  const navigate = useNavigate();
  const {
    connected: wsConnected,
    newsItems: wsNewsItems,
    hasNewArticles,
    clearNewArticlesFlag,
    addNewsItems,
  } = useNewsWebSocket();

  const [isOpen, setIsOpen] = useState(false);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [selectedSource, setSelectedSource] = useState("all");

  const [readIds, setReadIds] = useState<Set<string>>(getReadIds);
  const [lastSeenId, setLastSeenId] = useState<string | null>(getStoredLastSeenId);
  const [autoRefreshMs, setAutoRefreshMs] = useState<string>(getStoredAutoRefresh);

  const { newsItems, loading, error, loadNews } = useLocalNews(wsNewsItems, addNewsItems, selectedSource, isOpen);
  const { selectedArticle, articleContent, articleLoading, articleError, handleArticleClick, handleBack } = useArticleReader(readIds);
  const isRefreshing = useAutoRefresh(loadNews, autoRefreshMs);

  const { groupedNewsItems, sourceNames, expandedSources, toggleSourceExpanded } =
    useNewsSourceGroups({ newsItems, autoExpandCount: 2 });

  const unreadCount = newsItems.filter((item) => !readIds.has(item.id)).length;

  useEffect(() => {
    fetchNewsSources().then(setSources).catch((err) => {
      console.error("Failed to load news sources:", err);
    });
  }, []);

  useEffect(() => {
    if (isOpen) clearNewArticlesFlag();
  }, [isOpen, clearNewArticlesFlag]);

  useEffect(() => {
    if (isOpen && newsItems.length > 0 && newsItems[0].id !== lastSeenId) {
      const newId = newsItems[0].id;
      setLastSeenId(newId);
      saveLastSeenId(newId);
    }
  }, [isOpen, newsItems, lastSeenId]);

  const handleClose = () => {
    setIsOpen(false);
    handleBack();
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

  const sourceData = getSourceOptions(sources);

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
          color="dark"
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
          <ArticleView
            article={selectedArticle}
            content={articleContent}
            loading={articleLoading}
            error={articleError}
            onBack={handleBack}
            onClose={handleClose}
            onSymbolClick={handleSymbolClick}
          />
        ) : (
          <Stack gap={0} h="100%" className="news-list-view" data-testid="news-list-view">
            <NewsListHeader
              wsConnected={wsConnected}
              isRefreshing={isRefreshing}
              onClose={handleClose}
            />

            <Paper withBorder p="sm" id="news-panel-controls" data-testid="news-panel-controls">
              <NewsFilterControls
                sourceData={sourceData}
                selectedSource={selectedSource}
                autoRefreshMs={autoRefreshMs}
                loading={loading}
                isRefreshing={isRefreshing}
                unreadCount={unreadCount}
                onSourceChange={setSelectedSource}
                onRefresh={() => loadNews()}
                onAutoRefreshChange={setAutoRefreshMs}
                onMarkAllRead={handleMarkAllRead}
              />

              <ScrollArea flex={1} className="news-items-container">
                <NewsListContent
                  loading={loading}
                  error={error}
                  newsItems={newsItems}
                  selectedSource={selectedSource}
                  sourceNames={sourceNames}
                  groupedNewsItems={groupedNewsItems}
                  expandedSources={expandedSources}
                  readIds={readIds}
                  onToggleSource={toggleSourceExpanded}
                  onArticleClick={handleArticleClick}
                />
              </ScrollArea>
            </Paper>
          </Stack>
        )}
      </Box>
    </>
  );
}
