import { useLocation } from "react-router-dom";
import { Box, Text } from "@/ui";
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
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import MenuIcon from "@mui/icons-material/Menu";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import { useState } from "react";
import { FIN_HEADER_H, FIN_NAV_W, FIN_NAV_W_COLLAPSED } from "@/ui/palette";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure();
  const [desktopCollapsed, { toggle: toggleDesktop }] = useDisclosure(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const navWidth = desktopCollapsed ? FIN_NAV_W_COLLAPSED : FIN_NAV_W;

  const drawerContent = (
    <NavbarNested activePath={location.pathname} collapsed={desktopCollapsed} onToggleCollapse={toggleDesktop} onMobileNavigate={closeMobile} />
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }} id="app-shell" data-testid="app-shell">
      <MuiAppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }} id="app-header" data-testid="app-header">
        <Toolbar disableGutters>
          <Container maxWidth="xl" sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <IconButton size="small" onClick={toggleMobile} sx={{ display: { md: "none" } }} aria-label="Toggle navigation">
                <MenuIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={toggleDesktop} sx={{ display: { xs: "none", md: "inline-flex" } }} aria-label="Toggle sidebar">
                <MenuIcon fontSize="small" />
              </IconButton>
              <Text fw={700} size="md" id="app-logo" data-testid="app-logo">
                Alphashri
              </Text>
            </Stack>
            <Box sx={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
              <MarketTicker />
            </Box>
            <NewsPanel2 />
            <ActionIcon variant="subtle" size="lg" onClick={() => setNotifOpen(true)} data-testid="notif-bell">
              <IconBell size={20} />
            </ActionIcon>
          </Container>
        </Toolbar>
      </MuiAppBar>

      <NotificationsPanel opened={notifOpen} onClose={() => setNotifOpen(false)} />

      {/* Mobile: temporary drawer */}
      <MuiDrawer
        variant="temporary"
        open={mobileOpened}
        onClose={closeMobile}
        ModalProps={{ keepMounted: true }}
        id="app-navbar-mobile"
        data-testid="app-navbar-mobile"
        sx={{
          display: { xs: "block", md: "none" },
          "& .MuiDrawer-paper": { width: FIN_NAV_W, boxSizing: "border-box" },
        }}
      >
        <Toolbar />
        {drawerContent}
      </MuiDrawer>

      {/* Desktop: permanent drawer */}
      <MuiDrawer
        variant="permanent"
        id="app-navbar"
        data-testid="app-navbar"
        sx={{
          display: { xs: "none", md: "block" },
          width: navWidth,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: navWidth,
            boxSizing: "border-box",
            transition: theme.transitions.create(["width"], { easing: theme.transitions.easing.sharp, duration: theme.transitions.duration.enteringScreen }),
            overflowX: "hidden",
          },
        }}
        open
      >
        <Toolbar />
        {drawerContent}
      </MuiDrawer>

      <Box
        component="main"
        id="app-main"
        data-testid="app-main"
        sx={{ flexGrow: 1, width: { md: `calc(100% - ${navWidth}px)` }, ml: { md: `${navWidth}px` }, minWidth: 0, minHeight: 0, bgcolor: "background.default", display: "flex", flexDirection: "column" }}
      >
        <Toolbar />
        <Container maxWidth="xl" sx={{ py: 2, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {children}
        </Container>
      </Box>
    </Box>
  );
}
