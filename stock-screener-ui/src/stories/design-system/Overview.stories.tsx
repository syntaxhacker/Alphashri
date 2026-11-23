import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { Anchor, Card, Code, Divider, Flex, List, Paper, Stack, Text, Title } from "@/ui";
import { DENSITY_TOKENS } from "@/ui";
import { sp } from "@/ui/layout/spacing";
import * as palette from "@/ui/palette";

const meta: Meta = {
  title: "Design System/Overview",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Landing page for the local design system. It points at the stories that exist under src/stories/design-system and at the token modules they read from. This is a map of current work, not an audit or a coverage guarantee.",
      },
    },
  },
};
export default meta;

type Story = StoryObj;

const storyHref = (id: string) => `?path=/story/${id}`;

const StoryLink = (props: { id: string; label: string }) => (
  <Anchor href={storyHref(props.id)} target="_top" c="info" size="sm" underline="hover">{props.label}</Anchor>
);

const GroupCard = (props: {
  title: string;
  id: string;
  description: string;
  stories: Array<{ id: string; label: string }>;
}) => (
  <Card
    p="md"
    radius="md"
    style={{
      width: "300px",
      background: palette.SURFACE,
      border: `1px solid ${palette.BORDER}`,
    }}
  >
    <Stack gap="xs">
      <Anchor href={storyHref(props.id)} target="_top" c="primary" fw={600} size="md" underline="hover">
        {props.title}
      </Anchor>
      <Text size="xs" c="dimmed">{props.description}</Text>
      <Flex gap="xs" wrap="wrap" style={{ "margin-top": "4px" }}>
        {props.stories.map((s) => (
          <StoryLink id={s.id} label={s.label} />
        ))}
      </Flex>
    </Stack>
  </Card>
);

const TokenChip = (props: { name: string; value: string; fill: string }) => (
  <Flex gap="xs" align="center" style={{ padding: "4px 8px", "border-bottom": "1px solid var(--color-fin-border)" }}>
    <span
      style={{
        width: "16px",
        height: "16px",
        "flex-shrink": 0,
        "border-radius": "2px",
        background: props.fill,
        border: `1px solid ${palette.BORDER}`,
      }}
    />
    <Text size="xs" c="default" className="font-mono" style={{ width: "132px" }}>{props.name}</Text>
    <Text size="xs" c="dimmed" className="font-mono">{props.value}</Text>
  </Flex>
);

