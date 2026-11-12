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
import { IconArrowLeft, IconChartLine, IconChevronDown, IconChevronUp, IconExternalLink, IconNews, IconRefresh, IconX } from "../common/Icons";
import { For, Show, Switch, Match, type JSX } from "solid-js";
import type { NewsItem, NewsSymbol, ArticleResponse } from "./news-types";
import { AUTO_REFRESH_INTERVALS } from "./NewsLocalStorage";
import { formatTimeAgo } from "../../utils/ui-helpers";

function ArticleSymbols(props: {
  symbols: NewsSymbol[];
  onSymbolClick: (s: NewsSymbol) => void;
}) {
  return (
    <Show when={props.symbols && props.symbols.length > 0}>

    <Box data-testid="news-article-symbols">
      <Text size="sm" c="dimmed" style={{ marginBottom: 4 }}>
        Stocks mentioned:
      </Text>
      <Group gap="xs" align="center">
        <For each={props.symbols}>{(symbol) => (
          <Tooltip
            label={
              symbol.instrument_key
                ? `View ${symbol.trading_symbol} chart`
                : `Open ${symbol.code} on Moneycontrol`
            }
          >
            <Badge
              variant="light"
              color={symbol.instrument_key ? "primary" : "secondary"}
              onClick={() => props.onSymbolClick(symbol)}
              data-testid={`news-symbol-${symbol.code}`}
              style={{ cursor: "pointer" }}
            >
              {symbol.name || symbol.code}
              <Show when={symbol.instrument_key}>
                <IconChartLine size={12} style={{ marginLeft: 4 }} />
              </Show>
            </Badge>
          </Tooltip>
        )}</For>
      </Group>
    </Box>
    </Show>
  );
}

function ArticleBody(props: {
  content: ArticleResponse | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <Switch fallback={
      <Text c="dimmed" ta="center" py="xl">
        Unable to load article content.
      </Text>
    }>
      <Match when={props.loading}>
        <Group justify="center" align="center" py="xl">
          <Loader size="sm" />
          <Text c="dimmed">Loading article...</Text>
        </Group>
      </Match>
      <Match when={props.content?.description}>
        {(description) => (
          <Stack gap="sm">
            <For each={String(description()).split("\n\n")}>{(para, idx) => (
              <Text size="sm">
                {para}
              </Text>
            )}</For>
          </Stack>
        )}
      </Match>
      <Match when={props.error}>
        <Alert color="error" variant="light" title="Failed to load article">
          <Text size="sm">{props.error}</Text>
        </Alert>
      </Match>
    </Switch>
  );
}

