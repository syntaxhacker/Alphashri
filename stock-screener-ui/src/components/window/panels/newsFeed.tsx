import { createMemo, mergeProps } from "solid-js";
import { Box } from "@/ui";
import type { NewsItem } from "../../news/news-types";
import { NewsList } from "../../news/NewsList";
import { useNewsList } from "../../news/useNewsList";
import { getSourceOptions, useNewsSourceGroups } from "../../news/useNewsSourceGroups";
import type { DockPanelSpec } from "../../dock/types";

function NewsFeedPanel() {
  const { newsItems, sources, selectedSource, setSelectedSource, loading, error, loadNews } =
    useNewsList();
  const sourceData = createMemo(() => getSourceOptions(sources()));
  const selectedSourceName = createMemo(
    () => sourceData().find((option) => option.value === selectedSource())?.label,
  );
  const { groupedNewsItems, sourceNames, expandedSources, toggleSourceExpanded } =
    useNewsSourceGroups({ newsItems, autoExpandCount: 999 });

  const openStory = (item: NewsItem) => {
    if (item.sourceUrl) window.open(item.sourceUrl, "_blank", "noopener,noreferrer");
  };

  const newsListProps = mergeProps(() => ({
    loading: loading(),
    error: error(),
    selectedSource: selectedSource(),
    selectedSourceName: selectedSourceName(),
    sourceData: sourceData(),
    selectedArticle: null,
    onSourceChange: setSelectedSource,
    onRefresh: loadNews,
    onArticleClick: openStory,
    groupedNewsItems: groupedNewsItems(),
    sourceNames: sourceNames(),
    expandedSources: expandedSources(),
    toggleSourceExpanded,
  }));

  return (
    <Box data-testid="panel-news-feed" className="flex h-full min-h-0 flex-col">
      <NewsList {...newsListProps} />
    </Box>
  );
}

export const NEWS_FEED_PANEL: DockPanelSpec = {
  id: "news.feed",
  page: "report",
  title: "NEWS",
  size: 1,
  minWidth: 320,
  singleton: true,
  requires: [],
  mount: () => <NewsFeedPanel />,
};
