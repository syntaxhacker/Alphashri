import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Stack } from "@/ui";
import { LoadingOverlay } from "./LoadingOverlay";

const meta: Meta<typeof LoadingOverlay> = {
  title: "Primitives/Feedback/LoadingOverlay",
  component: LoadingOverlay,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Overlay with centered Loader over content. Use while refreshing a panel or table. When not to use: for page-level loading use Loader centered. Uses Mantine LoadingOverlay with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof LoadingOverlay>;

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <Box pos="relative" h={160} p="md" style={{ border: "1px solid var(--mantine-color-dark-4)", borderRadius: 8 }}>
      {children}
    </Box>
  );
}

export const Default: Story = {
  render: () => (
    <Panel>
      <LoadingOverlay visible />
      <Stack gap="xs">
        <strong>Positions</strong>
        <span>NIFTY long @ 24,150 — P&L +0.8%</span>
        <span>BANKNIFTY short @ 51,200 — P&L -0.2%</span>
      </Stack>
    </Panel>
  ),
};

export const Hidden: Story = {
  render: () => (
    <Panel>
      <LoadingOverlay visible={false} />
      <Stack gap="xs">
        <strong>Positions</strong>
        <span>NIFTY long @ 24,150 — P&L +0.8%</span>
        <span>BANKNIFTY short @ 51,200 — P&L -0.2%</span>
      </Stack>
    </Panel>
  ),
};

export const WithZIndex: Story = {
  args: {
    visible: true,
    zIndex: 50,
    loaderProps: { size: "sm", color: "teal" },
  },
};
