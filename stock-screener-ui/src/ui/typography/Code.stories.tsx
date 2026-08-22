import type { Meta, StoryObj } from "@storybook/react-vite";
import { Code } from "./Code";

const meta: Meta<typeof Code> = {
  title: "Design System/Typography/Code",
  component: Code,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Code>;

export const InlineCode: Story = {
  render: () => (
    <div>
      Run <Code>npx vite build</Code> to compile the project.
    </div>
  ),
};

export const BlockCode: Story = {
  render: () => (
    <Code block>
      {`function greet(name) {\n  return \`Hello, \${name}!\`;\n}`}
    </Code>
  ),
};

export const ColoredBlock: Story = {
  args: { block: true, color: "teal", children: "npm install @mantine/core" },
};
