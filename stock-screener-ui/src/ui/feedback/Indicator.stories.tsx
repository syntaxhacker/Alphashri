import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Group } from "@/ui";
import { Indicator } from "./Indicator";

const meta: Meta<typeof Indicator> = {
  title: "Primitives/Feedback/Indicator",
  component: Indicator,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Dot or badge anchored to a child. Use for unread counts or status dots on avatars. When not to use: for standalone badges use Badge. Uses MUI Indicator with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Indicator>;

function Placeholder() {
  return (
    <Box
      w={48}
      h={48}
      style={{
        borderRadius: "50%",
        backgroundColor: "var(--mui-palette-grey-700)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 600,
      }}
    >
      AS
    </Box>
  );
}

export const Default: Story = {
  render: () => (
    <Group gap="lg">
      <Indicator>
        <Placeholder />
      </Indicator>
      <Indicator color="red">
        <Placeholder />
      </Indicator>
    </Group>
  ),
};

export const WithLabel: Story = {
  args: {
    color: "red",
    label: "3",
    size: 18,
  },
};

export const Positions: Story = {
  render: () => (
    <Group gap="xl">
      <Indicator position="top-start">
        <Placeholder />
      </Indicator>
      <Indicator position="top-end" color="green">
        <Placeholder />
      </Indicator>
      <Indicator position="bottom-start" color="orange">
        <Placeholder />
      </Indicator>
      <Indicator position="bottom-end" color="violet">
        <Placeholder />
      </Indicator>
    </Group>
  ),
};

export const Processing: Story = {
  render: () => (
    <Group gap="lg">
      <Indicator processing size={14}>
        <Placeholder />
      </Indicator>
      <span>Bot syncing…</span>
    </Group>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Indicator disabled label="off">
      <Placeholder />
    </Indicator>
  ),
};

export const Inline: Story = {
  render: () => (
    <Group gap={8}>
      <Indicator color="teal" size={10}>
        <span style={{ fontSize: 12 }}>Live feed</span>
      </Indicator>
    </Group>
  ),
};
