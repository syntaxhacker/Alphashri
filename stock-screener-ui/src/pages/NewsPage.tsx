import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Paper from "@mui/material/Paper";
import CardContent from "@mui/material/CardContent";
import { useMediaQuery, Box, Stack, ScrollArea, Modal } from "@/ui";
import type { NewsItem, NewsSymbol, ArticleResponse } from "../components/news/news-types";
import { fetchArticle } from "../api/news";
import { useNewsSourceGroups, getSourceOptions } from "../components/news/useNewsSourceGroups";
import { useNewsList } from "../components/news/useNewsList";
import { ArticleDetail } from "../components/news/ArticleDetail";
import { NewsList } from "../components/news/NewsList";

function useArticleDetail(isMobile: boolean) {
  const [selectedArticle, setSelectedArticle] = useState<NewsItem | null>(null);
  const [articleContent, setArticleContent] = useState<ArticleResponse | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [_articleError, setArticleError] = useState<string | null>(null);
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
      if (fetchId === articleFetchId.current) setArticleContent(content as ArticleResponse);
    } catch (err) {
      if (fetchId === articleFetchId.current)
        setArticleError(err instanceof Error ? err.message : "Failed to load article");
    } finally {
      if (fetchId === articleFetchId.current) setArticleLoading(false);
    }
  };

  const handleCloseArticle = () => {
    setSelectedArticle(null);
    setArticleContent(null);
    setArticleError(null);
    setModalOpen(false);
  };

  return {
    selectedArticle,
    articleContent,
    articleLoading,
    showFullContent,
    modalOpen,
    handleArticleClick,
    handleCloseArticle,
    toggleFullContent: () => setShowFullContent((v) => !v),
  };
}

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
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, width: "100%", minHeight: 0, height: "100%", overflow: "hidden" }} data-testid="news-page">
      <Box flex={1} style={{ minHeight: 0, overflow: "auto" }} p={1}>
        <NewsList {...newsListProps} />
      </Box>
      <Modal
        opened={modalOpen}
        onClose={onCloseArticle}
        title="Article Analysis"
        size="lg"
        scrollAreaComponent={ScrollArea.Autosize}
        data-testid="article-modal"
      >
        <ArticleDetail {...articleDetailProps} />
      </Modal>
    </Box>
  );
}

function NewsPageDesktop({
  newsListProps,
  articleDetailProps,
}: {
  newsListProps: React.ComponentProps<typeof NewsList>;
  articleDetailProps: React.ComponentProps<typeof ArticleDetail>;
}) {
  return (
    <Box sx={{ p: 2, display: "flex", gap: 2, minHeight: 0, height: "100%", overflow: "hidden", width: "100%" }} data-testid="news-page">
      <Paper elevation={0} sx={{ flex: "0 0 40%", display: "flex", minHeight: 0, overflow: "hidden", minWidth: 0 }}>
        <CardContent sx={{ flex: 1, p: 1, "&:last-child": { pb: 1 }, overflow: "hidden", minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Box flex={1} style={{ minHeight: 0, overflow: "auto" }} p={1}>
            <NewsList {...newsListProps} />
          </Box>
        </CardContent>
      </Paper>
      <Paper elevation={0} sx={{ flex: "1 1 60%", display: "flex", minHeight: 0, overflow: "hidden", minWidth: 0 }}>
        <CardContent sx={{ flex: 1, p: 1, "&:last-child": { pb: 1 }, overflow: "hidden", minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Box flex={1} style={{ minHeight: 0, overflow: "auto" }} p={1}>
            <ArticleDetail {...articleDetailProps} />
          </Box>
        </CardContent>
      </Paper>
    </Box>
  );
}

export default function NewsPage() {
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { newsItems, sources, selectedSource, setSelectedSource, loading, error, loadNews } =
    useNewsList();
  const article = useArticleDetail(isMobile);
  const sourceData = getSourceOptions(sources);
  const { groupedNewsItems, sourceNames, expandedSources, toggleSourceExpanded } =
    useNewsSourceGroups({ newsItems, autoExpandCount: 999 });

  const handleSymbolClick = (symbol: NewsSymbol) => {
    if (symbol.instrument_key && symbol.trading_symbol) navigate(`/chart/${symbol.trading_symbol}`);
    else if (symbol.url) window.open(symbol.url, "_blank", "noopener,noreferrer");
  };

  const newsListProps = {
    loading,
    error,
    selectedSource,
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
    isMobile,
    showFullContent: article.showFullContent,
    onClose: article.handleCloseArticle,
    onToggleFullContent: article.toggleFullContent,
    onSymbolClick: handleSymbolClick,
  };

  if (isMobile) {
    return (
      <NewsPageMobile
        modalOpen={article.modalOpen}
        onCloseArticle={article.handleCloseArticle}
        newsListProps={newsListProps}
        articleDetailProps={articleDetailProps}
      />
    );
  }

  return <NewsPageDesktop newsListProps={newsListProps} articleDetailProps={articleDetailProps} />;
}
