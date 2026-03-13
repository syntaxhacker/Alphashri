import { Tabs } from "@mantine/core";

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
      variant="pills"
      color="blue"
      mb="md"
      data-testid="options-nav"
    >
      <Tabs.List className="options-nav-list" data-testid="options-nav-list">
        <Tabs.Tab
          value="chain"
          className="options-nav-tab"
          data-testid="nav-tab-chain"
        >
          Option Chain
        </Tabs.Tab>
        <Tabs.Tab
          value="positions"
          className="options-nav-tab"
          data-testid="nav-tab-positions"
        >
          Positions
        </Tabs.Tab>
        <Tabs.Tab
          value="greeks"
          className="options-nav-tab"
          data-testid="nav-tab-greeks"
        >
          Greeks
        </Tabs.Tab>
      </Tabs.List>
    </Tabs>
  );
}
