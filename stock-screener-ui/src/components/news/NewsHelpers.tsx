import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  CloseButton,
  Collapse,
  Divider,
  Group,
  Loader,
  ScrollArea,
  Select,
  Skeleton,
  Stack,
  Text,
  Title,
  ToolbarRow,
  Tooltip,
} from "@/ui";
import * as palette from "@/ui/palette";
import { IconArrowLeft, IconChartLine, IconChevronDown, IconChevronUp, IconExternalLink, IconNews, IconRefresh, IconX } from "@tabler/icons-react";
import { Fragment } from "react";
import type { ReactNode } from "react";
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
      <Text size="sm" c="dimmed" style={{ marginBottom: 4 }}>
        Stocks mentioned:
      </Text>
      <Group gap="xs" align="center">
        {symbols.map((symbol) => (
          <Tooltip
            key={symbol.code}
            label={
              symbol.instrument_key
                ? `View ${symbol.trading_symbol} chart`
                : `Open ${symbol.code} on Moneycontrol`
            }
          >
            <Badge
              variant="light"
              color={symbol.instrument_key ? "primary" : "secondary"}
              onClick={() => onSymbolClick(symbol)}
              data-testid={`news-symbol-${symbol.code}`}
              style={{ cursor: "pointer" }}
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
      <Group justify="center" align="center" py="xl">
        <Loader size="sm" />
        <Text c="dimmed">Loading article...</Text>
      </Group>
    );
  }
  if (content?.description) {
    return (
      <Stack gap="sm">
        {content.description.split("\n\n").map((para, idx) => (
          <Text key={`${idx}-${para.slice(0, 40)}`} size="sm">
            {para}
          </Text>
        ))}
      </Stack>
    );
  }
  if (error) {
    return (
      <Alert color="error" variant="light" title="Failed to load article">
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
  onRetryArticle,
}: {
  article: NewsItem;
  content: ArticleResponse | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onClose: () => void;
  onSymbolClick: (s: NewsSymbol) => void;
  onRetryArticle?: () => void;
}) {
  return (
    <Stack gap={0} h="100%" className="news-article-view" data-testid="news-article-view">
      <Group
        p="sm"
        justify="space-between"
        align="center"
        className="news-article-header"
        style={{ borderBottom: `1px solid ${/* divider */ "" }`, borderBottomColor: "" }}
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

          {!loading && error && onRetryArticle && (
            <Group justify="flex-start" align="center">
              <Button
                size="xs"
                variant="light"
                onClick={onRetryArticle}
                data-testid="news-article-retry-btn"
              >
                Retry
              </Button>
            </Group>
          )}

          {article.sourceUrl && (
            <Anchor href={article.sourceUrl} target="_blank" rel="noopener noreferrer" size="sm">
              <Group gap={4} align="center">
                Open Original <IconExternalLink size={12} />
              </Group>
            </Anchor>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

export function NewsItemCard({
  item,
  isUnread,
  selected = false,
  meta,
  testId = "news-item",
  onClick,
  variant = "default",
}: {
  item: NewsItem;
  isUnread: boolean;
  selected?: boolean;
  meta?: ReactNode;
  testId?: string;
  onClick: (item: NewsItem) => void;
  variant?: "default" | "desk";
}) {
  const isDesk = variant === "desk";
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={() => onClick(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick(item);
        }
      }}
      className={`news-item-card ${isUnread ? "unread" : ""} flex items-start gap-4 cursor-pointer`}
      style={{
        alignItems: "flex-start",
        gap: 8,
        ...(isDesk
          ? {
              minHeight: 64,
              paddingLeft: 12,
              paddingRight: 12,
              paddingTop: 8,
              paddingBottom: 8,
              borderRadius: 0,
              borderLeft: `3px solid ${selected ? palette.PRIMARY : "transparent"}`,
              transitionProperty: "background-color, border-color, transform",
              transitionDuration: "120ms",
            }
          : { paddingTop: 8, paddingBottom: 8 }),
      }}
      aria-label={item.headline}
      aria-current={selected ? "true" : undefined}
      data-testid={testId}
    >
      <Box className="shrink-0" style={{ marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {isUnread ? (
          <Box style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: palette.PRIMARY }} />
        ) : null}
      </Box>
      <Box style={{ minWidth: 0 }}>
        <Text
          size="sm"
          fw={isUnread ? 600 : 400}
          className="news-item-headline"
          style={{
            display: isDesk ? "-webkit-box" : undefined,
            WebkitBoxOrient: isDesk ? "vertical" : undefined,
            WebkitLineClamp: isDesk ? 2 : undefined,
            overflow: isDesk ? "hidden" : undefined,
            lineHeight: isDesk ? 1.35 : undefined,
            paddingRight: isDesk ? 4 : undefined,
            whiteSpace: isDesk ? "nowrap" : undefined,
          }}
        >
          {item.headline}
        </Text>
        <Box className="flex items-center justify-between gap-4 min-h-[18px]" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 18 }}>
          <Box component="span" style={{ minWidth: 0 }}>
            {meta}
          </Box>
          <Text size="xs" c="dimmed" className="news-item-meta" style={{ flex: "0 0 auto", fontVariantNumeric: "tabular-nums", marginTop: isDesk ? 4 : 0 }}>
            {formatTimeAgo(item.publishedAt)}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

export function NewsSourceGroup({
  source,
  items,
  isExpanded,
  readIds,
  onToggle,
  onItemClick,
  renderItem,
  itemTestId,
  variant = "default",
}: {
  source: string;
  items: NewsItem[];
  isExpanded: boolean;
  readIds: Set<string>;
  onToggle: () => void;
  onItemClick: (item: NewsItem) => void;
  renderItem?: (item: NewsItem, isUnread: boolean) => ReactNode;
  itemTestId?: string;
  variant?: "default" | "desk";
}) {
  const isDesk = variant === "desk";
  return (
    <Box component={isDesk ? "section" : "div"} className="news-source-group list-none">
      <Box role="button" tabIndex={0} onClick={onToggle} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }} aria-expanded={isExpanded} data-testid={`news-source-group-${source}`} className="flex items-center gap-2 cursor-pointer" style={isDesk ? { position: "sticky", top: 0, zIndex: 1, minHeight: 36, paddingLeft: 12, paddingRight: 12, borderRadius: 0, borderTop: `1px solid ${palette.BORDER}`, backgroundColor: palette.BG, transitionProperty: "background-color", transitionDuration: "120ms" } : { borderRadius: 8 }}>
        <Text size="sm" fw={700} style={{ textTransform: "uppercase" }}>
          {source}
        </Text>
        <Text size="xs" c="dimmed">
          {items.length} {items.length === 1 ? "article" : "articles"}
        </Text>
        <Box style={{ flex: 1 }} />
        {isExpanded ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
      </Box>

      <Collapse in={isExpanded}>
        <Box style={isDesk ? { paddingTop: 0, paddingBottom: 0 } : { paddingTop: 4, paddingBottom: 4 }}>
          {items.map((item) => {
            const isUnread = !readIds.has(item.id);
            if (renderItem) return <Fragment key={item.id}>{renderItem(item, isUnread)}</Fragment>;
            return (
              <NewsItemCard
                key={item.id}
                item={item}
                isUnread={isUnread}
                testId={itemTestId}
                onClick={onItemClick}
                variant={variant}
              />
            );
          })}
        </Box>
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
    <Stack gap={8}>
      <Select
        size="sm"
        value={selectedSource}
        onChange={(v) => v && onSourceChange(v)}
        data={sourceData}
        style={{ width: "100%" }}
        className="news-source-select"
        data-testid="news-source-select"
      />
      <ToolbarRow gap={8} justify="space-between">
        <Group gap="xs" align="center">
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
            w={96}
            data-testid="news-auto-refresh-select"
          />
        </Group>
        {unreadCount > 0 && (
          <Badge
            size="sm"
            variant="light"
            color="primary"
            onClick={onMarkAllRead}
            data-testid="news-unread-badge"
            style={{ cursor: "pointer" }}
          >
            {unreadCount} unread
          </Badge>
        )}
      </ToolbarRow>
    </Stack>
  );
}

const normalizeNewsSource = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

export function NewsListContent({
  loading,
  error,
  newsItems,
  selectedSource,
  selectedArticleId,
  sourceNames,
  groupedNewsItems,
  expandedSources,
  readIds,
  onToggleSource,
  onArticleClick,
  renderItemMeta,
  itemTestId,
  variant = "default",
}: {
  loading: boolean;
  error: string | null;
  newsItems: NewsItem[];
  selectedSource: string;
  selectedArticleId?: string | null;
  sourceNames: string[];
  groupedNewsItems: Record<string, NewsItem[]>;
  expandedSources: Set<string>;
  readIds: Set<string>;
  onToggleSource: (source: string) => void;
  onArticleClick: (item: NewsItem) => void;
  renderItemMeta?: (item: NewsItem) => ReactNode;
  itemTestId?: string;
  variant?: "default" | "desk";
}) {
  if (loading && newsItems.length === 0) {
    return (
      <Box style={{ padding: 16 }} data-testid="news-loading">
        <Stack className="gap-2">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} variant="rounded" h={64} />
          ))}
          <Text size="sm" c="dimmed" className="flex items-center gap-4">
            <Loader size="sm" />
            Loading news...
          </Text>
        </Stack>
      </Box>
    );
  }
  if (error) {
    return (
      <Alert color="error" style={{ margin: 8 }} data-testid="news-error">
        {error}
      </Alert>
    );
  }
  if (newsItems.length === 0) {
    return (
      <Box style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 32, paddingBottom: 32, textAlign: "center" }} data-testid="news-empty">
        <IconNews size={32} aria-hidden="true" />
        <Text size="sm" fw={600} style={{ marginTop: 8 }}>
          No news available
        </Text>
        <Text size="sm" c="dimmed">
          New articles will appear here when sources publish them.
        </Text>
      </Box>
    );
  }
  const normalizedSelectedSource = normalizeNewsSource(selectedSource);
  const visibleSources = sourceNames.filter(
    (source) => selectedSource === "all" || normalizeNewsSource(source) === normalizedSelectedSource,
  );
  const isDesk = variant === "desk";
  return (
    <Box component={isDesk ? "section" : undefined} className="news-source-groups" style={{ width: "100%" }} aria-label="News stories by source">
      {visibleSources.map((source, index) => (
        <Box component={isDesk ? "section" : "li"} key={source} style={{ listStyle: "none" }}>
          <NewsSourceGroup
            source={source}
            items={groupedNewsItems[source]}
            isExpanded={expandedSources.has(source)}
            readIds={readIds}
            onToggle={() => onToggleSource(source)}
            onItemClick={onArticleClick}
            variant={variant}
            renderItem={(item, isUnread) => (
              <NewsItemCard
                item={item}
                isUnread={isUnread}
                selected={selectedArticleId != null && selectedArticleId === item.id}
                meta={renderItemMeta?.(item)}
                testId={itemTestId}
                onClick={onArticleClick}
                variant={variant}
              />
            )}
          />
          {!isDesk && index < visibleSources.length - 1 ? <Divider orientation="horizontal" /> : null}
        </Box>
      ))}
    </Box>
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
    <Box id="news-panel-header" data-testid="news-panel-header">
      <ToolbarRow style={{ paddingLeft: 8, gap: 8 }}>
        <Text size="sm" fw={700} style={{ textTransform: "uppercase" }}>
          News
        </Text>
        {wsConnected && (
          <Tooltip label="Live updates connected">
            <Box style={{ color: palette.POSITIVE, fontSize: 8 }}>
              <Box style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: palette.POSITIVE }} />
            </Box>
          </Tooltip>
        )}
        {isRefreshing && <Loader size="sm" />}
        <Box style={{ flexGrow: 1 }} />
        <ActionIcon
          size="small"
          aria-label="Close news panel"
          onClick={onClose}
          className="news-close-btn"
          data-testid="news-close-btn"
          variant="subtle"
        >
          <IconX size={12} />
        </ActionIcon>
      </ToolbarRow>
      <Divider />
    </Box>
  );
}
