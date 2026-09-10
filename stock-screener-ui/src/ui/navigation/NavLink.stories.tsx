import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@/ui";
import { NavLink } from "./NavLink";

const meta: Meta<typeof NavLink> = {
  title: "Primitives/Navigation/NavLink",
  component: NavLink,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Navigation link with icon, label, and active state. Use inside AppShell navbar. When not to use: for external links use Anchor. Uses MUI NavLink with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof NavLink>;

export const Basic: Story = {
  args: {
    label: "Dashboard",
    href: "#",
  },
};

export const WithDescriptionAndIcon: Story = {
  args: {
    label: "Screener",
    description: "52W range & momentum scans",
    icon: <span role="img" aria-label="chart">📈</span>,
    href: "#",
  },
};

export const Active: Story = {
  args: {
    label: "Paper Trading",
    description: "Live positions & P&L",
    icon: <span role="img" aria-label="money">💰</span>,
    active: true,
    href: "#",
  },
};

export const Disabled: Story = {
  args: {
    label: "Settings",
    disabled: true,
    href: "#",
  },
};

export const Variants: Story = {
  render: () => (
    <Stack w={260} gap={0}>
      <NavLink label="Variant: light" variant="light" active />
      <NavLink label="Variant: filled" variant="filled" active />
      <NavLink label="Variant: subtle" variant="subtle" active />
    </Stack>
  ),
};

export const Nested: Story = {
  render: () => (
    <Stack w={280} gap={0}>
      <NavLink label="Strategies" icon={<span>🗂️</span>} defaultOpened>
        <NavLink label="ORB Best" description="Opening range breakout" />
        <NavLink label="SR Breakout" active />
        <NavLink label="52W Chaser" />
      </NavLink>
      <NavLink label="Reports" icon={<span>📄</span>} />
    </Stack>
  ),
};
