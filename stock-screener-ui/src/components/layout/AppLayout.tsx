import { useLocation } from "react-router-dom";
import { useDisclosure } from "@/ui/hooks";
import { NavbarNested } from "./NavbarNested";
import { NotificationsPanel } from "../notifications/NotificationsPanel";
import { UserButton } from "./UserButton";
import MuiAppBar from "@mui/material/AppBar";
import MuiDrawer from "@mui/material/Drawer";
import Toolbar from "@mui/material/Toolbar";
import Container from "@mui/material/Container";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Badge from "@mui/material/Badge";
import MenuIcon from "@mui/icons-material/Menu";
import NotificationsIcon from "@mui/icons-material/Notifications";
import { useTheme } from "@mui/material/styles";
import { useState } from "react";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const theme = useTheme();
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure();
  const [desktopCollapsed, { toggle: toggleDesktop }] = useDisclosure(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const navWidth = desktopCollapsed ? 64 : 200;

  const drawerContent = (
    <NavbarNested activePath={location.pathname} collapsed={desktopCollapsed} onToggleCollapse={toggleDesktop} onMobileNavigate={closeMobile} />
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }} id="app-shell" data-testid="app-shell">
      <MuiAppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }} id="app-header" data-testid="app-header">
        <Toolbar>
          <IconButton color="inherit" size="small" edge="start" onClick={toggleMobile} sx={{ display: { md: "none" }, mr: 1 }} aria-label="Toggle navigation">
            <MenuIcon />
          </IconButton>
          <IconButton color="inherit" size="small" edge="start" onClick={toggleDesktop} sx={{ display: { xs: "none", md: "inline-flex" }, mr: 1 }} aria-label="Toggle sidebar">
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap component="div" sx={{ fontWeight: 700, letterSpacing: "-0.01em" }} id="app-logo" data-testid="app-logo">
            Alphashri
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Stack direction="row" spacing={1} alignItems="center">
            <IconButton color="inherit" onClick={() => setNotifOpen(true)} data-testid="notif-bell" aria-label="Notifications">
              <Badge color="error" variant="dot" invisible={false}>
                <NotificationsIcon />
              </Badge>
            </IconButton>
            <UserButton collapsed={false} />
          </Stack>
        </Toolbar>
      </MuiAppBar>

      <NotificationsPanel opened={notifOpen} onClose={() => setNotifOpen(false)} />

      <MuiDrawer
        variant="temporary"
        open={mobileOpened}
        onClose={closeMobile}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: "block", md: "none" }, "& .MuiDrawer-paper": { width: 200, boxSizing: "border-box" } }}
      >
        <Toolbar />
        {drawerContent}
      </MuiDrawer>

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
            transition: theme.transitions.create("width", { easing: theme.transitions.easing.sharp, duration: theme.transitions.duration.enteringScreen }),
            overflowX: "hidden",
          },
        }}
        open
      >
        <Toolbar />
        {drawerContent}
      </MuiDrawer>

      <Box component="main" sx={{ flexGrow: 1, width: { md: `calc(100% - ${navWidth}px)` }, ml: { md: `${navWidth}px` }, minWidth: 0, minHeight: 0, bgcolor: "background.default", display: "flex", flexDirection: "column" }} id="app-main" data-testid="app-main">
        <Toolbar />
        <Container maxWidth="xl" disableGutters sx={{ p: 0, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {children}
        </Container>
      </Box>
    </Box>
  );
}
