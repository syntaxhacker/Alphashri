import { useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import Grid from "@mui/material/Grid";
import MuiStack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import CardContent from "@mui/material/CardContent";
import { Stack, Box, Tabs, Text } from "@/ui";
import { IconTable, IconChartDots, IconSettings } from "@tabler/icons-react";
import * as state from "../../state";
import { ScreenerNav } from "./ScreenerNav";
import { ScreenerHeader } from "./ScreenerHeader";
import { ScreenerContent } from "./ScreenerContent";
import { CorrelationTab } from "./CorrelationTab";
import { SelectionBar } from "./SelectionBar";
import { ScreenerSidePanel, screenerHasSideFilters } from "./ScreenerSidePanel";
import { ScreenerConfigView } from "./ScreenerConfigView";
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

  const setActiveTab = (tab: string) => {
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
    <Box sx={{ width: "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: 2 }}>
      <MuiStack
        spacing={0}
        id="screener-main"
        data-testid="screener-page"
        sx={{ minHeight: 0, width: "100%" }}
      >
        <Paper elevation={1} sx={{ p: 1, display: "flex", alignItems: "center" }} data-testid="screener-controls">
          <Tabs
            value={activeTab}
            onChange={(v) => {
              if (v && v !== "screener") {
                state.setSelectedSymbols([]);
              }
              if (v) setActiveTab(v);
            }}
          >
            <Tabs.List sx={{ minHeight: 36 }}>
              <Tabs.Tab value="screener" leftSection={<IconTable size={16} />} data-testid="tab-screener">
                Screener
              </Tabs.Tab>
              <Tabs.Tab value="correlation" leftSection={<IconChartDots size={16} />} data-testid="tab-correlation">
                Correlation
              </Tabs.Tab>
              <Tabs.Tab value="config" leftSection={<IconSettings size={16} />} data-testid="tab-config">
                Config
              </Tabs.Tab>
            </Tabs.List>
          </Tabs>
        </Paper>
        <Box
          id="screener-content"
          data-testid="screener-content"
          sx={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}
        >
          {activeTab === "screener" ? (
            <Box sx={{ display: "flex", flex: 1, minWidth: 0, minHeight: 0 }}>
              <ScreenerNav
                options={screenerOptions}
                activeScreener={activeScreener}
                onChange={onScreenerChange}
              />
              <MuiStack sx={{ flex: 1, minWidth: 0, minHeight: 0, gap: 0 }}>
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
                />
                <CompactAlerts activeScreener={activeScreener} warning={warning} />
                <Box sx={{ display: "flex", gap: 2, flex: 1, minHeight: 0, overflow: "hidden" }}>
                  {hasSideFilters && (
                    <Box sx={{ width: 220, flexShrink: 0, display: "flex" }}>
                      <Paper elevation={1} sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", p: 1 }}>
                        <ScreenerSidePanel activeScreener={activeScreener} screenerOptions={screenerOptions} />
                      </Paper>
                    </Box>
                  )}
                  <Paper elevation={1} sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
                    <CardContent sx={{ flex: 1, overflow: "auto", minHeight: 0, p: 1.5 }}>
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
                    </CardContent>
                    <SelectionBar onCompare={handleCompare} />
                  </Paper>
                </Box>
              </MuiStack>
            </Box>
          ) : (
            <Box sx={{ flex: 1, overflow: "auto", minHeight: 0, width: "100%" }}>
              {activeTab === "config" ? (
                <ScreenerConfigView
                  screenerOptions={screenerOptions}
                  activeScreener={activeScreener}
                  onScreenerChange={onConfigScreenerSelect}
                />
              ) : (
                <CorrelationTab />
              )}
            </Box>
          )}
        </Box>
      </MuiStack>
    </Box>
  );
}
