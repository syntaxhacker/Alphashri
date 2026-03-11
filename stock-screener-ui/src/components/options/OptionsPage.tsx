import { Box } from "@mantine/core";
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
    <Box data-testid="options-view">
      <OptionsNav activeTab={activeTab} onTabChange={setActiveTab} />

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

      {activeTab === "positions" && <PositionsPanel positions={positions || []} />}

      {activeTab === "greeks" && <GreeksPanel />}
    </Box>
  );
}

export default OptionsPage;
