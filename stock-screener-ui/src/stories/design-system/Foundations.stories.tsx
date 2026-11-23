import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Anchor, Badge, Box, Button, Card, Divider, Flex, Paper, Stack, Text, Title } from "@/ui";
import { DENSITY_TOKENS } from "@/ui";
import { sp } from "@/ui/layout/spacing";
import * as palette from "@/ui/palette";
import { contrastRatio, pickTextColor } from "@/utils/contrast";

const meta: Meta = {
  title: "Design System/Foundations",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Family landing page for the tokens the terminal renders with. Colour comes from palette.ts, spacing from spacing.ts and density from density.tsx. Radius and shadow steps are documented values mirrored in the Paper/Card implementations, not exported tokens. Per-primitive stories live under Design System/Components/*.",
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

const TokenChip = (props: { name: string; value: string; swatch?: string }) => (
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
    {props.swatch ? (
      <Box
        style={{
          width: "14px",
          height: "14px",
          "flex-shrink": 0,
          "border-radius": "3px",
          background: props.swatch,
          border: `1px solid ${palette.BORDER}`,
        }}
      />
    ) : null}
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

/** One composite specimen: a desk panel that uses the ramp, tones, spacing and focus token together. */
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
          flex: "1 1 320px",
          "min-width": "0",
          background: palette.SURFACE,
          border: `1px solid ${palette.BORDER}`,
          "border-radius": "6px",
          padding: "12px",
        }}
      >
        <Stack gap="sm">
          <Flex gap="sm" align="center" justify="space-between" wrap="wrap">
            <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">NIFTY 50 · 15m</Text>
            <Badge size="xs" color="success">LIVE</Badge>
          </Flex>
          <Divider />
          <Flex gap="md" justify="space-between" wrap="wrap">
            <Stack gap="xs">
              <Text size="xs" c="dimmed">Spot</Text>
              <Text size="lg" fw={600} className="font-mono">24,318.40</Text>
            </Stack>
            <Stack gap="xs">
              <Text size="xs" c="dimmed">Net change</Text>
              <Text size="lg" fw={600} c="success" className="font-mono">+186.25 (0.77%)</Text>
            </Stack>
          </Flex>
          <Box
            style={{
              background: palette.SURFACE_ALT,
              border: `1px solid ${palette.BORDER}`,
              "border-radius": "4px",
              padding: sp("sm"),
            }}
          >
            <Text size="xs" c="dimmed" className="font-mono">raised surface · hairline · 8px inset</Text>
          </Box>
        </Stack>
      </Box>
      <Box
        style={{
          flex: "0 1 240px",
          "min-width": "0",
          background: palette.SURFACE,
          border: `1px solid ${palette.BORDER}`,
          "border-radius": "6px",
          padding: "12px",
        }}
      >
        <Stack gap="sm">
          <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">Contrast & focus</Text>
          <Flex gap="sm" wrap="wrap">
            <Box
              style={{
                background: palette.SURFACE,
                color: palette.TEXT,
                border: `1px solid ${palette.BORDER}`,
                padding: "6px 10px",
                "border-radius": "4px",
              }}
            >
              <Text size="sm" className="font-mono">Aa text</Text>
            </Box>
            <Box
              style={{
                background: palette.SURFACE_ALT,
                color: palette.TEXT,
                border: `1px solid ${palette.BORDER}`,
                padding: "6px 10px",
                "border-radius": "4px",
              }}
            >
              <Text size="sm" className="font-mono">Aa raised</Text>
            </Box>
          </Flex>
          <Button size="sm" variant="outline">Tab to focus</Button>
          <Text size="xs" c="dimmed">Focus ring: PRIMARY · 2px · 1px offset. Never suppress it.</Text>
        </Stack>
      </Box>
    </Flex>
  </div>
);

const TOKENS = [
  { name: "PRIMARY", value: palette.PRIMARY, swatch: palette.PRIMARY },
  { name: "POSITIVE", value: palette.POSITIVE, swatch: palette.POSITIVE },
  { name: "NEGATIVE", value: palette.NEGATIVE, swatch: palette.NEGATIVE },
  { name: "SURFACE", value: palette.SURFACE, swatch: palette.SURFACE },
  { name: "SURFACE_ALT", value: palette.SURFACE_ALT, swatch: palette.SURFACE_ALT },
  { name: "BORDER", value: palette.BORDER, swatch: palette.BORDER },
  {
    name: "spacing",
    value: `xs ${sp("xs")} · sm ${sp("sm")} · md ${sp("md")} · lg ${sp("lg")} · xl ${sp("xl")}`,
  },
  {
    name: "density",
    value: `compact ${DENSITY_TOKENS.compact.tableRowHeight}px · comfortable ${DENSITY_TOKENS.comfortable.tableRowHeight}px`,
  },
];

