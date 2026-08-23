import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { OptionsPage } from "@/components/options/OptionsPage";
import { MOCK_OPTION_CHAIN, MOCK_SPOT_NIFTY } from "@/stories/fixtures";

const meta: Meta = {
  title: "Templates/Options",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Options — NIFTY/spot option chain table with OI, volume, IV, greeks, PCR and max pain from `components/options/OptionsPage.tsx`. Use to analyze expiries and strikes at /options. When not: for equity screening use Stock Screener at /.",
      },
    },
  },
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <MemoryRouter initialEntries={["/options"]}>
      <OptionsPage
        activeTab="chain"
        setActiveTab={() => {}}
        selectedUnderlying="NIFTY"
        selectedExpiry={MOCK_OPTION_CHAIN.expiry}
        loading={false}
        error={null}
        filters={{}}
        spotPrice={MOCK_SPOT_NIFTY}
        setUnderlying={() => {}}
        setExpiry={() => {}}
        setFilters={() => {}}
        refreshChain={() => {}}
        availableUnderlyings={["NIFTY", "RELIANCE"]}
        availableExpiries={[MOCK_OPTION_CHAIN.expiry]}
        strikeMatrix={MOCK_OPTION_CHAIN.chain}
        summary={MOCK_OPTION_CHAIN.summary}
      />
    </MemoryRouter>
  ),
};
