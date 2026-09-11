import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Container from "@mui/material/Container";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
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
    articleError,
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
    <Container maxWidth="xl" sx={{ py: 2, display: "flex", flexDirection: "column", gap: 1, width: "100%", minHeight: 0, height: "100%", overflow: "hidden", alignItems: "stretch", justifyContent: "flex-start" }} data-testid="news-page">
      <Stack spacing={1} sx={{ flex: 1, width: "100%", alignItems: "stretch", justifyContent: "flex-start" }}>
        <Grid container spacing={2} sx={{ justifyContent: "flex-start", alignItems: "stretch", width: "100%" }}>
          <Grid size={{ xs: 12 }} sx={{ display: "flex", justifyContent: "flex-start" }}>
            <Card elevation={0} sx={{ width: "100%", p: 1 }}>
              <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "flex-start", p: 1, width: "100%", "&:last-child": { pb: 1 } }}>
                <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1, width: "100%", display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "flex-start" }}>
                  <NewsList {...newsListProps} />
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Stack>
      <Modal
        opened={modalOpen}
        onClose={onCloseArticle}
        title="Article Analysis"
        size="lg"
        scrollAreaComponent={ScrollArea.Autosize}
        data-testid="article-modal"
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
          <ArticleDetail {...articleDetailProps} />
        </Box>
      </Modal>
    </Container>
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
    <Container maxWidth="xl" sx={{ py: 2, display: "flex", flexDirection: "column", gap: 1, minHeight: 0, height: "100%", overflow: "hidden", width: "100%", alignItems: "stretch", justifyContent: "flex-start" }} data-testid="news-page">
      <Grid container spacing={2} sx={{ justifyContent: "flex-start", alignItems: "stretch", width: "100%", flex: 1, minHeight: 0 }}>
        <Grid size={{ xs: 12, md: 5 }} sx={{ display: "flex", justifyContent: "flex-start", minHeight: 0 }}>
          <Card elevation={0} sx={{ flex: 1, display: "flex", flexDirection: "column", p: 1, minHeight: 0, overflow: "hidden" }}>
            <CardContent sx={{ flex: 1, p: 1, "&:last-child": { pb: 1 }, overflow: "hidden", minHeight: 0, display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "flex-start" }}>
              <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1, width: "100%", display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "flex-start" }}>
                <NewsList {...newsListProps} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 7 }} sx={{ display: "flex", justifyContent: "flex-start", minHeight: 0 }}>
          <Card elevation={0} sx={{ flex: 1, display: "flex", flexDirection: "column", p: 1, minHeight: 0, overflow: "hidden" }}>
            <CardContent sx={{ flex: 1, p: 1, "&:last-child": { pb: 1 }, overflow: "hidden", minHeight: 0, display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "flex-start" }}>
              <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1, width: "100%", display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "flex-start" }}>
                <ArticleDetail {...articleDetailProps} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
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
