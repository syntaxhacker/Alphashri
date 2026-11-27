import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  Anchor, Box, Code, Divider, Flex, List, ListItem, Stack, Text, Title,
  TYPE_CLASS, TYPE_SCALE, typeSize, type TypeRole,
} from "@/ui";
import * as palette from "@/ui/palette";
import "./typography-fonts.css";
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
            <Code color="primary">NIFTY 24,500 CE</Code>
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
          <Text className={TYPE_CLASS.body}>Body copy at 13px with measured leading.</Text>
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
  { name: "c", value: "primary · default · dimmed · success · error · warning · info" },
  { name: "fw", value: "normal · 500 · semibold · 700" },
  { name: "tt", value: "uppercase · lowercase · capitalize · none" },
  { name: "utility", value: "font-mono for price, P&L, OI and IV" },
];

/** Copy for each role. The role list itself is derived from the scale, not hand-kept. */
const ROLE_COPY: Record<TypeRole, { use: string; sample: string }> = {
  micro: { use: "Labels · badges, chart axes and dense table metadata.", sample: "NIFTY 50 · 24,318.40" },
  body: { use: "Body · dense copy and table cells; the default reading size.", sample: "Spot holds above the put wall into expiry." },
  label: { use: "Controls · form labels and input text.", sample: "Strike price" },
  title: { use: "Card title · panel and card headings.", sample: "Option chain" },
  heading: { use: "Section · page-section headings.", sample: "Market breadth" },
  display: { use: "Page title · page titles and hero values.", sample: "Index report" },
};

const TYPE_ROLES = (Object.keys(TYPE_SCALE) as TypeRole[]).map((role) => ({ role, ...ROLE_COPY[role] }));

const COMPONENTS: FamilyComponentRef[] = [
  { id: "design-system-components-typography-text--docs", name: "Text", note: "Sizes, tones, weights and truncation." },
  { id: "design-system-components-typography-title--docs", name: "Title", note: "Semantic h1–h6 with a separate size scale." },
  { id: "design-system-components-typography-anchor--docs", name: "Anchor", note: "Underline behaviour, tones and targets." },
  { id: "design-system-components-typography-code--docs", name: "Code", note: "Inline and block mono with semantic fills." },
  { id: "design-system-components-typography-list--docs", name: "List", note: "Ordered, unordered and icon-aligned items." },
];

// Every typography specimen renders inside this wrapper. Naming a system font
// in a stack is not enough — the name may be absent on the other runner. The
// faces are bundled in ./typography-fonts.css, so local (DejaVu) and CI
// (Liberation/Noto) rasterise identical glyph outlines and line boxes.
//
// `--font-mono` drives the `font-mono` utility; `--default-mono-font-family`
// drives Tailwind's `code`/`kbd`/`samp`/`pre` preflight. The bare `font-family`
// is essential too: plain inherited text resolves `body`'s "IBM Plex Sans",
// Roboto, system-ui stack once, at <body>, so a custom property changed on a
// descendant would never reach it.
const SPECIMEN_FONTS = {
  "--font-sans": '"Alphashri Specimen Sans", sans-serif',
  "--font-mono": '"Alphashri Specimen Mono", monospace',
  "--default-mono-font-family": '"Alphashri Specimen Mono", monospace',
  "font-family": "var(--font-sans)",
} as JSX.CSSProperties;

const BundledFonts = (props: { children: JSX.Element }) => (
  <div style={SPECIMEN_FONTS}>{props.children}</div>
);

