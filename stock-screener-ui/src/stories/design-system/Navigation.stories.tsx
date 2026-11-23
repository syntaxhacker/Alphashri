import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { AppShell, Box, NavLink, Stack, Text } from "@/ui";

const meta: Meta = { title: "Design System/Navigation", tags: ["autodocs"] };
export default meta;
type Story = StoryObj;

export const NavLinks: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ width: "300px", background: "var(--color-fin-surface)", border: "1px solid var(--color-fin-border)" }}>
        <NavLink label="Market" description="Screener and breadth" active />
        <NavLink label="Options" description="Chain, paper, replay" />
        <NavLink label="Reports" description="Index and profitability" />
        <NavLink label="Disabled" disabled />
        <NavLink label="With section" defaultOpened>
          <NavLink label="Nested item" />
          <NavLink label="Nested item 2" />
        </NavLink>
      </Box>
    )),
};

export const AppShellLayout: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ height: "420px", position: "relative", overflow: "hidden", border: "1px solid var(--color-fin-border)" }}>
        <AppShell
          header={{ height: 48 }}
          navbar={{ width: 220, collapsed: false }}
          padding="sm"
        >
          <Box style={{ position: "absolute", top: "0", left: "0", right: "0", height: "48px", background: "var(--color-fin-surface)", "border-bottom": "1px solid var(--color-fin-border)", display: "flex", "align-items": "center", padding: "0 12px" }}>
            <Text size="sm" fw={700}>ALPHASHRI</Text>
          </Box>
          <Box style={{ position: "absolute", top: "48px", left: "0", bottom: "0", width: "220px", background: "var(--color-fin-surface)", "border-right": "1px solid var(--color-fin-border)", padding: "8px" }}>
            <Stack gap="xs">
              <Text size="xs" c="dimmed">WORKSPACE</Text>
              <Text size="sm">Market</Text>
              <Text size="sm">Options</Text>
              <Text size="sm">Reports</Text>
            </Stack>
          </Box>
          <Box style={{ position: "absolute", top: "48px", left: "220px", right: "0", bottom: "0", padding: "16px", overflow: "auto" }}>
            <Text size="lg" fw={700}>Main content</Text>
            <Text size="sm" c="dimmed">AppShell owns the fixed header/navbar geometry; pages own the content.</Text>
          </Box>
        </AppShell>
      </Box>
    )),
};
