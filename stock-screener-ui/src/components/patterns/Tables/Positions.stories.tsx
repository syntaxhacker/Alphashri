import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@/ui";
import { PaperPositionsTable } from "@/components/paper-trading/PaperPositionsTable2";
import { MOCK_PAPER_POSITIONS } from "@/stories/fixtures";
import { setPositions, resetPaperTradingState } from "@/state/paperTrading";

const meta: Meta<typeof PaperPositionsTable> = {
  title: "Patterns/Tables/Positions",
  tags: ["autodocs"],
  parameters: { layout: "padded", docs: { description: { component: "PaperPositionsTable — exact component. Default seeds store via `setPositions(MOCK_PAPER_POSITIONS)`." } } },
};
export default meta;
type Story = StoryObj<typeof PaperPositionsTable>;

export const Default: Story = {
  decorators: [(Story) => { setPositions(MOCK_PAPER_POSITIONS as any); return <Story />; }],
  render: () => <Box p="sm"><PaperPositionsTable /></Box>,
};
export const Empty: Story = {
  decorators: [(Story) => { resetPaperTradingState(); setPositions([]); return <Story />; }],
  render: () => <Box p="sm"><PaperPositionsTable /></Box>,
};
