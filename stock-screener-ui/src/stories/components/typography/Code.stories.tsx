import type { Meta, StoryObj } from "@storybook/html-vite";
import { Code, Flex, Stack, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { solidStory } from "@/stories/solidStory";
import { Section } from "./fixtures";

const colorOptions = ["primary", "success", "error", "warning", "info", "secondary", "dimmed", "default"] as const;

const meta: Meta = {
  title: "Design System/Components/Typography/Code",
  tags: ["autodocs"],
  component: Code as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Code renders inline snippets as <code> and, with `block`, a wrapping <pre> with horizontal overflow. `color` selects a semantic fill; the component picks readable ink with pickTextColor() rather than assuming a dark theme. It uses the mono utility class.",
      },
    },
  },
  argTypes: {
    children: { control: { type: "text" }, description: "Snippet to render." },
    block: { control: { type: "boolean" }, description: "Render a <pre> block instead of inline <code>." },
    color: { control: { type: "select" }, options: colorOptions, description: "Semantic fill (or a literal colour)." },
    className: { control: { type: "text" } },
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: { children: "pickTextColor(fill)", block: false, color: "primary" },
  render: (args) => solidStory(() => <Code {...args} />),
};

export const InlineAndBlock: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Inline" note="Default <code> with the mono utility and a tight 2px/6px pad.">
          <Text size="sm">
            Inline: <Code>pickTextColor(fill)</Code> and <Code color="primary">PRIMARY</Code> inside a sentence.
          </Text>
        </Section>
        <Section title="Block" note="block renders a <pre> with pre-wrap, word-break and horizontal overflow.">
          <Code block>{`const cutoff = aggregate.rangeCutoff(asOf, "6m");\nconst rows = await fetchPrices({ range: cutoff });`}</Code>
          <Code block color="info">BLOCK WITH SEMANTIC INFO FILL — LONG LINE WRAPS INSIDE THE PRE.</Code>
        </Section>
      </Stack>
    )),
};

export const SemanticColors: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Semantic fills" note="color maps to a palette fill and picks readable ink for it — never text directly on a saturated colour.">
          <Flex gap="sm" wrap="wrap">
            {colorOptions.map((color) => (
              <Code color={color}>{color}</Code>
            ))}
            <Code>default (no fill)</Code>
          </Flex>
        </Section>
        <Section title="Literal colour escape hatch" note="A palette constant resolves to a raw colour value and is used verbatim as the fill.">
          <Flex gap="sm" wrap="wrap">
            <Code color={palette.PRIMARY}>palette.PRIMARY</Code>
            <Code color={palette.POSITIVE}>palette.POSITIVE</Code>
          </Flex>
        </Section>
      </Stack>
    )),
};
