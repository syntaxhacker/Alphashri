import { useMemo } from "react";
import { Stack } from "@mantine/core";
import { useTableSort } from "../../hooks/useTableSort";
import { ScreenerEmpty } from "./ScreenerEmpty";
import { ScreenerLoading } from "./ScreenerLoading";
import { ScreenerErrorPanel } from "./ScreenerErrorPanel";
import { ScreenerSection } from "./ScreenerSection";
import { getColumnsForScreener } from "./columns";
import * as state from "../../state";
import type { Stock } from "../../types";

interface SectionConfig {
  key: string;
  stocks: Stock[];
  label: string;
  description: string;
}

interface Props {
  approachingStocks: Stock[];
  touchedStocks: Stock[];
  sortColumn: string;
  sortDirection: "asc" | "desc";
  handleSortChange: (column: string) => void;
  isLoading: boolean;
  error: string | null;
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
  onRefresh,
  onSymbolClick,
  onSymbolHover,
  activeScreener,
  viewMode,
}: Props) {
  const { getSortedData } = useTableSort<Stock>({ sortColumn, sortDirection });

  const meta = state.profileMetaById[activeScreener];

  const scoreFormula = meta?.score_formula || "";

  const sections: SectionConfig[] = useMemo(() => {
    const sl = meta?.section_labels;
    const sd = meta?.section_descriptions;
    const result: SectionConfig[] = [];

    const sortedApproaching = getSortedData(approachingStocks, (s) => s[sortColumn as keyof Stock] as string | number);
    const sortedTouched = getSortedData(touchedStocks, (s) => s[sortColumn as keyof Stock] as string | number);

    if (sortedApproaching.length > 0) {
      result.push({
        key: "approaching",
        stocks: sortedApproaching,
        label: `${(sl?.primary || "Primary")} (${sortedApproaching.length})`,
        description: sd?.primary || "",
      });
    }
    if (sortedTouched.length > 0) {
      result.push({
        key: "touched",
        stocks: sortedTouched,
        label: `${(sl?.secondary || "Secondary")} (${sortedTouched.length})`,
        description: sd?.secondary || "",
      });
    }
    return result;
  }, [approachingStocks, touchedStocks, meta, sortColumn, getSortedData]);

  if (isLoading) return <ScreenerLoading />;
  if (error) return <ScreenerErrorPanel error={error} onRefresh={onRefresh} />;
  if (sections.length === 0) return <ScreenerEmpty />;

  return (
    <Stack gap={6} w="100%" p={6} style={{ minHeight: 0 }}>
      {sections.map((section) => {
        const columns = getColumnsForScreener(
          activeScreener,
          section.key as "approaching" | "touched",
        );
        return (
          <ScreenerSection
            key={section.key}
            title={section.label}
            description={section.description}
            testId={`screener-${section.key}-section`}
            stocks={section.stocks}
            columns={columns}
            badgeLabel={undefined}
            scoreFormula={scoreFormula}
            touchedSymbols={
              section.key === "touched"
                ? new Set(section.stocks.map((s) => s.symbol))
                : new Set<string>()
            }
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onSortChange={handleSortChange}
            onSymbolClick={onSymbolClick}
            onSymbolHover={onSymbolHover}
            viewMode={viewMode}
            section={section.key}
            activeScreener={activeScreener}
          />
        );
      })}
    </Stack>
  );
}
