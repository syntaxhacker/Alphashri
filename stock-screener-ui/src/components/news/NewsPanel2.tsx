import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { usePolling } from "@/hooks/usePolling";
import { useNavigate } from "@solidjs/router";
import { For } from "solid-js";
import { Box, Button, Divider, Indicator, Overlay, ScrollArea, Stack } from "@/ui";
import { IconNews } from "../common/Icons";
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
  wsNewsItems: () => NewsItem[],
  addNewsItems: (items: NewsItem[]) => void,
  selectedSource: () => string,
  isOpen: () => boolean,
) {
  const [localNewsItems, setLocalNewsItems] = createSignal<NewsItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const newsItems = createMemo(() => (wsNewsItems().length > 0 ? wsNewsItems() : localNewsItems()));

  const loadNews = async () => {
    setLoading(true);
    setError(null);
    try {
      const sourceParam = selectedSource() === "all" ? undefined : selectedSource();
      const items = await fetchNews(sourceParam, 50);
      if (wsNewsItems().length > 0) addNewsItems(items);
      else setLocalNewsItems(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load news");
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    // Track the source: switching sources re-fetches even while the panel stays open.
    selectedSource();
    if (isOpen()) void loadNews();
  });

  return { newsItems, loading, error, loadNews };
}

function useArticleReader(readIds: () => Set<string>) {
  const [selectedArticle, setSelectedArticle] = createSignal<NewsItem | null>(null);
  const [articleContent, setArticleContent] = createSignal<ArticleResponse | null>(null);
  const [articleLoading, setArticleLoading] = createSignal(false);
  const [articleError, setArticleError] = createSignal<string | null>(null);
  let fetchId = 0;

  const handleArticleClick = async (item: NewsItem) => {
    const fetchIdLocal = ++fetchId;
    const newReadIds = new Set(readIds());
    newReadIds.add(item.id);
    setSelectedArticle(item);
    setArticleLoading(true);
    setArticleContent(null);
    setArticleError(null);
    try {
      const content = await fetchArticle(item.sourceUrl);
      if (!content) throw new Error("Article content is unavailable");
      if (fetchIdLocal === fetchId) setArticleContent(content);
    } catch (err) {
      if (fetchIdLocal === fetchId) {
        setArticleError(err instanceof Error ? err.message : "Failed to load article");
      }
    } finally {
      if (fetchIdLocal === fetchId) setArticleLoading(false);
    }
  };

  const handleBack = () => {
    fetchId += 1;
    setSelectedArticle(null);
    setArticleContent(null);
    setArticleError(null);
    setArticleLoading(false);
  };

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
  loadNews: () => Promise<void>,
  autoRefreshMs: () => string,
) {
  const [isRefreshing, setIsRefreshing] = createSignal(false);

  const ms = () => parseInt(autoRefreshMs(), 10);
  usePolling(() => {
    setIsRefreshing(true);
    loadNews().finally(() => setIsRefreshing(false));
  }, ms(), { skipIfRunning: false });

  createEffect(() => {
    saveAutoRefresh(autoRefreshMs());
  });

  return isRefreshing;
}

// -----------------------------------------------------------------------------
// NewsPanel2-specific custom hooks (extracted from oversized component)
// -----------------------------------------------------------------------------

function useNewsSources() {
  const [sources, setSources] = createSignal<NewsSource[]>([]);

  onMount(() => {
    fetchNewsSources()
      .then(setSources)
      .catch((err) => {
        console.error("Failed to load news sources:", err);
      });
  });

  const sourceData = createMemo(() => getSourceOptions(sources()));
  return { sources, sourceData };
}

function useReadManagement(newsItems: () => NewsItem[]) {
  const [readIds, setReadIds] = createSignal<Set<string>>(getReadIds());
  const unreadCount = createMemo(() => newsItems().filter((item) => !readIds().has(item.id)).length);

  const handleMarkAllRead = () => {
    const newReadIds = new Set(readIds());
    newsItems().forEach((item) => newReadIds.add(item.id));
    setReadIds(newReadIds);
    saveReadIds(newReadIds);
  };

  return { readIds, unreadCount, handleMarkAllRead };
}

function useNewsTracking(isOpen: () => boolean, newsItems: () => NewsItem[]) {
  const [lastSeenId, setLastSeenId] = createSignal<string | null>(getStoredLastSeenId());

  createEffect(() => {
    const items = newsItems();
    if (isOpen() && items.length > 0 && items[0].id !== lastSeenId()) {
      const newId = items[0].id;
      setLastSeenId(newId);
      saveLastSeenId(newId);
    }
  });

  return lastSeenId;
}

// -----------------------------------------------------------------------------
// Sub-components (extracted from NewsPanel2 JSX)
// -----------------------------------------------------------------------------

function NewsPanelToggle(props: {
  hasNewArticles: boolean;
  unreadCount: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <Indicator
      color={props.hasNewArticles ? "success" : "error"}
      size={16}
      label={props.unreadCount > 9 ? "9+" : props.unreadCount}
      disabled={props.unreadCount === 0 || props.isOpen}
      offset={4}
      className={props.hasNewArticles ? "news-badge-pulse" : undefined}
    >
      {/* Icon-only in the header: the word "NEWS" cost ~54px of tape width.
          The count is capped at "9+" and the tooltip/aria-label carry the
          meaning. */}
      <Button
        variant="subtle"
        color="primary"
        size="sm"
        onClick={props.onToggle}
        data-testid="news-toggle-btn"
        aria-label="News"
        title={`Open news panel${props.unreadCount > 0 ? ` — ${props.unreadCount} unread` : ""}`}
        leftSection={<IconNews size={18} />}
        style={{ "min-width": 32, width: 32, height: 32, padding: 0 }}
      />
    </Indicator>
  );
}

function NewsPanelOverlay(props: { onClose: () => void }) {
  return (
    <Overlay
      color="secondary"
      backgroundOpacity={0.5}
      onClick={props.onClose}
      z-index={100}
      data-testid="news-overlay"
      className="news-overlay"
    />
  );
}

function NewsPanelBody(props: {
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
  onRetryArticle?: () => void;
}) {
  const selectedSourceName = () => props.sourceData.find((option) => option.value === props.selectedSource)?.label;
  return (
    <Show when={props.selectedArticle} fallback={(
    <Stack gap={0} h="100%" className="news-list-view" data-testid="news-list-view">
      <NewsListHeader wsConnected={props.wsConnected} isRefreshing={props.isRefreshing} onClose={props.handleClose} />

      <Box p="sm" id="news-panel-controls" data-testid="news-panel-controls">
        <NewsFilterControls
          sourceData={props.sourceData}
          selectedSource={props.selectedSource}
          autoRefreshMs={props.autoRefreshMs}
          loading={props.loading}
          isRefreshing={props.isRefreshing}
          unreadCount={props.unreadCount}
          onSourceChange={props.setSelectedSource}
          onRefresh={() => void props.loadNews()}
          onAutoRefreshChange={props.setAutoRefreshMs}
          onMarkAllRead={props.handleMarkAllRead}
        />
      </Box>
      <Divider />

      <ScrollArea flex={1} className="news-items-container">
          <NewsListContent
            loading={props.loading}
            error={props.error}
            newsItems={props.newsItems}
            selectedSource={props.selectedSource === "all" ? "all" : selectedSourceName() ?? props.selectedSource}
            sourceNames={props.sourceNames}
            groupedNewsItems={props.groupedNewsItems}
            expandedSources={props.expandedSources}
            readIds={props.readIds}
            onToggleSource={props.toggleSourceExpanded}
            onArticleClick={props.handleArticleClick}
          />
        </ScrollArea>
    </Stack>
    )}>
      {(article) => (
        <ArticleView
          article={article()}
          content={props.articleContent}
          loading={props.articleLoading}
          error={props.articleError}
          onBack={props.handleBack}
          onClose={props.handleClose}
          onSymbolClick={props.handleSymbolClick}
          onRetryArticle={props.onRetryArticle}
        />
      )}
    </Show>
  );
}

function NewsPanelContainer(props: { isOpen: boolean; children?: JSX.Element }) {
  return (
    <Box
      className={`news-panel fixed top-0 z-[200] flex h-screen w-[400px] max-w-[100vw] flex-col border-l border-fin-border bg-fin-surface ${props.isOpen ? "open" : ""}`}
      id="news-panel"
      style={{
        right: props.isOpen ? 0 : -400,
        transition: "right 0.3s ease",
      }}
      data-testid="news-panel"
    >
      {props.children}
    </Box>
  );
}

// -----------------------------------------------------------------------------
// Composite hook for NewsPanel2 (combines all panel-specific state)
// -----------------------------------------------------------------------------

function useNewsPanelHandlers(
  isOpen: () => boolean,
  setIsOpen: (v: boolean) => void,
  articleReader: ReturnType<typeof useArticleReader>,
  clearNewArticlesFlag: () => void,
  navigate: (path: string) => void,
) {
  const handleClose = () => {
    setIsOpen(false);
    articleReader.handleBack();
  };

  const handleSymbolClick = (symbol: NewsSymbol) => {
    if (symbol.instrument_key && symbol.trading_symbol) {
      navigate(`/chart/${symbol.trading_symbol}`);
    } else if (symbol.url) {
      window.open(symbol.url, "_blank", "noopener,noreferrer");
    }
  };

  createEffect(() => {
    if (isOpen()) clearNewArticlesFlag();
  });

  return { handleClose, handleSymbolClick };
}

function useNewsPanel() {
  const navigate = useNavigate();
  const ws = useNewsWebSocket();
  const [isOpen, setIsOpen] = createSignal(false);
  const [selectedSource, setSelectedSource] = createSignal("all");
  const [autoRefreshMs, setAutoRefreshMs] = createSignal<string>(getStoredAutoRefresh());
  const { sourceData } = useNewsSources();
  const wsNewsItems = () => ws.newsItems();
  const { newsItems, loading, error, loadNews } = useLocalNews(
    wsNewsItems,
    ws.addNewsItems,
    () => selectedSource(),
    () => isOpen(),
  );
  const readMgmt = useReadManagement(newsItems);
  const articleReader = useArticleReader(readMgmt.readIds);
  const isRefreshing = useAutoRefresh(loadNews, () => autoRefreshMs());
  const groups = useNewsSourceGroups({ newsItems, autoExpandCount: 2 });
  useNewsTracking(() => isOpen(), newsItems);
  const { handleClose, handleSymbolClick } = useNewsPanelHandlers(
    () => isOpen(),
    setIsOpen,
    articleReader,
    ws.clearNewArticlesFlag,
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
    groupedNewsItems: groups.groupedNewsItems,
    sourceNames: groups.sourceNames,
    expandedSources: groups.expandedSources,
    toggleSourceExpanded: groups.toggleSourceExpanded,
    wsConnected: () => ws.connected(),
    hasNewArticles: () => ws.hasNewArticles(),
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
        hasNewArticles={panel.hasNewArticles()}
        unreadCount={panel.unreadCount()}
        isOpen={panel.isOpen()}
        onToggle={() => panel.setIsOpen(!panel.isOpen())}
      />

      <Show when={panel.isOpen()}><NewsPanelOverlay onClose={panel.handleClose} /></Show>

      <NewsPanelContainer isOpen={panel.isOpen()}>
        <Show when={panel.isOpen()}>
          <NewsPanelBody
          selectedArticle={panel.selectedArticle()}
          articleContent={panel.articleContent()}
          articleLoading={panel.articleLoading()}
          articleError={panel.articleError()}
          handleBack={panel.handleBack}
          handleClose={panel.handleClose}
          handleSymbolClick={panel.handleSymbolClick}
          wsConnected={panel.wsConnected()}
          isRefreshing={panel.isRefreshing()}
          sourceData={panel.sourceData()}
          selectedSource={panel.selectedSource()}
          setSelectedSource={panel.setSelectedSource}
          autoRefreshMs={panel.autoRefreshMs()}
          loading={panel.loading()}
          error={panel.error()}
          unreadCount={panel.unreadCount()}
          loadNews={panel.loadNews}
          setAutoRefreshMs={panel.setAutoRefreshMs}
          handleMarkAllRead={panel.handleMarkAllRead}
          newsItems={panel.newsItems()}
          sourceNames={panel.sourceNames()}
          groupedNewsItems={panel.groupedNewsItems()}
          expandedSources={panel.expandedSources()}
          readIds={panel.readIds()}
          toggleSourceExpanded={panel.toggleSourceExpanded}
          handleArticleClick={panel.handleArticleClick}
          onRetryArticle={
            panel.selectedArticle()
              ? () => panel.handleArticleClick(panel.selectedArticle()!)
              : undefined
          }
        />
      </Show>
      </NewsPanelContainer>
    </>
  );
}
