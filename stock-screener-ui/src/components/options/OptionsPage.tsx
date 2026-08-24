import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { ScrollArea } from "@/ui";
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
    <Stack
      id="options-main"
      className="options-page"
      data-testid="options-view"
      spacing={1}
      sx={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
        <OptionsNav activeTab={activeTab} onTabChange={setActiveTab} />
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden", width: "100%", display: "flex", justifyContent: "center" }}>
        <Box sx={{ width: "100%", maxWidth: 1400, display: "flex", flexDirection: "column", alignItems: "center" }}>
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
                sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}
              >
                <PositionsPanel positions={positions || []} />
              </Box>
            )}

            {activeTab === "greeks" && (
              <Box
                id="greeks-container"
                className="options-tab-content"
                data-testid="options-greeks-tab"
                sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}
              >
                <GreeksPanel />
              </Box>
            )}
          </ScrollArea>
        </Box>
      </Box>
    </Stack>
  );
}
