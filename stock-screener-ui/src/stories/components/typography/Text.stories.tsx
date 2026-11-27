import type { Meta, StoryObj } from "@storybook/html-vite";
import { Divider, Flex, Stack, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { solidStory } from "@/stories/solidStory";
import { Section, longText } from "./fixtures";

const toneOptions = ["primary", "secondary", "success", "error", "warning", "info", "danger", "dimmed", "default"] as const;
const sizeOptions = ["xs", "sm", "md", "lg", "xl"];
const weightOptions = ["normal", "medium", "semibold", "bold", 500, 600, 700];

const meta: Meta = {
  title: "Design System/Components/Typography/Text",
  tags: ["autodocs"],
  // html-vite types `component` as a DOM tag; the real primitive is mounted via `render`.
  component: Text as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Text is the local body-copy primitive. It renders a <p> by default; `span` or `component` swap the element. `size` maps xs–xl to rem steps, `fw` takes a named weight or a number, and `c` takes a semantic tone (a utility class) or a literal colour. `truncate` and `lineClamp` handle overflow — keep the full value in `title`.",
      },
    },
  },
  argTypes: {
    children: { control: { type: "text" }, description: "Copy to render." },
    size: { control: { type: "select" }, options: sizeOptions, description: "xs 12 · sm 14 · md 16 · lg 18 · xl 20px." },
    fw: { control: { type: "select" }, options: weightOptions, description: "Named weight or numeric CSS font-weight." },
    c: { control: { type: "select" }, options: toneOptions, description: "Semantic tone name, not a hue." },
    ta: { control: { type: "inline-radio" }, options: ["left", "center", "right"] },
    tt: { control: { type: "select" }, options: ["none", "uppercase", "lowercase", "capitalize"] },
    lh: { control: { type: "number" } },
    fs: { control: { type: "select" }, options: ["normal", "italic"] },
    truncate: { control: { type: "select" }, options: [false, true, "end", "start"] },
    lineClamp: { control: { type: "number" } },
    span: { control: { type: "boolean" } },
    component: { control: { type: "select" }, options: ["p", "span", "div", "a", "code", "h3"] },
    title: { control: { type: "text" }, description: "Native tooltip for clipped labels." },
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: { children: "Market terminal 1,234.56 — playground copy", size: "sm", fw: 500, c: "primary" },
  render: (args) => solidStory(() => <Text {...args} />),
};

export const SizesAndWeights: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Sizes" note="xs 12 · sm 14 · md 16 · lg 18 · xl 20px, all from Text's sizeMap.">
          <Stack gap="xs">
            {sizeOptions.map((size) => (
              <Text size={size}>{`size="${size}" — Alphashri terminal 1,234.56`}</Text>
            ))}
          </Stack>
        </Section>
        <Section title="Weights" note="fw takes the named weights or any number; 500 is the medium emphasis used for numeric data.">
          <Flex gap="lg" align="baseline" wrap="wrap">
            <Text size="md" fw="normal">normal</Text>
            <Text size="md" fw={500}>500 medium</Text>
            <Text size="md" fw="semibold">semibold</Text>
            <Text size="md" fw={700}>700 bold</Text>
          </Flex>
          <Divider label="Numeric emphasis" labelPosition="left" />
          <Flex gap="lg" align="baseline" wrap="wrap">
            <Text size="sm" fw={500} className="font-mono">LTP 23,450.85</Text>
            <Text size="sm" fw={600} c="success" className="font-mono">+1,240.50</Text>
            <Text size="sm" fw={700} c="error" className="font-mono">-318.25</Text>
          </Flex>
        </Section>
      </Stack>
    )),
};

export const Tones: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section
          title="Semantic tones"
          note="All nine values accepted by c. Tones are utility classes so theme overrides and className still win."
        >
          <Stack gap="xs">
            {toneOptions.map((tone, i) => (
              <Stack gap="xs">
                <Flex gap="md" align="baseline">
                  <Text size="xs" c="dimmed" className="font-mono" style={{ width: "112px", "flex-shrink": 0 }}>{tone}</Text>
                  <Text size="sm" c={tone}>{tone} — Alphashri terminal 1,234.56</Text>
                </Flex>
                {i < toneOptions.length - 1 ? <Divider /> : null}
              </Stack>
            ))}
          </Stack>
          <Text size="xs" c="dimmed">
            secondary and dimmed both resolve to text-muted; error and danger both resolve to negative. Title and Anchor map info to primary instead.
          </Text>
        </Section>
        <Section title="Literal colour escape hatch" note="A c value that looks like a colour is painted inline; token names stay utilities.">
          <Text size="sm" c={palette.POSITIVE}>c=palette.POSITIVE renders as an inline colour value.</Text>
        </Section>
      </Stack>
    )),
};

export const TruncationAndLineClamp: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Truncate (end and start)" note="truncate sets overflow, nowrap and an ellipsis; 'start' flips the direction. The full value stays in title.">
          <Stack gap="sm" style={{ width: "420px" }}>
            <Text size="sm" truncate title={longText}>{longText}</Text>
            <Text size="sm" truncate="end" title={longText}>{longText}</Text>
            <Text size="sm" truncate="start" title={longText}>{longText}</Text>
          </Stack>
        </Section>
        <Section title="Line clamp" note="lineClamp=n clips to n lines with -webkit-line-clamp; pair with title for the full string.">
          <Stack gap="sm" style={{ width: "420px" }}>
            <Text size="sm" lineClamp={1} title={longText}>1 line — {longText}</Text>
            <Text size="sm" lineClamp={2} title={longText}>2 lines — {longText}</Text>
            <Text size="sm" lineClamp={3} title={longText}>3 lines — {longText}</Text>
          </Stack>
        </Section>
      </Stack>
    )),
};

export const Composition: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Element composition" note="Text is a paragraph by default; span switches to an inline element, component picks any supported intrinsic tag.">
          <Text size="sm">
            A paragraph by default.{" "}
            <Text size="sm" span c="primary">span inline</Text>
            {" "}inside the flow, followed by{" "}
            <Text size="sm" component="code" className="font-mono" style={{ "background-color": palette.SURFACE_ALT, padding: "2px 6px" }}>
              {"component=\"code\""}
            </Text>
            .
          </Text>
          <Divider label="Block override" labelPosition="left" />
          <Text size="sm" component="div" c="dimmed">{"component=\"div\" keeps the type styles on a block element."}</Text>
        </Section>
        <Section title="Alignment, transform and spacing" note="ta / tt pass straight to CSS; numeric p/m props multiply by 8.">
          <Stack gap="xs" style={{ width: "360px" }}>
            {(["left", "center", "right"] as const).map((ta) => (
              <Text size="sm" ta={ta} style={{ "background-color": palette.SURFACE_ALT, padding: "4px 8px" }}>ta={ta}</Text>
            ))}
          </Stack>
          <Flex gap="lg" align="baseline" wrap="wrap">
            <Text size="sm" tt="uppercase">open interest by strike</Text>
            <Text size="sm" tt="capitalize">open interest by strike</Text>
            <Text size="sm" fs="italic">fs=italic — a secondary annotation.</Text>
          </Flex>
          <Text size="sm" style={{ "background-color": palette.SURFACE_ALT, display: "inline-block" }} p="sm" m={1}>
            {"p=\"sm\" (8px), m={1} (8px)"}
          </Text>
        </Section>
      </Stack>
    )),
};
