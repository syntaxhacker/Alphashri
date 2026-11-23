import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  AppShell, AppShellHeader, AppShellMain, AppShellNavbar, AppShellSection, Badge, Box,
  Button, Divider, Flex, Group, NavLink, Stack, Text,
} from "@/ui";
import * as palette from "@/ui/palette";
import { ComponentIndex, FamilyFooter, FamilyHero, FamilyPage, SpecimenPanel, type FamilyComponentRef } from "./FamilyLanding";

const meta: Meta = {
  title: "Design System/Navigation",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Family landing page for the app chrome: NavLink for the rail and the AppShell composition for header, navbar, main and section. Each component has its own page under Design System/Components/Navigation; this page is an index plus two composed examples.",
      },
    },
  },
};
export default meta;
type Story = StoryObj;

const components: FamilyComponentRef[] = [
  { id: "design-system-components-navigation-appshell--docs", name: "AppShell", note: "Header, navbar, main and section parts" },
  { id: "design-system-components-navigation-navlink--docs", name: "NavLink", note: "Active, nested and disabled rail links" },
];

/**
 * Real shell parts laid out in flow, not at fixed offsets: the navbar keeps its
 * 220px rail on wide hosts and wraps above main when the host is too narrow for
 * two columns. Nothing is clipped by an overflow-hidden frame at 390px.
 */
const ShellComposition = () => (
  <Box style={{ "min-height": "380px", border: `1px solid ${palette.BORDER}`, background: palette.BG }}>
    <AppShellHeader
      style={{
        position: "relative", height: "48px", background: palette.SURFACE_ALT,
        "border-bottom": `1px solid ${palette.BORDER}`, display: "flex", "align-items": "center",
        "flex-wrap": "wrap", padding: "0 12px",
      }}
    >
      <Text size="sm" fw={700}>ALPHASHRI</Text>
      <Text size="xs" c="dimmed" style={{ "margin-left": "12px" }}>Header · 48px</Text>
    </AppShellHeader>
    <Flex wrap="wrap" align="stretch">
      <AppShellNavbar
        p={2}
        style={{
          position: "static", flex: "0 0 220px", width: "220px",
          background: palette.SURFACE, "border-right": `1px solid ${palette.BORDER}`,
        }}
      >
        <Stack gap="xs">
          <Text size="xs" c="dimmed" tt="uppercase" fw={500}>Workspace</Text>
          <NavLink label="Market" description="Screener and breadth" active />
          <NavLink label="Options" description="Chain, paper, replay" />
          <NavLink label="Reports" description="Index and profitability" />
        </Stack>
      </AppShellNavbar>
      <AppShellMain
        style={{ position: "static", flex: "1 1 300px", "min-width": "0", padding: "16px" }}
      >
        <AppShellSection grow>
          <Stack gap="sm">
            <Text size="lg" fw={700}>Main content</Text>
            <Text size="sm" c="dimmed" className="break-words">
              Each exported shell part renders its own semantic element; pages supply only the content.
            </Text>
            <Group gap="sm" wrap="wrap">
              <Badge variant="light" color="primary">Screener</Badge>
              <Badge variant="outline" color="info">Paper</Badge>
              <Badge variant="outline">Reports</Badge>
            </Group>
            <Divider />
            <Flex gap="sm" align="flex-start" wrap="wrap">
              {[
                { k: "Universe", v: "NIFTY 500" },
                { k: "Rows", v: "214" },
                { k: "Actionable", v: "18" },
                { k: "As of", v: "10:02 IST" },
              ].map((item) => (
                <Box key={item.k} style={{ "min-width": "110px", padding: "8px", background: palette.SURFACE_ALT, border: `1px solid ${palette.BORDER}` }}>
                  <Text size="xs" c="dimmed">{item.k}</Text>
                  <Text size="sm" fw={600} className="font-mono">{item.v}</Text>
                </Box>
              ))}
            </Flex>
          </Stack>
        </AppShellSection>
      </AppShellMain>
    </Flex>
  </Box>
);

const CollapsedChrome = () => {
  const [headerCollapsed, setHeaderCollapsed] = createSignal(true);
  const [navbarCollapsed, setNavbarCollapsed] = createSignal(true);
  return (
    <Stack gap="sm">
      <Group gap="sm" align="center" wrap="wrap">
        <Button size="xs" variant="outline" onClick={() => setHeaderCollapsed((v) => !v)}>
          Header: {headerCollapsed() ? "collapsed" : "visible"}
        </Button>
        <Button size="xs" variant="outline" onClick={() => setNavbarCollapsed((v) => !v)}>
          Navbar: {navbarCollapsed() ? "collapsed" : "visible"}
        </Button>
      </Group>
      <Box style={{ height: "240px", position: "relative", overflow: "hidden", border: `1px solid ${palette.BORDER}`, background: palette.SURFACE }}>
        <AppShell
          header={{ height: 48, collapsed: headerCollapsed() }}
          navbar={{ width: 220, collapsed: navbarCollapsed() }}
          padding="md"
        >
          <Text size="sm" fw={700}>Content area</Text>
          <Text size="xs" c="dimmed">A collapsed bar drops the fixed element and its matching margin from main.</Text>
        </AppShell>
      </Box>
    </Stack>
  );
};

export const FamilyLanding: Story = {
  render: () =>
    solidStory(() => (
      <FamilyPage>
        <FamilyHero
          name="Navigation"
          count={components.length}
          caption="shell composition"
          purpose="The chrome around every screen: a rail of NavLinks for destination and state, and an AppShell whose header, navbar, main and section each render their own semantic element. Collapsing a bar also removes the matching margin from main."
          specimen={<ShellComposition />}
        />
        <ComponentIndex items={components} />
        <SpecimenPanel title="NavLink" note="Active, described, nested and disabled rail entries.">
          <Box style={{ width: "320px", background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
            <NavLink label="Market" description="Screener and breadth" active />
            <NavLink label="Options" description="Chain, paper, replay" />
            <NavLink label="Reports" description="Index and profitability" />
            <NavLink label="Disabled" disabled />
            <NavLink label="With section" defaultOpened>
              <NavLink label="Nested item" />
              <NavLink label="Nested item 2" />
            </NavLink>
          </Box>
        </SpecimenPanel>
        <SpecimenPanel title="Collapsed chrome" note="Toggle each fixed bar independently; main follows the remaining edge.">
          <CollapsedChrome />
        </SpecimenPanel>
        <FamilyFooter source="src/ui" pages="src/stories/components/Navigation" />
      </FamilyPage>
    )),
};