const groups: Array<{ title: string; id: string; description: string; stories: Array<{ id: string; label: string }> }> = [
  {
    title: "Foundations",
    id: "design-system-foundations--color-tokens",
    description: "Colour anchors, semantic tones, surfaces and borders, then type, spacing, radius, shadow, motion and density.",
    stories: [
      { id: "design-system-foundations--color-tokens", label: "Color tokens" },
      { id: "design-system-foundations--type-scale", label: "Type scale" },
      { id: "design-system-foundations--spacing-scale", label: "Spacing" },
      { id: "design-system-foundations--radius-elevation-motion", label: "Radius / motion" },
    ],
  },
  {
    title: "Typography",
    id: "design-system-typography--text-tones",
    description: "Text tones, weights and modifiers; Title orders and sizes; Anchor, Code and List variants.",
    stories: [
      { id: "design-system-typography--text-tones", label: "Text tones" },
      { id: "design-system-typography--text-layout-props", label: "Modifiers" },
      { id: "design-system-typography--truncation-and-clamp", label: "Truncation" },
      { id: "design-system-typography--title-variants", label: "Title" },
      { id: "design-system-typography--anchor-variants", label: "Anchor" },
      { id: "design-system-typography--code-variants", label: "Code" },
      { id: "design-system-typography--list-variants", label: "List" },
    ],
  },
  {
    title: "Layout",
    id: "design-system-layout--boxes-and-surfaces",
    description: "Box, Paper, Card, Flex, Stack, Group, grids, ScrollArea and Collapse.",
    stories: [
      { id: "design-system-layout--boxes-and-surfaces", label: "Surfaces" },
      { id: "design-system-layout--flex-and-stack", label: "Flex / Stack" },
      { id: "design-system-layout--grids", label: "Grids" },
      { id: "design-system-layout--scroll-and-collapse", label: "Scroll / Collapse" },
    ],
  },
  {
    title: "Inputs",
    id: "design-system-inputs--buttons",
    description: "Buttons, text and number fields, selects, toggles and the copy action.",
    stories: [
      { id: "design-system-inputs--buttons", label: "Buttons" },
      { id: "design-system-inputs--text-fields", label: "Text fields" },
      { id: "design-system-inputs--selects", label: "Selects" },
      { id: "design-system-inputs--toggles", label: "Toggles" },
      { id: "design-system-inputs--copy-action", label: "Copy" },
    ],
  },
  {
    title: "Data display",
    id: "design-system-data-display--tabs-example",
    description: "Tabs, Accordion, Timeline, Tree, Menu and the density stack.",
    stories: [
      { id: "design-system-data-display--tabs-example", label: "Tabs" },
      { id: "design-system-data-display--accordion-example", label: "Accordion" },
      { id: "design-system-data-display--tree-example", label: "Tree" },
      { id: "design-system-data-display--density-stack", label: "Density" },
    ],
  },
  {
    title: "Feedback",
    id: "design-system-feedback--badges",
    description: "Badges, Alerts, notifications, Progress, Loaders, Skeletons and Indicators.",
    stories: [
      { id: "design-system-feedback--badges", label: "Badges" },
      { id: "design-system-feedback--alerts", label: "Alerts" },
      { id: "design-system-feedback--progress-and-loaders", label: "Progress" },
      { id: "design-system-feedback--skeletons-and-indicators", label: "Skeletons" },
    ],
  },
  {
    title: "Overlay",
    id: "design-system-overlay--modal-example",
    description: "Modal, Tooltip, Popover, Overlay and FloatingWindow.",
    stories: [
      { id: "design-system-overlay--modal-example", label: "Modal" },
      { id: "design-system-overlay--tooltip-example", label: "Tooltip" },
      { id: "design-system-overlay--popover-example", label: "Popover" },
      { id: "design-system-overlay--overlay-example", label: "Overlay" },
      { id: "design-system-overlay--floating-window-example", label: "Floating window" },
    ],
  },
  {
    title: "Navigation",
    id: "design-system-navigation--nav-links",
    description: "NavLink and the AppShell layout primitives.",
    stories: [
      { id: "design-system-navigation--nav-links", label: "Nav links" },
      { id: "design-system-navigation--app-shell-layout", label: "App shell" },
    ],
  },
  {
    title: "Shared primitives",
    id: "design-system-shared-primitives--section-headers",
    description: "Section headers, filter status, range control, sparklines, values and trade stats.",
    stories: [
      { id: "design-system-shared-primitives--section-headers", label: "Headers" },
      { id: "design-system-shared-primitives--filter-status", label: "Filter status" },
      { id: "design-system-shared-primitives--range-control", label: "Range" },
      { id: "design-system-shared-primitives--sparklines", label: "Sparklines" },
      { id: "design-system-shared-primitives--values-and-states", label: "Values" },
      { id: "design-system-shared-primitives--trade-stats", label: "Trade stats" },
    ],
  },
  {
    title: "App primitives",
    id: "design-system-app-primitives--key-value-rows",
    description: "KeyValue rows, market badges and shared empty / error / loading states.",
    stories: [
      { id: "design-system-app-primitives--key-value-rows", label: "KeyValue" },
      { id: "design-system-app-primitives--market-badges", label: "Badges" },
      { id: "design-system-app-primitives--states", label: "States" },
    ],
  },
  {
    title: "Portal",
    id: "design-system-portal--default-target",
    description: "Portal rendering into the document body or an explicit host element.",
    stories: [
      { id: "design-system-portal--default-target", label: "Default target" },
      { id: "design-system-portal--explicit-targets", label: "Explicit targets" },
      { id: "design-system-portal--toggle-target", label: "Toggle target" },
    ],
  },
  {
    title: "Misc",
    id: "design-system-misc--avatars",
    description: "Avatar, ThemeIcon and CloseButton.",
    stories: [
      { id: "design-system-misc--avatars", label: "Avatars" },
      { id: "design-system-misc--theme-icons", label: "Theme icons" },
      { id: "design-system-misc--close-buttons", label: "Close buttons" },
    ],
  },
];

