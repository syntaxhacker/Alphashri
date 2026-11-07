import { useLocation } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { useDisclosure } from "@/ui/hooks";
import { Box, Divider } from "@/ui";
import MuiDrawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import { IconMenu2 } from "@tabler/icons-react";
import { NavbarNested } from "./NavbarNested";
import { SidebarHeader } from "./SidebarHeader";
import { NotificationsPanel, useSurgeAlertTotal } from "../notifications/NotificationsPanel";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const theme = useTheme();
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure();
  const [desktopCollapsed, { toggle: toggleDesktop }] = useDisclosure(false);
  // Only one navigation tree is mounted at a time: the hidden permanent drawer
  // used to keep all 19 links (and the news poller) alive on phones.
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"), { noSsr: true });
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifRefreshKey, setNotifRefreshKey] = useState(0);
  const surgeTotal = useSurgeAlertTotal(notifRefreshKey);
  const navWidth = desktopCollapsed ? 64 : 200;

  // The desk dock drawer is portaled to <body>, outside #app-shell; publish the
  // nav width on the root so the bottom sheet aligns with the main column.
  useEffect(() => {
    document.documentElement.style.setProperty("--app-nav-width", `${navWidth}px`);
    return () => {
      document.documentElement.style.removeProperty("--app-nav-width");
    };
  }, [navWidth]);

  const handleNotifOpen = useCallback(() => setNotifOpen(true), []);
  const handleNotifClose = useCallback(() => {
    setNotifOpen(false);
    setNotifRefreshKey((key) => key + 1);
  }, []);

  const drawerContent = (
    <NavbarNested
      activePath={location.pathname}
      collapsed={desktopCollapsed}
      onMobileNavigate={closeMobile}
    />
  );

  return (
    <Box
      sx={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        bgcolor: "background.default",
      }}
      id="app-shell"
      data-testid="app-shell"
    >
      {/* No top app bar: on narrow viewports the rail is a temporary drawer, so
          a floating trigger replaces the header hamburger without a bar. */}
      <IconButton
        aria-label="Toggle navigation"
        onClick={toggleMobile}
        data-testid="app-mobile-nav-toggle"
        sx={{
          display: { xs: "inline-flex", md: "none" },
          position: "fixed",
          top: 8,
          left: 8,
          zIndex: (t) => t.zIndex.drawer - 1,
          width: 36,
          height: 36,
          bgcolor: "background.paper",
          border: 1,
          borderColor: "divider",
          boxShadow: 2,
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <IconMenu2 size={18} />
      </IconButton>

      <NotificationsPanel opened={notifOpen} onClose={handleNotifClose} />

      {!isDesktop ? (
      <MuiDrawer
        variant="temporary"
        open={mobileOpened}
        onClose={closeMobile}
        sx={{
          display: { xs: "block", md: "none" },
          "& .MuiDrawer-paper": { width: 220, boxSizing: "border-box" },
        }}
      >
        <SidebarHeader
          mobile
          surgeTotal={surgeTotal}
          onToggleCollapse={toggleDesktop}
          onOpenNotifications={handleNotifOpen}
        />
        <Divider />
        {drawerContent}
      </MuiDrawer>
      ) : null}

      {isDesktop ? (
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
            transition: theme.transitions.create("width", {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
            // The nav body owns the only scrollbar: the drawer paper is just a
            // fixed-width flex column (header + nav + footer).
            overflow: "hidden",
          },
        }}
        open
      >
        <SidebarHeader
          rail={desktopCollapsed}
          surgeTotal={surgeTotal}
          onToggleCollapse={toggleDesktop}
          onOpenNotifications={handleNotifOpen}
        />
        <Divider />
        {drawerContent}
      </MuiDrawer>
      ) : null}

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: "auto",
          bgcolor: "background.default",
          display: "flex",
          flexDirection: "column",
        }}
        id="app-main"
        data-testid="app-main"
      >
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            width: "100%",
            p: 0,
            m: 0,
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
