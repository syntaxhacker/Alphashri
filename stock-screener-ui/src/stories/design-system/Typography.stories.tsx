import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Anchor, Badge, Box, Card, Code, Divider, Flex, List, ListItem, Paper, Stack, Text, Title } from "@/ui";
import * as palette from "@/ui/palette";

const meta: Meta = {
  title: "Design System/Typography",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Family landing page for the local text primitives. Every specimen uses Text / Title / Anchor / Code / List from src/ui/typography; sizes, tones and behaviour come from those implementations. Full prop matrices live on the per-component docs pages.",
      },
    },
  },
};
export default meta;

type Story = StoryObj;

// Links must leave the preview iframe and open the Storybook manager.
const docsHref = (id: string) => `../?path=/docs/${id}`;

const DocsCard = (props: { id: string; label: string; note: string }) => (
  <Paper p="sm" radius="sm" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
    <Stack gap="xs">
      <Anchor href={docsHref(props.id)} target="_top" c="primary" fw={600} size="sm" underline="hover">
        {props.label}
      </Anchor>
      <Text size="xs" c="dimmed">{props.note}</Text>
    </Stack>
  </Paper>
);

const PropChip = (props: { name: string; value: string }) => (
  <Flex
    gap="xs"
    align="center"
    wrap="wrap"
    style={{
      padding: "8px 10px",
      "border-radius": "6px",
      border: `1px solid ${palette.BORDER}`,
      background: palette.SURFACE_ALT,
    }}
  >
    <Text size="xs" fw={600} className="font-mono">{props.name}</Text>
    <Text size="xs" c="dimmed" className="font-mono">{props.value}</Text>
  </Flex>
);

const Section = (props: { eyebrow: string; title: string; note: string; children: JSX.Element }) => (
  <Box component="section" style={{ width: "100%" }}>
    <Stack gap="sm">
      <Stack gap="xs">
        <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">{props.eyebrow}</Text>
        <Title order={2} size="md">{props.title}</Title>
        <Text size="sm" c="dimmed">{props.note}</Text>
      </Stack>
      {props.children}
    </Stack>
  </Box>
);

/** One composite specimen: hierarchy, tone, mono figures and inline utilities in a quote card. */
const Specimen = () => (
  <div
    style={{
      background: palette.BG,
      padding: "16px",
      "border-radius": "6px",
      border: `1px solid ${palette.BORDER}`,
    }}
  >
    <Flex gap="md" align="stretch" wrap="wrap">
      <Box
        style={{
          flex: "1 1 360px",
          "min-width": "0",
          background: palette.SURFACE,
          border: `1px solid ${palette.BORDER}`,
          "border-radius": "6px",
          padding: "16px",
        }}
      >
        <Stack gap="sm">
          <Flex gap="sm" align="center" justify="space-between" wrap="wrap">
            <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">NIFTY 50 · spot</Text>
            <Text size="xs" c="dimmed" className="font-mono">15m · IST</Text>
          </Flex>
          <Title order={2} size="xl" className="font-mono">24,318.40</Title>
          <Flex gap="sm" align="baseline" wrap="wrap">
            <Text size="sm" fw={600} c="success" className="font-mono">+186.25 (0.77%)</Text>
            <Text size="xs" c="dimmed">vs previous close</Text>
          </Flex>
          <Divider />
          <Text size="sm" c="dimmed">
            Open interest builds at the call wall while spot holds above the put wall; the short read stays constructive into expiry.
          </Text>
          <Flex gap="sm" align="center" wrap="wrap">
            <Code color="primary">useValueFlash</Code>
            <Anchor href={docsHref("design-system-components-typography-anchor--docs")} target="_top" size="sm" underline="hover">
              Anchor docs
            </Anchor>
          </Flex>
        </Stack>
      </Box>
      <Box
        style={{
          flex: "0 1 240px",
          "min-width": "0",
          background: palette.SURFACE,
          border: `1px solid ${palette.BORDER}`,
          "border-radius": "6px",
          padding: "16px",
        }}
      >
        <Stack gap="sm">
          <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">Hierarchy</Text>
          <Title order={3} size="md">Section title</Title>
          <Text size="sm">Body copy at 14px with measured leading.</Text>
          <Text size="xs" c="dimmed">Secondary label at 12px.</Text>
          <List size="sm" withPadding>
            <ListItem>Numbers use tabular mono figures.</ListItem>
            <ListItem>Tones carry meaning, not hue invention.</ListItem>
          </List>
        </Stack>
      </Box>
    </Flex>
  </div>
);

