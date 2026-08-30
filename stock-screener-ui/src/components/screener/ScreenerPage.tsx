import { useState, useCallback, lazy, Suspense, useTransition } from "react";
import { useSearchParams } from "react-router-dom";
import MuiStack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import CardContent from "@mui/material/CardContent";
import { Box, Tabs, Text, Select, Skeleton } from "@/ui";
import { IconTable, IconChartDots, IconSettings } from "@tabler/icons-react";
import * as state from "../../state";
import { ScreenerHeader } from "./ScreenerHeader";
import { ScreenerContent } from "./ScreenerContent";
import { SelectionBar } from "./SelectionBar";
import { screenerHasSideFilters } from "./ScreenerSidePanel";
import { ScreenerInlineFilters } from "./ScreenerInlineFilters";

const CorrelationTab = lazy(() => import("./CorrelationTab").then((m) => ({ default: m.CorrelationTab })));
const ScreenerConfigView = lazy(() => import("./ScreenerConfigView").then((m) => ({ default: m.ScreenerConfigView })));
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
}: ScreenerPageProps) {
  const [viewMode, setViewMode] = useState<"table" | "heatmap">("table");
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "screener";
  const [isPending, startTransition] = useTransition();

  const setActiveTab = (tab: string) => {
    startTransition(() => {
      setSearchParams(
        (prev) => {
          if (tab === "screener") {
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
            borderColor: "#30363D",
            borderRadius: 2,
            bgcolor: "#161B22",
            flexShrink: 0,
            overflow: "hidden",
            flexWrap: "nowrap",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
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
            <Tabs
              value={activeTab}
              onChange={(v) => {
                if (v && v !== "screener") state.setSelectedSymbols([]);
                if (v) setActiveTab(v);
              }}
            >
              <Tabs.List sx={{ minHeight: 32, display: "flex", alignItems: "center", gap: 0.5 }}>
                <Tabs.Tab value="screener" leftSection={<IconTable size={14} />} data-testid="tab-screener" style={{ minHeight: 32 }}>
                  Screener
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
            />
          </Box>
        </Paper>
        <Box
          id="screener-content"
          data-testid="screener-content"
          sx={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}
        >
          <Box sx={{ display: activeTab === "screener" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
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
                borderColor: "#30363D",
                borderRadius: 2,
                bgcolor: "#161B22",
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
          <Box sx={{ display: activeTab !== "screener" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
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
