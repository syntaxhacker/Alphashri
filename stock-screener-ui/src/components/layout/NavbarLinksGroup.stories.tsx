import type { Meta, StoryObj } from "@storybook/react";
import { AppShell } from "@mantine/core";
import { NavbarLinksGroup } from "./NavbarLinksGroup";
import { BrowserRouter } from "react-router-dom";
import { IconRocket, IconChartLine, IconTrendingUp, IconCurrencyDollar } from "@tabler/icons-react";

const meta: Meta<typeof NavbarLinksGroup> = {
  title: "Examples/App Layout/NavItem",
  component: NavbarLinksGroup,
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
    icon: {
      control: "select",
      options: ["IconRocket", "IconChartLine", "IconTrendingUp", "IconCurrencyDollar"],
      mapping: {
        IconRocket: IconRocket,
        IconChartLine: IconChartLine,
        IconTrendingUp: IconTrendingUp,
        IconCurrencyDollar: IconCurrencyDollar,
      },
    },
    label: {
      control: "text",
    },
    link: {
      control: "text",
    },
    active: {
      control: "boolean",
    },
  },
};

export default meta;
type Story = StoryObj<typeof NavbarLinksGroup>;

export const Default: Story = {
  args: {
    icon: IconRocket,
    label: "Getting Started",
    link: "/getting-started",
    active: false,
  },
};

export const Active: Story = {
  args: {
    icon: IconChartLine,
    label: "Dashboard",
    link: "/dashboard",
    active: true,
  },
};

export const WithIconRocket: Story = {
  args: {
    icon: IconRocket,
    label: "Getting Started",
    link: "/getting-started",
    active: false,
  },
};

export const WithIconChartLine: Story = {
  args: {
    icon: IconChartLine,
    label: "Analytics",
    link: "/analytics",
    active: false,
  },
};

export const WithIconTrendingUp: Story = {
  args: {
    icon: IconTrendingUp,
    label: "Performance",
    link: "/performance",
    active: false,
  },
};

export const WithIconCurrencyDollar: Story = {
  args: {
    icon: IconCurrencyDollar,
    label: "Crypto",
    link: "/crypto",
    active: false,
  },
};
