import type { Meta, StoryObj } from "@storybook/react-vite";
import { Title } from "./Title";

const meta: Meta<typeof Title> = {
  title: "Primitives/Typography/Title",
  component: Title,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Heading (h1-h6) with MUI typography scale. Use for page and section headings. When not to use: for body copy use Text. Uses MUI Title with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Title>;

export const AllOrders: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {([1, 2, 3, 4, 5, 6] as const).map((order) => (
        <Title key={order} order={order}>
          Heading order={order}
        </Title>
      ))}
    </div>
  ),
};

export const ColoredTitle: Story = {
  render: () => (
    <div>
      <Title order={3} c="info">
        Teal title
      </Title>
      <Title order={3} c="dimmed">
        Dimmed title
      </Title>
    </div>
  ),
};

export const AlignedCenter: Story = {
  args: { order: 4, ta: "center", children: "Centered title" },
};

// App pattern: explicit heading sizes (size="h4"/"h5") decoupled from order
export const HeadingSizes: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Title order={2} size="h3">size=&quot;h3&quot;</Title>
      <Title order={2} size="h4">size=&quot;h4&quot; (panel headers)</Title>
      <Title order={3} size="h5">size=&quot;h5&quot; (section headers)</Title>
    </div>
  ),
};
