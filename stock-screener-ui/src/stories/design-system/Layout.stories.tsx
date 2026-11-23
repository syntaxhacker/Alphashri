import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  Anchor, Badge, Box, Button, Card, Col, Divider, Flex, Grid, GridCol, NumberInput,
  Paper, Row, Select, Stack, Text, Title, ToolbarRow, useMediaQuery,
} from "@/ui";
import { sp } from "@/ui/layout/spacing";
import * as palette from "@/ui/palette";

const meta: Meta = {
  title: "Design System/Layout",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Family landing page for the local layout primitives. Compositions use the real Box/Flex/Grid/Row/Paper components and the live spacing tokens; full prop matrices and state variants live on the per-component docs pages.",
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

const cell = (label: string, sub?: string, tone = palette.BORDER) => (
  <Box
    p="sm"
    style={{
      display: "flex",
      "flex-direction": "column",
      "justify-content": "center",
      gap: "4px",
      "min-height": "52px",
      "min-width": "0",
      border: `1px solid ${tone}`,
      "border-radius": "6px",
      background: palette.SURFACE_ALT,
    }}
  >
    <Text size="sm" fw={600} className="font-mono">{label}</Text>
    {sub ? <Text size="xs" c="dimmed">{sub}</Text> : null}
  </Box>
);

const UNIVERSE_OPTIONS = [
  { value: "nifty50", label: "NIFTY 50" },
  { value: "nifty500", label: "NIFTY 500" },
  { value: "banknifty", label: "BANKNIFTY" },
];
const TIMEFRAME_OPTIONS = [
  { value: "5m", label: "5 min" },
  { value: "15m", label: "15 min" },
  { value: "1h", label: "1 hour" },
];

/** One composite specimen: a screen toolbar above a 12-track results/detail split. */
const Specimen = () => (
  <div
    style={{
      background: palette.BG,
      padding: "16px",
      "border-radius": "6px",
      border: `1px solid ${palette.BORDER}`,
    }}
  >
    <Stack gap="md">
      <Paper p="sm" radius="sm" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
        <ToolbarRow gap={8} justify="space-between">
          <ToolbarRow gap={8}>
            <Select size="sm" w={168} label="Universe" defaultValue="nifty500" data={UNIVERSE_OPTIONS} />
            <Select size="sm" w={132} label="Timeframe" defaultValue="15m" data={TIMEFRAME_OPTIONS} />
            <NumberInput size="sm" w={104} label="Min score" defaultValue={80} min={0} max={100} hideControls />
          </ToolbarRow>
          <ToolbarRow gap={8}>
            <Button size="sm" variant="outline">Reset</Button>
            <Button size="sm">Run screen</Button>
          </ToolbarRow>
        </ToolbarRow>
      </Paper>
      <Grid cols={12} gap={8}>
        <GridCol span={8}>{cell("12 tracks · span 8", "results table", palette.PRIMARY)}</GridCol>
        <GridCol span={4}>{cell("span 4", "detail rail")}</GridCol>
      </Grid>
      <Text size="xs" c="dimmed">
        ToolbarRow centres the controls; Grid writes explicit grid-column spans on the 12-track system.
      </Text>
    </Stack>
  </div>
);

const PROPS = [
  {
    name: "spacing",
    value: `xs ${sp("xs")} · sm ${sp("sm")} · md ${sp("md")} · lg ${sp("lg")} · xl ${sp("xl")}`,
  },
  { name: "Grid / Row", value: "cols 12 · gap 8" },
  { name: "Col", value: "span 12 → 6 → 4 → 3 at sm / md / lg" },
  { name: "Paper radius", value: "xs 2 · sm 4 · md 6 · lg 10 · xl 14" },
  { name: "Card radius", value: "xs 4 · sm 8 · md 16 · lg 24 · xl 32" },
  { name: "surfaces", value: "BG → SURFACE → SURFACE_ALT · BORDER hairline" },
];

const COMPONENTS = [
  { id: "design-system-components-layout-box--docs", label: "Box", note: "Semantic tag, sizing and spacing." },
  { id: "design-system-components-layout-flex--docs", label: "Flex", note: "Direction, wrap, justify and align." },
  { id: "design-system-components-layout-stack--docs", label: "Stack", note: "Column flow with a single gap." },
  { id: "design-system-components-layout-group--docs", label: "Group", note: "Inline clusters with wrap control." },
  { id: "design-system-components-layout-toolbarrow--docs", label: "ToolbarRow", note: "Centred control rows with explicit gap." },
  { id: "design-system-components-layout-grid--docs", label: "Grid", note: "12 tracks with GridCol spans and offsets." },
  { id: "design-system-components-layout-row--docs", label: "Row", note: "Responsive bands with Col overrides." },
  { id: "design-system-components-layout-simplegrid--docs", label: "SimpleGrid", note: "Equal columns for card sets." },
  { id: "design-system-components-layout-paper--docs", label: "Paper", note: "Panel surface and named shadows." },
  { id: "design-system-components-layout-card--docs", label: "Card", note: "Raised panel with its own radius scale." },
  { id: "design-system-components-layout-center--docs", label: "Center", note: "Centres content in a host." },
  { id: "design-system-components-layout-divider--docs", label: "Divider", note: "Hairline separation with optional label." },
  { id: "design-system-components-layout-collapse--docs", label: "Collapse", note: "Reveals content without a fixed-height hole." },
  { id: "design-system-components-layout-scrollarea--docs", label: "ScrollArea", note: "Owns its own scroll viewport." },
  { id: "design-system-components-layout-portal--docs", label: "Portal", note: "Mounts content outside the local flow." },
];

export const Landing: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "1100px", margin: "0 auto" }}>
        <Card p="lg" radius="md" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
          <Stack gap="md">
            <Flex gap="sm" align="center" wrap="wrap">
              <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">Design system / Layout</Text>
              <Badge size="xs" color="info">15 component pages</Badge>
            </Flex>
            <Stack gap="xs">
              <Title order={1} size="xl">Layout</Title>
              <Text size="sm" c="dimmed">
                Box, flex, grid and surface primitives that compose terminal panels without inventing a second spacing system.
              </Text>
            </Stack>
            <Box style={{ "border-top": `1px solid ${palette.BORDER}`, "padding-top": "16px" }}>
              <Specimen />
            </Box>
          </Stack>
        </Card>

        <Section
          eyebrow="Tokens"
          title="What Layout owns"
          note="Named spacing values plus the radius and surface scales mirrored in Paper and Card. Per-prop behaviour is documented on each component page."
        >
          <Flex gap="sm" wrap="wrap">
            {PROPS.map((prop) => <PropChip name={prop.name} value={prop.value} />)}
          </Flex>
        </Section>

        <Section
          eyebrow="Index"
          title="Components in this family"
          note="Fifteen component pages cover every layout primitive; the landing page keeps only one composite specimen and the grid contract."
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

