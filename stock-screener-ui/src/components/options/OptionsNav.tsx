import { Tabs, TabsList, Tab } from "@/ui";

interface OptionsNavProps {
  activeTab: string;
  onTabChange: (value: string) => void;
}

export function OptionsNav({ activeTab, onTabChange }: OptionsNavProps) {
  return (
    <Tabs
      id="options-nav-tabs"
      className="options-nav"
      value={activeTab}
      onChange={(val) => val && onTabChange(val)}
      mb="md"
      data-testid="options-nav"
    >
      <TabsList className="options-nav-list" data-testid="options-nav-list">
        <Tab value="chain" className="options-nav-tab" data-testid="nav-tab-chain">
          Option Chain
        </Tab>
        <Tab value="positions" className="options-nav-tab" data-testid="nav-tab-positions">
          Positions
        </Tab>
        <Tab value="greeks" className="options-nav-tab" data-testid="nav-tab-greeks">
          Greeks
        </Tab>
      </TabsList>
    </Tabs>
  );
}
