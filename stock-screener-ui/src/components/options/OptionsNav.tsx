import { Box } from "@/ui";
import { Tabs, TabsList, Tab } from "@/ui";

interface OptionsNavProps {
  activeTab: string;
  onTabChange: (value: string) => void;
}

export function OptionsNav({ activeTab, onTabChange }: OptionsNavProps) {
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
        value={activeTab}
        onChange={(val) => val && onTabChange(val)}
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
    </Box>
  );
}
