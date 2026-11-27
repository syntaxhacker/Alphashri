import type { Meta, StoryObj } from "@storybook/html-vite";
import { Anchor, Flex, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Section } from "./fixtures";

const toneOptions = ["primary", "secondary", "success", "error", "warning", "info", "danger", "dimmed", "default"];
const sizeOptions = ["xs", "sm", "md", "lg", "xl"] as const;

const meta: Meta = {
  title: "Design System/Components/Typography/Anchor",
  tags: ["autodocs"],
  component: Anchor as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Anchor is the local link primitive. It renders an <a> and carries Text's size/weight/tone/overflow props plus `underline` (always / hover / never), `href`, `target` and `rel`. `component=\"span\"` keeps the styling without navigation. All demo links use in-page fragments — no network.",
      },
    },
  },
  argTypes: {
    children: { control: { type: "text" }, description: "Link label." },
    href: { control: { type: "text" }, description: "Destination; in-page fragment in these demos." },
    target: { control: { type: "select" }, options: ["_self", "_blank"] },
    underline: { control: { type: "inline-radio" }, options: ["always", "hover", "never"], description: "hover is the default." },
    size: { control: { type: "select" }, options: sizeOptions },
    fw: { control: { type: "select" }, options: ["normal", "medium", "semibold", "bold", 500, 600, 700] },
    c: { control: { type: "select" }, options: toneOptions },
    truncate: { control: { type: "select" }, options: [false, true, "end", "start"] },
    lineClamp: { control: { type: "number" } },
    component: { control: { type: "select" }, options: ["a", "span", "div"] },
    title: { control: { type: "text" }, description: "Native tooltip for clipped labels." },
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: { children: "Playground link", href: "#anchor-playground", underline: "hover", c: "primary", size: "sm" },
  render: (args) => solidStory(() => <Anchor {...args} />),
};

export const UnderlineModes: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Underline behaviour" note="always adds a permanent underline, never removes it, and hover (the default) underlines on pointer hover only.">
          <Flex gap="lg" wrap="wrap">
            <Anchor href="#anchors" underline="always">always</Anchor>
            <Anchor href="#anchors" underline="hover">hover (default)</Anchor>
            <Anchor href="#anchors" underline="never">never</Anchor>
          </Flex>
        </Section>
        <Section title="Target" note="target only reaches the DOM while the root stays an <a>.">
          <Stack gap="xs">
            <Text size="sm"><Anchor href="#anchors">Same page (default target)</Anchor></Text>
            <Text size="sm"><Anchor href="#anchors" target="_blank">{"target=\"_blank\""}</Anchor></Text>
          </Stack>
        </Section>
      </Stack>
    )),
};

export const TonesAndSizes: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Tones" note="Anchor's info tone resolves to primary, matching Title; other tones mirror Text.">
          <Flex gap="lg" wrap="wrap" align="baseline">
            {toneOptions.map((c) => (
              <Anchor href="#anchors" c={c}>{c} link</Anchor>
            ))}
          </Flex>
        </Section>
        <Section title="Sizes and weight" note="Anchor shares Text's xs–xl size scale and accepts numeric weights.">
          <Flex gap="lg" wrap="wrap" align="baseline">
            {sizeOptions.map((size) => (
              <Anchor href="#anchors" size={size}>{size}</Anchor>
            ))}
            <Anchor href="#anchors" size="md" fw={500}>md / 500</Anchor>
          </Flex>
        </Section>
      </Stack>
    )),
};

export const TruncationAndComposition: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Truncate and line clamp" note="Overflow props behave like Text's; keep the full label in title.">
          <Stack gap="sm" style={{ width: "320px" }}>
            <Anchor href="#anchors" truncate title="A deliberately long link label that is clipped to demonstrate truncation">
              A deliberately long link label that is clipped to demonstrate truncation
            </Anchor>
            <Anchor href="#anchors" lineClamp={2} title="A deliberately long link label that is clipped to two lines">
              A deliberately long link label that is clipped to two lines so the line clamp is visible in a narrow column
            </Anchor>
          </Stack>
        </Section>
        <Section title="Inline composition" note="component='span' drops href/target from the DOM but keeps the link styling for in-copy affordances.">
          <Text size="sm">Inline <Anchor component="span" c="primary">span-styled anchor</Anchor> inside body copy, next to a normal <Anchor href="#anchors">text link</Anchor>.</Text>
        </Section>
      </Stack>
    )),
};
