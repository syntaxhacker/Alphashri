import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { ScrollArea, ToolbarRow } from "@/ui";
import { OptionChainPanel } from "./OptionChain/OptionChainPanel";
import { OptionChainHeader } from "./OptionChain/OptionChainHeader";
import { OptionChainFilters } from "./OptionChain/OptionChainFilters";
import { PositionsPanel } from "./OptionPositions/PositionsPanel";
import { PremiumTrackerPanel } from "./PremiumTracker/PremiumTrackerPanel";
import { PositioningPanel } from "./Positioning/PositioningPanel";
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

      {/* Chain controls live in the options toolbar (not the chain panel) so
          they stay mounted across chain/positions/premium tabs. */}
      <ToolbarRow
        id="options-chain-controls-bar"
        gap={8}
        justify="flex-start"
        style={{
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 4,
          paddingBottom: 4,
          borderBottom: "1px solid var(--mui-palette-divider)",
          width: "100%",
          flexShrink: 0,
        }}
      >
        <OptionChainHeader
          selectedUnderlying={selectedUnderlying}
          selectedExpiry={selectedExpiry}
          setUnderlying={setUnderlying}
          setExpiry={setExpiry}
          availableUnderlyings={availableUnderlyings}
          availableExpiries={availableExpiries}
        />
        <OptionChainFilters filters={filters} setFilters={setFilters} />
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
                refreshChain={refreshChain}
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

            {activeTab === "positioning" && (
              <Box
                id="positioning-container"
                className="options-tab-content"
                data-testid="options-positioning-tab"
                sx={{ display: "flex", flexDirection: "column", width: "100%" }}
              >
                <PositioningPanel underlying={selectedUnderlying} expiry={selectedExpiry} />
              </Box>
            )}
          </ScrollArea>
      </Box>
    </Stack>
  );
}
