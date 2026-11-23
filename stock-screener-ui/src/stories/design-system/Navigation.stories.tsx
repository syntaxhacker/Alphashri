import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  Anchor, AppShell, AppShellHeader, AppShellMain, AppShellNavbar, AppShellSection, Badge, Box,
  Button, Card, Divider, Flex, Group, NavLink, Paper, Stack, Text, Title,
} from "@/ui";
import * as palette from "@/ui/palette";

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

const docsHref = (id: string) => `../?path=/docs/${id}`;
const DocsLink = (props: { id: string; label: string }) => (
  <Anchor href={docsHref(props.id)} target="_top" c="info" size="sm" underline="hover">{props.label}</Anchor>
);

type ComponentRef = { id: string; name: string; note: string };
const components: ComponentRef[] = [
  { id: "design-system-components-navigation-appshell--docs", name: "AppShell", note: "Header, navbar, main and section parts" },
  { id: "design-system-components-navigation-navlink--docs", name: "NavLink", note: "Active, nested and disabled rail links" },
];

const FamilyHero = (props: { name: string; purpose: string; count: number; specimen: JSX.Element }) => (
  <Paper p="lg" radius="md" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}`, "border-left": `3px solid ${palette.PRIMARY}` }}>
    <Stack gap="md">
      <Flex gap="sm" align="center" wrap="wrap">
        <Text size="xs" c="primary" tt="uppercase" fw={500} className="font-mono">Design system · family</Text>
        <Badge size="xs" variant="light" color="primary">{props.count} component pages</Badge>
      </Flex>
      <Stack gap="xs">
        <Title order={1} size="xl">{props.name}</Title>
        <Text size="sm" c="default" style={{ "max-width": "780px" }}>{props.purpose}</Text>
      </Stack>
      <Divider />
      <Text size="xs" c="dimmed" tt="uppercase" fw={500} className="font-mono">At a glance · shell composition</Text>
      {props.specimen}
    </Stack>
  </Paper>
);

const ComponentIndex = (props: { items: ComponentRef[] }) => (
  <Stack gap="sm">
    <Flex gap="sm" align="baseline" wrap="wrap">
      <Title order={2} size="lg">Components in this family</Title>
      <Text size="xs" c="dimmed">Open each card to reach its dedicated page.</Text>
    </Flex>
    <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px" }}>
      {props.items.map((item) => (
        <Card key={item.id} p="sm" radius="sm" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
          <Stack gap="xs">
            <DocsLink id={item.id} label={item.name} />
            <Text size="xs" c="dimmed">{item.note}</Text>
          </Stack>
        </Card>
      ))}
    </div>
  </Stack>
);

const Specimen = (props: { title: string; note: string; children: JSX.Element }) => (
  <Paper p="md" radius="md" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
    <Stack gap="sm">
      <Flex gap="sm" align="baseline" wrap="wrap">
        <Title order={3} size="md">{props.title}</Title>
        <Text size="xs" c="dimmed">{props.note}</Text>
      </Flex>
      <Divider />
      {props.children}
    </Stack>
  </Paper>
);

/**
 * Absolute positioning keeps the real shell parts inside the preview frame;
 * in an app they are fixed to the viewport by default.
 */
const ShellComposition = () => (
  <Box style={{ height: "380px", position: "relative", overflow: "hidden", border: `1px solid ${palette.BORDER}`, background: palette.BG }}>
    <AppShellHeader
      style={{
        position: "absolute", height: "48px", background: palette.SURFACE_ALT,
        "border-bottom": `1px solid ${palette.BORDER}`, display: "flex", "align-items": "center",
        padding: "0 12px",
      }}
    >
      <Text size="sm" fw={700}>ALPHASHRI</Text>
      <Text size="xs" c="dimmed" style={{ "margin-left": "12px" }}>Header · 48px</Text>
    </AppShellHeader>
    <AppShellNavbar
      p={2}
      style={{
        position: "absolute", top: "48px", height: "calc(100% - 48px)", width: "220px",
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
      style={{
        position: "absolute", top: "48px", left: "220px", width: "calc(100% - 220px)",
        height: "calc(100% - 48px)", overflow: "auto",
      }}
    >
      <AppShellSection grow>
        <Stack gap="sm">
          <Text size="lg" fw={700}>Main content</Text>
          <Text size="sm" c="dimmed">Each exported shell part renders its own semantic element; pages supply only the content.</Text>
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
      <Stack gap="lg" style={{ "max-width": "1120px", padding: "4px 0 24px" }}>
        <FamilyHero
          name="Navigation"
          count={components.length}
          purpose="The chrome around every screen: a rail of NavLinks for destination and state, and an AppShell whose header, navbar, main and section each render their own semantic element. Collapsing a bar also removes the matching margin from main."
          specimen={<ShellComposition />}
        />
        <ComponentIndex items={components} />
        <Specimen title="NavLink" note="Active, described, nested and disabled rail entries.">
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
        </Specimen>
        <Specimen title="Collapsed chrome" note="Toggle each fixed bar independently; main follows the remaining edge.">
          <CollapsedChrome />
        </Specimen>
        <Text size="xs" c="dimmed">Source: <code>src/ui</code> · per-component pages: <code>src/stories/components/Navigation</code>.</Text>
      </Stack>
    )),
};
