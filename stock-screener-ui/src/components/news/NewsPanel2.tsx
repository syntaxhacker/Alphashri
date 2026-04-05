import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, type NavigateFunction } from "react-router-dom";
import { Box, Button, Indicator, Overlay, Paper, ScrollArea, Stack } from "@mantine/core";
import { IconNews } from "@tabler/icons-react";
import type { NewsItem, ArticleResponse, NewsSymbol } from "./news-types";
import { fetchArticle } from "../../api/news";
import { useNewsWebSocket } from "../../state/newsWebSocket";
import { useNewsSourceGroups, getSourceOptions } from "./useNewsSourceGroups";
import {
  getStoredLastSeenId,
  saveLastSeenId,
  getStoredAutoRefresh,
  saveAutoRefresh,
} from "./NewsLocalStorage";
import { ArticleView, NewsFilterControls, NewsListContent, NewsListHeader } from "./NewsHelpers";
import { useNewsList } from "./useNewsList";
import { useNewsReadState } from "./useNewsReadState";

function useArticleReader(markAsRead: (id: string) => void) {
  const [selectedArticle, setSelectedArticle] = useState<NewsItem | null>(null);
  const [articleContent, setArticleContent] = useState<ArticleResponse | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [articleError, setArticleError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  const handleArticleClick = useCallback(
    async (item: NewsItem) => {
      const fetchId = ++fetchIdRef.current;
      markAsRead(item.id);
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
    [markAsRead],
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

function useAutoRefresh(loadNews: () => Promise<void>, autoRefreshMs: string) {
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
        loadNews().finally(() => setIsRefreshing(false));
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

interface NewsListSectionProps {
  wsConnected: boolean;
  isRefreshing: boolean;
  onClose: () => void;
  sourceData: { value: string; label: string }[];
  selectedSource: string;
  autoRefreshMs: string;
  loading: boolean;
  error: string | null;
  unreadCount: number;
  newsItems: NewsItem[];
  sourceNames: string[];
  groupedNewsItems: Record<string, NewsItem[]>;
  expandedSources: Set<string>;
  readIds: Set<string>;
  onSourceChange: (value: string) => void;
  onRefresh: () => void;
  onAutoRefreshChange: (value: string) => void;
  onMarkAllRead: () => void;
  onToggleSource: (source: string) => void;
  onArticleClick: (item: NewsItem) => void;
}

function NewsToggleBadge({
  isOpen,
  onToggle,
  hasNewArticles,
  unreadCount,
}: {
  isOpen: boolean;
  onToggle: () => void;
  hasNewArticles: boolean;
  unreadCount: number;
}) {
  return (
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

function NewsArticleSection({
  article,
  content,
  loading,
  error,
  onBack,
  onClose,
  navigate,
}: {
  article: NewsItem;
  content: ArticleResponse | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onClose: () => void;
  navigate: NavigateFunction;
}) {
  const handleSymbolClick = (symbol: NewsSymbol) => {
    if (symbol.instrument_key && symbol.trading_symbol) {
      navigate(`/chart/${symbol.trading_symbol}`);
    } else if (symbol.url) {
      window.open(symbol.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <ArticleView
      article={article}
      content={content}
      loading={loading}
      error={error}
      onBack={onBack}
      onClose={onClose}
      onSymbolClick={handleSymbolClick}
    />
  );
}

function NewsListSection({
  wsConnected,
  isRefreshing,
  onClose,
  sourceData,
  selectedSource,
  autoRefreshMs,
  loading,
  error,
  unreadCount,
  newsItems,
  sourceNames,
  groupedNewsItems,
  expandedSources,
  readIds,
  onSourceChange,
  onRefresh,
  onAutoRefreshChange,
  onMarkAllRead,
  onToggleSource,
  onArticleClick,
}: NewsListSectionProps) {
  return (
    <Stack gap={0} h="100%" className="news-list-view" data-testid="news-list-view">
      <NewsListHeader wsConnected={wsConnected} isRefreshing={isRefreshing} onClose={onClose} />
      <Paper withBorder p="sm" id="news-panel-controls" data-testid="news-panel-controls">
        <NewsFilterControls
          sourceData={sourceData}
          selectedSource={selectedSource}
          autoRefreshMs={autoRefreshMs}
          loading={loading}
          isRefreshing={isRefreshing}
          unreadCount={unreadCount}
          onSourceChange={onSourceChange}
          onRefresh={onRefresh}
          onAutoRefreshChange={onAutoRefreshChange}
          onMarkAllRead={onMarkAllRead}
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
            onToggleSource={onToggleSource}
            onArticleClick={onArticleClick}
          />
        </ScrollArea>
      </Paper>
    </Stack>
  );
}

export default function NewsPanel2() {
  const navigate = useNavigate();
  const ws = useNewsWebSocket();
  const [isOpen, setIsOpen] = useState(false);
  const [lastSeenId, setLastSeenId] = useState(getStoredLastSeenId);
  const [autoRefreshMs, setAutoRefreshMs] = useState(getStoredAutoRefresh);
  const { newsItems, sources, selectedSource, setSelectedSource, loading, error, loadNews } =
    useNewsList({
      wsNewsItems: ws.newsItems,
      addNewsItems: ws.addNewsItems,
      isOpen,
    });
  const { readIds, markAsRead, markAllRead, unreadCount } = useNewsReadState(newsItems);
  const article = useArticleReader(markAsRead);
  const isRefreshing = useAutoRefresh(loadNews, autoRefreshMs);
  const { groupedNewsItems, sourceNames, expandedSources, toggleSourceExpanded } =
    useNewsSourceGroups({ newsItems, autoExpandCount: 2 });
  useEffect(() => {
    if (isOpen) ws.clearNewArticlesFlag();
  }, [isOpen, ws.clearNewArticlesFlag]);
  useEffect(() => {
    if (isOpen && newsItems[0]?.id !== lastSeenId) {
      const id = newsItems[0]?.id;
      if (id) {
        setLastSeenId(id);
        saveLastSeenId(id);
      }
    }
  }, [isOpen, newsItems, lastSeenId]);
  const handleClose = () => {
    setIsOpen(false);
    article.handleBack();
  };
  return (
    <>
      <NewsToggleBadge
        isOpen={isOpen}
        onToggle={() => setIsOpen(!isOpen)}
        hasNewArticles={ws.hasNewArticles}
        unreadCount={unreadCount}
      />
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
        {article.selectedArticle ? (
          <NewsArticleSection
            article={article.selectedArticle}
            content={article.articleContent}
            loading={article.articleLoading}
            error={article.articleError}
            onBack={article.handleBack}
            onClose={handleClose}
            navigate={navigate}
          />
        ) : (
          <NewsListSection
            wsConnected={ws.connected}
            isRefreshing={isRefreshing}
            onClose={handleClose}
            sourceData={getSourceOptions(sources)}
            selectedSource={selectedSource}
            autoRefreshMs={autoRefreshMs}
            loading={loading}
            error={error}
            unreadCount={unreadCount}
            newsItems={newsItems}
            sourceNames={sourceNames}
            groupedNewsItems={groupedNewsItems}
            expandedSources={expandedSources}
            readIds={readIds}
            onSourceChange={setSelectedSource}
            onRefresh={() => loadNews()}
            onAutoRefreshChange={setAutoRefreshMs}
            onMarkAllRead={markAllRead}
            onToggleSource={toggleSourceExpanded}
            onArticleClick={article.handleArticleClick}
          />
        )}
      </Box>
    </>
  );
}
