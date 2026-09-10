import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "./Card";

const meta: Meta<typeof Card> = {
  title: "Primitives/Layout/Card",
  component: Card,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Content container with border and shadow. Use for dashboards, screener rows, or any grouped content that needs visual separation. When not to use: for page-level layout use Paper or Box. Uses MUI Card with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: () => (
    <Card shadow="sm" padding="lg" radius="md" w={300}>
      Simple card with shadow and large padding.
    </Card>
  ),
};

export const PaddingVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      {(["xs", "md", "xl"] as const).map((padding) => (
        <Card key={padding} padding={padding} radius="md">
          padding=&quot;{padding}&quot;
        </Card>
      ))}
    </div>
  ),
};

export const WithShadowAndRadius: Story = {
  render: () => (
    <Card shadow="lg" radius="xl" padding="md" w={280}>
      Rounded card with a large shadow
    </Card>
  ),
};
