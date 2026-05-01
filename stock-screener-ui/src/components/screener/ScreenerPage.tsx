import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Stack, Box, Tabs } from "@mantine/core";
import { IconTable, IconChartDots } from "@tabler/icons-react";
import * as state from "../../state";
import { CompactPage } from "../common/compact";
import { ScreenerNav } from "./ScreenerNav";
import { ScreenerHeader } from "./ScreenerHeader";
import { ScreenerContent } from "./ScreenerContent";
import { CorrelationTab } from "./CorrelationTab";
import { SelectionBar } from "./SelectionBar";
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

export function ScreenerPage({
  screenerOptions,
  activeScreener,
  onScreenerChange,
  title,
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
    <CompactPage>
      <Stack
        h="100%"
        id="screener-main"
        className="screener-page"
        gap="sm"
        data-testid="screener-page"
      >
        <Box flex="0 0 auto" className="screener-controls" data-testid="screener-controls">
          <Stack gap="sm">
            <Tabs value={activeTab} onChange={(v) => v && setActiveTab(v)}>
              <Tabs.List>
                <Tabs.Tab
                  value="screener"
                  leftSection={<IconTable size={16} />}
                  data-testid="tab-screener"
                >
                  Screener
                </Tabs.Tab>
                <Tabs.Tab
                  value="correlation"
                  leftSection={<IconChartDots size={16} />}
                  data-testid="tab-correlation"
                >
                  Correlation
                </Tabs.Tab>
              </Tabs.List>
            </Tabs>
            {activeTab === "screener" && (
              <>
                <ScreenerNav
                  options={screenerOptions}
                  activeScreener={activeScreener}
                  onChange={onScreenerChange}
                />
                <ScreenerHeader
                  title={title}
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
              </>
            )}
          </Stack>
        </Box>
        <Box
          flex={1}
          id="screener-content"
          className="screener-content"
          style={{ minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
          data-testid="screener-content"
        >
          <Box style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            {activeTab === "correlation" ? (
              <CorrelationTab />
            ) : (
              <ScreenerContent
                approachingStocks={approachingStocks}
                touchedStocks={touchedStocks}
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                handleSortChange={handleSortChange}
                isLoading={isLoading}
                error={error}
                totalStocks={approachingStocks.length + touchedStocks.length}
                onRefresh={onRefresh}
                onSymbolClick={onSymbolClick}
                onSymbolHover={onSymbolHover}
                activeScreener={activeScreener}
                viewMode={viewMode}
              />
            )}
          </Box>
          {activeTab === "screener" && <SelectionBar onCompare={handleCompare} />}
        </Box>
      </Stack>
    </CompactPage>
  );
}
