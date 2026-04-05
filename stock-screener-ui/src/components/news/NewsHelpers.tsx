import {
  Button,
  CloseButton,
  Divider,
  Group,
  ScrollArea,
  Stack,
  Text,
  Title,
  Anchor,
} from "@mantine/core";
import { IconArrowLeft, IconExternalLink } from "@tabler/icons-react";
import type { NewsItem, NewsSymbol, ArticleResponse } from "./news-types";
import { formatTimeAgo } from "../../utils/ui-helpers";
import { ArticleSymbols } from "./ArticleSymbols";
import { ArticleBody } from "./ArticleBody";

export { ArticleSymbols } from "./ArticleSymbols";
export { ArticleBody } from "./ArticleBody";
export { NewsItemCard } from "./NewsItemCard";
export { NewsSourceGroup } from "./NewsSourceGroup";
export { NewsFilterControls } from "./NewsFilterControls";
export { NewsListContent } from "./NewsListContent";
export { NewsListHeader } from "./NewsListHeader";

export function ArticleView({
  article,
  content,
  loading,
  error,
  onBack,
  onClose,
  onSymbolClick,
}: {
  article: NewsItem;
  content: ArticleResponse | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onClose: () => void;
  onSymbolClick: (s: NewsSymbol) => void;
}) {
  return (
    <Stack gap={0} h="100%" className="news-article-view" data-testid="news-article-view">
      <Group
        p="sm"
        justify="space-between"
        className="news-article-header"
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <Button
          variant="subtle"
          size="sm"
          leftSection={<IconArrowLeft size={14} />}
          onClick={onBack}
          data-testid="news-article-back-btn"
        >
          Back
        </Button>
        <CloseButton onClick={onClose} />
      </Group>

      <ScrollArea flex={1} p="sm" className="news-article-content">
        <Stack gap="sm">
          <Title order={4} data-testid="news-article-headline">
            {article.headline}
          </Title>

          <Text size="sm" c="dimmed" data-testid="news-article-meta">
            {content?.source || article.source} |{" "}
            {formatTimeAgo(content?.publishedAt || article.publishedAt)}
          </Text>

          <ArticleSymbols symbols={content?.symbols ?? []} onSymbolClick={onSymbolClick} />

          <Divider />

          <ArticleBody content={content} loading={loading} error={error} />

          {article.sourceUrl && (
            <Anchor href={article.sourceUrl} target="_blank" rel="noopener noreferrer" size="sm">
              <Group gap={4}>
                Open Original <IconExternalLink size={12} />
              </Group>
            </Anchor>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
