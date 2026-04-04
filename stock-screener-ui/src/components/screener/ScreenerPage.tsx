import { Stack, Box, Button, Text, Group } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useState, useMemo } from "react";
import { ScreenerNav } from "./ScreenerNav";
import { ScreenerHeader } from "./ScreenerHeader";
import { ScreenerTable } from "./ScreenerTable";
import { ScreenerHeatmap } from "./ScreenerHeatmap";
import { ScreenerEmpty } from "./ScreenerEmpty";
import { ScreenerLoading } from "./ScreenerLoading";
import { getColumnsForScreener } from "./columns";
import type { Stock } from "../../types";
import { useTableSort } from "../../hooks/useTableSort";
import { CompactPage, CompactPanel } from "../common/compact";

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
  const {
    sortColumn,
    sortDirection,
    handleSort: handleSortChange,
    getSortedData,
  } = useTableSort<Stock>({
    initialColumn: "score",
    initialDirection: "desc",
  });
  const [viewMode, setViewMode] = useState<"table" | "heatmap">("table");

  const sortedApproaching = useMemo(
    () =>
      getSortedData(
        approachingStocks ?? [],
        (s) => s[sortColumn as keyof Stock] as string | number,
      ),
    [approachingStocks, getSortedData, sortColumn],
  );

  const sortedTouched = useMemo(
    () =>
      getSortedData(touchedStocks ?? [], (s) => s[sortColumn as keyof Stock] as string | number),
    [touchedStocks, getSortedData, sortColumn],
  );

  const columns = getColumnsForScreener(activeScreener);
  const emptySet = new Set<string>();
  const totalStocks = (approachingStocks ?? []).length + (touchedStocks ?? []).length;

  const renderStocksView = (stocks: Stock[], touchedSymbols: Set<string>) => {
    if (viewMode === "heatmap") {
      return (
        <ScreenerHeatmap
          stocks={stocks}
          columns={columns}
          touchedSymbols={touchedSymbols}
          onSymbolClick={onSymbolClick}
          onSymbolHover={onSymbolHover}
        />
      );
    }

    return (
      <ScreenerTable
        stocks={stocks}
        columns={columns}
        touchedSymbols={touchedSymbols}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
        onSymbolClick={onSymbolClick}
        onSymbolHover={onSymbolHover}
        screenerType={activeScreener}
      />
    );
  };

  const renderContent = () => {
    if (isLoading) {
      return <ScreenerLoading />;
    }

    if (error) {
      return (
        <Stack
          gap="sm"
          align="stretch"
          className="screener-error-container"
          data-testid="screener-error-container"
        >
          <CompactPanel
            testId="screener-error"
            className="screener-alert"
            title={
              <Group gap="xs" wrap="nowrap">
                <IconAlertCircle size={18} />
                <Text fw={600} size="sm">
                  Screener failed to load
                </Text>
              </Group>
            }
            description={error}
            action={
              <Button
                onClick={onRefresh}
                variant="light"
                color="red"
                size="sm"
                data-testid="screener-retry-btn"
              >
                Retry
              </Button>
            }
          />
        </Stack>
      );
    }

    if (totalStocks === 0) {
      return <ScreenerEmpty />;
    }

    return (
      <Stack
        gap="sm"
        style={{
          height: "100%",
          width: "100%",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {sortedApproaching.length > 0 && (
          <CompactPanel
            className="screener-section approaching-section"
            title={`Approaching (${sortedApproaching.length})`}
            description="Stocks nearing but have not yet touched the 52W high"
            testId="screener-approaching-section"
            style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
          >
            <Box style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              {renderStocksView(sortedApproaching, emptySet)}
            </Box>
          </CompactPanel>
        )}

        {sortedTouched.length > 0 && (
          <CompactPanel
            className="screener-section touched-section"
            title={`Touched (${sortedTouched.length})`}
            description="Stocks that have touched or broken out of the 52W high"
            testId="screener-touched-section"
            style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
          >
            <Box style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              {renderStocksView(sortedTouched, new Set(sortedTouched.map((s) => s.symbol)))}
            </Box>
          </CompactPanel>
        )}
      </Stack>
    );
  };

  return (
    <CompactPage>
      <Box
        h="100%"
        id="screener-main"
        className="screener-page"
        style={{ display: "flex", flexDirection: "column", gap: "var(--mantine-spacing-sm)" }}
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
          style={{ minHeight: 0, display: "flex" }}
          data-testid="screener-content"
        >
          {renderContent()}
        </Box>
      </Box>
    </CompactPage>
  );
}
