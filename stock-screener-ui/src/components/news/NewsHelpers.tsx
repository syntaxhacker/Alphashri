import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  CloseButton,
  Collapse,
  Divider,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconChartLine,
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconRefresh,
} from "@tabler/icons-react";
import type { NewsItem, NewsSymbol, ArticleResponse } from "./news-types";
import { AUTO_REFRESH_INTERVALS } from "./NewsLocalStorage";
import { formatTimeAgo } from "../../utils/ui-helpers";

function ArticleSymbols({
  symbols,
  onSymbolClick,
}: {
  symbols: NewsSymbol[];
  onSymbolClick: (s: NewsSymbol) => void;
}) {
  if (!symbols || symbols.length === 0) return null;
  return (
    <Box data-testid="news-article-symbols">
      <Text size="sm" c="dimmed" mb="xs">
        Stocks mentioned:
      </Text>
      <Group gap="xs">
        {symbols.map((symbol, idx) => (
          <Tooltip
            key={idx}
            label={
              symbol.instrument_key
                ? `View ${symbol.trading_symbol} chart`
                : `Open ${symbol.code} on Moneycontrol`
            }
          >
            <Badge
              variant="light"
              color={symbol.instrument_key ? "blue" : "gray"}
              onClick={() => onSymbolClick(symbol)}
              data-testid={`news-symbol-${symbol.code}`}
            >
              {symbol.name || symbol.code}
              {symbol.instrument_key && <IconChartLine size={12} style={{ marginLeft: 4 }} />}
            </Badge>
          </Tooltip>
        ))}
      </Group>
    </Box>
  );
}

function ArticleBody({
  content,
  loading,
  error,
}: {
  content: ArticleResponse | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <Group justify="center" py="xl">
        <Loader size="sm" />
        <Text c="dimmed">Loading article...</Text>
      </Group>
    );
  }
  if (content?.description) {
    return (
      <Stack gap="sm">
        {content.description.split("\n\n").map((para, idx) => (
          <Text key={idx} size="sm">
            {para}
          </Text>
        ))}
      </Stack>
    );
  }
  if (error) {
    return (
      <Alert color="red" variant="light" title="Failed to load article">
        <Text size="sm">{error}</Text>
      </Alert>
    );
  }
  return (
    <Text c="dimmed" ta="center" py="xl">
      Unable to load article content.
    </Text>
  );
}

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

function NewsItemCard({
  item,
  isUnread,
  onClick,
}: {
  item: NewsItem;
  isUnread: boolean;
  onClick: (item: NewsItem) => void;
}) {
  return (
    <Card
      padding="xs"
      className={`news-item-card ${isUnread ? "unread" : ""}`}
      style={{
        borderLeft: isUnread ? "3px solid var(--mantine-color-blue-6)" : undefined,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(item);
      }}
      data-testid="news-item"
    >
      <Group gap="xs" wrap="nowrap">
        {isUnread && <Box w={5} h={5} bg="blue" style={{ borderRadius: "50%", flexShrink: 0 }} />}
        <Text
          size="xs"
          fw={isUnread ? 500 : 400}
          lineClamp={1}
          className="news-item-headline"
          flex={1}
        >
          {item.headline}
        </Text>
        <Text size="xs" c="dimmed" className="news-item-meta">
          {formatTimeAgo(item.publishedAt)}
        </Text>
      </Group>
    </Card>
  );
}

