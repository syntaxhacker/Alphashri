import { useLocation } from "react-router-dom";
import { AppShell, Group, Box } from "@mantine/core";
import { useState } from "react";
import { NavbarNested } from "./NavbarNested";
import { MarketTicker } from "./MarketTicker";
import { useThemeColors } from "../../hooks/useThemeColors";
import NewsPanel from "../news/NewsPanel";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const colors = useThemeColors();
  const [collapsed, setCollapsed] = useState(false);

  const toggleCollapsed = () => setCollapsed((prev) => !prev);

  return (
    <AppShell
      header={{ height: 52 }}
      navbar={{
        width: collapsed ? 60 : 180,
        breakpoint: "sm",
      }}
      padding="sm"
      h="100vh"
      id="app-shell"
      data-testid="app-shell"
    >
      <AppShell.Header
        bg="light-dark(rgba(255, 255, 255, 0.86), rgba(11, 15, 20, 0.88))"
        c={colors.text}
        id="app-header"
        data-testid="app-header"
        style={{
          borderBottom: "1px solid light-dark(rgba(15, 23, 42, 0.08), rgba(148, 163, 184, 0.14))",
          backdropFilter: "blur(18px)",
        }}
      >
        <Group justify="space-between" align="center" h="100%" px="xs">
          <Box flex={1}>
            <MarketTicker />
          </Box>
          <NewsPanel />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar id="app-navbar" data-testid="app-navbar">
        <NavbarNested
          activePath={location.pathname}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
        />
      </AppShell.Navbar>

      <AppShell.Main
        bg="transparent"
        c={colors.text}
        h="100%"
        style={{ overflow: "hidden" }}
        id="app-main"
        data-testid="app-main"
      >
        <Box className="app-page-frame" h="100%">
          <Box className="app-page-content" flex={1} h="100%">
            {children}
          </Box>
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
