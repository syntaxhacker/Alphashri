import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Indicator, Overlay, Paper, ScrollArea, Stack } from "@/ui";
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
import { ArticleView, NewsFilterControls, NewsListContent, NewsListHeader } from "./NewsHelpers";

// =============================================================================
// Custom Hooks
// =============================================================================

function useLocalNews(
  wsNewsItems: NewsItem[],
  addNewsItems: (items: NewsItem[]) => void,
  selectedSource: string,
  isOpen: boolean,
) {
  const [localNewsItems, setLocalNewsItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const newsItems = wsNewsItems.length > 0 ? wsNewsItems : localNewsItems;

  const loadNews = useCallback(
    async (isAutoRefresh = false) => {
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
    },
    [selectedSource, wsNewsItems.length, addNewsItems],
  );

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

  const handleArticleClick = useCallback(
    async (item: NewsItem) => {
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
    },
    [readIds],
  );

  const handleBack = useCallback(() => {
    setSelectedArticle(null);
    setArticleContent(null);
    setArticleError(null);
  }, []);

  return {
    selectedArticle,
    articleContent,
    articleLoading,
    articleError,
    handleArticleClick,
    handleBack,
  };
}

function useAutoRefresh(
  loadNews: (isAutoRefresh: boolean) => Promise<void>,
  autoRefreshMs: string,
) {
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

// -----------------------------------------------------------------------------
// NewsPanel2-specific custom hooks (extracted from oversized component)
// -----------------------------------------------------------------------------

function useNewsSources() {
  const [sources, setSources] = useState<NewsSource[]>([]);

  useEffect(() => {
    fetchNewsSources()
      .then(setSources)
      .catch((err) => {
        console.error("Failed to load news sources:", err);
      });
  }, []);

  const sourceData = getSourceOptions(sources);
  return { sources, sourceData };
}

function useReadManagement(newsItems: NewsItem[]) {
  const [readIds, setReadIds] = useState<Set<string>>(getReadIds);
  const unreadCount = newsItems.filter((item) => !readIds.has(item.id)).length;

  const handleMarkAllRead = useCallback(() => {
    const newReadIds = new Set(readIds);
    newsItems.forEach((item) => newReadIds.add(item.id));
    setReadIds(newReadIds);
    saveReadIds(newReadIds);
  }, [newsItems, readIds]);

  return { readIds, setReadIds, unreadCount, handleMarkAllRead };
}

function useNewsTracking(isOpen: boolean, newsItems: NewsItem[]) {
  const [lastSeenId, setLastSeenId] = useState<string | null>(getStoredLastSeenId);

  useEffect(() => {
    if (isOpen && newsItems.length > 0 && newsItems[0].id !== lastSeenId) {
      const newId = newsItems[0].id;
      setLastSeenId(newId);
      saveLastSeenId(newId);
    }
  }, [isOpen, newsItems, lastSeenId]);

  return lastSeenId;
}

// -----------------------------------------------------------------------------
// Sub-components (extracted from NewsPanel2 JSX)
// -----------------------------------------------------------------------------

function NewsPanelToggle({
  hasNewArticles,
  unreadCount,
  isOpen,
  onToggle,
}: {
  hasNewArticles: boolean;
  unreadCount: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <Indicator
      color={hasNewArticles ? "success" : "error"}
      size={16}
      label={unreadCount > 99 ? "99+" : unreadCount}
      disabled={unreadCount === 0 || isOpen}
      offset={4}
      className={hasNewArticles ? "news-badge-pulse" : undefined}
    >
      <Button
        variant="filled"
        color="primary"
        size="sm"
        onClick={onToggle}
        data-testid="news-toggle-btn"
        title="Open news panel"
        leftSection={<IconNews size={16} />}
      >
        NEWS
      </Button>
    </Indicator>
  );
}

function NewsPanelOverlay({ onClose }: { onClose: () => void }) {
  return (
    <Overlay
      color="secondary"
      backgroundOpacity={0.5}
      onClick={onClose}
      zIndex={100}
      data-testid="news-overlay"
      className="news-overlay"
    />
  );
}

function NewsPanelBody({
  selectedArticle,
  articleContent,
  articleLoading,
  articleError,
  handleBack,
  handleClose,
  handleSymbolClick,
  wsConnected,
  isRefreshing,
  sourceData,
  selectedSource,
  setSelectedSource,
  autoRefreshMs,
  loading,
  error,
  unreadCount,
  loadNews,
  setAutoRefreshMs,
  handleMarkAllRead,
  newsItems,
  sourceNames,
  groupedNewsItems,
  expandedSources,
  readIds,
  toggleSourceExpanded,
  handleArticleClick,
}: {
  selectedArticle: NewsItem | null;
  articleContent: ArticleResponse | null;
  articleLoading: boolean;
  articleError: string | null;
  handleBack: () => void;
  handleClose: () => void;
  handleSymbolClick: (symbol: NewsSymbol) => void;
  wsConnected: boolean;
  isRefreshing: boolean;
  sourceData: { value: string; label: string }[];
  selectedSource: string;
  setSelectedSource: (source: string) => void;
  autoRefreshMs: string;
  loading: boolean;
  error: string | null;
  unreadCount: number;
  loadNews: () => Promise<void>;
  setAutoRefreshMs: (ms: string) => void;
  handleMarkAllRead: () => void;
  newsItems: NewsItem[];
  sourceNames: string[];
  groupedNewsItems: Record<string, NewsItem[]>;
  expandedSources: Set<string>;
  readIds: Set<string>;
  toggleSourceExpanded: (source: string) => void;
  handleArticleClick: (item: NewsItem) => void;
}) {
  return selectedArticle ? (
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
      <NewsListHeader wsConnected={wsConnected} isRefreshing={isRefreshing} onClose={handleClose} />

      <Paper p="sm" id="news-panel-controls" data-testid="news-panel-controls">
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
  );
}

function NewsPanelContainer({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) {
  return (
    <Box
      pos="fixed"
      top={0}
      right={isOpen ? 0 : -400}
      w={400}
      h="100vh"
      sx={{ bgcolor: "background.paper", borderLeft: 1, borderColor: "divider" }}
      className={`news-panel ${isOpen ? "open" : ""}`}
      id="news-panel"
      style={{
        zIndex: 200,
        transition: "right 0.3s ease",
        display: "flex",
        flexDirection: "column",
      }}
      data-testid="news-panel"
    >
      {children}
    </Box>
  );
}

// -----------------------------------------------------------------------------
// Composite hook for NewsPanel2 (combines all panel-specific state)
// -----------------------------------------------------------------------------

function useNewsPanelHandlers(
  isOpen: boolean,
  setIsOpen: (v: boolean) => void,
  articleReader: ReturnType<typeof useArticleReader>,
  clearNewArticlesFlag: () => void,
  navigate: (path: string) => void,
) {
  const handleClose = useCallback(() => {
    setIsOpen(false);
    articleReader.handleBack();
  }, [articleReader.handleBack, setIsOpen]);

  const handleSymbolClick = useCallback(
    (symbol: NewsSymbol) => {
      if (symbol.instrument_key && symbol.trading_symbol) {
        navigate(`/chart/${symbol.trading_symbol}`);
      } else if (symbol.url) {
        window.open(symbol.url, "_blank", "noopener,noreferrer");
      }
    },
    [navigate],
  );

  useEffect(() => {
    if (isOpen) clearNewArticlesFlag();
  }, [isOpen, clearNewArticlesFlag]);

  return { handleClose, handleSymbolClick };
}

function useNewsPanel() {
  const navigate = useNavigate();
  const {
    connected: wsConnected,
    newsItems: wsNewsItems,
    hasNewArticles,
    clearNewArticlesFlag,
    addNewsItems,
  } = useNewsWebSocket();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState("all");
  const [autoRefreshMs, setAutoRefreshMs] = useState<string>(getStoredAutoRefresh);
  const { sourceData } = useNewsSources();
  const { newsItems, loading, error, loadNews } = useLocalNews(
    wsNewsItems,
    addNewsItems,
    selectedSource,
    isOpen,
  );
  const readMgmt = useReadManagement(newsItems);
  const articleReader = useArticleReader(readMgmt.readIds);
  const isRefreshing = useAutoRefresh(loadNews, autoRefreshMs);
  const { groupedNewsItems, sourceNames, expandedSources, toggleSourceExpanded } =
    useNewsSourceGroups({ newsItems, autoExpandCount: 2 });
  useNewsTracking(isOpen, newsItems);
  const { handleClose, handleSymbolClick } = useNewsPanelHandlers(
    isOpen,
    setIsOpen,
    articleReader,
    clearNewArticlesFlag,
    navigate,
  );
  return {
    isOpen,
    setIsOpen,
    selectedSource,
    setSelectedSource,
    autoRefreshMs,
    setAutoRefreshMs,
    newsItems,
    loading,
    error,
    loadNews,
    ...readMgmt,
    ...articleReader,
    isRefreshing,
    groupedNewsItems,
    sourceNames,
    expandedSources,
    toggleSourceExpanded,
    wsConnected,
    hasNewArticles,
    sourceData,
    handleClose,
    handleSymbolClick,
  };
}

export default function NewsPanel2() {
  const panel = useNewsPanel();

  return (
    <>
      <NewsPanelToggle
        hasNewArticles={panel.hasNewArticles}
        unreadCount={panel.unreadCount}
        isOpen={panel.isOpen}
        onToggle={() => panel.setIsOpen(!panel.isOpen)}
      />

      {panel.isOpen && <NewsPanelOverlay onClose={panel.handleClose} />}

      <NewsPanelContainer isOpen={panel.isOpen}>
        <NewsPanelBody
          selectedArticle={panel.selectedArticle}
          articleContent={panel.articleContent}
          articleLoading={panel.articleLoading}
          articleError={panel.articleError}
          handleBack={panel.handleBack}
          handleClose={panel.handleClose}
          handleSymbolClick={panel.handleSymbolClick}
          wsConnected={panel.wsConnected}
          isRefreshing={panel.isRefreshing}
          sourceData={panel.sourceData}
          selectedSource={panel.selectedSource}
          setSelectedSource={panel.setSelectedSource}
          autoRefreshMs={panel.autoRefreshMs}
          loading={panel.loading}
          error={panel.error}
          unreadCount={panel.unreadCount}
          loadNews={panel.loadNews}
          setAutoRefreshMs={panel.setAutoRefreshMs}
          handleMarkAllRead={panel.handleMarkAllRead}
          newsItems={panel.newsItems}
          sourceNames={panel.sourceNames}
          groupedNewsItems={panel.groupedNewsItems}
          expandedSources={panel.expandedSources}
          readIds={panel.readIds}
          toggleSourceExpanded={panel.toggleSourceExpanded}
          handleArticleClick={panel.handleArticleClick}
        />
      </NewsPanelContainer>
    </>
  );
}
