import { Box, ScrollArea } from "@mantine/core";
import { OptionChainPanel } from "./OptionChain/OptionChainPanel";
import { PositionsPanel } from "./OptionPositions/PositionsPanel";
import { GreeksPanel } from "./OptionGreeks/GreeksPanel";
import { OptionsNav } from "./OptionsNav";

interface OptionsPageProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  selectedUnderlying: string;
  selectedExpiry: string;
  loading: boolean;
  error: string | null;
  filters: any;
  spotPrice: number | null;
  setUnderlying: (u: string) => void;
  setExpiry: (e: string) => void;
  setFilters: (f: any) => void;
  refreshChain: () => void;
  availableUnderlyings: string[];
  availableExpiries: string[];
  strikeMatrix: Array<{ strike: number; ce: any; pe: any }>;
  positions?: any[];
  timestamp?: string;
  summary?: any;
}

export function OptionsPage({
  activeTab,
  setActiveTab,
  selectedUnderlying,
  selectedExpiry,
  loading,
  error,
  filters,
  spotPrice,
  setUnderlying,
  setExpiry,
  setFilters,
  refreshChain,
  availableUnderlyings,
  availableExpiries,
  strikeMatrix,
  positions,
  timestamp,
  summary,
}: OptionsPageProps) {
  return (
    <Box
      id="options-main"
      className="options-page"
      h="100%"
      style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
      data-testid="options-view"
    >
      <OptionsNav activeTab={activeTab} onTabChange={setActiveTab} />

      <Box flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
        <ScrollArea h="100%" offsetScrollbars>
          {activeTab === "chain" && (
            <OptionChainPanel
              selectedUnderlying={selectedUnderlying}
              selectedExpiry={selectedExpiry}
              loading={loading}
              error={error}
              filters={filters}
              spotPrice={spotPrice}
              setUnderlying={setUnderlying}
              setExpiry={setExpiry}
              setFilters={setFilters}
              refreshChain={refreshChain}
              availableUnderlyings={availableUnderlyings}
              availableExpiries={availableExpiries}
              strikeMatrix={strikeMatrix}
              timestamp={timestamp}
              summary={summary}
            />
          )}

          {activeTab === "positions" && (
            <Box
              id="positions-container"
              className="options-tab-content"
              data-testid="options-positions-tab"
            >
              <PositionsPanel positions={positions || []} />
            </Box>
          )}

          {activeTab === "greeks" && (
            <Box
              id="greeks-container"
              className="options-tab-content"
              data-testid="options-greeks-tab"
            >
              <GreeksPanel />
            </Box>
          )}
        </ScrollArea>
      </Box>
    </Box>
  );
}
