import { Box } from "@/ui";
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
      className="flex items-center justify-start min-w-0"
      py={0}
    >
      <Tabs
        id="options-nav-tabs"
        className="options-nav"
        value={props.activeTab}
        onChange={(val) => val && props.onTabChange(val)}
        data-testid="options-nav"
      >
        <TabsList className="options-nav-list" data-testid="options-nav-list">
          <Tab value="chain" className="options-nav-tab" data-testid="nav-tab-chain">
            Option Chain
          </Tab>
          <Tab value="positions" className="options-nav-tab" data-testid="nav-tab-positions">
            Positions
          </Tab>
          <Tab value="premium" className="options-nav-tab" data-testid="nav-tab-premium">
            Premium
          </Tab>
          <Tab value="simulator" className="options-nav-tab" data-testid="nav-tab-simulator">
            Simulator
          </Tab>
          <Tab value="positioning" className="options-nav-tab" data-testid="nav-tab-positioning">
            Positioning
          </Tab>
        </TabsList>
      </Tabs>
      <button
        type="button"
        onClick={() => dock.open("NIFTY", "options")}
        className="ml-auto shrink-0 border-0 bg-transparent pl-2 font-mono text-[9px] text-fin-text-muted hover:text-fin-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-primary"
        data-testid="options-analytics-link"
      >
        Analytics ↗
      </button>
    </Box>
  );
}