export function ArticleView(props: {
  article: NewsItem;
  content: ArticleResponse | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onClose: () => void;
  onSymbolClick: (s: NewsSymbol) => void;
  onRetryArticle?: () => void;
}) {
  const article = () => props.article;
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
          onClick={props.onBack}
          data-testid="news-article-back-btn"
        >
          Back
        </Button>
        <CloseButton onClick={props.onClose} />
      </Group>

      <ScrollArea flex={1} p="sm" className="news-article-content">
        <Stack gap="sm">
          <Title order={4} data-testid="news-article-headline">
            {props.article.headline}
          </Title>

          <Text size="sm" c="dimmed" data-testid="news-article-meta">
            {props.content?.source || props.article.source} |{" "}
            {formatTimeAgo(props.content?.publishedAt || props.article.publishedAt)}
          </Text>

          <ArticleSymbols symbols={props.content?.symbols ?? []} onSymbolClick={props.onSymbolClick} />

          <Divider />

          <ArticleBody content={props.content} loading={props.loading} error={props.error} />

          <Show when={!props.loading && props.error && props.onRetryArticle}>
            <Group justify="flex-start" align="center">
              <Button
                size="xs"
                variant="light"
                onClick={props.onRetryArticle}
                data-testid="news-article-retry-btn"
              >
                Retry
              </Button>
            </Group>
          </Show>

          <Show when={props.article.sourceUrl}>
            <Anchor href={props.article.sourceUrl} target="_blank" rel="noopener noreferrer" size="sm">
              <Group gap={4} align="center">
                Open Original <IconExternalLink size={12} />
              </Group>
            </Anchor>
          </Show>
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

export function NewsItemCard(props: {
  item: NewsItem;
  isUnread: boolean;
  selected?: boolean;
  meta?: JSX.Element;
  testId?: string;
  onClick: (item: NewsItem) => void;
  variant?: "default" | "desk";
}) {
  const item = () => props.item;
  const isUnread = () => props.isUnread;
  const selected = () => props.selected ?? false;
  const isDesk = () => (props.variant ?? "default") === "desk";
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={() => props.onClick(item())}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onClick(item());
        }
      }}
      className={`news-item-card ${isUnread() ? "unread" : ""} flex items-start gap-4 cursor-pointer`}
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
              borderLeft: `3px solid ${selected() ? palette.PRIMARY : "transparent"}`,
              transitionProperty: "background-color, border-color, transform",
              transitionDuration: "120ms",
            }
          : { paddingTop: 8, paddingBottom: 8 }),
      }}
      aria-label={item().headline}
      aria-current={selected() ? "true" : undefined}
      data-testid={props.testId ?? "news-item"}
    >
      <Box className="shrink-0" style={{ marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Show when={isUnread()}>
          <Box style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: palette.PRIMARY }} />
        </Show>
      </Box>
      <Box style={{ minWidth: 0 }}>
        <Text
          size="sm"
          fw={isUnread() ? 600 : 400}
          className="news-item-headline"
          style={{
            display: isDesk() ? "-webkit-box" : undefined,
            "-webkit-box-orient": isDesk() ? "vertical" : undefined,
            "-webkit-line-clamp": isDesk() ? 2 : undefined,
            overflow: isDesk() ? "hidden" : undefined,
            lineHeight: isDesk() ? 1.35 : undefined,
            paddingRight: isDesk() ? 4 : undefined,
            whiteSpace: isDesk() ? "nowrap" : undefined,
          }}
        >
          {item().headline}
        </Text>
        <Box className="flex items-center justify-between gap-4 min-h-[18px]" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 18 }}>
          <Box component="span" style={{ minWidth: 0 }}>
            {props.meta}
          </Box>
          <Text size="xs" c="dimmed" className="news-item-meta" style={{ flex: "0 0 auto", fontVariantNumeric: "tabular-nums", marginTop: isDesk() ? 4 : 0 }}>
            {formatTimeAgo(item().publishedAt)}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

export function NewsSourceGroup(props: {
  source: string;
  items: NewsItem[];
  isExpanded: boolean;
  readIds: Set<string>;
  onToggle: () => void;
  onItemClick: (item: NewsItem) => void;
  renderItem?: (item: NewsItem, isUnread: boolean) => JSX.Element;
  itemTestId?: string;
  variant?: "default" | "desk";
}) {
  const isDesk = () => (props.variant ?? "default") === "desk";
  return (
    <Box component={isDesk() ? "section" : "div"} className="news-source-group list-none">
      <Box role="button" tabIndex={0} onClick={props.onToggle} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onToggle(); } }} aria-expanded={props.isExpanded} data-testid={`news-source-group-${props.source}`} className="flex items-center gap-2 cursor-pointer" style={isDesk() ? { position: "sticky", top: 0, zIndex: 1, minHeight: 36, paddingLeft: 12, paddingRight: 12, borderRadius: 0, borderTop: `1px solid ${palette.BORDER}`, backgroundColor: palette.BG, transitionProperty: "background-color", transitionDuration: "120ms" } : { borderRadius: 8 }}>
        <Text size="sm" fw={700} style={{ textTransform: "uppercase" }}>
          {props.source}
        </Text>
        <Text size="xs" c="dimmed">
          {props.items.length} {props.items.length === 1 ? "article" : "articles"}
        </Text>
        <Box style={{ flex: 1 }} />
        <Show when={props.isExpanded} fallback={<IconChevronDown size={12} />}><IconChevronUp size={12} /></Show>
      </Box>

      <Collapse in={props.isExpanded}>
        <Box style={isDesk() ? { paddingTop: 0, paddingBottom: 0 } : { paddingTop: 4, paddingBottom: 4 }}>
          <For each={props.items}>{(item) => {
            const isUnread = !props.readIds.has(item.id);
            return props.renderItem ? (
              props.renderItem(item, isUnread)
            ) : (
              <NewsItemCard
                item={item}
                isUnread={isUnread}
                testId={props.itemTestId}
                onClick={props.onItemClick}
                variant={props.variant}
              />
            );
          }}</For>
        </Box>
      </Collapse>
    </Box>
  );
}

