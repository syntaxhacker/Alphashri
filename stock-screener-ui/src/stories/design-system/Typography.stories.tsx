import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { Anchor, Code, Divider, List, Text, Title } from "@/ui";

const meta: Meta = { title: "Design System/Typography", tags: ["autodocs"] };
export default meta;
type Story = StoryObj;

export const TextStyles: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ display: "grid", gap: "12px", "max-width": "820px" }}>
        <Text size="xl" fw={700}>Extra large / 700 — headline</Text>
        <Text size="lg" fw={600}>Large / 600 — section heading</Text>
        <Text size="md">Medium / 400 — default body copy for dense terminal surfaces.</Text>
        <Text size="sm">Small / 400 — secondary copy and table values.</Text>
        <Text size="xs">Extra small / 400 — labels and meta.</Text>
        <Text size="sm" c="dimmed">Dimmed tone — supporting information.</Text>
        <Text size="sm" c="success">Positive tone — +1,240.50</Text>
        <Text size="sm" c="error">Negative tone — -318.25</Text>
        <Text size="sm" fw={700} class="font-mono tabular-nums">Monospace numerical: 23,450.85</Text>
        <Text size="sm" truncate style={{ width: "280px" }}>
          This sentence is intentionally long enough to demonstrate single-line truncation with an ellipsis.
        </Text>
      </div>
    )),
};

export const Titles: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ display: "grid", gap: "8px" }}>
        <Title order={1}>Order 1 / market terminal</Title>
        <Title order={2}>Order 2 / panel title</Title>
        <Title order={3}>Order 3 / section</Title>
        <Title order={4}>Order 4 / dense header</Title>
        <Title order={5}>Order 5 / label</Title>
        <Title order={6}>Order 6 / micro label</Title>
        <Title order={3} c="dimmed">Dimmed title</Title>
      </div>
    )),
};

export const LinksAndCode: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ display: "grid", gap: "14px", "max-width": "720px" }}>
        <Text>
          Inline link: <Anchor href="#typography">view the market report</Anchor> and a{" "}
          <Anchor href="#typography" underline="always">permanently underlined link</Anchor>.
        </Text>
        <Text>
          Inline code: <Code>useValueFlash</Code>; block code:
        </Text>
        <Code block>{`const range = aggregate.rangeCutoff(asOf, "6m");\nconst rows = await fetchPrices({ range });`}</Code>
        <Divider />
        <List withPadding>
          <List.Item>Ordered rows can be used for setup steps.</List.Item>
          <List.Item>Lists inherit the terminal type scale.</List.Item>
          <List.Item>Nested content stays readable at 11–13px.</List.Item>
        </List>
      </div>
    )),
};