const COMPONENTS = [
  { id: "design-system-components-layout-box--docs", label: "Box", note: "Named spacing becomes padding and gaps." },
  { id: "design-system-components-layout-paper--docs", label: "Paper", note: "Control-friendly radius and named shadows." },
  { id: "design-system-components-layout-card--docs", label: "Card", note: "The wider, panel-level radius scale." },
  { id: "design-system-components-typography-text--docs", label: "Text", note: "Type sizes, tones and mono figures." },
  { id: "design-system-components-feedback-badge--docs", label: "Badge", note: "Semantic fills for status and direction." },
  { id: "design-system-components-app-tanstacktable--docs", label: "TanStackTable", note: "Where density is written to CSS." },
];

export const Landing: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "1100px", margin: "0 auto" }}>
        <Card p="lg" radius="md" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
          <Stack gap="md">
            <Flex gap="sm" align="center" wrap="wrap">
              <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">Design system / Foundations</Text>
              <Badge size="xs" color="info">79 component pages use these tokens</Badge>
            </Flex>
            <Stack gap="xs">
              <Title order={1} size="xl">Foundations</Title>
              <Text size="sm" c="dimmed">
                Colour, spacing, radius, elevation and density — shared by every component page, with no dedicated Foundations primitives.
              </Text>
            </Stack>
            <Box style={{ "border-top": `1px solid ${palette.BORDER}`, "padding-top": "16px" }}>
              <Specimen />
            </Box>
          </Stack>
        </Card>

        <Section
          eyebrow="Tokens"
          title="What Foundations owns"
          note="Values below are read from the source modules at render time. No colour literal is authored in this file."
        >
          <Flex gap="sm" wrap="wrap">
            {TOKENS.map((token) => <TokenChip name={token.name} value={token.value} swatch={token.swatch} />)}
          </Flex>
        </Section>

        <Section
          eyebrow="Index"
          title="Components in this family"
          note="Foundations owns no per-component pages. These are the primitives that give its tokens a concrete shape; full variant docs live on each page."
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

const CONTRAST_PAIRS = [
  { label: "TEXT on BG", fg: palette.TEXT, bg: palette.BG, min: 4.5 },
  { label: "TEXT on SURFACE", fg: palette.TEXT, bg: palette.SURFACE, min: 4.5 },
  { label: "TEXT_MUTED on SURFACE", fg: palette.TEXT_MUTED, bg: palette.SURFACE, min: 4.5 },
  { label: "POSITIVE on SURFACE", fg: palette.POSITIVE, bg: palette.SURFACE, min: 4.5 },
  { label: "NEGATIVE on SURFACE", fg: palette.NEGATIVE, bg: palette.SURFACE, min: 4.5 },
  { label: "pickTextColor on PRIMARY", fg: pickTextColor(palette.PRIMARY), bg: palette.PRIMARY, min: 4.5 },
  { label: "PRIMARY focus ring (graphic)", fg: palette.PRIMARY, bg: palette.SURFACE, min: 3 },
];

/** Measured with the same WCAG helper the guard tests use, not a hand-written table. */
export const Contrast: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="md" style={{ "max-width": "820px", margin: "0 auto" }}>
        <Section
          eyebrow="Real demo"
          title="Contrast pairs"
          note="Measured at render time over the tokens shown above. AA text needs 4.5:1; meaningful graphics such as the focus ring need 3:1."
        >
          <Stack gap="xs">
            {CONTRAST_PAIRS.map((pair) => {
              const ratio = contrastRatio(pair.fg, pair.bg);
              const passes = ratio >= pair.min;
              return (
                <Flex gap="sm" align="center" wrap="wrap" style={{ padding: "6px 0", "border-bottom": `1px solid ${palette.BORDER}` }}>
                  <Box
                    style={{
                      width: "36px",
                      height: "22px",
                      "flex-shrink": 0,
                      background: pair.bg,
                      color: pair.fg,
                      border: `1px solid ${palette.BORDER}`,
                      display: "grid",
                      "place-items": "center",
                      "font-family": palette.MONO,
                      "font-size": "10px",
                    }}
                  >
                    Aa
                  </Box>
                  <Text size="xs" className="font-mono" style={{ flex: "1 1 220px", "min-width": "0" }}>{pair.label}</Text>
                  <Text size="xs" className="font-mono">{`${ratio.toFixed(2)}:1`}</Text>
                  <Text size="xs" c={passes ? "success" : "error"}>{`${passes ? "pass" : "fail"} ≥ ${pair.min}`}</Text>
                </Flex>
              );
            })}
          </Stack>
        </Section>
      </Stack>
    )),
};
