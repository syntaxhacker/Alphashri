import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useMediaQuery } from "@mantine/hooks";
import { Box, ScrollArea, Modal } from "@mantine/core";
import type { NewsItem, NewsSymbol, ArticleResponse } from "../components/news/news-types";
import { fetchArticle } from "../api/news";
import { useNewsSourceGroups, getSourceOptions } from "../components/news/useNewsSourceGroups";
import { useNewsList } from "../components/news/useNewsList";
import { ArticleDetail } from "../components/news/ArticleDetail";
import { NewsList } from "../components/news/NewsList";

export default function NewsPage() {
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 768px)");

  const { newsItems, sources, selectedSource, setSelectedSource, loading, error, loadNews } = useNewsList();

  const [selectedArticle, setSelectedArticle] = useState<NewsItem | null>(null);
  const [articleContent, setArticleContent] = useState<ArticleResponse | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [_articleError, setArticleError] = useState<string | null>(null);
  const [showFullContent, setShowFullContent] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const articleFetchId = useRef(0);

  const sourceData = getSourceOptions(sources);

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
        setArticleContent(content as ArticleResponse);
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

  const newsListProps = {
    loading,
    error,
    selectedSource,
    sourceData,
    selectedArticle,
    onSourceChange: setSelectedSource,
    onRefresh: loadNews,
    onArticleClick: handleArticleClick,
    groupedNewsItems,
    sourceNames,
    expandedSources,
    toggleSourceExpanded,
  };

  const articleDetailProps = {
    selectedArticle,
    articleContent,
    articleLoading,
    isMobile,
    showFullContent,
    onClose: handleCloseArticle,
    onToggleFullContent: () => setShowFullContent((v) => !v),
    onSymbolClick: handleSymbolClick,
  };

  if (isMobile) {
    return (
      <Box p="sm" data-testid="news-page" className="news-page">
        <ScrollArea.Autosize mah="calc(100vh - 100px)" offsetScrollbars>
          <NewsList {...newsListProps} />
        </ScrollArea.Autosize>

        <Modal
          opened={modalOpen}
          onClose={handleCloseArticle}
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
          <NewsList {...newsListProps} />
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
          <ArticleDetail {...articleDetailProps} />
        </ScrollArea>
      </Box>
    </Box>
  );
}
