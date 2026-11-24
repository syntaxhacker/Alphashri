import { Box, Text } from "@/ui";
import { Tabs, TabsList, Tab } from "@/ui";
import { useSymbolDock } from "@/components/common/symbolDockContext";

interface OptionsNavProps {
  activeTab: string;
  onTabChange: (value: string) => void;
}

export function OptionsNav(props: OptionsNavProps) {
  const dock = useSymbolDock();
  return (
    <Box
      id="options-nav-wrapper"
      data-testid="options-nav-wrapper"
      className="flex w-full min-w-0 items-center gap-1"
      py={0}
    >
      <Box className="relative min-w-0 flex-1">
        <Tabs
          id="options-nav-tabs"
          // The 34px nav bar must never wrap: the strip scrolls inside its own
          // flex item so every label stays on one line at 390px.
          className="options-nav w-full min-w-0"
          value={props.activeTab}
          onChange={(val) => val && props.onTabChange(val)}
          data-testid="options-nav"
        >
          <TabsList
            // A scrollbar would eat the fixed 34px bar's height; keyboard arrows
            // and touch still reach every tab, and the strip itself scrolls.
            // Trailing padding lets the last tab scroll clear of the overlay cue.
            className="options-nav-list flex-nowrap overflow-x-auto overscroll-x-contain pr-8 [&::-webkit-scrollbar]:hidden"
            style={{ "scrollbar-width": "none" }}
            data-testid="options-nav-list"
          >
            <Tab value="chain" className="options-nav-tab shrink-0 whitespace-nowrap" data-testid="nav-tab-chain">
              Option Chain
            </Tab>
            <Tab value="positions" className="options-nav-tab shrink-0 whitespace-nowrap" data-testid="nav-tab-positions">
              Positions
            </Tab>
            <Tab value="premium" className="options-nav-tab shrink-0 whitespace-nowrap" data-testid="nav-tab-premium">
              Premium
            </Tab>
            <Tab value="simulator" className="options-nav-tab shrink-0 whitespace-nowrap" data-testid="nav-tab-simulator">
              Simulator
            </Tab>
            <Tab value="positioning" className="options-nav-tab shrink-0 whitespace-nowrap" data-testid="nav-tab-positioning">
              Positioning
            </Tab>
          </TabsList>
        </Tabs>
        <Box
          data-testid="options-nav-overflow-cue"
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 flex items-center bg-gradient-to-l from-fin-surface via-fin-surface to-transparent pl-4 pr-1 text-fin-primary lg:hidden"
        >
          <Text fw={700} className="text-ui-micro leading-none">→</Text>
        </Box>
      </Box>
      <button
        type="button"
        onClick={() => dock.open("NIFTY", "options")}
        className="ml-auto shrink-0 whitespace-nowrap border-0 bg-transparent pl-1 pr-0 font-mono text-ui-micro text-fin-text-muted hover:text-fin-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-text"
        data-testid="options-analytics-link"
      >
        Analytics ↗
      </button>
    </Box>
  );
}
