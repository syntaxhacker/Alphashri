import { useState, useEffect } from "react";
import { Stack, Box } from "@mantine/core";
import * as state from "../../state";
import { CompactPage } from "../common/compact";
import { ScreenerNav } from "./ScreenerNav";
import { ScreenerHeader } from "./ScreenerHeader";
import { ScreenerContent } from "./ScreenerContent";
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

  const { sortColumn, sortDirection, handleSortChange } = useScreenerSort(activeScreener);

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
          </Stack>
        </Box>
        <Box
          flex={1}
          id="screener-content"
          className="screener-content"
          style={{ minHeight: 0 }}
          data-testid="screener-content"
        >
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
        </Box>
      </Stack>
    </CompactPage>
  );
}