export const Overview: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "1120px", padding: "8px 4px 24px" }}>
        <Paper
          p="lg"
          radius="md"
          style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}`, "border-left": `3px solid ${palette.PRIMARY}` }}
        >
          <Stack gap="sm">
            <Text size="xs" c="primary" tt="uppercase" fw={500} className="font-mono">Design system · living reference</Text>
            <Title order={1} size="xl">Alphashri terminal</Title>
            <Text size="md" c="default" style={{ "max-width": "760px" }}>
              A Bloomberg-style desk UI: black canvas, amber chrome and tabular mono data. These stories show the
              primitives and tokens the app imports, rendered with those same modules — not a separate showcase palette.
            </Text>
            <Flex gap="sm" align="center" wrap="wrap">
              <Code color="primary">src/ui/palette.ts</Code>
              <Code color="info">src/ui/typography</Code>
              <Code>src/ui/layout</Code>
              <Code color="dimmed">tailwind.css @theme</Code>
            </Flex>
          </Stack>
        </Paper>

        <Paper p="md" radius="md" style={{ border: `1px solid ${palette.BORDER}` }}>
          <Stack gap="sm">
            <Title order={2} size="lg">Purpose</Title>
            <Text size="sm" c="default" style={{ "max-width": "820px" }}>
              Give the desk one place to see how a token looks in context and which primitive to reach for. Every value
              on these pages is read from the source module at render time, so a retune shows up here without a docs edit.
              Where two components disagree — for example Text and Title map <Code>info</Code> differently — the story says so.
            </Text>
            <Text size="xs" c="dimmed">
              This is documentation of existing work. It makes no claim that every component in the app is covered or that an audit passed.
            </Text>
          </Stack>
        </Paper>

        <Paper p="md" radius="md" style={{ border: `1px solid ${palette.BORDER}` }}>
          <Stack gap="sm">
            <Title order={2} size="lg">Principles</Title>
            <List size="sm" withPadding>
              <List.Item icon={<Text size="xs" c="primary" span>01</Text>}>
                <Text size="sm" span c="default" fw={500}>One source of truth.</Text>{" "}
                Colours live in palette.ts; tailwind.css mirrors them. Components never author a hex.
              </List.Item>
              <List.Item icon={<Text size="xs" c="primary" span>02</Text>}>
                <Text size="sm" span c="default" fw={500}>Semantic, not decorative.</Text>{" "}
                Tokens carry meaning — direction, state, hierarchy — so changing a role changes every consumer with it.
              </List.Item>
              <List.Item icon={<Text size="xs" c="primary" span>03</Text>}>
                <Text size="sm" span c="default" fw={500}>Local primitives first.</Text>{" "}
                @/ui renders semantic HTML plus Tailwind; no style props, no second component library.
              </List.Item>
              <List.Item icon={<Text size="xs" c="primary" span>04</Text>}>
                <Text size="sm" span c="default" fw={500}>Dense but legible.</Text>{" "}
                8pt spacing, 4/6/10 control radii, tabular mono numerals and a 9px type floor.
              </List.Item>
              <List.Item icon={<Text size="xs" c="primary" span>05</Text>}>
                <Text size="sm" span c="default" fw={500}>Measure and look.</Text>{" "}
                Green checks are not evidence of a working screen; verify on real surfaces at real viewports.
              </List.Item>
            </List>
          </Stack>
        </Paper>

        <Paper p="md" radius="md" style={{ border: `1px solid ${palette.BORDER}` }}>
          <Stack gap="sm">
            <Title order={2} size="lg">Token summary</Title>
            <Text size="xs" c="dimmed">
              A quick read of the core values. The full tables, with intended uses, live in the Foundations stories.
            </Text>
            <Flex gap="lg" align="flex-start" wrap="wrap">
              <div style={{ "min-width": "300px", flex: 1 }}>
                <Text size="xs" c="primary" tt="uppercase" fw={500} className="font-mono">Anchors</Text>
                <TokenChip name="PRIMARY" value={palette.PRIMARY} fill={palette.PRIMARY} />
                <TokenChip name="POSITIVE" value={palette.POSITIVE_COLOR} fill={palette.POSITIVE_COLOR} />
                <TokenChip name="NEGATIVE" value={palette.NEGATIVE_COLOR} fill={palette.NEGATIVE_COLOR} />
                <TokenChip name="WARNING" value={palette.WARNING} fill={palette.WARNING} />
                <TokenChip name="INFO" value={palette.INFO} fill={palette.INFO} />
              </div>
              <div style={{ "min-width": "300px", flex: 1 }}>
                <Text size="xs" c="primary" tt="uppercase" fw={500} className="font-mono">Surfaces &amp; ink</Text>
                <TokenChip name="BG" value={palette.BG} fill={palette.BG} />
                <TokenChip name="SURFACE" value={palette.SURFACE} fill={palette.SURFACE} />
                <TokenChip name="SURFACE_ALT" value={palette.SURFACE_ALT} fill={palette.SURFACE_ALT} />
                <TokenChip name="BORDER" value={palette.BORDER} fill={palette.BORDER} />
                <TokenChip name="TEXT" value={palette.TEXT} fill={palette.TEXT} />
                <TokenChip name="TEXT_MUTED" value={palette.TEXT_MUTED} fill={palette.TEXT_MUTED} />
              </div>
              <div style={{ "min-width": "260px", flex: 1 }}>
                <Text size="xs" c="primary" tt="uppercase" fw={500} className="font-mono">Scales</Text>
                <Flex gap="sm" align="center" wrap="wrap" style={{ padding: "8px 0" }}>
                  <Text size="xs" c="dimmed" className="font-mono">spacing</Text>
                  {(["xs", "sm", "md", "lg", "xl"] as const).map((step) => (
                    <Text size="xs" c="default" className="font-mono">{step}={sp(step)}</Text>
                  ))}
                </Flex>
                <Flex gap="sm" align="center" wrap="wrap" style={{ padding: "8px 0" }}>
                  <Text size="xs" c="dimmed" className="font-mono">Paper radius</Text>
                  <Text size="xs" c="default" className="font-mono">2 / 4 / 6 / 10 / 14</Text>
                </Flex>
                <Flex gap="sm" align="center" wrap="wrap" style={{ padding: "8px 0" }}>
                  <Text size="xs" c="dimmed" className="font-mono">Card radius</Text>
                  <Text size="xs" c="default" className="font-mono">4 / 8 / 16 / 24 / 32</Text>
                </Flex>
                <Flex gap="sm" align="center" wrap="wrap" style={{ padding: "8px 0" }}>
                  <Text size="xs" c="dimmed" className="font-mono">density rows</Text>
                  <Text size="xs" c="default" className="font-mono">{DENSITY_TOKENS.compact.tableRowHeight} / {DENSITY_TOKENS.comfortable.tableRowHeight}px</Text>
                </Flex>
              </div>
            </Flex>
            <StoryLink id="design-system-foundations--color-tokens" label="See all foundations tokens →" />
          </Stack>
        </Paper>

        <Stack gap="sm">
          <Title order={2} size="lg">Explore the groups</Title>
          <Text size="sm" c="dimmed">
            Links open the matching story inside Storybook. Each card lists the stories currently in that group.
          </Text>
          <Flex gap="md" wrap="wrap">
            {groups.map((g) => (
              <GroupCard title={g.title} id={g.id} description={g.description} stories={g.stories} />
            ))}
          </Flex>
        </Stack>

        <Paper p="md" radius="md" style={{ border: `1px solid ${palette.BORDER}` }}>
          <Stack gap="sm">
            <Title order={2} size="lg">Component coverage index</Title>
            <Text size="xs" c="dimmed">
              An index of the story groups that exist today, with the primitives each one exercises. Absence from this
              table means there is no story for it yet — not that the component is untested or unsupported.
            </Text>
            {groups.map((g) => (
              <div>
                <Divider label={g.title} labelPosition="left" />
                <Flex gap="md" align="baseline" style={{ padding: "6px 0" }}>
                  <Text size="xs" c="default" className="font-mono" style={{ width: "260px" }}>{g.title}</Text>
                  <Text size="xs" c="dimmed">{g.description}</Text>
                  <StoryLink id={g.id} label="open ↗" />
                </Flex>
              </div>
            ))}
          </Stack>
        </Paper>

        <Text size="xs" c="dimmed">
          Source: <Code>src/stories/design-system/</Code> · tokens: <Code>src/ui/palette.ts</Code>,{" "}
          <Code>src/ui/layout/spacing.ts</Code>, <Code>src/ui/layout/Paper.tsx</Code>,{" "}
          <Code>src/ui/layout/Card.tsx</Code>, <Code>src/ui/density.tsx</Code>.
        </Text>
      </Stack>
    )),
};
