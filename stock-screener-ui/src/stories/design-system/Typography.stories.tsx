import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { Anchor, Box, Code, Divider, Flex, List, ListItem, Stack, Text, Title } from "@/ui";
import * as palette from "@/ui/palette";
import { ComponentIndex, docsHref, FamilyChip, FamilyFooter, FamilyHero, FamilyPage, SpecimenPanel, type FamilyComponentRef } from "./FamilyLanding";

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

const COMPONENTS: FamilyComponentRef[] = [
  { id: "design-system-components-typography-text--docs", name: "Text", note: "Sizes, tones, weights and truncation." },
  { id: "design-system-components-typography-title--docs", name: "Title", note: "Semantic h1–h6 with a separate size scale." },
  { id: "design-system-components-typography-anchor--docs", name: "Anchor", note: "Underline behaviour, tones and targets." },
  { id: "design-system-components-typography-code--docs", name: "Code", note: "Inline and block mono with semantic fills." },
  { id: "design-system-components-typography-list--docs", name: "List", note: "Ordered, unordered and icon-aligned items." },
];

export const Landing: Story = {
  render: () =>
    solidStory(() => (
      <FamilyPage width="1100px" padding="0">
        <FamilyHero
          name="Typography"
          count={5}
          caption="type hierarchy"
          purpose="One type scale for terminal copy, headings and numeric data — expressed through five local primitives."
          specimen={<Specimen />}
        />

        <SpecimenPanel
          title="What Typography owns"
          note="Only the props exposed by the typography primitives; values come from their implementations, not a parallel scale."
        >
          <Flex gap="sm" wrap="wrap">
            {PROPS.map((prop) => <FamilyChip name={prop.name} value={prop.value} />)}
          </Flex>
        </SpecimenPanel>

        <ComponentIndex
          items={COMPONENTS}
          note="Each page carries the full prop matrix and state variants; this landing page keeps one representative specimen."
        />
        <FamilyFooter source="src/ui/typography" pages="src/stories/components/typography" />
      </FamilyPage>
    )),
};

export const ScaleAndTones: Story = {
  render: () =>
    solidStory(() => (
      <FamilyPage width="820px" padding="0">
        <SpecimenPanel
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
        </SpecimenPanel>
      </FamilyPage>
    )),
};