function NewsSourceGroup({
  source,
  items,
  isExpanded,
  readIds,
  onToggle,
  onItemClick,
}: {
  source: string;
  items: NewsItem[];
  isExpanded: boolean;
  readIds: Set<string>;
  onToggle: () => void;
  onItemClick: (item: NewsItem) => void;
}) {
  return (
    <Box className="news-source-group">
      <Group
        gap="xs"
        p="xs"
        style={{
          borderRadius: "var(--mantine-radius-sm)",
          backgroundColor: "var(--mantine-color-default-hover)",
        }}
        onClick={onToggle}
        data-testid={`news-source-group-${source}`}
      >
        {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        <Text size="sm" fw={600} tt="uppercase">
          {source}
        </Text>
        <Badge size="xs" variant="light" color="gray">
          {items.length}
        </Badge>
      </Group>

      <Collapse in={isExpanded}>
        <Stack gap={4} mt="xs">
          {items.map((item) => (
            <NewsItemCard
              key={item.id}
              item={item}
              isUnread={!readIds.has(item.id)}
              onClick={onItemClick}
            />
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}

export function NewsFilterControls({
  sourceData,
  selectedSource,
  autoRefreshMs,
  loading,
  isRefreshing,
  unreadCount,
  onSourceChange,
  onRefresh,
  onAutoRefreshChange,
  onMarkAllRead,
}: {
  sourceData: { value: string; label: string }[];
  selectedSource: string;
  autoRefreshMs: string;
  loading: boolean;
  isRefreshing: boolean;
  unreadCount: number;
  onSourceChange: (v: string) => void;
  onRefresh: () => void;
  onAutoRefreshChange: (v: string) => void;
  onMarkAllRead: () => void;
}) {
  return (
    <Group gap="xs">
      <Select
        size="sm"
        value={selectedSource}
        onChange={(v) => v && onSourceChange(v)}
        data={sourceData}
        flex={1}
        className="news-source-select"
        data-testid="news-source-select"
      />

      <Tooltip label="Refresh">
        <ActionIcon
          variant="light"
          size="sm"
          onClick={onRefresh}
          loading={loading}
          disabled={loading || isRefreshing}
          className="news-refresh-btn"
          data-testid="news-refresh-btn"
        >
          <IconRefresh size={14} />
        </ActionIcon>
      </Tooltip>

      <Select
        size="sm"
        value={autoRefreshMs}
        onChange={(v) => v && onAutoRefreshChange(v)}
        data={AUTO_REFRESH_INTERVALS}
        w={60}
        data-testid="news-auto-refresh-select"
      />

      {unreadCount > 0 && (
        <Badge variant="light" color="blue" onClick={onMarkAllRead} data-testid="news-unread-badge">
          {unreadCount} unread
        </Badge>
      )}
    </Group>
  );
}

export function NewsListContent({
  loading,
  error,
  newsItems,
  selectedSource,
  sourceNames,
  groupedNewsItems,
  expandedSources,
  readIds,
  onToggleSource,
  onArticleClick,
}: {
  loading: boolean;
  error: string | null;
  newsItems: NewsItem[];
  selectedSource: string;
  sourceNames: string[];
  groupedNewsItems: Record<string, NewsItem[]>;
  expandedSources: Set<string>;
  readIds: Set<string>;
  onToggleSource: (source: string) => void;
  onArticleClick: (item: NewsItem) => void;
}) {
  if (loading && newsItems.length === 0) {
    return (
      <Group justify="center" py="xl" data-testid="news-loading">
        <Loader size="sm" />
        <Text c="dimmed">Loading news...</Text>
      </Group>
    );
  }
  if (error) {
    return (
      <Text c="red" ta="center" py="xl" data-testid="news-error">
        {error}
      </Text>
    );
  }
  if (newsItems.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="xl" data-testid="news-empty">
        No news available
      </Text>
    );
  }
  return (
    <Stack gap="xs" className="news-source-groups">
      {sourceNames.map((source) => {
        const items = groupedNewsItems[source];
        const isExpanded = expandedSources.has(source);
        if (selectedSource !== "all" && selectedSource !== source) return null;
        return (
          <NewsSourceGroup
            key={source}
            source={source}
            items={items}
            isExpanded={isExpanded}
            readIds={readIds}
            onToggle={() => onToggleSource(source)}
            onItemClick={onArticleClick}
          />
        );
      })}
    </Stack>
  );
}

export function NewsListHeader({
  wsConnected,
  isRefreshing,
  onClose,
}: {
  wsConnected: boolean;
  isRefreshing: boolean;
  onClose: () => void;
}) {
  return (
    <Paper withBorder p="sm" mb="xs" id="news-panel-header" data-testid="news-panel-header">
      <Group justify="space-between">
        <Group gap="xs">
          <Text fw={600}>NEWS</Text>
          {wsConnected && (
            <Tooltip label="Live updates connected">
              <Box
                w={6}
                h={6}
                bg="green"
                style={{ borderRadius: "50%" }}
                data-testid="news-ws-indicator"
              />
            </Tooltip>
          )}
          {isRefreshing && <Loader size="sm" />}
        </Group>
        <CloseButton onClick={onClose} className="news-close-btn" data-testid="news-close-btn" />
      </Group>
    </Paper>
  );
}
