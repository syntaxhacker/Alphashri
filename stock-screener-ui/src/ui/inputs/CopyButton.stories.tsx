import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group } from "@mantine/core";
import { CopyButton } from "./CopyButton";
import { Button } from "./Button";

const meta: Meta<typeof CopyButton> = {
  title: "Design System/UI/Inputs/CopyButton",
  component: CopyButton,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof CopyButton>;

export const Default: Story = {
  render: () => (
    <CopyButton value="RELIANCE">
      {({ copied, copy }) => (
        <Button variant={copied ? "light" : "filled"} color={copied ? "teal" : "blue"} onClick={copy}>
          {copied ? "Copied!" : "Copy symbol"}
        </Button>
      )}
    </CopyButton>
  ),
};

export const CopyToken: Story = {
  render: () => (
    <Group gap="md">
      <code>f8a1…9c2e</code>
      <CopyButton value="f8a1b2c3d4e5f67890abcdef12345678" timeout={2000}>
        {({ copied, copy }) => (
          <Button variant="default" size="xs" onClick={copy}>
            {copied ? "✓ Copied" : "Copy token"}
          </Button>
        )}
      </CopyButton>
    </Group>
  ),
};
