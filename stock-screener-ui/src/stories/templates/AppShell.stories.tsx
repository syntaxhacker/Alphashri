import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { Box, Text, Paper, Group } from "@/ui";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthProvider } from "@/components/auth/AuthProvider2";

function Placeholder({ label }: { label: string }) {
  return (
    <Paper p="md" data-testid="placeholder-page">
      <Text fw={600}>{label}</Text>
      <Text size="sm" c="dimmed">Page content inside AppShellMain</Text>
    </Paper>
  );
}

const meta: Meta = {
  title: "Templates/Application Shell",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Application shell — header (logo + ticker + news) + collapsible navbar + main. Use as the top-level layout for every authenticated route. When not: for standalone auth pages use a centered Card without the shell.",
      },
    },
  },
};
export default meta;

export const Default: StoryObj = {
  decorators: [(Story) => <MemoryRouter initialEntries={["/"]}><AuthProvider><Story /></AuthProvider></MemoryRouter>],
  render: () => <AppLayout><Placeholder label="Screener" /></AppLayout>,
};

export const CollapsedDesktop: StoryObj = {
  decorators: [(Story) => <MemoryRouter initialEntries={["/backtest"]}><AuthProvider><Story /></AuthProvider></MemoryRouter>],
  render: () => <AppLayout><Placeholder label="Backtest — toggle collapse to see 80px rail" /></AppLayout>,
};

export const MobileDrawerOpen: StoryObj = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  decorators: [(Story) => <MemoryRouter initialEntries={["/paper"]}><AuthProvider><Story /></AuthProvider></MemoryRouter>],
  render: () => <AppLayout><Placeholder label="Paper Trading — 375px mobile viewport (open burger to see drawer)" /></AppLayout>,
};
