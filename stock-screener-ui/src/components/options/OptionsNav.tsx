import { Tabs } from "@mantine/core";

interface OptionsNavProps {
  activeTab: string;
  onTabChange: (value: string) => void;
}

export function OptionsNav({ activeTab, onTabChange }: OptionsNavProps) {
  return (
    <Tabs
      value={activeTab}
      onChange={(val) => val && onTabChange(val)}
      variant="pills"
      color="blue"
      mb="md"
      data-testid="options-nav"
    >
      <Tabs.List>
        <Tabs.Tab value="chain" data-testid="nav-tab-chain">
          Option Chain
        </Tabs.Tab>
        <Tabs.Tab value="positions" data-testid="nav-tab-positions">
          Positions
        </Tabs.Tab>
        <Tabs.Tab value="greeks" data-testid="nav-tab-greeks">
          Greeks
        </Tabs.Tab>
      </Tabs.List>
    </Tabs>
  );
}
