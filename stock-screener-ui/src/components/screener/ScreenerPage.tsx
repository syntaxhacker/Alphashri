import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Stack, Box, Tabs, Flex, Text } from "@/ui";
import { IconTable, IconChartDots, IconSettings } from "@tabler/icons-react";
import * as state from "../../state";
import { CompactPage } from "../common/compact";
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

function useScreenerSort(activeScreener: string) {
  const sortColumn = state.sortColumn;
  const sortDirection = state.sortDirection;

  const handleSortChange = (column: string) => {
    if (state.sortColumn === column) {
      state.setSortDirection(state.sortDirection === "asc" ? "desc" : "asc");
    } else {
      state.setSortColumn(column);
      state.setSortDirection("desc");
    }
  };

  useEffect(() => {
    const meta = state.profileMetaById[activeScreener];
    if (meta?.default_sort?.column) {
      state.setSortColumn(meta.default_sort.column);
      state.setSortDirection(meta.default_sort.direction || "desc");
    }
  }, [activeScreener]);

  return { sortColumn, sortDirection, handleSortChange };
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
      px={8}
      py={2}
      style={{ flexShrink: 0, borderBottom: "1px solid var(--mantine-color-default-border)" }}
      data-testid="screener-52w-high-banner"
    >
      {lines.map((line) => (
        <Text key={line} size="10px" c="dimmed" lineClamp={2}>
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

  const { sortColumn, sortDirection, handleSortChange } = useScreenerSort(activeScreener);

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

  return (
    <CompactPage gap={4}>
      <Stack
        h="100%"
        id="screener-main"
        className="screener-page"
        gap={4}
        data-testid="screener-page"
      >
        <Box flex="0 0 auto" className="screener-controls" data-testid="screener-controls">
          <Tabs
            value={activeTab}
            onChange={(v) => {
              if (v && v !== "screener") {
                state.setSelectedSymbols([]);
              }
              if (v) setActiveTab(v);
            }}
          >
            <Tabs.List style={{ minHeight: 32 }}>
              <Tabs.Tab
                value="screener"
                leftSection={<IconTable size={14} />}
                data-testid="tab-screener"
                py={4}
              >
                Screener
              </Tabs.Tab>
              <Tabs.Tab
                value="correlation"
                leftSection={<IconChartDots size={14} />}
                data-testid="tab-correlation"
                py={4}
              >
                Correlation
              </Tabs.Tab>
              <Tabs.Tab
                value="config"
                leftSection={<IconSettings size={14} />}
                data-testid="tab-config"
                py={4}
              >
                Config
              </Tabs.Tab>
            </Tabs.List>
          </Tabs>
        </Box>
        <Box
          flex={1}
          id="screener-content"
          className="screener-content"
          style={{ minHeight: 0, display: "flex", overflow: "hidden" }}
          data-testid="screener-content"
        >
          {activeTab === "screener" ? (
            <Flex flex={1} miw={0} mih={0}>
              <ScreenerNav
                options={screenerOptions}
                activeScreener={activeScreener}
                onChange={onScreenerChange}
              />
              <Stack flex={1} gap={0} miw={0} mih={0}>
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
                <Flex flex={1} miw={0} mih={0}>
                  {screenerHasSideFilters(activeScreener) && (
                    <ScreenerSidePanel
                      activeScreener={activeScreener}
                      screenerOptions={screenerOptions}
                      sortColumn={sortColumn}
                      sortDirection={sortDirection}
                    />
                  )}
                  <Box
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      overflow: "hidden",
                      minWidth: 0,
                    }}
                  >
                    <Box style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                      <ScreenerContent
                        approachingStocks={approachingStocks}
                        touchedStocks={touchedStocks}
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        handleSortChange={handleSortChange}
                        isLoading={isLoading}
                        error={error}
                        onRefresh={onRefresh}
                        onSymbolClick={onSymbolClick}
                        onSymbolHover={onSymbolHover}
                        activeScreener={activeScreener}
                        viewMode={viewMode}
                      />
                    </Box>
                    <SelectionBar onCompare={handleCompare} />
                  </Box>
                </Flex>
              </Stack>
            </Flex>
          ) : (
            <Box style={{ flex: 1, overflow: "auto", minHeight: 0, width: "100%" }}>
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
      </Stack>
    </CompactPage>
  );
}