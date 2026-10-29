import { useLocation } from "react-router-dom";
import { useDisclosure } from "@/ui/hooks";
import { NavbarNested } from "./NavbarNested";
import { NotificationsPanel, useSurgeAlertTotal } from "../notifications/NotificationsPanel";
import { MarketTicker } from "./MarketTicker";
import NewsPanel2 from "../news/NewsPanel2";
import MuiAppBar from "@mui/material/AppBar";
import MuiDrawer from "@mui/material/Drawer";
import Toolbar from "@mui/material/Toolbar";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
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
  const [notifRefreshKey, setNotifRefreshKey] = useState(0);
  const surgeTotal = useSurgeAlertTotal(notifRefreshKey);
  const navWidth = desktopCollapsed ? 64 : 200;

  const handleNotifOpen = () => setNotifOpen(true);
  const handleNotifClose = () => {
    setNotifOpen(false);
    setNotifRefreshKey((key) => key + 1);
  };

  const drawerContent = (
    <NavbarNested activePath={location.pathname} collapsed={desktopCollapsed} onToggleCollapse={toggleDesktop} onMobileNavigate={closeMobile} />
  );

  return (
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden", bgcolor: "background.default" }} id="app-shell" data-testid="app-shell">
      <MuiAppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }} id="app-header" data-testid="app-header">
        <Toolbar sx={{ px: 1.5, gap: 0.75, minHeight: { xs: 48, sm: 56 } }}>
          <IconButton color="inherit" size="small" edge="start" onClick={toggleMobile} sx={{ display: { md: "none" }, mr: 0.5 }} aria-label="Toggle navigation">
            <MenuIcon fontSize="small" />
          </IconButton>
          <IconButton color="inherit" size="small" edge="start" onClick={toggleDesktop} sx={{ display: { xs: "none", md: "inline-flex" }, mr: 0.5 }} aria-label="Toggle sidebar">
            <MenuIcon fontSize="small" />
          </IconButton>
          <Typography variant="h6" noWrap component="div" sx={{ fontSize: 14, lineHeight: 1, fontWeight: 700, letterSpacing: "-0.01em", mr: 0.25 }} id="app-logo" data-testid="app-logo">
            Alphashri
          </Typography>
          {/* Centre zone: market tape when live, explicit status when the
              exchange is closed so the header never shows a dead gap. */}
          <Box
            data-testid="app-header-center"
            sx={{ flexGrow: 1, minWidth: 0, display: "flex", alignItems: "center", overflow: "hidden" }}
          >
            <MarketTicker />
          </Box>
          <Divider
            orientation="vertical"
            flexItem
            data-testid="app-header-divider"
            sx={{ my: 1.75, borderColor: "divider" }}
          />
          <Stack
            direction="row"
            spacing={0.5}
            data-testid="app-header-actions"
            sx={{
              alignItems: "center",
              flexShrink: 0,
              "& .MuiButton-root": { height: 32 },
              "& .MuiIconButton-root": { width: 32, height: 32 },
            }}
          >
            <NewsPanel2 />
            <Tooltip title={surgeTotal > 0 ? `${surgeTotal} surge alerts` : "Notifications"}>
              <IconButton
                color="inherit"
                size="small"
                onClick={handleNotifOpen}
                data-testid="notif-bell"
                aria-label={surgeTotal > 0 ? `Notifications, ${surgeTotal} surge alerts` : "Notifications"}
                sx={{ "& .MuiBadge-badge": { fontSize: 9, height: 13, minWidth: 13, px: 0.4 } }}
              >
                <Badge
                  color="error"
                  badgeContent={surgeTotal > 9 ? "9+" : surgeTotal}
                  invisible={surgeTotal === 0}
                  data-testid="notif-badge"
                >
                  <NotificationsIcon fontSize="small" />
                </Badge>
              </IconButton>
            </Tooltip>
          </Stack>
        </Toolbar>
      </MuiAppBar>

      <NotificationsPanel opened={notifOpen} onClose={handleNotifClose} />

      <MuiDrawer
        variant="temporary"
        open={mobileOpened}
        onClose={closeMobile}
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
            // The nav body owns the only scrollbar: the drawer paper is just a
            // fixed-width flex column (Toolbar + nav + footer).
            overflow: "hidden",
          },
        }}
        open
      >
        <Toolbar />
        {drawerContent}
      </MuiDrawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, minHeight: 0, overflow: "auto", bgcolor: "background.default", display: "flex", flexDirection: "column" }} id="app-main" data-testid="app-main">
        <Toolbar />
        <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", width: "100%", p: 0, m: 0 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
