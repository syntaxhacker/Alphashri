import { useState, useCallback, lazy, Suspense, useTransition } from "react";
import { useSearchParams } from "react-router-dom";
import MuiStack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import { Box, Tabs, Text, Select, Skeleton, ActionIcon, Switch, Tooltip } from "@/ui";
import { BORDER, SURFACE } from "@/ui/palette";
import { IconTable, IconChartDots, IconSettings, IconLayoutDashboard, IconRefresh, IconCoins } from "@tabler/icons-react";
import * as state from "../../state";
import { DashboardView } from "./DashboardView";
import { ScreenerHeader } from "./ScreenerHeader";
import { ScreenerContent } from "./ScreenerContent";
import { SelectionBar } from "./SelectionBar";
import { screenerHasSideFilters } from "./ScreenerSidePanel";
import { GroupPerformancePanel } from "./GroupPerformancePanel";
import { ScreenerInlineFilters } from "./ScreenerInlineFilters";

const CorrelationTab = lazy(() => import("./CorrelationTab").then((m) => ({ default: m.CorrelationTab })));
const ScreenerConfigView = lazy(() => import("./ScreenerConfigView").then((m) => ({ default: m.ScreenerConfigView })));
const DeepValueTab = lazy(() => import("../value/ValuePanel").then((m) => ({ default: m.ValuePanel })));
import {
  setSymbols,
  setTimeframe,
  setPeriod,
  setPeriodUnit,
  fetchCorrelationData,
} from "../../state/correlation";
import type { Stock } from "../../types";

interface ScreenerPageProps {
  screenerOptions: Array<{ id: string; label: string; description?: string }>;
  activeScreener: string;
  onScreenerChange: (id: string) => void;
  onConfigScreenerSelect: (id: string) => void;
  title: string;
  status: string;
  isLoading: boolean;
  autoRefreshSeconds: number;
  provider: string;
  mode: string;
  onRefresh: () => void;
  onAutoRefreshChange: (value: number) => void;
  onProviderChange: (value: string) => void;
  onModeChange: (value: string) => void;
  approachingStocks: Stock[];
  touchedStocks: Stock[];
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
  error?: string | null;
  warning?: string | null;
  /** Market universe for the Dashboard tab. Uncontrolled default is "nifty500". */
  universe?: string;
  onUniverseChange?: (universe: string) => void;
}

/** Market universes offered by the Dashboard toolbar selector. */
export const DASHBOARD_UNIVERSES = [
  { value: "nifty50", label: "Nifty 50" },
  { value: "nifty500", label: "Nifty 500" },
  { value: "NSE_EQ", label: "All NSE" },
] as const;

export const DEFAULT_DASHBOARD_UNIVERSE = "nifty500";

/**
 * Map a Dashboard panel id to the closest existing screener profile id.
 * Returns null when there is no close profile — the caller then just opens
 * the Screener tab with the current profile.
 */
export function mapDashboardPanelToScreener(
  panelId: string,
  screenerIds: string[],
): string | null {
  const has = (id: string) => screenerIds.includes(id);
  switch (panelId) {
    case "near_52w":
    case "near_52w_high":
    case "near_52w_high_low":
      if (has("near_52w_breakout")) return "near_52w_breakout";
      if (has("52w_high")) return "52w_high";
      return null;
    case "near_52w_low":
      if (has("52w_high")) return "52w_high";
      if (has("near_52w_breakout")) return "near_52w_breakout";
      return null;
    case "gainers_losers":
    case "losers":
      return null;
    case "new_highs":
    case "touched_52w":
      if (has("touched_52w_high")) return "touched_52w_high";
      if (has("52w_high")) return "52w_high";
      return null;
    case "gap":
    case "gap_up":
    case "gap_down":
      if (has("market_open_gap")) return "market_open_gap";
      return null;
    default:
      // gainers / losers / most_active / turnover / volume_surge /
      // range_expansion and anything unknown → Screener tab as-is.
      return null;
  }
}

function CompactAlerts({
  activeScreener,
  warning,
}: {
  activeScreener: string;
  warning?: string | null;
}) {
  const lines: string[] = [];
  if (activeScreener === "52w_high") {
    lines.push("52W from Upstox daily; LTP live when broker connected.");
  }
  if (warning) {
    lines.push(warning);
  }
  if (lines.length === 0) {
    return null;
  }
  return (
    <Box
      px={2}
      py={1}
      sx={{ flexShrink: 0 }}
      data-testid="screener-52w-high-banner"
    >
      {lines.map((line) => (
        <Text key={line} size="11px" c="dimmed" lineClamp={2}>
          {line}
        </Text>
      ))}
    </Box>
  );
}