export const Landing: Story = {
  render: () =>
    solidStory(() => (
      <BundledFonts>
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
          note="Props below come from the primitives; the six-role scale is read from TYPE_SCALE / TYPE_CLASS / typeSize, not a parallel alias matrix."
        >
          <Stack gap="md">
            <Flex gap="sm" wrap="wrap">
              {PROPS.map((prop) => <FamilyChip name={prop.name} value={prop.value} />)}
            </Flex>
            <Divider label="The type scale" labelPosition="left" />
            <Stack gap="xs">
              {TYPE_ROLES.map(({ role, use }) => (
                <Flex
                  key={role}
                  gap="sm"
                  align="baseline"
                  wrap="wrap"
                  style={{ padding: "6px 0", "border-bottom": `1px solid ${palette.BORDER}` }}
                >
                  <Text size="xs" c="primary" fw={700} className="font-mono" style={{ width: "72px", "flex-shrink": 0 }}>{role}</Text>
                  <Text size="xs" c="default" className="font-mono">{TYPE_CLASS[role]}</Text>
                  <Text size="xs" c="dimmed" className="font-mono">{`${typeSize(role)}px / ${TYPE_SCALE[role].lineHeight}px`}</Text>
                  <Text size="xs" c="dimmed" style={{ "flex": "1 1 160px", "min-width": "0" }}>{use}</Text>
                </Flex>
              ))}
            </Stack>
            <Text size="xs" c="default" style={{ "max-width": "780px" }}>
              The five <code>xs…xl</code> size props are aliases onto these roles, not six distinct steps:{" "}
              <code>size="sm"</code> on Text, Anchor and List maps to <em>label</em> (14px) and their <code>xl</code>{" "}
              caps at <em>heading</em> (20px), while Title's <code>xl</code> maps to <em>display</em> (24px). Body copy at
              13px has no size alias — use <code>text-ui-body</code> or <code>typeStyle("body")</code> for it.
            </Text>
          </Stack>
        </SpecimenPanel>

        <ComponentIndex
          items={COMPONENTS}
          note="Each page carries the full prop matrix and state variants; this landing page keeps one representative specimen."
        />
        <FamilyFooter source="src/ui/typography" pages="src/stories/components/typography" />
      </FamilyPage>
      </BundledFonts>
    )),
};

/**
 * The product type scale. Each row renders the real `text-ui-*` utility so the
 * px size and leading a reader sees are exactly what the product ships; the
 * role list and its copy are driven by TYPE_SCALE / TYPE_CLASS / typeSize.
 */
export const TypeScale: Story = {
  render: () =>
    solidStory(() => (
      <BundledFonts>
      <FamilyPage width="820px" padding="0">
        <SpecimenPanel
          title="Typography scale"
          note="Six roles cover every product surface. Choose the role for the job — one definition owns the utility, the pixel size and the line height."
        >
          <Stack gap="xs">
            {TYPE_ROLES.map(({ role, use, sample }) => (
              <Flex
                gap="md"
                align="center"
                wrap="wrap"
                style={{ padding: "10px 0", "border-bottom": `1px solid ${palette.BORDER}` }}
              >
                <Box style={{ width: "116px", "flex-shrink": 0 }}>
                  <Text size="xs" fw={700} c="primary" className="font-mono">{TYPE_CLASS[role]}</Text>
                  <Text size="xs" c="dimmed" className="font-mono">{`${typeSize(role)}px / ${TYPE_SCALE[role].lineHeight}px`}</Text>
                </Box>
                <Box className={TYPE_CLASS[role]} style={{ "flex": "1 1 200px", "min-width": "0" }}>{sample}</Box>
                <Text size="xs" c="dimmed" style={{ "flex": "1 1 180px", "min-width": "0" }}>{use}</Text>
              </Flex>
            ))}
          </Stack>
          <Divider label="The floor" labelPosition="left" />
          <Text size="sm" c="default">
            Nothing renders below 12px. The 12px floor is enforced by <code>design-scale</code> tests — reach for <code>text-ui-micro</code> on the densest labels rather than a private pixel size.
          </Text>
        </SpecimenPanel>
      </FamilyPage>
      </BundledFonts>
    )),
};

export const ScaleAndTones: Story = {
  render: () =>
    solidStory(() => (
      <BundledFonts>
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
      </BundledFonts>
    )),
};
