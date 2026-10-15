import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Paper,
  SegmentedControl,
  Skeleton,
  Text,
  TextInput,
  ToolbarRow,
} from "@/ui";
import { BORDER, SURFACE } from "@/ui/palette";
import {
  fetchScreenerDashboard,
} from "../../api/screenerDashboard";
import type {
  ScreenerDashboardPanel,
  ScreenerDashboardResponse,
  ScreenerDashboardRow,
} from "../../types/screenerDashboard";
import {
  formatCurrency,
  formatNumber,
  formatPercentage,
  formatTimeOnly,
  getPnLTextColor,
} from "../../utils/ui-helpers";
import { Sparkline } from "./Sparkline";
import { SymbolAvatar } from "./SymbolAvatar";

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

function RowDetail({ row, panelId }: { row: ScreenerDashboardRow; panelId: string }) {
  const high52w = dashboardRowHigh52w(row);
  const mcap = dashboardRowMcapCr(row);
  const items: Array<{ label: string; value: string; testid: string }> = [
    {
      label: "52W high",
      value: high52w != null ? formatCurrency(high52w, 2) : "—",
      testid: "high52w",
    },
    {
      label: "ATR",
      value: finiteOrNull(row.atr) != null ? formatCurrency(row.atr as number, 2) : "—",
      testid: "atr",
    },
    {
      label: "RSI",
      value: finiteOrNull(row.rsi) != null ? (row.rsi as number).toFixed(1) : "—",
      testid: "rsi",
    },
    {
      label: "VWAP",
      value: finiteOrNull(row.vwap) != null ? formatCurrency(row.vwap as number, 2) : "—",
      testid: "vwap",
    },
    {
      label: "Mkt cap",
      value: mcap != null ? `₹${formatNumber(mcap * 1e7)}` : "—",
      testid: "mcap",
    },
    {
      label: "Rel vol",
      value: `${dashboardRowRelVol(row).toFixed(1)}x`,
      testid: "relvol",
    },
  ];
  return (
    <Box
      data-testid={`dashboard-row-detail-${panelId}-${row.symbol}`}
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 0.5,
        px: 0.5,
        py: 0.5,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {items.map((item) => (
        <Box key={item.testid} sx={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed" span data-testid={`dashboard-row-detail-${panelId}-${row.symbol}-${item.testid}-label`}>
            {item.label}
          </Text>
          <Text
            size="xs"
            span
            data-testid={`dashboard-row-detail-${panelId}-${row.symbol}-${item.testid}`}
            sx={{ display: "block", fontVariantNumeric: "tabular-nums" }}
          >
            {item.value}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function DashboardCard({
  group,
  query,
  expanded,
  onToggleExpanded,
  onOpenSymbol,
  onOpenScan,
}: {
  group: CardGroup;
  query: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpenSymbol?: (symbol: string) => void;
  onOpenScan?: (panelId: string) => void;
}) {
  const visiblePanels = group.panels;
  const [selectedId, setSelectedId] = useState<string>(visiblePanels[0]?.id ?? "");
  const [sort, setSort] = useState<SortKey>("default");
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);

  const activePanel =
    visiblePanels.find((p) => p.id === selectedId) ?? visiblePanels[0];
  useEffect(() => {
    if (activePanel && selectedId !== activePanel.id && !visiblePanels.some((p) => p.id === selectedId)) {
      setSelectedId(activePanel.id);
    }
  }, [activePanel, selectedId, visiblePanels]);

  if (!activePanel) return null;
  const isMerged = group.panels.length > 1;
  const cardKey = group.key;

  const filtered = (Array.isArray(activePanel.rows) ? activePanel.rows : []).filter((r) =>
    matchesQuery(r, query),
  );
  const shown = sortDashboardRows(filtered, sort);
  const canShowMore = activePanel.qualify > shown.length || expanded;

  return (
    <Paper
      elevation={0}
      data-testid={`dashboard-card-${cardKey}`}
      sx={{
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: 1,
        borderColor: BORDER,
        borderRadius: 2,
        bgcolor: SURFACE,
      }}
    >
      <Box sx={{ px: 1, pt: 1 }}>
        <ToolbarRow gap={4} wrap={false}>
          <Text
            size="xs"
            fw={600}
            truncate
            span
            title={group.title}
            data-testid={`dashboard-card-title-${cardKey}`}
            sx={{ flex: 1, minWidth: 0 }}
          >
            {group.title}
          </Text>
          <Badge size="xs" data-testid={`dashboard-card-count-${cardKey}`}>
            {shown.length}
          </Badge>
          <Menu closeOnItemClick data-testid={`dashboard-sort-menu-${cardKey}`}>
            <MenuTarget>
              <ActionIcon
                size="xs"
                variant="subtle"
                data-testid={`dashboard-sort-${cardKey}`}
                aria-label={`Sort ${group.title}`}
              >
                <Text size="xs" span fw={700}>
                  …
                </Text>
              </ActionIcon>
            </MenuTarget>
            <MenuDropdown>
              {SORT_OPTIONS.map((opt) => (
                <MenuItem
                  key={opt.value}
                  data-testid={`dashboard-sort-${cardKey}-${opt.value}`}
                  onClick={() => setSort(opt.value)}
                >
                  {sort === opt.value ? `✓ ${opt.label}` : opt.label}
                </MenuItem>
              ))}
            </MenuDropdown>
          </Menu>
        </ToolbarRow>
        {isMerged ? (
          <Box sx={{ py: 0.5 }}>
            <SegmentedControl
              size="xs"
              value={activePanel.id}
              onChange={(v) => {
                setSelectedId(v);
                setDetailSymbol(null);
              }}
              data={group.panels.map((p) => ({
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
              data-testid={`dashboard-toggle-${cardKey}`}
            />
          </Box>
        ) : null}
        {activePanel.metric_label ? (
          <Text size="xs" c="dimmed" span truncate title={activePanel.metric_label}>
            {activePanel.metric_label}
          </Text>
        ) : null}
      </Box>
      {shown.length === 0 ? (
        <Box sx={{ px: 1, py: 1 }} data-testid={`dashboard-card-empty-${cardKey}`}>
          <Text size="xs" c="dimmed">
            No stocks qualify
          </Text>
        </Box>
      ) : (
        <Box sx={{ px: 1 }} data-testid={`dashboard-card-rows-${cardKey}`}>
          {shown.map((row, idx) => {
            const isOpen = detailSymbol === row.symbol;
            return (
              <Box key={`${activePanel.id}-${row.symbol}`}>
                <Box
                  data-testid={`dashboard-row-${activePanel.id}-${row.symbol}`}
                  data-symbol={row.symbol}
                  role={onOpenSymbol ? "button" : undefined}
                  tabIndex={onOpenSymbol ? 0 : undefined}
                  onClick={onOpenSymbol ? () => onOpenSymbol(row.symbol) : undefined}
                  onKeyDown={
                    onOpenSymbol
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onOpenSymbol(row.symbol);
                          }
                        }
                      : undefined
                  }
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    minWidth: 0,
                    py: 0.75,
                    borderBottom: isOpen || idx < shown.length - 1 ? 1 : 0,
                    borderColor: "divider",
                    cursor: onOpenSymbol ? "pointer" : "default",
                    fontVariantNumeric: "tabular-nums",
                    "&:hover": onOpenSymbol ? { bgcolor: "action.hover" } : {},
                  }}
                >
                  <SymbolAvatar symbol={row.symbol} name={row.name} logo={row.logo} size={20} />
                  <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0 }}>
                    <Text size="xs" fw={700} truncate span title={row.symbol}>
                      {row.symbol}
                    </Text>
                    {row.sub_value || row.sub_label ? (
                      <Text size="xs" c="dimmed" truncate span title={row.sub_label}>
                        {row.sub_value || row.sub_label}
                      </Text>
                    ) : null}
                  </Box>
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      flexShrink: 0,
                    }}
                  >
                    <Text size="xs" ta="right" span sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {formatCurrency(row.close, 2)}
                    </Text>
                    <Text
                      size="xs"
                      c={getPnLTextColor(row.change)}
                      ta="right"
                      span
                      sx={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {formatPercentage(row.change)}
                    </Text>
                  </Box>
                  <Sparkline data={row.spark ?? []} change={row.change} width={64} height={20} />
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    data-testid={`dashboard-row-expand-${activePanel.id}-${row.symbol}`}
                    aria-label={isOpen ? `Hide details for ${row.symbol}` : `Show details for ${row.symbol}`}
                    aria-expanded={isOpen}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDetailSymbol(isOpen ? null : row.symbol);
                    }}
                  >
                    <Text size="xs" span>
                      {isOpen ? "▴" : "▾"}
                    </Text>
                  </ActionIcon>
                </Box>
                {isOpen ? <RowDetail row={row} panelId={activePanel.id} /> : null}
              </Box>
            );
          })}
        </Box>
      )}
      <Box sx={{ mt: "auto", borderTop: 1, borderColor: "divider" }}>
        <ToolbarRow gap={4} wrap={false} clip>
          <Box sx={{ flex: 1, minWidth: 0, px: 1, py: 0.75 }}>
            <Text size="xs" c="dimmed" truncate span>
              {shown.length} of {activePanel.qualify} stocks qualify
            </Text>
          </Box>
          {canShowMore ? (
            <Button
              size="xs"
              variant="subtle"
              onClick={onToggleExpanded}
              data-testid={`dashboard-show-more-${cardKey}`}
            >
              {expanded ? "Show less" : "Show more"}
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="subtle"
            onClick={onOpenScan ? () => onOpenScan(activePanel.id) : undefined}
            data-testid={`dashboard-open-scan-${cardKey}`}
          >
            Open scan
          </Button>
        </ToolbarRow>
      </Box>
    </Paper>
  );
}

export function DashboardView({ universe = "nifty500", onOpenSymbol, onOpenScan }: DashboardViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ScreenerDashboardResponse | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [minMcapCr, setMinMcapCr] = useState<number>(DASHBOARD_DEFAULT_MIN_MCAP_CR);
  const [hiddenPanels, setHiddenPanels] = useState<string[]>(loadHiddenPanels);
  const bypassCacheRef = useRef(false);

  const limit = expanded ? DASHBOARD_MAX_LIMIT : 8;

  useEffect(() => {
    try {
      window.localStorage.setItem(HIDDEN_PANELS_STORAGE_KEY, JSON.stringify(hiddenPanels));
    } catch {
      // storage unavailable — panel visibility just won't persist
    }
  }, [hiddenPanels]);

  // ⌘K / Ctrl-K focuses the dashboard search.
  useEffect(() => {
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
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const bypass = bypassCacheRef.current;
    bypassCacheRef.current = false;
    // Keep the legacy 2-arg call shape for default fetches so older
    // backends (and existing call assertions) keep working; only send
    // round-2 params when they differ from the defaults.
    const needsOptions =
      bypass || expanded || minMcapCr !== DASHBOARD_DEFAULT_MIN_MCAP_CR;
    const request = needsOptions
      ? fetchScreenerDashboard(universe, controller.signal, {
          limit,
          minMarketCapCr: minMcapCr,
          ...(bypass ? { refresh: true } : {}),
        })
      : fetchScreenerDashboard(universe, controller.signal);
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
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [universe, refreshKey, expanded, minMcapCr, limit]);

  const handleRefresh = useCallback(() => {
    // Ask the backend to bypass a cached snapshot when supported;
    // otherwise this is a plain refetch.
    bypassCacheRef.current = true;
    setRefreshKey((k) => k + 1);
  }, []);

  const handleToggleExpanded = useCallback(() => {
    setExpanded((v) => !v);
  }, []);

  const handleTogglePanel = useCallback((panelId: string) => {
    setHiddenPanels((prev) =>
      prev.includes(panelId) ? prev.filter((id) => id !== panelId) : [...prev, panelId],
    );
  }, []);

  const sections = data?.sections ?? [];

  const allPanelIds = useMemo(() => {
    const ids: string[] = [];
    for (const section of sections) {
      for (const panel of section.panels) {
        if (!ids.includes(panel.id)) ids.push(panel.id);
      }
    }
    return ids;
  }, [sections]);

  const isStale =
    data != null &&
    (data.cached === true ||
      (typeof data.age_sec === "number" && data.age_sec > 0));

  return (
    <Box
      data-testid="screener-dashboard"
      data-universe={data?.universe ?? universe}
      sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, width: "100%", flex: 1 }}
    >
      <ToolbarRow gap={8} wrap={false}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {data ? (
            <Text size="xs" c="dimmed" truncate span>
              {data.universe} · {data.total} stocks · as of {formatTimeOnly(data.as_of)}
              {isStale ? (
                <Text
                  size="xs"
                  c="dimmed"
                  span
                  data-testid="dashboard-stale"
                  title={
                    typeof data.age_sec === "number"
                      ? `Cached snapshot, ${data.age_sec}s old`
                      : "Cached snapshot"
                  }
                >
                  {" "}
                  (cached
                  {typeof data.age_sec === "number" ? ` ${data.age_sec}s` : ""})
                </Text>
              ) : null}
            </Text>
          ) : (
            <Text size="xs" c="dimmed" truncate span>
              {universe}
            </Text>
          )}
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
          value={query}
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
            {allPanelIds.length === 0 ? (
              <MenuItem disabled>Panels load with data</MenuItem>
            ) : (
              allPanelIds.map((panelId) => (
                <MenuItem
                  key={panelId}
                  data-testid={`dashboard-customize-${panelId}`}
                  onClick={() => handleTogglePanel(panelId)}
                >
                  {hiddenPanels.includes(panelId) ? `○ ${panelId}` : `● ${panelId}`}
                </MenuItem>
              ))
            )}
          </MenuDropdown>
        </Menu>
        <Chip
          size="xs"
          checked={minMcapCr === DASHBOARD_DEFAULT_MIN_MCAP_CR}
          onChange={(next) =>
            setMinMcapCr(next ? DASHBOARD_DEFAULT_MIN_MCAP_CR : 0)
          }
          data-testid="dashboard-liquidity-chip"
          aria-label="Minimum market cap ₹500 crore filter"
        >
          ₹500 Cr+
        </Chip>
      </ToolbarRow>
      {loading ? (
        <Box
          sx={{ display: "flex", flexDirection: "column", gap: 1 }}
          data-testid="dashboard-loading"
        >
          <Skeleton h={16} />
          <Skeleton h={16} />
          <Skeleton h={16} />
          <Skeleton h={16} />
        </Box>
      ) : error ? (
        <Box sx={{ p: 1 }} data-testid="dashboard-error">
          <Text size="xs" c="error">
            {error}
          </Text>
        </Box>
      ) : sections.length === 0 ? (
        <Box sx={{ p: 1 }} data-testid="dashboard-empty">
          <Text size="xs" c="dimmed">
            No dashboard data
          </Text>
        </Box>
      ) : (
        sections.map((section) => {
          const groups = groupPanels(section.panels)
            .map((group) => ({
              ...group,
              panels: group.panels.filter((p) => !hiddenPanels.includes(p.id)),
            }))
            .filter((group) => group.panels.length > 0);
          if (groups.length === 0) return null;
          const qualifyTotal = groups.reduce(
            (m, g) => m + g.panels.reduce((n, p) => n + (p.qualify ?? 0), 0),
            0,
          );
          return (
            <Box
              key={section.id}
              data-testid={`dashboard-section-${section.id}`}
              sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, width: "100%" }}
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
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "repeat(2, minmax(0, 1fr))",
                    lg: "repeat(4, minmax(0, 1fr))",
                  },
                  gap: 1,
                  minWidth: 0,
                  width: "100%",
                }}
              >
                {groups.map((group) => (
                  <DashboardCard
                    key={group.key}
                    group={group}
                    query={query}
                    expanded={expanded}
                    onToggleExpanded={handleToggleExpanded}
                    onOpenSymbol={onOpenSymbol}
                    onOpenScan={onOpenScan}
                  />
                ))}
              </Box>
            </Box>
          );
        })
      )}
    </Box>
  );
}
