import type { Meta, StoryObj } from "@storybook/html-vite";
import { Stack, Title } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Section } from "./fixtures";

const toneOptions = ["primary", "secondary", "success", "error", "warning", "info", "danger", "dimmed", "default"];
const sizeOptions = ["xs", "sm", "md", "lg", "xl"] as const;

const meta: Meta = {
  title: "Design System/Components/Typography/Title",
  tags: ["autodocs"],
  component: Title as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Title is the local heading primitive. `order` picks the semantic h1–h6 tag (default h3) but does not set the font size — pass `size` for that. `component` can override the element, and `c`, `fw`, `ta`, `lh` style it. Note Title maps the `info` tone to primary, unlike Text.",
      },
    },
  },
  argTypes: {
    children: { control: { type: "text" }, description: "Heading text." },
    order: { control: { type: "select" }, options: [1, 2, 3, 4, 5, 6], description: "Semantic heading level → h1…h6." },
    size: { control: { type: "select" }, options: sizeOptions, description: "xs 12 · sm 14 · md 16 · lg 18 · xl 24px." },
    c: { control: { type: "select" }, options: toneOptions },
    fw: { control: { type: "select" }, options: ["normal", "medium", "semibold", "bold", 500, 600, 700] },
    ta: { control: { type: "inline-radio" }, options: ["left", "center", "right"] },
    lh: { control: { type: "number" } },
    component: { control: { type: "select" }, options: ["h1", "h2", "h3", "h4", "h5", "h6", "div"] },
    title: { control: { type: "text" }, description: "Native tooltip forwarded to the heading element." },
    mt: { control: { type: "number" } },
    mb: { control: { type: "number" } },
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: { children: "Heading — playground", order: 3, size: "lg", c: "primary" },
  render: (args) => solidStory(() => <Title {...args} />),
};

export const OrderAndSizes: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Order → semantic element" note="order 1…6 renders h1…h6. It sets the tag, not the size — pass size explicitly for a token-driven font-size.">
          <Stack gap="xs">
            {([1, 2, 3, 4, 5, 6] as const).map((order) => (
              <Title order={order} size="md">{`order={${order}} → h${order}`}</Title>
            ))}
          </Stack>
        </Section>
        <Section title="Title sizes" note="Title's scale differs from Text: xl is 24px here.">
          <Stack gap="xs">
            {sizeOptions.map((size) => (
              <Title order={3} size={size}>{`Title size="${size}"`}</Title>
            ))}
          </Stack>
        </Section>
      </Stack>
    )),
};

export const TonesAndOverrides: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Tones" note="All nine tone names are accepted. Title's info maps to primary, so it reads as the accent colour here.">
          {toneOptions.map((tone) => (
            <Title order={4} size="md" c={tone}>{`c="${tone}" — heading`}</Title>
          ))}
        </Section>
        <Section title="Component override and typography props" note="component changes the element while order stays available for semantics; fw / lh / ta / margins apply too.">
          <Title order={4} component="h2" c="primary" size="lg">An h2 element with order=4</Title>
          <Title order={4} size="md" fw={500} lh={1.4} ta="center">fw / lh / ta also apply</Title>
          <Title order={4} size="md" mt={1} mb={2}>{"Numeric mt={1} / mb={2} multiply by 8"}</Title>
        </Section>
      </Stack>
    )),
};
