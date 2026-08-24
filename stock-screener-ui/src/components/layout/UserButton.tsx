import { IconLogout } from "@tabler/icons-react";
import { Avatar, Box, Group, Text, UnstyledButton, Menu, MenuTarget, MenuDropdown, MenuItem, rem } from "@/ui";


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
    <Menu position="right-start" offset={8} shadow="md">
      <MenuTarget>
        <UnstyledButton
          data-testid="user-menu-trigger"
          id="user-button"
          sx={{
            display: "block",
            width: "100%",
            p: "8px",
            color: "text.primary",
            borderRadius: "8px",
            "&:hover": { bgcolor: "action.hover" },
          }}
          style={{ padding: collapsed ? "8px" : undefined }}
        >
          <Group justify={collapsed ? "center" : "flex-start"} wrap="nowrap" gap="sm">
            <Avatar radius="xl" alt={user.displayName} data-testid="user-avatar" />

            {!collapsed && (
              <Box flex={1} data-testid="user-info" style={{ minWidth: 0 }}>
                <Text size="xs" fw={500} truncate data-testid="user-display-name">
                  {user.displayName}
                </Text>

                <Text c="dimmed" size="xs" truncate data-testid="user-email">
                  {user.email}
                </Text>
              </Box>
            )}
          </Group>
        </UnstyledButton>
      </MenuTarget>

      <MenuDropdown data-testid="user-menu-dropdown">
        <MenuItem
          leftSection={<IconLogout style={{ width: rem(14), height: rem(14) }} />}
          onClick={handleLogout}
          color="error"
          data-testid="logout-button"
        >
          Logout
        </MenuItem>
      </MenuDropdown>
    </Menu>
  );
}
