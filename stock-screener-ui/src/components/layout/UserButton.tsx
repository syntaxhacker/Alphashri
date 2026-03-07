import { IconLogout } from "@tabler/icons-react";
import { Avatar, Group, Text, UnstyledButton, Menu, rem } from "@mantine/core";
import classes from "./UserButton.module.css";

declare global {
  interface Window {
    __ALPHASHRI_USER__?: {
      displayName: string;
      email: string;
    };
    handleLogout?: () => void;
  }
}

export function UserButton({ collapsed }: { collapsed?: boolean }) {
  const user = window.__ALPHASHRI_USER__ || { displayName: "User", email: "user@example.com" };

  const handleLogout = () => {
    if (window.handleLogout) {
      window.handleLogout();
    }
  };

  return (
    <Menu position="right-start" offset={8}>
      <Menu.Target>
        <UnstyledButton
          className={classes.user}
          data-testid="user-menu-trigger"
          style={{ padding: collapsed ? "var(--mantine-spacing-xs)" : undefined }}
        >
          <Group justify={collapsed ? "center" : "flex-start"}>
            <Avatar radius="xl" alt={user.displayName} />

            {!collapsed && (
              <div style={{ flex: 1 }}>
                <Text size="sm" fw={500}>
                  {user.displayName}
                </Text>

                <Text c="dimmed" size="xs">
                  {user.email}
                </Text>
              </div>
            )}
          </Group>
        </UnstyledButton>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Item
          leftSection={<IconLogout style={{ width: rem(14), height: rem(14) }} />}
          onClick={handleLogout}
          color="red"
          data-testid="logout-button"
        >
          Logout
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
