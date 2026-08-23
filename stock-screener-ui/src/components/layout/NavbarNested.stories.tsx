import type { Meta, StoryObj } from "@storybook/react";
import { AppShell } from "@/ui";
import { NavbarNested } from "./NavbarNested";
import { BrowserRouter } from "react-router-dom";
import { expect, fn, userEvent, within } from "storybook/test";

const meta: Meta<typeof NavbarNested> = {
  title: "Examples/App Layout/SideMenu",
  component: NavbarNested,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "App sidebar navigation — collapsible grouped links for AppShell navbar. Use as the primary app navigation. When not: for top nav use Tabs or NavLink row." } } },
  decorators: [
    (Story) => (
      <BrowserRouter>
        <AppShell>
          <Story />
        </AppShell>
      </BrowserRouter>
    ),
  ],
  argTypes: {
    activePath: {
      control: "select",
      options: ["/", "/backtest", "/paper", "/sector", "/strategies", "/bots"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof NavbarNested>;

export const Default: Story = {
  args: {
    activePath: "/",
  },
};

export const WithBacktestActive: Story = {
  args: {
    activePath: "/backtest",
  },
};

export const WithPaperTradingActive: Story = {
  args: {
    activePath: "/paper",
  },
};

export const WithStrategiesActive: Story = {
  args: {
    activePath: "/strategies",
  },
};

export const WithBotsActive: Story = {
  args: {
    activePath: "/bots",
  },
};

export const Collapsed: Story = {
  args: {
    activePath: "/",
    collapsed: true,
  },
};

export const WithLongLabels: Story = {
  args: {
    activePath: "/",
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 180, border: "1px dashed var(--mantine-color-dimmed)" }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story:
          "Constrained to 180px to verify label truncation / tooltip fallback does not overflow. Collapsed mode shows icon-only with tooltip.",
      },
    },
  },
};

export const NavigationCallback: Story = {
  args: {
    activePath: "/",
    onMobileNavigate: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // NavbarLinksGroup renders NavLink with data-testid="nav-<label>" (e.g. nav-backtest)
    const navItem = canvas.getByTestId("nav-backtest");
    await userEvent.click(navItem);
    await expect(args.onMobileNavigate).toHaveBeenCalled();
  },
};