const Ruler = () => (
  <Grid cols={12} gap={8} style={{ "margin-bottom": "8px" }}>
    {Array.from({ length: 12 }, (_, i) => (
      <GridCol span={1}>
        <Box
          style={{
            height: "18px",
            display: "grid",
            "place-items": "center",
            border: `1px solid ${palette.BORDER}`,
            background: palette.SURFACE_ALT,
            color: palette.TEXT_MUTED,
            "font-family": palette.MONO,
            "font-size": "9px",
          }}
        >
          {i + 1}
        </Box>
      </GridCol>
    ))}
  </Grid>
);

/** The one layout demo that still adds family-level value: the 12-track contract. */
export const GridContract: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="md" style={{ "max-width": "900px", margin: "0 auto" }}>
        <Section
          eyebrow="Real demo"
          title="The 12-track contract"
          note="GridCol span writes a real grid-column; offset sets grid-column-start. The numbered ruler makes both values checkable by eye."
        >
          <Stack gap="md">
            <Stack gap="xs">
              <Text size="xs" c="dimmed" className="font-mono">span 4 / span 8 on the same 12 tracks</Text>
              <Ruler />
              <Grid cols={12} gap={8}>
                <GridCol span={4}>{cell("span 4", "about one third", palette.PRIMARY)}</GridCol>
                <GridCol span={8}>{cell("span 8", "about two thirds")}</GridCol>
              </Grid>
            </Stack>
            <Divider />
            <Stack gap="xs">
              <Text size="xs" c="dimmed" className="font-mono">offset 4 pins three 4-wide cells to tracks 1–4, 5–8 and 9–12</Text>
              <Ruler />
              <Grid cols={12} gap={8}>
                <GridCol span={4} offset={0}>{cell("offset 0", "cols 1–4")}</GridCol>
                <GridCol span={4} offset={4}>{cell("offset 4", "cols 5–8", palette.PRIMARY)}</GridCol>
                <GridCol span={4} offset={8}>{cell("offset 8", "cols 9–12")}</GridCol>
              </Grid>
            </Stack>
          </Stack>
        </Section>
      </Stack>
    )),
};

