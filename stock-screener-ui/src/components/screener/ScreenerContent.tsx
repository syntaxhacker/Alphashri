import { memo, useMemo } from "react";
import { Stack } from "@/ui";
import { ScreenerEmpty } from "./ScreenerEmpty";
import { ScreenerLoading } from "./ScreenerLoading";
import { ScreenerErrorPanel } from "./ScreenerErrorPanel";
import { ScreenerSection } from "./ScreenerSection";
import { getColumnsForScreener } from "./columns";
import * as state from "../../state";
import type { Stock } from "../../types";

interface SectionConfig {
  key: "approaching" | "touched";
  stocks: Stock[];
  label: string;
  description: string;
  columns: ReturnType<typeof getColumnsForScreener>;
  touchedSymbols: Set<string>;
}

interface Props {
  approachingStocks: Stock[];
  touchedStocks: Stock[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
  activeScreener: string;
  viewMode: "table" | "heatmap";
}

export const ScreenerContent = memo(function ScreenerContent({
  approachingStocks,
  touchedStocks,
  isLoading,
  error,
  onRefresh,
  onSymbolClick,
  onSymbolHover,
  activeScreener,
  viewMode,
}: Props) {
  const meta = state.profileMetaById[activeScreener];

  const scoreFormula = meta?.score_formula || "";

  const sections: SectionConfig[] = useMemo(() => {
    const sl = meta?.section_labels;
    const sd = meta?.section_descriptions;
    const result: SectionConfig[] = [];

    if (approachingStocks.length > 0) {
      result.push({
        key: "approaching",
        stocks: approachingStocks,
        label: `${(sl?.primary || "Primary")} (${approachingStocks.length})`,
        description: sd?.primary || "",
        columns: getColumnsForScreener(activeScreener, "approaching"),
        touchedSymbols: new Set<string>(),
      });
    }
    if (touchedStocks.length > 0) {
      result.push({
        key: "touched",
        stocks: touchedStocks,
        label: `${(sl?.secondary || "Secondary")} (${touchedStocks.length})`,
        description: sd?.secondary || "",
        columns: getColumnsForScreener(activeScreener, "touched"),
        touchedSymbols: new Set(touchedStocks.map((stock) => stock.symbol)),
      });
    }
    return result;
  }, [approachingStocks, touchedStocks, meta, activeScreener]);

  const hasResults = sections.length > 0;
  if (isLoading && !hasResults) return <ScreenerLoading />;
  if (error) return <ScreenerErrorPanel error={error} onRefresh={onRefresh} />;
  if (!hasResults) return <ScreenerEmpty />;

  return (
    <Stack gap={1} w="100%" p={0} sx={{ minHeight: 0, display: "flex", alignItems: "stretch" }}>
      {sections.map((section) => (
          <ScreenerSection
            key={section.key}
            title={section.label}
            description={section.description}
            testId={`screener-${section.key}-section`}
            stocks={section.stocks}
            columns={section.columns}
            badgeLabel={undefined}
            scoreFormula={scoreFormula}
            touchedSymbols={section.touchedSymbols}
            onSymbolClick={onSymbolClick}
            onSymbolHover={onSymbolHover}
            viewMode={viewMode}
            section={section.key}
            activeScreener={activeScreener}
          />
        ))}
    </Stack>
  );
});
