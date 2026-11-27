import type { Meta, StoryObj } from "@storybook/html-vite";
import { Badge, Flex, Stack, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { solidStory } from "@/stories/solidStory";
import { Catalog, Section, Specimen, SpecimenGrid } from "./fixtures";

const colorOptions = ["primary", "success", "error", "danger", "warning", "info", "secondary", "default", "neutral", "dimmed"] as const;
const sizeOptions = ["xs", "sm", "md", "lg", "xl"] as const;
const radiusOptions = ["xs", "sm", "md", "lg", "xl"] as const;
const variantOptions = ["light", "filled", "outline", "dot", "white"];

const meta: Meta = {
  title: "Design System/Components/Feedback/Badge",
  tags: ["autodocs"],
  component: Badge as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Badge is a status label, never a control — smaller than Chip, with no pointer cursor or hover fill. `color` maps to a semantic token, `variant` switches light / filled / outline / dot / white chrome, and `size`, `radius`, `leftSection`, `rightSection` and `fullWidth` shape it. Filled badges keep contrast in both schemes; a raw fill colour gets a contrast-picked ink.",
      },
    },
  },
  argTypes: {
    children: { control: { type: "text" }, description: "Badge label." },
    variant: { control: { type: "select" }, options: variantOptions },
    color: { control: { type: "select" }, options: colorOptions },
    size: { control: { type: "select" }, options: sizeOptions },
    radius: { control: { type: "select" }, options: radiusOptions },
    fullWidth: { control: { type: "boolean" } },
    title: { control: { type: "text" }, description: "Native tooltip forwarded to the badge element." },
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: { children: "LIVE", variant: "light", color: "success", size: "sm" },
  render: (args) =>
    solidStory(() => (
      <Catalog title="Badge" note="Compact status labels on a surfaced specimen grid. Every tone and variant is rendered at readable size.">
        <Section title="Playground" note="The controls above drive this specimen.">
          <Specimen label={`${args.variant} · ${args.color} · ${args.size}`}>
            <Badge {...args} />
          </Specimen>
        </Section>
      </Catalog>
    )),
};

export const Variants: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="Badge — chrome" note="Light is the quiet default; filled inverts onto a theme fill; outline is a hairline; dot drops the pill chrome.">
        <Section title="Variants" note="Each cell pairs the badge with its variant name.">
          <SpecimenGrid min={200}>
            <Specimen label="light (default)"><Badge>light (default)</Badge></Specimen>
            <Specimen label="filled"><Badge variant="filled" color="primary">filled</Badge></Specimen>
            <Specimen label="outline"><Badge variant="outline" color="info">outline</Badge></Specimen>
            <Specimen label="dot / live"><Badge variant="dot" color="success">dot / live</Badge></Specimen>
            <Specimen label="white"><Badge variant="white" color="success">white</Badge></Specimen>
          </SpecimenGrid>
        </Section>
        <Section title="Sections and width" note="leftSection/rightSection are dropped for dot; fullWidth stretches the pill across its host.">
          <Flex gap="sm" wrap="wrap" align="center">
            <Badge variant="light" color="success" leftSection={<span aria-hidden="true">●</span>}>Filled dot slot</Badge>
            <Badge variant="light" color="secondary" rightSection={<span>12</span>}>Count</Badge>
            <Badge variant="outline" color="warning" title="Native tooltip on a status label">With title</Badge>
          </Flex>
          <Stack gap="sm" style={{ "padding-top": "16px" }}>
            <Text size="xs" c="dimmed">fullWidth</Text>
            <Badge fullWidth color="info" variant="light">fullWidth status strip</Badge>
          </Stack>
        </Section>
      </Catalog>
    )),
};

export const Tones: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="Badge — tones" note="The full semantic scale plus the order/feed labels that use it in the app.">
        <Section title="Semantic tones" note="error and danger resolve to the same negative token; secondary, default, neutral and dimmed share muted ink.">
          <SpecimenGrid min={180}>
            {colorOptions.map((color) => (
              <Specimen label={color}>
                <Badge color={color}>{color}</Badge>
              </Specimen>
            ))}
          </SpecimenGrid>
        </Section>
        <Section title="Error and success states" note="Typical order/feed status labels using the negative and positive tones.">
          <SpecimenGrid min={200}>
            <Specimen label="accepted"><Badge variant="filled" color="success">Order accepted</Badge></Specimen>
            <Specimen label="rejected"><Badge variant="light" color="error">Rejected</Badge></Specimen>
            <Specimen label="feed down"><Badge variant="dot" color="error">Feed down</Badge></Specimen>
            <Specimen label="partial fill"><Badge variant="dot" color="warning">Partial fill</Badge></Specimen>
            <Specimen label="info"><Badge variant="outline" color="info">Info</Badge></Specimen>
          </SpecimenGrid>
          <Text size="xs" c="dimmed" style={{ "padding-top": "16px" }}>
            Filled badges use a theme fill so the foreground keeps contrast in both colour schemes; a raw fill falls back to a contrast-picked ink.
          </Text>
        </Section>
        <Section title="Raw fill colour" note="Passing a palette token string uses the same contrast helper as filled Alert cells.">
          <Specimen label="raw amber fill">
            <Badge variant="filled" color={palette.PRIMARY}>Raw fill</Badge>
          </Specimen>
        </Section>
      </Catalog>
    )),
};

export const SizesAndRadius: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="Badge — scale" note="Five height steps and five radius steps, all set at the 12px micro floor so labels stay readable.">
        <Section title="Sizes" note="xs 14px → xl 22px tall; every size uses the 12px micro type step.">
          <SpecimenGrid min={180}>
            {sizeOptions.map((size) => (
              <Specimen label={size}>
                <Badge size={size} color="primary">{size}</Badge>
              </Specimen>
            ))}
          </SpecimenGrid>
        </Section>
        <Section title="Radius" note="Radius steps are the design-system tokens; numeric values are also accepted by the component.">
          <SpecimenGrid min={180}>
            {radiusOptions.map((radius) => (
              <Specimen label={`radius ${radius}`}>
                <Badge radius={radius} variant="outline" color="secondary">radius {radius}</Badge>
              </Specimen>
            ))}
          </SpecimenGrid>
        </Section>
      </Catalog>
    )),
};
