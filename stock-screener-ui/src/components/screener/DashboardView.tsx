import { For, Show, Switch, Match, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Chip,
  Menu,
  MenuDropdown,
  MenuItem,
  MenuTarget,
  SegmentedControl,
  Skeleton,
  Text,
  TextInput,
  ToolbarRow,
} from "@/ui";
import { fetchScreenerDashboard } from "../../api/screenerDashboard";
import type {
  ScreenerDashboardPanel,
  ScreenerDashboardResponse,
  ScreenerDashboardRow,
} from "../../types/screenerDashboard";
import { CompactPanel } from "../common/compact";
import {
  formatCurrency,
  formatNumber,
  formatPercentage,
  formatTimeOnly,
  getPnLTextColor,
} from "../../utils/ui-helpers";
import { Sparkline } from "./Sparkline";
import { SymbolAvatar } from "./SymbolAvatar";
import { symbolRowCursor, symbolRowProps } from "../common/symbolRowProps";

export interface DashboardViewProps {
  universe?: string;
  onOpenSymbol?: (symbol: string) => void;
  onOpenScan?: (panelId: string) => void;
}

type SortKey = "default" | "change" | "relvol" | "volume" | "value";

/** Refetch size for "Show more" (backend max). */
const DASHBOARD_MAX_LIMIT = 30;
/** Default minimum market-cap filter in ₹ crore (backend default). */
const DASHBOARD_DEFAULT_MIN_MCAP_CR = 500;

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "default", label: "Default" },
  { value: "change", label: "Change %" },
  { value: "relvol", label: "Rel vol" },
  { value: "volume", label: "Volume" },
  { value: "value", label: "Value" },
];

const HIDDEN_PANELS_STORAGE_KEY = "screener-dashboard.hidden-panels.v1";

/** Panel ids merged into the single "Top gainers" card (new backend shape). */
const GAINERS_GROUP_IDS = ["gainers", "losers"];
/** Panel ids merged into the single "Near 52W high" card. `near_52w` is legacy. */
const HIGH52_GROUP_IDS = ["near_52w_high", "near_52w_low", "near_52w"];

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseRelVolFromText(row: ScreenerDashboardRow): number | null {
  const text = `${row.sub_value ?? ""} ${row.sub_label ?? ""}`;
  const m = /([\d.,]+)\s*x/i.exec(text);
  if (!m) return null;
  const v = Number.parseFloat(m[1].replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
}

export function dashboardRowRelVol(row: ScreenerDashboardRow): number {
  return (
    finiteOrNull(row.rel_volume) ??
    finiteOrNull(row.relvol) ??
    parseRelVolFromText(row) ??
    0
  );
}

export function dashboardRowVolume(row: ScreenerDashboardRow): number {
  return finiteOrNull(row.volume) ?? 0;
}

export function dashboardRowValue(row: ScreenerDashboardRow): number {
  return finiteOrNull(row.value) ?? finiteOrNull(row.turnover) ?? 0;
}

export function dashboardRowHigh52w(row: ScreenerDashboardRow): number | null {
  return finiteOrNull(row.price_52_week_high) ?? finiteOrNull(row.high_52w);
}

export function dashboardRowMcapCr(row: ScreenerDashboardRow): number | null {
  return finiteOrNull(row.market_cap) ?? finiteOrNull(row.market_cap_cr);
}

function sortDashboardRows(
  rows: ScreenerDashboardRow[],
  sort: SortKey,
): ScreenerDashboardRow[] {
  if (sort === "default") return rows;
  const get = (r: ScreenerDashboardRow): number => {
    switch (sort) {
      case "change":
        return Number.isFinite(r.change) ? r.change : 0;
      case "relvol":
        return dashboardRowRelVol(r);
      case "volume":
        return dashboardRowVolume(r);
      case "value":
        return dashboardRowValue(r);
      default:
        return 0;
    }
  };
  return [...rows].sort((a, b) => get(b) - get(a));
}

function matchesQuery(row: ScreenerDashboardRow, q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    row.symbol.toLowerCase().includes(needle) ||
    (row.name ?? "").toLowerCase().includes(needle)
  );
}

