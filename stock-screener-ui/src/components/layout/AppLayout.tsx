import { useLocation } from "react-router-dom";
import { AppShell, AppShellHeader, AppShellNavbar, AppShellMain, Group, Box, Text } from "@/ui";
import { useState } from "react";
import { NavbarNested } from "./NavbarNested";
import { NotificationsPanel } from "../notifications/NotificationsPanel";
import { IconBell } from "@tabler/icons-react";
import { ActionIcon } from "@/ui";
import { MarketTicker } from "./MarketTicker";
import { useThemeColors } from "../../hooks/useThemeColors";
import NewsPanel2 from "../news/NewsPanel2";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const colors = useThemeColors();
  const [collapsed, setCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const toggleCollapsed = () => setCollapsed((prev) => !prev);

  return (
    <AppShell
      header={{ height: 50 }}
      navbar={{
        width: collapsed ? 80 : 200,
        breakpoint: "sm",
      }}
      padding="md"
      h="100vh"
      id="app-shell"
      data-testid="app-shell"
    >
      <AppShellHeader
        bg={colors.background}
        c={colors.text}
        id="app-header"
        data-testid="app-header"
      >
        <Group justify="space-between" align="center" h="100%" px="sm" gap="sm">
          <Text fw={700} size="lg" id="app-logo" data-testid="app-logo" style={{ flex: "none" }}>
            🚀 Alphashri
          </Text>
          <Box flex={1}>
            <MarketTicker />
          </Box>
          <NewsPanel2 />
          <ActionIcon variant="subtle" size="lg" onClick={() => setNotifOpen(true)} data-testid="notif-bell">
            <IconBell size={20} />
          </ActionIcon>
        </Group>
      </AppShellHeader>

      <NotificationsPanel opened={notifOpen} onClose={() => setNotifOpen(false)} />

      <AppShellNavbar id="app-navbar" data-testid="app-navbar">
        <NavbarNested
          activePath={location.pathname}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
        />
      </AppShellNavbar>

      <AppShellMain
        bg={colors.background}
        c={colors.text}
        h="100%"
        style={{ overflow: "auto" }}
        id="app-main"
        data-testid="app-main"
      >
        {children}
      </AppShellMain>
    </AppShell>
  );
}
