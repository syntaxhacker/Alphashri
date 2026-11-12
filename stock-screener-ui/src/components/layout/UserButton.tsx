import { Show, createMemo, useContext } from "solid-js";
import { IconLogout } from "../common/Icons";
import { Avatar, Box, Group, Text, UnstyledButton, Menu, MenuTarget, MenuDropdown, MenuItem } from "@/ui";
import { AuthContext } from "../auth/AuthProvider2";


declare global {
  interface Window {
    __ALPHASHRI_USER__?: {
      displayName: string;
      email: string;
    };
    handleLogout?: () => void;
  }
}

export function UserButton(props: { collapsed?: boolean }) {
  const collapsed = () => props.collapsed ?? false;
  // Prefer the auth context so the button re-renders when the user loads.
  // Fall back to the window global for Storybook (no provider) and tests.
  const auth = useContext(AuthContext);
  const user = createMemo(() =>
    auth?.user
      ? {
          displayName: auth.user.display_name || auth.user.email?.split("@")[0] || "User",
          email: auth.user.email,
        }
      : window.__ALPHASHRI_USER__ || { displayName: "User", email: "user@example.com" },
  );

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
          className="block w-full p-2 text-fin-text rounded-fin hover:bg-fin-surface-alt"
          style={{ padding: collapsed() ? "8px" : undefined }}
        >
          <Group justify={collapsed() ? "center" : "flex-start"} wrap="nowrap" gap="sm">
            <Avatar radius="xl" alt={user().displayName} data-testid="user-avatar" />

            <Show when={!collapsed()}>
              <Box flex={1} data-testid="user-info" style={{ "min-width": "0px" }}>
                <Text size="xs" fw={500} truncate data-testid="user-display-name">
                  {user().displayName}
                </Text>

                <Text c="dimmed" size="xs" truncate data-testid="user-email">
                  {user().email}
                </Text>
              </Box>
            </Show>
          </Group>
        </UnstyledButton>
      </MenuTarget>

      <MenuDropdown data-testid="user-menu-dropdown">
        <MenuItem
          leftSection={<IconLogout size={14} />}
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
