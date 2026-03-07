import { useState } from "react";
import { useLocation } from "react-router-dom";
import { AppShell } from "@mantine/core";
import { NavbarNested } from "./NavbarNested";
import { MarketTicker } from "./MarketTicker";
import { useThemeColors } from "../../hooks/useThemeColors";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const colors = useThemeColors();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <AppShell
      header={{ height: 40 }}
      navbar={{
        width: collapsed ? 80 : 300,
        breakpoint: "sm",
      }}
      padding="md"
      h="100vh"
    >
      <AppShell.Header bg={colors.background} c={colors.text}>
        <MarketTicker />
      </AppShell.Header>

      <AppShell.Navbar>
        <NavbarNested
          activePath={location.pathname}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(!collapsed)}
        />
      </AppShell.Navbar>

      <AppShell.Main bg={colors.background} c={colors.text} h="100%" style={{ overflow: "hidden" }}>
        {children}
      </AppShell.Main>
    </AppShell>
  );
}
