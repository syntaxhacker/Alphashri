import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Stack } from "@mantine/core";
import { LoadingOverlay } from "./LoadingOverlay";

const meta: Meta<typeof LoadingOverlay> = {
  title: "Design System/UI/Feedback/LoadingOverlay",
  component: LoadingOverlay,
  tags: ["autodocs"],
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
