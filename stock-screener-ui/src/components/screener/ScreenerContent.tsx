import { memo, useMemo } from "react";
import { Stack, Button, CopyButton } from "@/ui";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import { ScreenerEmpty } from "./ScreenerEmpty";
import { ScreenerLoading } from "./ScreenerLoading";
import { ScreenerErrorPanel } from "./ScreenerErrorPanel";
import { ScreenerSection } from "./ScreenerSection";
import { getColumnsForScreener } from "./columns";
import * as state from "../../state";
import type { Stock } from "../../types";

function approachRank(stock: Stock): number {
  if (stock.approach_type === "fresh") return 0;
  if (stock.approach_type === "retest") return 2;
  return 1;
}

function CopySymbolsAction({ stocks, testId }: { stocks: Stock[]; testId: string }) {
  const value = stocks.map((s) => s.symbol).join(",");
  return (
    <CopyButton value={value}>
      {({ copied, copy }) => (
        <Button
          size="xs"
          variant="subtle"
          color={copied ? "success" : "secondary"}
          onClick={copy}
          data-testid={testId}
        >
          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
          {copied ? "Copied" : "TV symbols"}
        </Button>
      )}
    </CopyButton>
  );
}

interface SectionConfig {
  key: "approaching" | "touched";
  stocks: Stock[];
  label: string;
  description: string;
  columns: ReturnType<typeof getColumnsForScreener>;
  touchedSymbols: Set<string>;
  copyTestId: string;
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
      // Fresh approaches first, then unknown, then retests (stable within groups).
      const ordered = [...approachingStocks].sort((a, b) => approachRank(a) - approachRank(b));
      result.push({
        key: "approaching",
        stocks: ordered,
        label: `${(sl?.primary || "Primary")} (${approachingStocks.length})`,
        description: sd?.primary || "",
        columns: getColumnsForScreener(activeScreener, "approaching"),
        touchedSymbols: new Set<string>(),
        copyTestId: "copy-approaching-symbols",
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
        copyTestId: "copy-touched-symbols",
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
            action={<CopySymbolsAction stocks={section.stocks} testId={section.copyTestId} />}
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
