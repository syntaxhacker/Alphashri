import { useMemo } from "react";
import { Stack } from "@mantine/core";
import { useTableSort } from "../../hooks/useTableSort";
import { ScreenerEmpty } from "./ScreenerEmpty";
import { ScreenerLoading } from "./ScreenerLoading";
import { ScreenerErrorPanel } from "./ScreenerErrorPanel";
import { ScreenerSection } from "./ScreenerSection";
import { getColumnsForScreener } from "./columns";
import type { Stock } from "../../types";

interface Props {
  approachingStocks: Stock[];
  touchedStocks: Stock[];
  sortColumn: string;
  sortDirection: "asc" | "desc";
  handleSortChange: (column: string) => void;
  isLoading: boolean;
  error: string | null;
  totalStocks: number;
  onRefresh: () => void;
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
  activeScreener: string;
  viewMode: "table" | "heatmap";
}

export function ScreenerContent({
  approachingStocks,
  touchedStocks,
  sortColumn,
  sortDirection,
  handleSortChange,
  isLoading,
  error,
  totalStocks,
  onRefresh,
  onSymbolClick,
  onSymbolHover,
  activeScreener,
  viewMode,
}: Props) {
  const { getSortedData } = useTableSort<Stock>({ sortColumn, sortDirection });

  const sortedApproaching = useMemo(
    () => getSortedData(approachingStocks, (s) => s[sortColumn as keyof Stock] as string | number),
    [approachingStocks, getSortedData, sortColumn],
  );
  const sortedTouched = useMemo(
    () => getSortedData(touchedStocks, (s) => s[sortColumn as keyof Stock] as string | number),
    [touchedStocks, getSortedData, sortColumn],
  );

  const columns = getColumnsForScreener(activeScreener);
  const emptySet = new Set<string>();

  if (isLoading) return <ScreenerLoading />;
  if (error) return <ScreenerErrorPanel error={error} onRefresh={onRefresh} />;
  if (totalStocks === 0) return <ScreenerEmpty />;

  return (
    <Stack gap="sm" w="100%" style={{ minHeight: 0 }}>
      {sortedApproaching.length > 0 && (
        <ScreenerSection
          title={`Approaching (${sortedApproaching.length})`}
          description="Stocks nearing but have not yet touched the 52W high"
          testId="screener-approaching-section"
          stocks={sortedApproaching}
          columns={columns}
          touchedSymbols={emptySet}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSortChange={handleSortChange}
          onSymbolClick={onSymbolClick}
          onSymbolHover={onSymbolHover}
          viewMode={viewMode}
          section="approaching"
          activeScreener={activeScreener}
        />
      )}
      {sortedTouched.length > 0 && (
        <ScreenerSection
          title={`Touched (${sortedTouched.length})`}
          description="Stocks that have touched or broken out of the 52W high"
          testId="screener-touched-section"
          stocks={sortedTouched}
          columns={columns}
          touchedSymbols={new Set(sortedTouched.map((s) => s.symbol))}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSortChange={handleSortChange}
          onSymbolClick={onSymbolClick}
          onSymbolHover={onSymbolHover}
          viewMode={viewMode}
          section="touched"
          activeScreener={activeScreener}
        />
      )}
    </Stack>
  );
}
