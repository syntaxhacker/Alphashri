import Box from "@mui/material/Box";
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
      sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", py: 1 }}
    >
      <Tabs
        id="options-nav-tabs"
        className="options-nav"
        value={activeTab}
        onChange={(val) => val && onTabChange(val)}
        data-testid="options-nav"
      >
        <TabsList
          className="options-nav-list"
          data-testid="options-nav-list"
          sx={{ display: "flex", alignItems: "center", justifyContent: "center" } as any}
        >
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
    </Box>
  );
}
