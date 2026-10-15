import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Typography from "@mui/material/Typography";
import { IconNews } from "@tabler/icons-react";
import { Box, Modal, Paper, Stack, useMediaQuery } from "@/ui";
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
      sx={{
        minHeight: 56,
        px: 2,
        py: 1,
        display: "flex",
        alignItems: "center",
        gap: 1,
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Box
        sx={{
          width: 32,
          height: 32,
          display: "grid",
          placeItems: "center",
          borderRadius: 1,
          color: "primary.main",
          bgcolor: "action.selected",
          flex: "0 0 auto",
        }}
      >
        <IconNews size={18} stroke={1.8} aria-hidden="true" />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ lineHeight: 1.2 }}>
          Market intelligence
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
          Headlines, catalysts and AI-assisted briefs in one workspace
        </Typography>
      </Box>
      <Box sx={{ flex: 1 }} />
      <Stack
        direction="row"
        gap={3}
        sx={{
          display: { xs: "none", sm: "flex" },
          "& > :not(:first-of-type)": { borderLeft: 1, borderColor: "divider", pl: 2 },
        }}
      >
        <Box sx={{ textAlign: "right" }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1 }}>
            Stories
          </Typography>
          <Typography variant="subtitle2" fontWeight={700} sx={{ fontVariantNumeric: "tabular-nums" }}>
            {storyCount}
          </Typography>
        </Box>
        <Box sx={{ textAlign: "right" }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1 }}>
            Sources
          </Typography>
          <Typography variant="subtitle2" fontWeight={700} sx={{ fontVariantNumeric: "tabular-nums" }}>
            {sourceCount}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}

const paneSx = {
  minHeight: 0,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
  bgcolor: "background.paper",
} as const;

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
        sx={{ ...paneSx, flex: 1, mt: 1 }}
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
    <Box
      role="region"
      aria-label="Article reader"
      sx={paneSx}
    >
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
      sx={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        bgcolor: "background.default",
      }}
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
          sx={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "minmax(300px, 0.78fr) minmax(0, 1.22fr)",
            gap: 1,
            p: 1,
          }}
        >
          <Paper
            component="section"
            aria-label="News feed"
            data-testid="news-list-region"
            sx={paneSx}
          >
            <NewsList {...newsListProps} />
          </Paper>
          <NewsPageDesktop articleDetailProps={articleDetailProps} />
        </Box>
      )}
    </Box>
  );
}
