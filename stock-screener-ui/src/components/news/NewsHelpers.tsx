import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  CloseButton,
  Divider,
  Group,
  Loader,
  ScrollArea,
  Select,
  Stack,
  Text,
  Title,
  ToolbarRow,
  Tooltip,
} from "@/ui";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import MuiListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MuiDivider from "@mui/material/Divider";
import MuiCollapse from "@mui/material/Collapse";
import Skeleton from "@mui/material/Skeleton";
import MuiAlert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import Toolbar from "@mui/material/Toolbar";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  IconArrowLeft,
  IconChartLine,
  IconExternalLink,
  IconNews,
  IconRefresh,
} from "@tabler/icons-react";
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
      <Text size="sm" c="dimmed" mb="xs">
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
              size="sm"
              variant="light"
              color={symbol.instrument_key ? "primary" : "secondary"}
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
        sx={{ borderBottom: 1, borderColor: "divider" }}
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
}: {
  item: NewsItem;
  isUnread: boolean;
  selected?: boolean;
  meta?: ReactNode;
  testId?: string;
  onClick: (item: NewsItem) => void;
}) {
  return (
    <ListItem disablePadding>
      <MuiListItemButton
        selected={selected}
        onClick={() => onClick(item)}
        aria-label={item.headline}
        className={`news-item-card ${isUnread ? "unread" : ""}`}
        data-testid={testId}
        sx={{ alignItems: "flex-start", gap: 1, py: 1 }}
      >
        <ListItemIcon sx={{ minWidth: 20, mt: 0.5, justifyContent: "center" }}>
          {isUnread ? (
            <FiberManualRecordIcon sx={{ fontSize: 8 }} color="primary" aria-hidden="true" />
          ) : null}
        </ListItemIcon>
        <ListItemText
          primary={item.headline}
          secondary={
            <>
              {meta}
              <Typography variant="caption" className="news-item-meta">
                {formatTimeAgo(item.publishedAt)}
              </Typography>
            </>
          }
          slotProps={{
            primary: {
              variant: "body2",
              fontWeight: isUnread ? 600 : 400,
              noWrap: true,
              className: "news-item-headline",
            },
            secondary: { component: "div", variant: "caption" },
          }}
        />
      </MuiListItemButton>
    </ListItem>
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
}: {
  source: string;
  items: NewsItem[];
  isExpanded: boolean;
  readIds: Set<string>;
  onToggle: () => void;
  onItemClick: (item: NewsItem) => void;
  renderItem?: (item: NewsItem, isUnread: boolean) => ReactNode;
  itemTestId?: string;
}) {
  return (
    <Box component="li" className="news-source-group" sx={{ listStyle: "none" }}>
      <ListItem disablePadding>
        <MuiListItemButton
          onClick={onToggle}
          aria-expanded={isExpanded}
          data-testid={`news-source-group-${source}`}
          sx={{ borderRadius: 1 }}
        >
          <ListItemText
            primary={source}
            secondary={`${items.length} ${items.length === 1 ? "article" : "articles"}`}
            slotProps={{
              primary: {
                variant: "subtitle2",
                sx: { textTransform: "uppercase", fontWeight: 700 },
              },
              secondary: { variant: "caption" },
            }}
          />
          {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </MuiListItemButton>
      </ListItem>

      <MuiCollapse in={isExpanded} timeout="auto" unmountOnExit>
        <List dense disablePadding sx={{ py: 0.5 }}>
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
              />
            );
          })}
        </List>
      </MuiCollapse>
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
}) {
  if (loading && newsItems.length === 0) {
    return (
      <Box sx={{ p: 2 }} data-testid="news-loading">
        <Stack spacing={1}>
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} variant="rounded" height={64} />
          ))}
          <Typography variant="body2" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Loader size="sm" />
            Loading news...
          </Typography>
        </Stack>
      </Box>
    );
  }
  if (error) {
    return (
      <MuiAlert severity="error" sx={{ m: 1 }} data-testid="news-error">
        {error}
      </MuiAlert>
    );
  }
  if (newsItems.length === 0) {
    return (
      <Box sx={{ px: 2, py: 4, textAlign: "center" }} data-testid="news-empty">
        <IconNews size={32} aria-hidden="true" />
        <Typography variant="subtitle1" fontWeight={600} sx={{ mt: 1 }}>
          No news available
        </Typography>
        <Typography variant="body2" color="text.secondary">
          New articles will appear here when sources publish them.
        </Typography>
      </Box>
    );
  }
  const visibleSources = sourceNames.filter(
    (source) => selectedSource === "all" || selectedSource === source,
  );
  return (
    <List dense disablePadding className="news-source-groups" sx={{ width: "100%" }}>
      {visibleSources.map((source, index) => (
        <Box component="li" key={source} sx={{ listStyle: "none" }}>
          <NewsSourceGroup
            source={source}
            items={groupedNewsItems[source]}
            isExpanded={expandedSources.has(source)}
            readIds={readIds}
            onToggle={() => onToggleSource(source)}
            onItemClick={onArticleClick}
            renderItem={(item, isUnread) => (
              <NewsItemCard
                item={item}
                isUnread={isUnread}
                selected={selectedArticleId != null && selectedArticleId === item.id}
                meta={renderItemMeta?.(item)}
                testId={itemTestId}
                onClick={onArticleClick}
              />
            )}
          />
          {index < visibleSources.length - 1 ? <MuiDivider component="li" /> : null}
        </Box>
      ))}
    </List>
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
      <Toolbar variant="dense" disableGutters sx={{ px: 1, gap: 1 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ textTransform: "uppercase" }}>
          News
        </Typography>
        {wsConnected && (
          <Tooltip label="Live updates connected">
            <FiberManualRecordIcon
              color="success"
              sx={{ fontSize: 8 }}
              data-testid="news-ws-indicator"
            />
          </Tooltip>
        )}
        {isRefreshing && <Loader size="sm" />}
        <Box sx={{ flexGrow: 1 }} />
        <IconButton
          edge="end"
          size="small"
          aria-label="Close news panel"
          onClick={onClose}
          className="news-close-btn"
          data-testid="news-close-btn"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Toolbar>
      <MuiDivider />
    </Box>
  );
}
