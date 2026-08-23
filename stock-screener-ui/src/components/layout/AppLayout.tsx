import { useLocation } from "react-router-dom";
import { AppShell, AppShellHeader, AppShellNavbar, AppShellMain, Group, Box, Text } from "@/ui";
import { Burger } from "@mantine/core";
import { useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { NavbarNested } from "./NavbarNested";
import { NotificationsPanel } from "../notifications/NotificationsPanel";
import { IconBell } from "@tabler/icons-react";
import { ActionIcon } from "@/ui";
import { MarketTicker } from "./MarketTicker";
import NewsPanel2 from "../news/NewsPanel2";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
  const [desktopCollapsed, { toggle: toggleDesktop }] = useDisclosure(false);
  const [notifOpen, setNotifOpen] = useState(false);

  return (
    <AppShell
      header={{ height: 50 }}
      navbar={{
        width: desktopCollapsed ? 80 : 200,
        breakpoint: "sm",
        collapsed: { mobile: !mobileOpened, desktop: false },
      }}
      padding="md"
      id="app-shell"
      data-testid="app-shell"
    >
      <AppShellHeader id="app-header" data-testid="app-header" sx={{ bgcolor: "background.paper" }}>
        <Group justify="space-between" align="center" h="100%" px="sm" gap="sm">
          <Group gap="xs">
            <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <Text fw={700} size="lg" id="app-logo" data-testid="app-logo" style={{ flex: "none" }}>
              🚀 Alphashri
            </Text>
          </Group>
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
          collapsed={desktopCollapsed}
          onToggleCollapse={toggleDesktop}
          onMobileNavigate={toggleMobile}
        />
      </AppShellNavbar>

      <AppShellMain id="app-main" data-testid="app-main" sx={{ bgcolor: "background.paper" }}>
        {children}
      </AppShellMain>
    </AppShell>
  );
}
