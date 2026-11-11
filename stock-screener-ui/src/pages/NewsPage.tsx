import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IconNews } from "@tabler/icons-react";
import { Box, Modal, Paper, Stack, Text, useMediaQuery } from "@/ui";
import * as palette from "@/ui/palette";
import type { ArticleResponse, NewsItem, NewsSymbol } from "../components/news/news-types";
import { fetchArticle } from "../api/news";
import { getSourceOptions, useNewsSourceGroups } from "../components/news/useNewsSourceGroups";
import { useNewsList } from "../components/news/useNewsList";
import { ArticleDetail } from "../components/news/ArticleDetail";
import { NewsList } from "../components/news/NewsList";

function useArticleDetail(isMobile: boolean) {
  const [selectedArticle, setSelectedArticle] = useState<NewsItem | null>(null);
  const [articleContent, setArticleContent] = useState<ArticleResponse | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [articleError, setArticleError] = useState<string | null>(null);
  const [showFullContent, setShowFullContent] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const articleFetchId = useRef(0);

  const handleArticleClick = async (item: NewsItem) => {
    const fetchId = ++articleFetchId.current;
    setSelectedArticle(item);
    setArticleLoading(true);
    setArticleContent(null);
    setArticleError(null);
    setShowFullContent(false);
    if (isMobile) setModalOpen(true);
    try {
      const content = await fetchArticle(item.sourceUrl);
      if (!content) throw new Error("Article content is unavailable");
      if (fetchId === articleFetchId.current) setArticleContent(content as ArticleResponse);
    } catch (err) {
      if (fetchId === articleFetchId.current) {
        setArticleError(err instanceof Error ? err.message : "Failed to load article");
      }
    } finally {
      if (fetchId === articleFetchId.current) setArticleLoading(false);
    }
  };

  const handleCloseArticle = () => {
    articleFetchId.current += 1;
    setSelectedArticle(null);
    setArticleContent(null);
    setArticleError(null);
    setArticleLoading(false);
    setShowFullContent(false);
    setModalOpen(false);
  };

  return {
    selectedArticle,
    articleContent,
    articleLoading,
    articleError,
    showFullContent,
    modalOpen,
    handleArticleClick,
    handleCloseArticle,
    toggleFullContent: () => setShowFullContent((value) => !value),
  };
}

function NewsWorkspaceHeader({ storyCount, sourceCount }: { storyCount: number; sourceCount: number }) {
  return (
    <Box
      component="header"
      data-testid="news-workspace-header"
      className="flex items-center gap-2 border-b border-fin-border bg-fin-surface"
      style={{ minHeight: 56, paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8 }}
    >
      <Box
        className="size-8 grid place-items-center rounded-fin flex-shrink-0"
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          color: palette.PRIMARY,
          backgroundColor: "rgba(88, 166, 255, 0.12)",
        }}
      >
        <IconNews size={18} stroke={1.8} aria-hidden="true" />
      </Box>
      <Box className="min-w-0">
        <Text size="sm" fw={700} style={{ lineHeight: 1.2 }}>
          Market intelligence
        </Text>
        <Text size="xs" c="dimmed" className="hidden sm:block">
          Headlines, catalysts and AI-assisted briefs in one workspace
        </Text>
      </Box>
      <Box className="min-w-0 flex-1" />
      <Stack
        direction="row"
        gap={6}
        className="hidden sm:flex divide-x divide-fin-border"
      >
        <Box className="text-right">
          <Text size="xs" c="dimmed" style={{ lineHeight: 1 }}>
            Stories
          </Text>
          <Text size="xs" fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
            {storyCount}
          </Text>
        </Box>
        <Box className="text-right pl-4">
          <Text size="xs" c="dimmed" style={{ lineHeight: 1 }}>
            Sources
          </Text>
          <Text size="xs" fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
            {sourceCount}
          </Text>
        </Box>
      </Stack>
    </Box>
  );
}

