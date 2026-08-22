import type { Meta, StoryObj } from "@storybook/react-vite";
import { Title } from "./Title";

const meta: Meta<typeof Title> = {
  title: "Design System/Typography/Title",
  component: Title,
  tags: ["autodocs"],
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
      <Title order={3} c="teal">
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
