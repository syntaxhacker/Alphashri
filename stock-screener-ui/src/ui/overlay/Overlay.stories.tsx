import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Text, Title, Box, Button, Group } from "@/ui";
import { Overlay } from "./Overlay";

const meta: Meta<typeof Overlay> = {
  title: "Primitives/Overlays/Overlay",
  component: Overlay,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Semi-transparent backdrop over content. Use behind modals or to dim background. When not to use: for modals use Modal. Uses MUI Overlay with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Overlay>;

const panelStyle = {
  width: "100%",
  height: 160,
  position: "relative" as const,
  borderRadius: "8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export const Default: Story = {
  render: () => (
    <Stack gap="sm">
      <Title order={5}>Dark overlay at 0.6 opacity</Title>
      <Box style={panelStyle}>
        <Text size="sm">Content beneath the overlay</Text>
        <Overlay opacity={0.6} color="common.black" zIndex={5} />
      </Box>
    </Stack>
  ),
};

export const OpacityScale: Story = {
  render: () => (
    <Stack gap="md">
      <Title order={5}>Opacity scale (0.25 / 0.6 / 0.85)</Title>
      <Group grow gap="md">
        {[
          { opacity: 0.25, label: "opacity 0.25" },
          { opacity: 0.6, label: "opacity 0.60" },
          { opacity: 0.85, label: "opacity 0.85" },
        ].map(({ opacity, label }) => (
          <Box key={label} style={{ ...panelStyle, height: 120 }}>
            <Button size="compact-sm" variant="light">{label}</Button>
            <Overlay opacity={opacity} color="common.black" zIndex={5} />
          </Box>
        ))}
      </Group>
    </Stack>
  ),
};

export const BlurAndCenteredContent: Story = {
  render: () => (
    <Stack gap="sm">
      <Title order={5}>Blur + centered children</Title>
      <Box style={panelStyle}>
        <Text size="sm">Sensitive data behind blur</Text>
        <Overlay blur={4} center zIndex={5}>
          <Text size="sm" c="white" fw={600}>Hidden until enabled</Text>
        </Overlay>
      </Box>
    </Stack>
  ),
};
