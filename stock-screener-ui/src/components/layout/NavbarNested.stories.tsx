import type { Meta, StoryObj } from "@storybook/react";
import { AppShell } from "@mantine/core";
import { NavbarNested } from "./NavbarNested";
import { BrowserRouter } from "react-router-dom";

const meta: Meta<typeof NavbarNested> = {
  title: "Design System/Layout/SideMenu",
  component: NavbarNested,
  tags: ["autodocs"],
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