export function ScreenerPage({
  screenerOptions,
  activeScreener,
  onScreenerChange,
  onConfigScreenerSelect,
  status,
  isLoading,
  autoRefreshSeconds,
  provider,
  mode,
  onRefresh,
  onAutoRefreshChange,
  onProviderChange,
  onModeChange,
  approachingStocks,
  touchedStocks,
  onSymbolClick,
  onSymbolHover,
  error,
  warning,
  universe: universeProp,
  onUniverseChange,
}: ScreenerPageProps) {
  const [viewMode, setViewMode] = useState<"table" | "heatmap">("table");
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "dashboard";
  const isValueTab = activeTab === "deepvalue";
  const [isPending, startTransition] = useTransition();
  const [internalUniverse, setInternalUniverse] = useState(DEFAULT_DASHBOARD_UNIVERSE);
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  const [showLastClose, setShowLastClose] = useState(false);
  const universe = universeProp ?? internalUniverse;
  const handleUniverseChange = useCallback(
    (u: string) => {
      if (onUniverseChange) {
        onUniverseChange(u);
      } else {
        setInternalUniverse(u);
      }
    },
    [onUniverseChange],
  );

  const setActiveTab = (tab: string) => {
    startTransition(() => {
      setSearchParams(
        (prev) => {
          if (tab === "dashboard") {
            prev.delete("tab");
          } else {
            prev.set("tab", tab);
          }
          return prev;
        },
        { replace: true },
      );
    });
  };

  const handleOpenScan = useCallback(
    (panelId: string) => {
      const target = mapDashboardPanelToScreener(
        panelId,
        screenerOptions.map((o) => o.id),
      );
      if (target && target !== activeScreener) {
        onScreenerChange(target);
      }
      setActiveTab("screener");
    },
    [screenerOptions, activeScreener, onScreenerChange, setSearchParams],
  );

  const handleCompare = useCallback(() => {
    const syms = state.selectedSymbols;
    if (syms.length < 2) return;
    setSymbols(syms);
    setTimeframe("daily");
    setPeriod(90);
    setPeriodUnit("days");
    fetchCorrelationData();
    state.clearSelectedSymbols();
    setSearchParams(
      { tab: "correlation", symbols: syms.join(","), timeframe: "daily", period: "90" },
      { replace: true },
    );
  }, [setSearchParams]);

  const hasSideFilters = screenerHasSideFilters(activeScreener);
  const hasResults = approachingStocks.length + touchedStocks.length > 0;
  const isDashboard = activeTab === "dashboard";

  return (
    <Box sx={{ width: "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: 1 }}>
      <MuiStack
        spacing={0}
        id="screener-main"
        data-testid="screener-page"
        sx={{ minHeight: 0, width: "100%", gap: 1 }}
      >
        {/* Unified 48px toolbar — POC Option A promoted to live */}
        <Paper
          elevation={0}
          data-testid="screener-controls"
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 2,
            px: 1.5,
            height: 48,
            minHeight: 48,
            maxHeight: 48,
            border: 1,
            borderColor: BORDER,
            borderRadius: 2,
            bgcolor: SURFACE,
            flexShrink: 0,
            overflow: "hidden",
            flexWrap: "nowrap",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
            {isDashboard ? (
              <Select
                value={universe}
                onChange={(v) => v && handleUniverseChange(v)}
                data={DASHBOARD_UNIVERSES.map((o) => ({ value: o.value, label: o.label }))}
                size="xs"
                w={148}
                data-testid="dashboard-universe-select"
                comboboxProps={{ withinPortal: true }}
                aria-label="Market universe"
              />
            ) : isValueTab ? (
              <Text size="xs" fw={600} data-testid="deep-value-tab-label">
                Deep Value
              </Text>
            ) : (
              <Select
                value={activeScreener}
                onChange={(v) => v && onScreenerChange(v)}
                data={screenerOptions.map((o) => ({ value: o.id, label: o.label }))}
                size="xs"
                w={148}
                data-testid="screener-select"
                comboboxProps={{ withinPortal: true }}
                aria-label="Screener"
              />
            )}
            <Tabs
              value={activeTab}
              onChange={(v) => {
                if (v && v !== "screener") state.setSelectedSymbols([]);
                if (v) setActiveTab(v);
              }}
            >
              <Tabs.List sx={{ minHeight: 32, display: "flex", alignItems: "center", gap: 0.5 }}>
                <Tabs.Tab value="dashboard" leftSection={<IconLayoutDashboard size={14} />} data-testid="tab-dashboard" style={{ minHeight: 32 }}>
                  Dashboard
                </Tabs.Tab>
                <Tabs.Tab value="screener" leftSection={<IconTable size={14} />} data-testid="tab-screener" style={{ minHeight: 32 }}>
                  Screener
                </Tabs.Tab>
                <Tabs.Tab value="deepvalue" leftSection={<IconCoins size={14} />} data-testid="tab-deepvalue" style={{ minHeight: 32 }}>
                  Deep Value
                </Tabs.Tab>
                <Tabs.Tab value="correlation" leftSection={<IconChartDots size={14} />} data-testid="tab-correlation" style={{ minHeight: 32 }}>
                  Correlation
                </Tabs.Tab>
                <Tabs.Tab value="config" leftSection={<IconSettings size={14} />} data-testid="tab-config" style={{ minHeight: 32 }}>
                  Config
                </Tabs.Tab>
              </Tabs.List>
            </Tabs>
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, px: 1, display: "flex", justifyContent: "center", overflow: "hidden" }}>
            <Text size="xs" c="dimmed" truncate sx={{ fontSize: 11 }} title={status} data-testid="screener-status">
              {status}
            </Text>
          </Box>
          <Box sx={{ flexShrink: 0, display: "flex", alignItems: "center", flexWrap: "nowrap" }}>
            {isDashboard ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
                <Tooltip label={showLastClose ? "Showing last close (visual)" : "Show last close"}>
                  <Switch
                    size="xs"
                    checked={showLastClose}
                    onChange={(e) => setShowLastClose(e.currentTarget.checked)}
                    label="Last close"
                    data-testid="dashboard-last-close-toggle"
                    aria-label="Last close"
                  />
                </Tooltip>
                <Tooltip label="Refresh dashboard">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={() => setDashboardRefreshKey((k) => k + 1)}
                    data-testid="dashboard-refresh"
                    aria-label="Refresh dashboard"
                  >
                    <IconRefresh size={14} />
                  </ActionIcon>
                </Tooltip>
              </Box>
            ) : isValueTab ? null : (
              <ScreenerHeader
              status={status}
              isLoading={isLoading}
              autoRefreshSeconds={autoRefreshSeconds}
              provider={provider}
              mode={mode}
              onRefresh={onRefresh}
              onAutoRefreshChange={onAutoRefreshChange}
              onProviderChange={onProviderChange}
              onModeChange={onModeChange}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              hideStatus
              disableControls={isLoading && !hasResults}
            />
            )}
          </Box>
        </Paper>
        <Box
          id="screener-content"
          data-testid="screener-content"
          sx={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}
        >
          <Box
            data-testid="dashboard-panel"
            sx={{ display: isDashboard ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0, overflow: "auto" }}
          >
            <DashboardView
              key={`dashboard-${dashboardRefreshKey}`}
              universe={universe}
              onOpenSymbol={onSymbolClick}
              onOpenScan={handleOpenScan}
            />
          </Box>
          <Box sx={{ display: activeTab === "screener" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0, gap: 1 }}>
            <GroupPerformancePanel />
            <Paper
              elevation={0}
              sx={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                border: 1,
                borderColor: BORDER,
                borderRadius: 2,
                bgcolor: SURFACE,
                opacity: isPending ? 0.6 : 1,
              }}
            >
              <CompactAlerts activeScreener={activeScreener} warning={warning} />
              {hasSideFilters && <ScreenerInlineFilters activeScreener={activeScreener} embedded />}
              <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", p: 0.5, gap: 0.5 }}>
                <ScreenerContent
                  approachingStocks={approachingStocks}
                  touchedStocks={touchedStocks}
                  isLoading={isLoading}
                  error={error}
                  onRefresh={onRefresh}
                  onSymbolClick={onSymbolClick}
                  onSymbolHover={onSymbolHover}
                  activeScreener={activeScreener}
                  viewMode={viewMode}
                />
                <SelectionBar onCompare={handleCompare} />
              </Box>
            </Paper>
          </Box>
          <Box
            data-testid="deep-value-panel"
            sx={{ display: isValueTab ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0, overflow: "auto" }}
          >
            <Suspense fallback={<Box sx={{ p: 2 }}><Skeleton h={120} /><Skeleton h={200} mt="sm" /></Box>}>
              <DeepValueTab />
            </Suspense>
          </Box>
          <Box sx={{ display: activeTab === "correlation" || activeTab === "config" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0, overflow: "auto" }}>
            <Suspense fallback={<Box sx={{ p: 2 }}><Skeleton h={120} /><Skeleton h={200} mt="sm" /></Box>}>
              {activeTab === "config" ? (
                <ScreenerConfigView
                  screenerOptions={screenerOptions}
                  activeScreener={activeScreener}
                  onScreenerChange={onConfigScreenerSelect}
                />
              ) : activeTab === "correlation" ? (
                <CorrelationTab />
              ) : null}
            </Suspense>
          </Box>
        </Box>
      </MuiStack>
    </Box>
  );
}