const ViewportReadout = () => {
  const sm = useMediaQuery("(min-width: 640px)");
  const md = useMediaQuery("(min-width: 768px)");
  const lg = useMediaQuery("(min-width: 1024px)");
  return (
    <Text size="xs" c="dimmed" className="font-mono">
      {`active breakpoint: ${lg() ? "lg (≥1024)" : md() ? "md (≥768)" : sm() ? "sm (≥640)" : "base (<640)"}`}
    </Text>
  );
};

/** Family-level narrow-screen review, pinned to the 390px handset viewport. */
export const Responsive390: Story = {
  globals: { viewport: "mobile1" },
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
      options: {
        mobile1: {
          name: "Handset 390",
          styles: { width: "390px", height: "844px" },
          type: "mobile",
        },
      },
    },
  },
  render: () =>
    solidStory(() => (
      <Stack gap="md" style={{ "max-width": "100%" }}>
        <Section
          eyebrow="Real demo"
          title="390px handset"
          note="matchMedia resolves against the iframe width, so the base branches below are what a 390px device sees."
        >
          <Stack gap="md">
            <Stack gap="xs">
              <Text size="xs" c="dimmed" className="font-mono">base spans are viewport-independent</Text>
              <Row cols={12} gap={8}>
                <Col span={6}>{cell("span 6")}</Col>
                <Col span={6}>{cell("span 6")}</Col>
              </Row>
            </Stack>
            <Divider />
            <Stack gap="xs">
              <ViewportReadout />
              <Row cols={12} gap={8}>
                <Col span={12} sm={6} md={4} lg={3}>{cell("A", "12 → 6 → 4 → 3")}</Col>
                <Col span={12} sm={6} md={4} lg={3}>{cell("B", "12 → 6 → 4 → 3")}</Col>
                <Col span={12} sm={6} md={4} lg={3}>{cell("C", "12 → 6 → 4 → 3")}</Col>
                <Col span={12} sm={6} md={4} lg={3}>{cell("D", "12 → 6 → 4 → 3")}</Col>
              </Row>
            </Stack>
            <Divider />
            <Stack gap="xs">
              <Text size="xs" c="dimmed" className="font-mono">ToolbarRow wraps in 390px instead of scrolling</Text>
              <ToolbarRow gap={8}>
                <Select size="xs" w={140} label="Universe" defaultValue="nifty500" data={UNIVERSE_OPTIONS} />
                <NumberInput size="xs" w={92} label="Min score" defaultValue={80} hideControls />
                <Button size="xs" variant="outline">Reset</Button>
                <Button size="xs">Run</Button>
              </ToolbarRow>
            </Stack>
          </Stack>
        </Section>
      </Stack>
    )),
};
