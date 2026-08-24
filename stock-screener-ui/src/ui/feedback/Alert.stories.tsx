import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@/ui";
import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import { Alert } from "./Alert";

const meta: Meta<typeof Alert> = {
  title: "Primitives/Feedback/Alert",
  component: Alert,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Callout for success, warning, error, or info. Use for form errors, system messages, or risk notices. When not to use: for transient feedback use Notification. Uses MUI Alert with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Alert>;

export const Default: Story = {
  args: {
    title: "Default alert",
    children: "This is a default alert message.",
  },
};

export const Info: Story = {
  args: {
    color: "blue",
    title: "Info",
    icon: <IconInfoCircle size={18} />,
    children: "Market data will refresh every 5 seconds during trading hours.",
  },
};

export const Success: Story = {
  args: {
    color: "green",
    title: "Success",
    children: "Your strategy config was saved.",
  },
};

export const Warning: Story = {
  args: {
    color: "orange",
    title: "Warning",
    icon: <IconAlertTriangle size={18} />,
    children: "Daily loss limit is close to being reached.",
  },
};

export const Error: Story = {
  args: {
    color: "red",
    title: "Error",
    withCloseButton: true,
    onClose: () => {},
    children: "Failed to fetch chart data. Please retry.",
  },
};

export const Variants: Story = {
  render: () => (
    <Stack gap="xs">
      <Alert variant="light" color="blue">light variant</Alert>
      <Alert variant="filled" color="blue">filled variant</Alert>
      <Alert variant="outline" color="blue">outline variant</Alert>
      <Alert variant="transparent" color="blue">transparent variant</Alert>
    </Stack>
  ),
};
