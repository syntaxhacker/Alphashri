import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Title, Button } from "@mantine/core";
import { IconTrash, IconSettings, IconLogout } from "@tabler/icons-react";
import { Menu, MenuTarget, MenuDropdown, MenuItem } from "./Menu";

const meta: Meta<typeof Menu> = {
  title: "Primitives/Data Display/Menu",
  component: Menu,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Menu>;

export const Default: Story = {
  render: () => (
    <Stack gap="sm" p="xl">
      <Title order={5}>Click the button to open</Title>
      <Menu position="bottom-start" withArrow shadow="md">
        <MenuTarget>
          <Button variant="default">Bot actions</Button>
        </MenuTarget>
        <MenuDropdown>
          <MenuItem leftSection={<IconSettings size={16} />} onClick={() => {}}>
            Configure
          </MenuItem>
          <MenuItem leftSection={<IconLogout size={16} />} onClick={() => {}}>
            Stop bot
          </MenuItem>
          <MenuItem
            color="red"
            leftSection={<IconTrash size={16} />}
            onClick={() => {}}
          >
            Delete bot
          </MenuItem>
        </MenuDropdown>
      </Menu>
    </Stack>
  ),
};

export const HoverTrigger: Story = {
  render: () => (
    <Stack gap="sm" p="xl">
      <Title order={5}>Hover trigger + disabled item</Title>
      <Menu trigger="hover">
        <MenuTarget>
          <Button variant="light" color="blue">Hover me</Button>
        </MenuTarget>
        <MenuDropdown>
          <MenuItem onClick={() => {}}>View chart</MenuItem>
          <MenuItem disabled>Add to watchlist</MenuItem>
          <MenuItem color="red" onClick={() => {}}>Remove</MenuItem>
        </MenuDropdown>
      </Menu>
    </Stack>
  ),
};
