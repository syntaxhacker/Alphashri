import { Show } from "solid-js";
import { Box, Button, Stack, ScrollArea, ToolbarRow, useDisclosure } from "@/ui";
import * as palette from "@/ui/palette";
import { IconHelpCircle, IconRefresh } from "@/patterns/icons";
import { OptionChainPanel } from "./OptionChain/OptionChainPanel";
import { OptionChainHeader } from "./OptionChain/OptionChainHeader";
import { OptionChainFilters } from "./OptionChain/OptionChainFilters";
import { OptionChainGuide } from "./OptionChain/OptionChainGuide";
import { CHAIN_CONTROL_H } from "./OptionChain/controlClass";
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
  const [guideOpened, { open: openGuide, close: closeGuide }] = useDisclosure(false);

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
          height: "34px",
          "min-height": "34px",
          "max-height": "34px",
          "padding-left": "12px",
          "padding-right": "12px",
          "flex-shrink": 0,
        }}
      >
        <OptionsNav activeTab={props.activeTab} onTabChange={props.setActiveTab} />
      </ToolbarRow>

      {/* Chain controls stay mounted across chain/positions/premium tabs;
          the simulator owns its header, so the chain controls are hidden there.
          One band: every control on a single 24px line, the guide/refresh
          cluster pushed right by `ml-auto` (never its own row). */}
      <Show when={props.activeTab !== "simulator"}>
        <ToolbarRow
          id="options-chain-controls-bar"
          gap={8}
          justify="flex-start"
          wrap={false}
          className="w-full shrink-0 overflow-x-auto"
          style={{
            "padding-left": "12px",
            "padding-right": "12px",
            "padding-top": "2px",
            "padding-bottom": "2px",
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
          <Show when={props.activeTab === "chain"}>
            <Box
              data-testid="options-chain-actions"
              className="ml-auto flex shrink-0 items-center gap-2"
              style={{ height: `${CHAIN_CONTROL_H}px` }}
            >
              <Button
                variant="light"
                color="primary"
                size="xs"
                className="h-6"
                leftSection={<IconHelpCircle size={12} />}
                onClick={openGuide}
                data-testid="open-guide-btn"
              >
                Guide
              </Button>
              {/* A real <button>, not a Box: the suite asserts
                  toBeDisabled()/toBeEnabled(), which only exist on a form control. */}
              <button
                type="button"
                disabled={props.loading}
                aria-label="Refresh option chain"
                onClick={() => !props.loading && props.refreshChain()}
                className="inline-flex h-6 w-6 items-center justify-center border-0 bg-transparent p-0 text-fin-text-muted disabled:cursor-default disabled:opacity-50 enabled:cursor-pointer enabled:hover:text-fin-text"
                data-testid="refresh-chain-btn"
              >
                <IconRefresh size={14} />
              </button>
            </Box>
          </Show>
        </ToolbarRow>
      </Show>

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

      {/* Fixed overlay: kept outside the scroll container so it never inherits
          the chain panel's scroll offset. */}
      <OptionChainGuide opened={guideOpened()} onClose={closeGuide} />
    </Stack>
  );
}