const PROPS = [
  { name: "Text size", value: "xs 12 · sm 14 · md 16 · lg 18 · xl 20" },
  { name: "Title size", value: "xs 12 · sm 14 · md 16 · lg 18 · xl 24" },
  { name: "c", value: "primary · default · dimmed · success · error · warning · info" },
  { name: "fw", value: "normal · 500 · semibold · 700" },
  { name: "tt", value: "uppercase · lowercase · capitalize · none" },
  { name: "utility", value: "font-mono for price, P&L, OI and IV" },
];

const COMPONENTS = [
  { id: "design-system-components-typography-text--docs", label: "Text", note: "Sizes, tones, weights and truncation." },
  { id: "design-system-components-typography-title--docs", label: "Title", note: "Semantic h1–h6 with a separate size scale." },
  { id: "design-system-components-typography-anchor--docs", label: "Anchor", note: "Underline behaviour, tones and targets." },
  { id: "design-system-components-typography-code--docs", label: "Code", note: "Inline and block mono with semantic fills." },
  { id: "design-system-components-typography-list--docs", label: "List", note: "Ordered, unordered and icon-aligned items." },
];

export const Landing: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "1100px", margin: "0 auto" }}>
        <Card p="lg" radius="md" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
          <Stack gap="md">
            <Flex gap="sm" align="center" wrap="wrap">
              <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">Design system / Typography</Text>
              <Badge size="xs" color="info">5 component pages</Badge>
            </Flex>
            <Stack gap="xs">
              <Title order={1} size="xl">Typography</Title>
              <Text size="sm" c="dimmed">
                One type scale for terminal copy, headings and numeric data — expressed through five local primitives.
              </Text>
            </Stack>
            <Box style={{ "border-top": `1px solid ${palette.BORDER}`, "padding-top": "16px" }}>
              <Specimen />
            </Box>
          </Stack>
        </Card>

        <Section
          eyebrow="Tokens"
          title="What Typography owns"
          note="Only the props exposed by the typography primitives; values come from their implementations, not a parallel scale."
        >
          <Flex gap="sm" wrap="wrap">
            {PROPS.map((prop) => <PropChip name={prop.name} value={prop.value} />)}
          </Flex>
        </Section>

        <Section
          eyebrow="Index"
          title="Components in this family"
          note="Each page carries the full prop matrix and state variants; this landing page keeps one representative specimen."
        >
          <Box
            style={{
              display: "grid",
              "grid-template-columns": "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "8px",
            }}
          >
            {COMPONENTS.map((component) => (
              <DocsCard id={component.id} label={component.label} note={component.note} />
            ))}
          </Box>
        </Section>
      </Stack>
    )),
};

export const ScaleAndTones: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="md" style={{ "max-width": "820px", margin: "0 auto" }}>
        <Section
          eyebrow="Real demo"
          title="Scale and tones"
          note="Rendered with the real Text primitive. Title's order prop selects the semantic tag; its size prop selects the type scale."
        >
          <Stack gap="xs">
            {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
              <Flex
                gap="md"
                align="baseline"
                wrap="wrap"
                style={{ "border-bottom": `1px solid ${palette.BORDER}`, padding: "6px 0" }}
              >
                <Text size="xs" c="dimmed" className="font-mono" style={{ width: "72px" }}>{size}</Text>
                <Text size={size} fw={500}>Alphashri terminal 23,450.85</Text>
              </Flex>
            ))}
          </Stack>
          <Divider label="Semantic tones" labelPosition="left" />
          <Flex gap="md" align="baseline" wrap="wrap">
            {(["primary", "success", "error", "warning", "info", "dimmed"] as const).map((tone) => (
              <Text size="sm" c={tone} fw={500}>{tone}</Text>
            ))}
          </Flex>
          <Divider label="Numeric treatment" labelPosition="left" />
          <Flex gap="lg" align="baseline" wrap="wrap">
            <Text size="sm" fw={500} className="font-mono">LTP 23,450.85</Text>
            <Text size="sm" fw={600} c="success" className="font-mono">+1,240.50</Text>
            <Text size="sm" fw={700} c="error" className="font-mono">-318.25</Text>
            <Text size="xs" c="dimmed" className="font-mono">IV 18.42%</Text>
          </Flex>
        </Section>
      </Stack>
    )),
};
