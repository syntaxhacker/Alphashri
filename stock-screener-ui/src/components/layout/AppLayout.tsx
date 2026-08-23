import { useLocation } from "react-router-dom";
import { Group, Box, Text } from "@/ui";
import { useDisclosure } from "@/ui/hooks";
import { NavbarNested } from "./NavbarNested";
import { NotificationsPanel } from "../notifications/NotificationsPanel";
import { IconBell } from "@tabler/icons-react";
import { ActionIcon } from "@/ui";
import { MarketTicker } from "./MarketTicker";
import NewsPanel2 from "../news/NewsPanel2";
import MuiAppBar from "@mui/material/AppBar";
import MuiDrawer from "@mui/material/Drawer";
import Toolbar from "@mui/material/Toolbar";
import IconButton from "@mui/material/IconButton";
import MenuIcon from "@mui/icons-material/Menu";
import { useState } from "react";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
  const [desktopCollapsed, { toggle: toggleDesktop }] = useDisclosure(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const headerHeight = 50;
  const navWidth = desktopCollapsed ? 80 : 200;

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }} id="app-shell" data-testid="app-shell">
      <MuiAppBar position="fixed" sx={{ height: headerHeight, zIndex: (t) => t.zIndex.drawer + 1 }} id="app-header" data-testid="app-header">
        <Toolbar sx={{ minHeight: headerHeight, height: headerHeight, bgcolor: "background.paper" }}>
          <Group justify="space-between" align="center" h="100%" px="sm" gap="sm">
            <Group gap="xs">
              <IconButton size="small" onClick={toggleMobile} sx={{ display: { sm: "none" } }} aria-label="Toggle navigation">
                <MenuIcon />
              </IconButton>
              <IconButton size="small" onClick={toggleDesktop} sx={{ display: { xs: "none", sm: "inline-flex" } }} aria-label="Toggle sidebar">
                <MenuIcon />
              </IconButton>
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
        </Toolbar>
      </MuiAppBar>

      <NotificationsPanel opened={notifOpen} onClose={() => setNotifOpen(false)} />

      <MuiDrawer
        variant="permanent"
        id="app-navbar"
        data-testid="app-navbar"
        sx={{
          width: navWidth,
          flexShrink: 0,
          display: { xs: mobileOpened ? "block" : "none", sm: "block" },
          [`& .MuiDrawer-paper`]: {
            width: navWidth,
            boxSizing: "border-box",
            top: headerHeight,
            height: `calc(100% - ${headerHeight}px)`,
          },
        }}
        open
      >
        <NavbarNested activePath={location.pathname} collapsed={desktopCollapsed} onToggleCollapse={toggleDesktop} onMobileNavigate={toggleMobile} />
      </MuiDrawer>

      <Box
        component="main"
        id="app-main"
        data-testid="app-main"
        sx={{ flexGrow: 1, ml: { sm: `${navWidth}px` }, mt: `${headerHeight}px`, p: 2, minWidth: 0, minHeight: 0, bgcolor: "background.paper" }}
      >
        {children}
      </Box>
    </Box>
  );
}
