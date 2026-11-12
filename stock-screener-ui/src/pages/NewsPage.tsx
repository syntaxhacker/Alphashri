import { createSignal, mergeProps, Show, type ComponentProps } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Icon } from "../components/common/Icons";
import { Box, Modal, Paper, Stack, Text, useMediaQuery } from "@/ui";
import * as palette from "@/ui/palette";
import type { ArticleResponse, NewsItem, NewsSymbol } from "../components/news/news-types";
import { fetchArticle } from "../api/news";
import { getSourceOptions, useNewsSourceGroups } from "../components/news/useNewsSourceGroups";
import { useNewsList } from "../components/news/useNewsList";
import { ArticleDetail } from "../components/news/ArticleDetail";
import { NewsList } from "../components/news/NewsList";

type ArticleDetailProps = ComponentProps<typeof ArticleDetail>;
type NewsListProps = ComponentProps<typeof NewsList>;

function useArticleDetail(isMobile: () => boolean) {
  const [selectedArticle, setSelectedArticle] = createSignal<NewsItem | null>(null);
  const [articleContent, setArticleContent] = createSignal<ArticleResponse | null>(null);
  const [articleLoading, setArticleLoading] = createSignal(false);
  const [articleError, setArticleError] = createSignal<string | null>(null);
  const [showFullContent, setShowFullContent] = createSignal(false);
  const [modalOpen, setModalOpen] = createSignal(false);
  let articleFetchId = 0;

  const handleArticleClick = async (item: NewsItem) => {
    const fetchId = ++articleFetchId;
    setSelectedArticle(item);
    setArticleLoading(true);
    setArticleContent(null);
    setArticleError(null);
    setShowFullContent(false);
    if (isMobile()) setModalOpen(true);
    try {
      const content = await fetchArticle(item.sourceUrl);
      if (!content) throw new Error("Article content is unavailable");
      if (fetchId === articleFetchId) setArticleContent(content as ArticleResponse);
    } catch (err) {
      if (fetchId === articleFetchId) {
        setArticleError(err instanceof Error ? err.message : "Failed to load article");
      }
    } finally {
      if (fetchId === articleFetchId) setArticleLoading(false);
    }
  };

  const handleCloseArticle = () => {
    articleFetchId += 1;
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

function NewsWorkspaceHeader(props: { storyCount: number; sourceCount: number }) {
  return (
    <Box
      component="header"
      data-testid="news-workspace-header"
      className="flex items-center gap-2 border-b border-fin-border bg-fin-surface"
      style={{ "min-height": 56, "padding-left": 16, "padding-right": 16, "padding-top": 8, "padding-bottom": 8 }}
    >
      <Box
        className="size-8 grid place-items-center rounded-fin flex-shrink-0"
        style={{
          width: 32,
          height: 32,
          "border-radius": 8,
          color: palette.PRIMARY,
          "background-color": "rgba(88, 166, 255, 0.12)",
        }}
      >
        <Icon name="news" size={18} stroke={1.8} aria-hidden="true" />
      </Box>
      <Box className="min-w-0">
        <Text size="sm" fw={700} style={{ "line-height": 1.2 }}>
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
          <Text size="xs" c="dimmed" style={{ "line-height": 1 }}>
            Stories
          </Text>
          <Text size="xs" fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
            {props.storyCount}
          </Text>
        </Box>
        <Box className="text-right pl-4">
          <Text size="xs" c="dimmed" style={{ "line-height": 1 }}>
            Sources
          </Text>
          <Text size="xs" fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
            {props.sourceCount}
          </Text>
        </Box>
      </Stack>
    </Box>
  );
}

const paneClassName =
  "flex flex-col overflow-hidden min-h-0 border border-fin-border rounded-fin bg-fin-surface";

function NewsPageMobile(props: {
  modalOpen: boolean;
  newsListProps: NewsListProps;
  articleDetailProps: ArticleDetailProps;
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
        <NewsList {...props.newsListProps} />
      </Paper>
      <Modal
        opened={props.modalOpen}
        onClose={props.onCloseArticle}
        fullScreen
        withCloseButton={false}
        padding={0}
        data-testid="article-modal"
      >
        <ArticleDetail {...props.articleDetailProps} />
      </Modal>
    </>
  );
}

function NewsPageDesktop(props: {
  articleDetailProps: ArticleDetailProps;
}) {
  return (
    <Box role="region" aria-label="Article reader" className={paneClassName}>
      <ArticleDetail {...props.articleDetailProps} />
    </Box>
  );
}

export default function NewsPage() {
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 899px)");
  const { newsItems, sources, selectedSource, setSelectedSource, loading, error, loadNews } = useNewsList();
  const article = useArticleDetail(isMobile);
  const sourceData = () => getSourceOptions(sources());
  const selectedSourceName = () => sourceData().find((option) => option.value === selectedSource())?.label;
  const { groupedNewsItems, sourceNames, expandedSources, toggleSourceExpanded } = useNewsSourceGroups({
    newsItems,
    autoExpandCount: 999,
  });

  const handleSymbolClick = (symbol: NewsSymbol) => {
    if (symbol.instrument_key && symbol.trading_symbol) navigate(`/chart/${symbol.trading_symbol}`);
    else if (symbol.url) window.open(symbol.url, "_blank", "noopener,noreferrer");
  };

  // Spreading a plain object into <NewsList> would freeze props.children-like
  // values at mount — mergeProps keeps every attribute a live getter.
  const newsListProps = mergeProps(() => ({
    loading: loading(),
    error: error(),
    selectedSource: selectedSource(),
    selectedSourceName: selectedSourceName(),
    sourceData: sourceData(),
    selectedArticle: article.selectedArticle(),
    onSourceChange: setSelectedSource,
    onRefresh: loadNews,
    onArticleClick: article.handleArticleClick,
    groupedNewsItems: groupedNewsItems(),
    sourceNames: sourceNames(),
    expandedSources: expandedSources(),
    toggleSourceExpanded,
  }));
  const articleDetailProps = mergeProps(() => ({
    selectedArticle: article.selectedArticle(),
    articleContent: article.articleContent(),
    articleLoading: article.articleLoading(),
    articleError: article.articleError(),
    isMobile: isMobile(),
    showFullContent: article.showFullContent(),
    onClose: article.handleCloseArticle,
    onToggleFullContent: article.toggleFullContent,
    onSymbolClick: handleSymbolClick,
    onRetryArticle: article.selectedArticle()
      ? () => article.handleArticleClick(article.selectedArticle() as NewsItem)
      : undefined,
  }));

  return (
    <Box
      className="h-full min-h-0 flex flex-col overflow-hidden bg-fin-bg"
      data-testid="news-page"
    >
      <NewsWorkspaceHeader storyCount={newsItems().length} sourceCount={sourceNames().length} />
      <Show
        when={isMobile()}
        fallback={
          <Box
            className="flex-1 min-h-0 grid gap-2 p-2"
            style={{ "grid-template-columns": "minmax(300px, 0.78fr) minmax(0, 1.22fr)" }}
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
        }
      >
        <NewsPageMobile
          modalOpen={article.modalOpen()}
          onCloseArticle={article.handleCloseArticle}
          newsListProps={newsListProps}
          articleDetailProps={articleDetailProps}
        />
      </Show>
    </Box>
  );
}
