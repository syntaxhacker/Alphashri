import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScrollArea } from "./ScrollArea";

const meta: Meta<typeof ScrollArea> = {
  title: "Primitives/Layout/ScrollArea",
  component: ScrollArea,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ScrollArea>;

const longContent = Array.from({ length: 40 }, (_, i) => (
  <div key={i} style={{ padding: "6px 12px", borderBottom: "1px solid var(--mantine-color-default-border)" }}>
    Row {i + 1}
  </div>
));

export const VerticalScroll: Story = {
  render: () => (
    <ScrollArea h={200} w={300} type="always">
      {longContent}
    </ScrollArea>
  ),
};

export const AutoScrollbar: Story = {
  render: () => (
    <ScrollArea h={200} w={300} offsetScrollbars>
      {longContent}
    </ScrollArea>
  ),
};