export function NewsFilterControls(props: {
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
        value={props.selectedSource}
        onChange={(v) => v && props.onSourceChange(v)}
        data={props.sourceData}
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
              onClick={props.onRefresh}
              loading={props.loading}
              disabled={props.loading || props.isRefreshing}
              className="news-refresh-btn"
              data-testid="news-refresh-btn"
            >
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
          <Select
            size="sm"
            value={props.autoRefreshMs}
            onChange={(v) => v && props.onAutoRefreshChange(v)}
            data={AUTO_REFRESH_INTERVALS}
            w={96}
            data-testid="news-auto-refresh-select"
          />
        </Group>
        <Show when={props.unreadCount > 0}>
          <Badge
            size="sm"
            variant="light"
            color="primary"
            onClick={props.onMarkAllRead}
            data-testid="news-unread-badge"
            style={{ cursor: "pointer" }}
          >
            {props.unreadCount} unread
          </Badge>
        </Show>
      </ToolbarRow>
    </Stack>
  );
}

const normalizeNewsSource = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

export function NewsListContent(props: {
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
  renderItemMeta?: (item: NewsItem) => JSX.Element;
  itemTestId?: string;
  variant?: "default" | "desk";
}) {
  const visibleSources = () => {
    const normalizedSelectedSource = normalizeNewsSource(props.selectedSource);
    return props.sourceNames.filter(
      (source) => props.selectedSource === "all" || normalizeNewsSource(source) === normalizedSelectedSource,
    );
  };
  const isDesk = () => (props.variant ?? "default") === "desk";

  return (
    <Switch fallback={
      <Box component={isDesk() ? "section" : undefined} className="news-source-groups" style={{ width: "100%" }} aria-label="News stories by source">
        <For each={visibleSources()}>{(source, index) => (
          <Box component={isDesk() ? "section" : "li"} style={{ listStyle: "none" }}>
            <NewsSourceGroup
              source={source}
              items={props.groupedNewsItems[source]}
              isExpanded={props.expandedSources.has(source)}
              readIds={props.readIds}
              onToggle={() => props.onToggleSource(source)}
              onItemClick={props.onArticleClick}
              variant={props.variant}
              renderItem={(item, isUnread) => (
                <NewsItemCard
                  item={item}
                  isUnread={isUnread}
                  selected={props.selectedArticleId != null && props.selectedArticleId === item.id}
                  meta={props.renderItemMeta?.(item)}
                  testId={props.itemTestId}
                  onClick={props.onArticleClick}
                  variant={props.variant}
                />
              )}
            />
            <Show when={!isDesk() && index() < visibleSources().length - 1}>
              <Divider orientation="horizontal" />
            </Show>
          </Box>
        )}</For>
      </Box>
    }>
      <Match when={props.loading && props.newsItems.length === 0}>
        <Box style={{ padding: 16 }} data-testid="news-loading">
          <Stack className="gap-2">
            <For each={[0, 1, 2]}>{(row) => (
              <Skeleton h={64} radius="sm" visible />
            )}</For>
            <Text size="sm" c="dimmed" className="flex items-center gap-4">
              <Loader size="sm" />
              Loading news...
            </Text>
          </Stack>
        </Box>
      </Match>
      <Match when={props.error}>
        <Alert color="error" style={{ margin: 8 }} data-testid="news-error">
          {props.error}
        </Alert>
      </Match>
      <Match when={props.newsItems.length === 0}>
        <Box style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 32, paddingBottom: 32, textAlign: "center" }} data-testid="news-empty">
          <IconNews size={32} aria-hidden="true" />
          <Text size="sm" fw={600} style={{ marginTop: 8 }}>
            No news available
          </Text>
          <Text size="sm" c="dimmed">
            New articles will appear here when sources publish them.
          </Text>
        </Box>
      </Match>
    </Switch>
  );
}

export function NewsListHeader(props: {
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
        <Show when={props.wsConnected}>
          <Tooltip label="Live updates connected">
            <Box style={{ color: palette.POSITIVE, fontSize: 8 }}>
              <Box style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: palette.POSITIVE }} />
            </Box>
          </Tooltip>
        </Show>
        <Show when={props.isRefreshing}>
          <Loader size="sm" />
        </Show>
        <Box style={{ flexGrow: 1 }} />
        <ActionIcon
          size="small"
          aria-label="Close news panel"
          onClick={props.onClose}
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