const paneClassName =
  "flex flex-col overflow-hidden min-h-0 border border-fin-border rounded-fin bg-fin-surface";

function NewsPageMobile({
  modalOpen,
  newsListProps,
  articleDetailProps,
  onCloseArticle,
}: {
  modalOpen: boolean;
  newsListProps: React.ComponentProps<typeof NewsList>;
  articleDetailProps: React.ComponentProps<typeof ArticleDetail>;
  onCloseArticle: () => void;
}) {
  return (
    <>
      <Paper
        component="section"
        aria-label="News feed"
        data-testid="news-list-region"
        className={`${paneClassName} flex-1 mt-2`}
      >
        <NewsList {...newsListProps} />
      </Paper>
      <Modal
        opened={modalOpen}
        onClose={onCloseArticle}
        fullScreen
        withCloseButton={false}
        padding={0}
        data-testid="article-modal"
      >
        <ArticleDetail {...articleDetailProps} />
      </Modal>
    </>
  );
}

function NewsPageDesktop({
  articleDetailProps,
}: {
  articleDetailProps: React.ComponentProps<typeof ArticleDetail>;
}) {
  return (
    <Box role="region" aria-label="Article reader" className={paneClassName}>
      <ArticleDetail {...articleDetailProps} />
    </Box>
  );
}

export default function NewsPage() {
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 899px)");
  const { newsItems, sources, selectedSource, setSelectedSource, loading, error, loadNews } = useNewsList();
  const article = useArticleDetail(isMobile);
  const sourceData = getSourceOptions(sources);
  const selectedSourceName = sourceData.find((option) => option.value === selectedSource)?.label;
  const { groupedNewsItems, sourceNames, expandedSources, toggleSourceExpanded } = useNewsSourceGroups({
    newsItems,
    autoExpandCount: 999,
  });

  const handleSymbolClick = (symbol: NewsSymbol) => {
    if (symbol.instrument_key && symbol.trading_symbol) navigate(`/chart/${symbol.trading_symbol}`);
    else if (symbol.url) window.open(symbol.url, "_blank", "noopener,noreferrer");
  };

  const newsListProps = {
    loading,
    error,
    selectedSource,
    selectedSourceName,
    sourceData,
    selectedArticle: article.selectedArticle,
    onSourceChange: setSelectedSource,
    onRefresh: loadNews,
    onArticleClick: article.handleArticleClick,
    groupedNewsItems,
    sourceNames,
    expandedSources,
    toggleSourceExpanded,
  };
  const articleDetailProps = {
    selectedArticle: article.selectedArticle,
    articleContent: article.articleContent,
    articleLoading: article.articleLoading,
    articleError: article.articleError,
    isMobile,
    showFullContent: article.showFullContent,
    onClose: article.handleCloseArticle,
    onToggleFullContent: article.toggleFullContent,
    onSymbolClick: handleSymbolClick,
    onRetryArticle: article.selectedArticle
      ? () => article.handleArticleClick(article.selectedArticle as NewsItem)
      : undefined,
  };

  return (
    <Box
      className="h-full min-h-0 flex flex-col overflow-hidden bg-fin-bg"
      data-testid="news-page"
    >
      <NewsWorkspaceHeader storyCount={newsItems.length} sourceCount={sourceNames.length} />
      {isMobile ? (
        <NewsPageMobile
          modalOpen={article.modalOpen}
          onCloseArticle={article.handleCloseArticle}
          newsListProps={newsListProps}
          articleDetailProps={articleDetailProps}
        />
      ) : (
        <Box
          className="flex-1 min-h-0 grid gap-2 p-2"
          style={{ gridTemplateColumns: "minmax(300px, 0.78fr) minmax(0, 1.22fr)" }}
        >
          <Paper
            component="section"
            aria-label="News feed"
            data-testid="news-list-region"
            className={paneClassName}
          >
            <NewsList {...newsListProps} />
          </Paper>
          <NewsPageDesktop articleDetailProps={articleDetailProps} />
        </Box>
      )}
    </Box>
  );
}
