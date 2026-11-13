import { Stack, ScrollArea, ToolbarRow } from "@/ui";
import * as palette from "@/ui/palette";
import { OptionChainPanel } from "./OptionChain/OptionChainPanel";
import { OptionChainHeader } from "./OptionChain/OptionChainHeader";
import { OptionChainFilters } from "./OptionChain/OptionChainFilters";
import { PositionsPanel } from "./OptionPositions/PositionsPanel";
import { PremiumTrackerPanel } from "./PremiumTracker/PremiumTrackerPanel";
import { PositioningPanel } from "./Positioning/PositioningPanel";
import { SimulatorPanel } from "./Simulator/SimulatorPanel";
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
      className="options-page flex flex-col h-full overflow-hidden w-full min-h-0"
      data-testid="options-view"
      spacing={1}
    >
      <ToolbarRow
        id="options-nav-bar"
        gap={8}
        justify="flex-start"
        wrap={false}
        clip
        className="w-full shrink-0"
        style={{
          height: palette.FIN_HEADER_H,
          "min-height": palette.FIN_HEADER_H,
          "max-height": palette.FIN_HEADER_H,
          "padding-left": "12px",
          "padding-right": "12px",
          "border-bottom": `1px solid ${palette.BORDER}`,
          "flex-shrink": 0,
        }}
      >
        <OptionsNav activeTab={activeTab} onTabChange={setActiveTab} />
      </ToolbarRow>

      {/* Chain controls stay mounted across chain/positions/premium tabs;
          the simulator owns its header, so the chain controls are hidden there. */}
      {activeTab !== "simulator" && (
        <ToolbarRow
          id="options-chain-controls-bar"
          gap={8}
          justify="flex-start"
          className="w-full shrink-0"
          style={{
            "padding-left": "12px",
            "padding-right": "12px",
            "padding-top": "4px",
            "padding-bottom": "4px",
            "border-bottom": `1px solid ${palette.BORDER}`,
            "flex-shrink": 0,
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
      )}

      <div className="flex flex-col h-full overflow-hidden w-full min-h-0">
        <ScrollArea className="h-full" offsetScrollbars>
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
              <div
                id="positions-container"
                className="options-tab-content flex flex-col w-full min-h-0"
                data-testid="options-positions-tab"
              >
                <PositionsPanel positions={positions || []} />
              </div>
            )}

            {activeTab === "premium" && (
              <div
                id="premium-container"
                className="options-tab-content flex flex-col w-full min-h-0"
                data-testid="options-premium-tab"
              >
                <PremiumTrackerPanel strikeMatrix={strikeMatrix} selectedUnderlying={selectedUnderlying} />
              </div>
            )}

            {activeTab === "positioning" && (
              <div
                id="positioning-container"
                className="options-tab-content flex flex-col w-full min-h-0"
                data-testid="options-positioning-tab"
              >
                <PositioningPanel underlying={selectedUnderlying} expiry={selectedExpiry} />
              </div>
            )}

            {activeTab === "simulator" && (
              <div
                id="simulator-container"
                className="options-tab-content flex flex-col w-full min-h-0"
                data-testid="options-simulator-tab"
              >
                <SimulatorPanel
                  selectedUnderlying={selectedUnderlying}
                  selectedExpiry={selectedExpiry}
                  spotPrice={spotPrice}
                  strikeMatrix={strikeMatrix}
                  availableUnderlyings={availableUnderlyings}
                  availableExpiries={availableExpiries}
                  loading={loading && strikeMatrix.length === 0}
                  error={error}
                  onUnderlyingChange={setUnderlying}
                  onExpiryChange={setExpiry}
                />
              </div>
            )}
          </ScrollArea>
      </div>
    </Stack>
  );
}
