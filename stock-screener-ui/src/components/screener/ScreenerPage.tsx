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
    <Box sx={{ width: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <MuiStack
        spacing={1}
        id="screener-main"
        data-testid="screener-page"
        sx={{ minHeight: 0, width: "100%" }}
      >
        <Box data-testid="screener-controls" sx={{ px: 0, flex: "0 0 auto", width: "100%" }}>
          <Tabs
            value={activeTab}
            onChange={(v) => {
              if (v && v !== "screener") {
                state.setSelectedSymbols([]);
              }
              if (v) setActiveTab(v);
            }}
          >
            <Tabs.List sx={{ minHeight: 40, alignItems: "center" }}>
              <Tabs.Tab
                value="screener"
                leftSection={<IconTable size={14} />}
                data-testid="tab-screener"
                py={1}
              >
                Screener
              </Tabs.Tab>
              <Tabs.Tab
                value="correlation"
                leftSection={<IconChartDots size={14} />}
                data-testid="tab-correlation"
                py={1}
              >
                Correlation
              </Tabs.Tab>
              <Tabs.Tab
                value="config"
                leftSection={<IconSettings size={14} />}
                data-testid="tab-config"
                py={1}
              >
                Config
              </Tabs.Tab>
            </Tabs.List>
          </Tabs>
        </Box>
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
                <Grid container spacing={2} sx={{ flex: 1, minHeight: 0, minWidth: 0, flexWrap: "nowrap", overflow: "hidden" }}>
                  {hasSideFilters && (
                    <Grid size={{ xs: 12, md: 5 }} sx={{ display: "flex", minWidth: 0, maxWidth: { md: 220 } }}>
                      <ScreenerSidePanel
                        activeScreener={activeScreener}
                        screenerOptions={screenerOptions}
                      />
                    </Grid>
                  )}
                  <Grid size={{ xs: 12, md: hasSideFilters ? 7 : 12 }} sx={{ display: "flex", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
                    <Paper elevation={1} sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
                      <CardContent sx={{ flex: 1, overflow: "auto", minHeight: 0, p: 1, "&:last-child": { pb: 1 } }}>
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
                  </Grid>
                </Grid>
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
