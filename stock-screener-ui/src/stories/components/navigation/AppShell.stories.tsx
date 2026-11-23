import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  AppShell, AppShellSection, Box, Button, Group, Stack, Text,
} from "@/ui";
import { Page, SampleRow, ShellChrome, Specimen } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Navigation/AppShell",
  tags: ["autodocs"],
  // html-vite types `component` as a render function over a flat Args bag;
  // Solid components require concrete props, so the real component is cast here.
  component: AppShell as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "AppShell lays out fixed header/navbar chrome and a main region with matching margins. It can be configured with `header={{ height, collapsed }}`, `navbar={{ width, collapsed }}` and `padding`, or assembled from the exported AppShellHeader / AppShellNavbar / AppShellMain / AppShellSection parts. `collapsed` removes the bar and its margin. Width maps are not responsive here: resolveNavbarWidth picks the last declared numeric value at every viewport. The previews use a transformed, relative box only to contain the fixed chrome; in an app the bars are fixed to the viewport.",
      },
    },
  },
  argTypes: {
    header: { control: "object", description: "{ height, collapsed } for the top bar." },
    navbar: { control: "object", description: "{ width, collapsed } for the side bar." },
    padding: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
      description: "Main-region padding. Numbers are px; tokens map to the spacing ramp.",
    },
    className: { control: "text", description: "Extra class on the shell root." },
  },
};
export default meta;
type Story = StoryObj;

const PREVIEW = {
  height: "340px",
  width: "100%",
  position: "relative",
  overflow: "hidden",
  transform: "translateZ(0)",
  border: "1px solid var(--color-fin-border)",
  background: "var(--color-fin-surface)",
} as const;

export const HeaderNavbarMainSections: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen
          title="Header, navbar, main and sections"
          note="Each exported part renders its own semantic element. The absolute offsets are preview scaffolding only."
        >
          <Box style={PREVIEW}>
            <ShellChrome>
              <AppShellSection grow>
                <Stack gap="sm">
                  <Group gap="sm" align="center">
                    <Text size="sm" fw={700}>Screener · saved view</Text>
                    <Text size="xs" c="dimmed">session pinned</Text>
                  </Group>
                  <Text size="xs" c="dimmed">One section grows; add more sections for separate panels.</Text>
                  <SampleRow label="Universe" value="NIFTY 500" />
                  <SampleRow label="Rows" value="18 actionable" tone="var(--color-fin-primary)" />
                </Stack>
              </AppShellSection>
              <AppShellSection>
                <Box style={{ "margin-top": "16px", padding: "12px", background: "var(--color-fin-surface-alt)", border: "1px solid var(--color-fin-border)" }}>
                  <Text size="xs" fw={600}>Secondary section · run notes</Text>
                  <Text size="xs" c="dimmed">Frame is fresh and margins were verified.</Text>
                </Box>
              </AppShellSection>
            </ShellChrome>
          </Box>
        </Specimen>
      </Page>
    )),
};

export const CollapsedChrome: Story = {
  render: () =>
    solidStory(() => {
      const [headerCollapsed, setHeaderCollapsed] = createSignal(false);
      const [navbarCollapsed, setNavbarCollapsed] = createSignal(false);
      return (
        <Page>
          <Specimen
            title="Collapsed chrome"
            note="A collapsed bar is not rendered and its matching main margin is removed. This shell does not animate the change."
          >
            <Stack gap="sm">
              <Group gap="xs" wrap="wrap">
                <Button size="xs" variant="outline" onClick={() => setHeaderCollapsed((v) => !v)}>
                  header: {headerCollapsed() ? "collapsed" : "visible"}
                </Button>
                <Button size="xs" variant="outline" onClick={() => setNavbarCollapsed((v) => !v)}>
                  navbar: {navbarCollapsed() ? "collapsed" : "visible"}
                </Button>
              </Group>
              <Box style={PREVIEW}>
                <AppShell
                  header={{ height: 48, collapsed: headerCollapsed() }}
                  navbar={{ width: 220, collapsed: navbarCollapsed() }}
                  padding="md"
                >
                  <ShellChrome headerCollapsed={headerCollapsed()} navbarCollapsed={navbarCollapsed()} />
                </AppShell>
              </Box>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const WidthsAndPadding: Story = {
  render: () =>
    solidStory(() => {
      const presets = [
        { label: "Compact · 180", width: 180 },
        { label: "Default · 220", width: 220 },
        { label: "Map · last value 280", width: { base: 180, lg: 280 } },
      ];
      const [width, setWidth] = createSignal<number | Record<string, number>>(220);
      const [padding, setPadding] = createSignal<"sm" | "md" | "lg">("md");
      const resolved = () =>
        typeof width() === "number" ? String(width()) : String(Object.values(width() as Record<string, number>).at(-1));
      return (
        <Page>
          <Specimen
            title="Widths and padding"
            note="Width maps resolve to their last declared numeric value at every viewport; there is no breakpoint switching."
          >
            <Stack gap="sm">
              <Group gap="xs" wrap="wrap">
                {presets.map((preset) => (
                  <Button
                    size="xs"
                    variant={width() === preset.width ? "filled" : "outline"}
                    onClick={() => { setWidth(preset.width); }}
                  >
                    {preset.label}
                  </Button>
                ))}
              </Group>
              <Group gap="xs" wrap="wrap">
                {(["sm", "md", "lg"] as const).map((p) => (
                  <Button size="xs" variant={padding() === p ? "filled" : "outline"} onClick={() => { setPadding(p); }}>
                    Padding · {p}
                  </Button>
                ))}
                <Text size="xs" c="dimmed">Navbar width: {resolved()} px</Text>
              </Group>
              <Box style={PREVIEW}>
                <AppShell header={{ height: 48 }} navbar={{ width: width() }} padding={padding()}>
                  <ShellChrome width={Number(resolved())} />
                </AppShell>
              </Box>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const Playground: Story = {
  args: {
    headerHeight: 48,
    navbarWidth: 220,
    headerCollapsed: false,
    navbarCollapsed: false,
    padding: "md",
  },
  render: (args) =>
    solidStory(() => (
      <Page>
        <Specimen
          title="Playground"
          code={`header.height=${String(args.headerHeight)} · navbar.width=${String(args.navbarWidth)} · padding=${String(args.padding)}`}
        >
          <Box style={PREVIEW}>
            <AppShell
              header={{ height: Number(args.headerHeight ?? 48), collapsed: Boolean(args.headerCollapsed) }}
              navbar={{ width: Number(args.navbarWidth ?? 220), collapsed: Boolean(args.navbarCollapsed) }}
              padding={args.padding}
            >
              <ShellChrome
                width={Number(args.navbarWidth ?? 220)}
                headerCollapsed={Boolean(args.headerCollapsed)}
                navbarCollapsed={Boolean(args.navbarCollapsed)}
              />
            </AppShell>
          </Box>
        </Specimen>
      </Page>
    )),
};
