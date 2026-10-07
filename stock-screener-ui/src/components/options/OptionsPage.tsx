import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { ScrollArea, ToolbarRow } from "@/ui";
import { OptionChainPanel } from "./OptionChain/OptionChainPanel";
import { PositionsPanel } from "./OptionPositions/PositionsPanel";
import { PremiumTrackerPanel } from "./PremiumTracker/PremiumTrackerPanel";
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
      sx={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column", width: "100%" }}
    >
      <ToolbarRow
        id="options-nav-bar"
        gap={8}
        justify="flex-start"
        wrap={false}
        clip
        style={{
          height: 48,
          minHeight: 48,
          maxHeight: 48,
          paddingLeft: 12,
          paddingRight: 12,
          borderBottom: "1px solid var(--mui-palette-divider)",
          width: "100%",
          flexShrink: 0,
        }}
      >
        <OptionsNav activeTab={activeTab} onTabChange={setActiveTab} />
      </ToolbarRow>

      <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden", width: "100%", display: "flex", flexDirection: "column" }}>
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
                sx={{ display: "flex", flexDirection: "column", width: "100%" }}
              >
                <PositionsPanel positions={positions || []} />
              </Box>
            )}

            {activeTab === "premium" && (
              <Box
                id="premium-container"
                className="options-tab-content"
                data-testid="options-premium-tab"
                sx={{ display: "flex", flexDirection: "column", width: "100%" }}
              >
                <PremiumTrackerPanel strikeMatrix={strikeMatrix} selectedUnderlying={selectedUnderlying} />
              </Box>
            )}
          </ScrollArea>
      </Box>
    </Stack>
  );
}