function loadHiddenPanels(): string[] {
  try {
    const raw = window.localStorage.getItem(HIDDEN_PANELS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

interface CardGroup {
  key: string;
  title: string;
  panels: ScreenerDashboardPanel[];
}

/**
 * Merge toggle-pair panels into single cards:
 * gainers+losers → one "Top gainers" card, near_52w_high+near_52w_low
 * (or legacy near_52w) → one "Near 52W high" card. Lone panels pass through.
 */
function groupPanels(panels: ScreenerDashboardPanel[]): CardGroup[] {
  const byId = new Map(panels.map((p) => [p.id, p]));
  const groups: CardGroup[] = [];
  const consumed = new Set<string>();

  const gainersPanels = GAINERS_GROUP_IDS.map((id) => byId.get(id)).filter(
    (p): p is ScreenerDashboardPanel => p != null,
  );
  if (gainersPanels.length > 1) {
    groups.push({
      key: "gainers_losers",
      title: gainersPanels[0]?.title || "Top gainers",
      panels: gainersPanels,
    });
    gainersPanels.forEach((p) => consumed.add(p.id));
  }

  const high52Panels = HIGH52_GROUP_IDS.map((id) => byId.get(id)).filter(
    (p): p is ScreenerDashboardPanel => p != null,
  );
  if (high52Panels.length > 1) {
    groups.push({
      key: "near_52w_high_low",
      title: high52Panels[0]?.title || "Near 52W high",
      panels: high52Panels,
    });
    high52Panels.forEach((p) => consumed.add(p.id));
  }

  for (const panel of panels) {
    if (!consumed.has(panel.id)) {
      groups.push({ key: panel.id, title: panel.title, panels: [panel] });
    }
  }
  return groups;
}

function RowDetail(props: { row: ScreenerDashboardRow; panelId: string }) {
  const high52w = dashboardRowHigh52w(props.row);
  const mcap = dashboardRowMcapCr(props.row);
  const items: Array<{ label: string; value: string; testid: string }> = [
    {
      label: "52W high",
      value: high52w != null ? formatCurrency(high52w, 2) : "—",
      testid: "high52w",
    },
    {
      label: "ATR",
      value: finiteOrNull(props.row.atr) != null ? formatCurrency(props.row.atr as number, 2) : "—",
      testid: "atr",
    },
    {
      label: "RSI",
      value: finiteOrNull(props.row.rsi) != null ? (props.row.rsi as number).toFixed(1) : "—",
      testid: "rsi",
    },
    {
      label: "VWAP",
      value: finiteOrNull(props.row.vwap) != null ? formatCurrency(props.row.vwap as number, 2) : "—",
      testid: "vwap",
    },
    {
      label: "Mkt cap",
      value: mcap != null ? `₹${formatNumber(mcap * 1e7)}` : "—",
      testid: "mcap",
    },
    {
      label: "Rel vol",
      value: `${dashboardRowRelVol(props.row).toFixed(1)}x`,
      testid: "relvol",
    },
  ];
  return (
    <Box
      data-testid={`dashboard-row-detail-${props.panelId}-${props.row.symbol}`}
      className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-1 px-1 py-1 tabular-nums"
    >
      <For each={items}>
        {(item) => (
        <Box className="min-w-0">
          <Text size="xs" c="dimmed" span data-testid={`dashboard-row-detail-${props.panelId}-${props.row.symbol}-${item.testid}-label`}>
            {item.label}
          </Text>
          <Text
            size="xs"
            span
            data-testid={`dashboard-row-detail-${props.panelId}-${props.row.symbol}-${item.testid}`}
            className="block tabular-nums"
          >
            {item.value}
          </Text>
        </Box>
        )}
      </For>
    </Box>
  );
}

function DashboardCard(props: {
  group: CardGroup;
  query: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpenSymbol?: (symbol: string) => void;
  onOpenScan?: (panelId: string) => void;
}) {
  const visiblePanels = () => props.group.panels;
  const [selectedId, setSelectedId] = createSignal<string>(visiblePanels()[0]?.id ?? "");
  const [sort, setSort] = createSignal<SortKey>("default");
  const [detailSymbol, setDetailSymbol] = createSignal<string | null>(null);

  const activePanel = () =>
    visiblePanels().find((p) => p.id === selectedId()) ?? visiblePanels()[0];
  const isMerged = () => props.group.panels.length > 1;
  const cardKey = () => props.group.key;

  const shown = createMemo(() => {
    const panel = activePanel();
    if (!panel) return [];
    const filtered = (Array.isArray(panel.rows) ? panel.rows : []).filter((r) =>
      matchesQuery(r, props.query),
    );
    return sortDashboardRows(filtered, sort());
  });
  const canShowMore = () => (activePanel()?.qualify ?? 0) > shown().length || props.expanded;

  return (
    <CompactPanel
      testId={`dashboard-card-${cardKey()}`}
      padded={false}
      flush
      style={{ "min-width": 0, "min-height": 0, display: "flex", "flex-direction": "column", overflow: "hidden" }}
      title={
        <Box className="flex w-full flex-col gap-0.5 py-0.5">
          <ToolbarRow gap={4} wrap={false}>
            <Text
              size="xs"
              fw={600}
              truncate
              span
              title={props.group.title}
              data-testid={`dashboard-card-title-${cardKey()}`}
              className="min-w-0 flex-1"
            >
              {props.group.title}
            </Text>
            <Badge size="xs" data-testid={`dashboard-card-count-${cardKey()}`}>
              {shown().length}
            </Badge>
            <Menu closeOnItemClick data-testid={`dashboard-sort-menu-${cardKey()}`}>
              <MenuTarget>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  data-testid={`dashboard-sort-${cardKey()}`}
                  aria-label={`Sort ${props.group.title}`}
                >
                  <Text size="xs" span fw={700}>
                    …
                  </Text>
                </ActionIcon>
              </MenuTarget>
              <MenuDropdown>
                <For each={SORT_OPTIONS}>
                  {(opt) => (
                    <MenuItem
                      data-testid={`dashboard-sort-${cardKey()}-${opt.value}`}
                      onClick={() => setSort(opt.value)}
                    >
                      {sort() === opt.value ? `✓ ${opt.label}` : opt.label}
                    </MenuItem>
                  )}
                </For>
              </MenuDropdown>
            </Menu>
          </ToolbarRow>
          <Show when={isMerged() && activePanel()}>
            {(active) => (
              <SegmentedControl
                size="xs"
                value={active().id}
                onChange={(v) => {
                  setSelectedId(v);
                  setDetailSymbol(null);
                }}
                data={visiblePanels().map((p) => ({
                  value: p.id,
                  label:
                    p.id === "losers"
                      ? "Losers"
                      : p.id === "near_52w_low"
                        ? "52W low"
                        : p.id === "near_52w_high" || p.id === "near_52w"
                          ? "52W high"
                          : p.id === "gainers"
                            ? "Gainers"
                            : p.title,
                }))}
                data-testid={`dashboard-toggle-${cardKey()}`}
              />
            )}
          </Show>
          <Show when={activePanel()?.metric_label}>
            <Text size="xs" c="dimmed" span truncate title={activePanel()!.metric_label}>
              {activePanel()!.metric_label}
            </Text>
          </Show>
        </Box>
      }
    >
      <Show when={shown().length > 0} fallback={
        <Box className="p-2" data-testid={`dashboard-card-empty-${cardKey()}`}>
          <Text size="xs" c="dimmed">
            No stocks qualify
          </Text>
        </Box>
      }>
        <Box className="px-2" data-testid={`dashboard-card-rows-${cardKey()}`}>
          <For each={shown()}>
            {(row, idx) => {
            const isOpen = () => detailSymbol() === row.symbol;
            return (
              <Box>
                <Box
                  data-testid={`dashboard-row-${activePanel()?.id}-${row.symbol}`}
                  data-symbol={row.symbol}
                  {...symbolRowProps(props.onOpenSymbol, row.symbol)}
                  class="flex min-w-0 items-center gap-2 py-0.5 tabular-nums"
                  classList={{
                    "border-b border-fin-border": isOpen() || idx() < shown().length - 1,
                    "hover:bg-fin-surface-alt": !!props.onOpenSymbol,
                  }}
                  style={{ cursor: symbolRowCursor(props.onOpenSymbol) }}
                >
                  <SymbolAvatar symbol={row.symbol} name={row.name} logo={row.logo} size={20} />
                  <Box className="flex min-w-0 flex-1 flex-col gap-0">
                    <Text size="xs" fw={700} truncate span title={row.symbol} lh={1.1}>
                      {row.symbol}
                    </Text>
                    <Show when={row.sub_value || row.sub_label}>
                      <Text size="xs" c="dimmed" truncate span title={row.sub_label} lh={1.1}>
                        {row.sub_value || row.sub_label}
                      </Text>
                    </Show>
                  </Box>
                  <Box
                    className="flex flex-shrink-0 flex-col items-end"
                  >
                    <Text size="xs" ta="right" span lh={1.1} className="tabular-nums">
                      {formatCurrency(row.close, 2)}
                    </Text>
                    <Text
                      size="xs"
                      c={getPnLTextColor(row.change)}
                      ta="right"
                      span
                      lh={1.1}
                      className="tabular-nums"
                    >
                      {formatPercentage(row.change)}
                    </Text>
                  </Box>
                  <Sparkline data={row.spark ?? []} change={row.change} width={64} height={20} />
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    style={{ width: 16, height: 16, "min-height": 16, padding: 0 }}
                    data-testid={`dashboard-row-expand-${activePanel()?.id}-${row.symbol}`}
                    aria-label={isOpen() ? `Hide details for ${row.symbol}` : `Show details for ${row.symbol}`}
                    aria-expanded={isOpen()}
                    onClick={(e: MouseEvent) => {
                      e.stopPropagation();
                      setDetailSymbol(isOpen() ? null : row.symbol);
                    }}
                  >
                    <Text size="xs" span>
                      {isOpen() ? "▴" : "▾"}
                    </Text>
                  </ActionIcon>
                </Box>
                <Show when={isOpen()}>
                  <RowDetail row={row} panelId={activePanel()!.id} />
                </Show>
              </Box>
            );
            }}
          </For>
        </Box>
      </Show>
      <Box className="mt-auto border-t border-fin-border">
        <ToolbarRow gap={4} wrap={false} clip>
          <Box className="min-w-0 flex-1 px-2 py-1.5">
            <Text size="xs" c="dimmed" truncate span>
              {shown().length} of {activePanel()?.qualify ?? 0} stocks qualify
            </Text>
          </Box>
          <Show when={canShowMore()}>
            <Button
              size="xs"
              variant="subtle"
              onClick={props.onToggleExpanded}
              data-testid={`dashboard-show-more-${cardKey()}`}
            >
              {props.expanded ? "Show less" : "Show more"}
            </Button>
          </Show>
          <Button
            size="xs"
            variant="subtle"
            onClick={props.onOpenScan ? () => props.onOpenScan!(activePanel()!.id) : undefined}
            data-testid={`dashboard-open-scan-${cardKey()}`}
          >
            Open scan
          </Button>
        </ToolbarRow>
      </Box>
    </CompactPanel>
  );
}

export function DashboardView(props: DashboardViewProps) {
  const universe = () => props.universe ?? "nifty500";
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [data, setData] = createSignal<ScreenerDashboardResponse | null>(null);
  const [refreshKey, setRefreshKey] = createSignal(0);
  const [query, setQuery] = createSignal("");
  const [expanded, setExpanded] = createSignal(false);
  const [minMcapCr, setMinMcapCr] = createSignal<number>(DASHBOARD_DEFAULT_MIN_MCAP_CR);
  const [hiddenPanels, setHiddenPanels] = createSignal<string[]>(loadHiddenPanels);
  let bypassCache = false;

  const limit = () => (expanded() ? DASHBOARD_MAX_LIMIT : 8);

  createEffect(() => {
    try {
      window.localStorage.setItem(HIDDEN_PANELS_STORAGE_KEY, JSON.stringify(hiddenPanels()));
    } catch {
      // storage unavailable — panel visibility just won't persist
    }
  });

  // ⌘K / Ctrl-K focuses the dashboard search.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        const input = document.querySelector(
          '[data-testid="dashboard-search"]',
        ) as HTMLInputElement | null;
        if (input) {
          e.preventDefault();
          input.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  createEffect(() => {
    const currentUniverse = universe();
    const currentRefreshKey = refreshKey();
    const currentExpanded = expanded();
    const currentMinMcapCr = minMcapCr();
    const currentLimit = limit();
    void currentRefreshKey;

    let cancelled = false;
    const controller = new AbortController();
    onCleanup(() => {
      cancelled = true;
      controller.abort();
    });
    setLoading(true);
    setError(null);
    const bypass = bypassCache;
    bypassCache = false;
    // Keep the legacy 2-arg call shape for default fetches so older
    // backends (and existing call assertions) keep working; only send
    // round-2 params when they differ from the defaults.
    const needsOptions =
      bypass || currentExpanded || currentMinMcapCr !== DASHBOARD_DEFAULT_MIN_MCAP_CR;
    const request = needsOptions
      ? fetchScreenerDashboard(currentUniverse, controller.signal, {
          limit: currentLimit,
          minMarketCapCr: currentMinMcapCr,
          ...(bypass ? { refresh: true } : {}),
        })
      : fetchScreenerDashboard(currentUniverse, controller.signal);
    request
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
        setData(null);
        setLoading(false);
      });
  });

  const handleRefresh = () => {
    // Ask the backend to bypass a cached snapshot when supported;
    // otherwise this is a plain refetch.
    bypassCache = true;
    setRefreshKey((k) => k + 1);
  };

  const handleToggleExpanded = () => {
    setExpanded((v) => !v);
  };

  const handleTogglePanel = (panelId: string) => {
    setHiddenPanels((prev) =>
      prev.includes(panelId) ? prev.filter((id) => id !== panelId) : [...prev, panelId],
    );
  };

  const sections = () => data()?.sections ?? [];

  const allPanelIds = createMemo(() => {
    const ids: string[] = [];
    for (const section of sections()) {
      for (const panel of section.panels) {
        if (!ids.includes(panel.id)) ids.push(panel.id);
      }
    }
    return ids;
  });

  const isStale = () => {
    const d = data();
    return (
      d != null &&
      (d.cached === true ||
        (typeof d.age_sec === "number" && d.age_sec > 0))
    );
  };

  return (
    <Box
      data-testid="screener-dashboard"
      data-universe={data()?.universe ?? universe()}
      className="flex w-full min-w-0 flex-1 flex-col gap-2"
    >
      <ToolbarRow gap={8} wrap={false}>
        <Box className="min-w-0 flex-1">
          <Show
            when={data()}
            fallback={
              <Text size="xs" c="dimmed" truncate span>
                {universe()}
              </Text>
            }
          >
            {(current) => (
              <Text size="xs" c="dimmed" truncate span>
                {current().universe} · {current().total} stocks · as of {formatTimeOnly(current().as_of)}
                <Show when={isStale()}>
                  <Text
                    size="xs"
                    c="dimmed"
                    span
                    data-testid="dashboard-stale"
                    title={
                      typeof current().age_sec === "number"
                        ? `Cached snapshot, ${current().age_sec}s old`
                        : "Cached snapshot"
                    }
                  >
                    {" "}(cached
                    {typeof current().age_sec === "number" ? ` ${current().age_sec}s` : ""})
                  </Text>
                </Show>
              </Text>
            )}
          </Show>
        </Box>
        <Button
          size="xs"
          variant="subtle"
          onClick={handleRefresh}
          data-testid="dashboard-refresh"
          aria-label="Refresh dashboard"
        >
          Refresh
        </Button>
      </ToolbarRow>
      <ToolbarRow gap={8} wrap={false} data-testid="dashboard-toolbar">
        <TextInput
          size="xs"
          w={200}
          placeholder="Search symbol (⌘K)"
          value={query()}
          onChange={setQuery}
          data-testid="dashboard-search"
          aria-label="Search dashboard rows"
        />
        <Menu closeOnItemClick={false} data-testid="dashboard-customize">
          <MenuTarget>
            <Button size="xs" variant="subtle" aria-label="Customize dashboard panels" data-testid="dashboard-customize-button">
              Customize
            </Button>
          </MenuTarget>
          <MenuDropdown>
            <Show
              when={allPanelIds().length > 0}
              fallback={<MenuItem disabled>Panels load with data</MenuItem>}
            >
              <For each={allPanelIds()}>
                {(panelId) => (
                  <MenuItem
                    data-testid={`dashboard-customize-${panelId}`}
                    onClick={() => handleTogglePanel(panelId)}
                  >
                    {hiddenPanels().includes(panelId) ? `○ ${panelId}` : `● ${panelId}`}
                  </MenuItem>
                )}
              </For>
            </Show>
          </MenuDropdown>
        </Menu>
        <Chip
          size="xs"
          checked={minMcapCr() === DASHBOARD_DEFAULT_MIN_MCAP_CR}
          onChange={(next) =>
            setMinMcapCr(next ? DASHBOARD_DEFAULT_MIN_MCAP_CR : 0)
          }
          data-testid="dashboard-liquidity-chip"
          aria-label="Minimum market cap ₹500 crore filter"
        >
          ₹500 Cr+
        </Chip>
      </ToolbarRow>
      <Switch>
        <Match when={loading()}>
          <Box
            className="flex flex-col gap-2"
            data-testid="dashboard-loading"
          >
            <Skeleton h={16} />
            <Skeleton h={16} />
            <Skeleton h={16} />
            <Skeleton h={16} />
          </Box>
        </Match>
        <Match when={error()}>
          <Box className="p-2" data-testid="dashboard-error">
            <Text size="xs" c="error">
              {error()}
            </Text>
          </Box>
        </Match>
        <Match when={sections().length === 0}>
          <Box className="p-2" data-testid="dashboard-empty">
            <Text size="xs" c="dimmed">
              No dashboard data
            </Text>
          </Box>
        </Match>
        <Match when={true}>
          <For each={sections()}>
            {(section) => {
              const groups = groupPanels(section.panels)
                .map((group) => ({
                  ...group,
                  panels: group.panels.filter((p) => !hiddenPanels().includes(p.id)),
                }))
                .filter((group) => group.panels.length > 0);
              if (groups.length === 0) return null;
              const qualifyTotal = groups.reduce(
                (m, g) => m + g.panels.reduce((n, p) => n + (p.qualify ?? 0), 0),
                0,
              );
              return (
                <Box
                  data-testid={`dashboard-section-${section.id}`}
                  className="flex w-full min-w-0 flex-col gap-2"
                >
                  <ToolbarRow gap={8} wrap={false}>
                    <Text size="sm" fw={700} span>
                      {section.title}
                    </Text>
                    <Text size="xs" c="dimmed" span>
                      {qualifyTotal} qualify
                    </Text>
                  </ToolbarRow>
                  <Box
                    className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
                  >
                    <For each={groups}>
                      {(group) => (
                        <DashboardCard
                          group={group}
                          query={query()}
                          expanded={expanded()}
                          onToggleExpanded={handleToggleExpanded}
                          onOpenSymbol={props.onOpenSymbol}
                          onOpenScan={props.onOpenScan}
                        />
                      )}
                    </For>
                  </Box>
                </Box>
              );
            }}
          </For>
        </Match>
      </Switch>
    </Box>
  );
}
