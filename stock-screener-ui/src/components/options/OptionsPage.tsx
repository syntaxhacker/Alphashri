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

export function OptionsPage(props: OptionsPageProps) {
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
        <OptionsNav activeTab={props.activeTab} onTabChange={props.setActiveTab} />
      </ToolbarRow>

      {/* Chain controls stay mounted across chain/positions/premium tabs;
          the simulator owns its header, so the chain controls are hidden there. */}
      {props.activeTab !== "simulator" && (
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
            selectedUnderlying={props.selectedUnderlying}
            selectedExpiry={props.selectedExpiry}
            setUnderlying={props.setUnderlying}
            setExpiry={props.setExpiry}
            availableUnderlyings={props.availableUnderlyings}
            availableExpiries={props.availableExpiries}
          />
          <OptionChainFilters filters={props.filters} setFilters={props.setFilters} />
        </ToolbarRow>
      )}

      <div className="flex flex-col h-full overflow-hidden w-full min-h-0">
        <ScrollArea className="h-full" offsetScrollbars>
          {props.activeTab === "chain" && (
            <OptionChainPanel
                selectedUnderlying={props.selectedUnderlying}
                selectedExpiry={props.selectedExpiry}
                loading={props.loading}
                error={props.error}
                filters={props.filters}
                spotPrice={props.spotPrice}
                refreshChain={props.refreshChain}
                strikeMatrix={props.strikeMatrix}
                timestamp={props.timestamp}
                summary={props.summary}
              />
            )}

            {props.activeTab === "positions" && (
              <div
                id="positions-container"
                className="options-tab-content flex flex-col w-full min-h-0"
                data-testid="options-positions-tab"
              >
                <PositionsPanel positions={props.positions || []} />
              </div>
            )}

            {props.activeTab === "premium" && (
              <div
                id="premium-container"
                className="options-tab-content flex flex-col w-full min-h-0"
                data-testid="options-premium-tab"
              >
                <PremiumTrackerPanel strikeMatrix={props.strikeMatrix} selectedUnderlying={props.selectedUnderlying} />
              </div>
            )}

            {props.activeTab === "positioning" && (
              <div
                id="positioning-container"
                className="options-tab-content flex flex-col w-full min-h-0"
                data-testid="options-positioning-tab"
              >
                <PositioningPanel underlying={props.selectedUnderlying} expiry={props.selectedExpiry} />
              </div>
            )}

            {props.activeTab === "simulator" && (
              <div
                id="simulator-container"
                className="options-tab-content flex flex-col w-full min-h-0"
                data-testid="options-simulator-tab"
              >
                <SimulatorPanel
                  selectedUnderlying={props.selectedUnderlying}
                  selectedExpiry={props.selectedExpiry}
                  spotPrice={props.spotPrice}
                  strikeMatrix={props.strikeMatrix}
                  availableUnderlyings={props.availableUnderlyings}
                  availableExpiries={props.availableExpiries}
                  loading={props.loading && props.strikeMatrix.length === 0}
                  error={props.error}
                  onUnderlyingChange={props.setUnderlying}
                  onExpiryChange={props.setExpiry}
                />
              </div>
            )}
          </ScrollArea>
      </div>
    </Stack>
  );
}
