import { MemoryRouter } from "react-router-dom";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@/ui";
import { PaperHistoryTable } from "@/components/paper-trading/PaperHistoryTable2";
import { MOCK_PAPER_TRADES } from "@/stories/fixtures";
import { setTrades, resetPaperTradingState } from "@/state/paperTrading";

const meta: Meta<typeof PaperHistoryTable> = {
  title: "Patterns/Tables/PaperHistory",
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "PaperHistory pattern — expandable trade rows with PnlText + ExitReasonBadge + inline notes. Use for any history table with row expansion. Default seeds store via `setTrades(MOCK_PAPER_TRADES)`. When not: for simple lists without expansion use TableStates + plain Table.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof PaperHistoryTable>;

export const Default: Story = {
  decorators: [(Story) => { setTrades(MOCK_PAPER_TRADES as any); return <MemoryRouter><Story /></MemoryRouter>; }],
  render: () => <Box p="sm"><PaperHistoryTable /></Box>,
};
export const Empty: Story = {
  decorators: [(Story) => { resetPaperTradingState(); setTrades([]); return <MemoryRouter><Story /></MemoryRouter>; }],
  render: () => <Box p="sm"><PaperHistoryTable /></Box>,
};
