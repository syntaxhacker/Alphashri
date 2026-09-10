import { MemoryRouter } from "react-router-dom";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@/ui";
import { PaperPositionsTable } from "@/components/paper-trading/PaperPositionsTable2";
import { MOCK_PAPER_POSITIONS } from "@/stories/fixtures";
import { setPositions, resetPaperTradingState } from "@/state/paperTrading";

const meta: Meta<typeof PaperPositionsTable> = {
  title: "Patterns/Tables/Positions",
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Positions pattern — live positions table with real-time P&L (PnlText), side/status badges, and popover detail. Use for any open-positions view backed by `useLivePrices` or polling. Default seeds via `setPositions(MOCK_PAPER_POSITIONS)`. When not: for closed/history rows use PaperHistory/TradeHistory instead.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof PaperPositionsTable>;

export const Default: Story = {
  decorators: [(Story) => { setPositions(MOCK_PAPER_POSITIONS as any); return <MemoryRouter><Story /></MemoryRouter>; }],
  render: () => <Box p="sm"><PaperPositionsTable /></Box>,
};
export const Empty: Story = {
  decorators: [(Story) => { resetPaperTradingState(); setPositions([]); return <MemoryRouter><Story /></MemoryRouter>; }],
  render: () => <Box p="sm"><PaperPositionsTable /></Box>,
};
