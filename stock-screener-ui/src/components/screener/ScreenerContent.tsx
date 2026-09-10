import { useMemo } from "react";
import { Stack } from "@/ui";
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
      });
    }
    if (touchedStocks.length > 0) {
      result.push({
        key: "touched",
        stocks: touchedStocks,
        label: `${(sl?.secondary || "Secondary")} (${touchedStocks.length})`,
        description: sd?.secondary || "",
      });
    }
    return result;
  }, [approachingStocks, touchedStocks, meta]);

  if (isLoading) return <ScreenerLoading />;
  if (error) return <ScreenerErrorPanel error={error} onRefresh={onRefresh} />;
  if (sections.length === 0) return <ScreenerEmpty />;

  return (
    <Stack gap={1} w="100%" p={0} sx={{ minHeight: 0, display: "flex", alignItems: "stretch" }}>
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
