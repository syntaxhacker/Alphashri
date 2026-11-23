import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  AppShell, AppShellHeader, AppShellMain, AppShellNavbar, AppShellSection,
  Box, Button, Group, NavLink, Stack, Text,
} from "@/ui";

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

/**
 * Composition API: the header/navbar/main/section are the real exported shell
 * parts. `position: absolute` is applied only to keep them inside this bordered
 * preview; in an app they are fixed to the viewport by default.
 */
export const AppShellComposition: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ height: "420px", position: "relative", overflow: "hidden", border: "1px solid var(--color-fin-border)" }}>
        <AppShellHeader
          style={{
            position: "absolute",
            height: "48px",
            background: "var(--color-fin-surface)",
            "border-bottom": "1px solid var(--color-fin-border)",
            display: "flex",
            "align-items": "center",
            padding: "0 12px",
          }}
        >
          <Text size="sm" fw={700}>ALPHASHRI</Text>
          <Text size="xs" c="dimmed" style={{ "margin-left": "12px" }}>Composition with the exported shell parts</Text>
        </AppShellHeader>
        <AppShellNavbar
          p={2}
          style={{
            position: "absolute",
            top: "48px",
            height: "calc(100% - 48px)",
            width: "220px",
            background: "var(--color-fin-surface)",
            "border-right": "1px solid var(--color-fin-border)",
          }}
        >
          <Stack gap="xs">
            <Text size="xs" c="dimmed">WORKSPACE</Text>
            <NavLink label="Market" active />
            <NavLink label="Options" />
            <NavLink label="Reports" />
          </Stack>
        </AppShellNavbar>
        <AppShellMain
          style={{
            position: "absolute",
            top: "48px",
            left: "220px",
            width: "calc(100% - 220px)",
            height: "calc(100% - 48px)",
            overflow: "auto",
          }}
        >
          <AppShellSection grow>
            <Stack gap="xs">
              <Text size="lg" fw={700}>Main content</Text>
              <Text size="sm" c="dimmed">
                AppShellHeader, AppShellNavbar, AppShellMain and AppShellSection each render their
                own semantic element; pages supply only the content.
              </Text>
            </Stack>
          </AppShellSection>
        </AppShellMain>
      </Box>
    )),
};

export const CollapsedHeaderAndNavbar: Story = {
  render: () =>
    solidStory(() => {
      const [headerCollapsed, setHeaderCollapsed] = createSignal(true);
      const [navbarCollapsed, setNavbarCollapsed] = createSignal(true);
      return (
        <Stack gap="sm">
          <Group gap="sm">
            <Button size="xs" variant="outline" onClick={() => setHeaderCollapsed((v) => !v)}>
              Header: {headerCollapsed() ? "collapsed" : "visible"}
            </Button>
            <Button size="xs" variant="outline" onClick={() => setNavbarCollapsed((v) => !v)}>
              Navbar: {navbarCollapsed() ? "collapsed" : "visible"}
            </Button>
          </Group>
          <Box style={{ height: "300px", position: "relative", overflow: "hidden", border: "1px solid var(--color-fin-border)" }}>
            <AppShell
              header={{ height: 48, collapsed: headerCollapsed() }}
              navbar={{ width: 220, collapsed: navbarCollapsed() }}
              padding="md"
            >
              <Text size="sm" fw={700}>Content area</Text>
              <Text size="xs" c="dimmed">
                A collapsed shell drops the fixed bar and removes its matching margin from main.
              </Text>
            </AppShell>
          </Box>
        </Stack>
      );
    }),
};

export const NavbarWidthPresets: Story = {
  render: () =>
    solidStory(() => {
      const presets = [
        { label: "Compact · 180px", width: 180 },
        { label: "Default · 220px", width: 220 },
        { label: "Max declared width · 280px", width: { base: 220, lg: 280 } },
      ];
      const [width, setWidth] = createSignal<number | Record<string, number>>(presets[1].width);
      // Mirrors AppShell.resolveNavbarWidth: an object resolves to its last
      // declared numeric value, with no viewport/breakpoint selection.
      const resolved = () =>
        typeof width() === "number" ? String(width()) : String(Object.values(width() as Record<string, number>).at(-1));
      return (
        <Stack gap="sm">
          <Group gap="sm">
            <Text size="xs" c="dimmed">Navbar width · resolved {resolved()}px</Text>
            {presets.map((preset) => (
              <Button
                size="xs"
                variant={width() === preset.width ? "filled" : "outline"}
                onClick={() => setWidth(preset.width)}
              >
                {preset.label}
              </Button>
            ))}
          </Group>
          <Box style={{ height: "320px", position: "relative", overflow: "hidden", border: "1px solid var(--color-fin-border)" }}>
            <AppShell header={{ height: 48 }} navbar={{ width: width() }} padding="md">
              <Text size="sm" fw={700}>Content follows the navbar edge</Text>
              <Text size="xs" c="dimmed">
                AppShell is not responsive here: a width map resolves to its last declared value (280px) at every viewport. Pass a single number for a fixed width.
              </Text>
            </AppShell>
          </Box>
        </Stack>
      );
    }),
};
