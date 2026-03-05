import { useLocation } from "react-router-dom";
import { Box } from "@mantine/core";
import { NavbarNested } from "./NavbarNested";
import { MarketTicker } from "./MarketTicker";
import { useThemeColors } from "../../hooks/useThemeColors";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const colors = useThemeColors();

  return (
    <Box
      bg={colors.background}
      c={colors.text}
      style={{ display: "flex", minHeight: "100vh", flexDirection: "column" }}
    >
      <MarketTicker />
      <Box style={{ display: "flex", flex: 1 }}>
        <NavbarNested activePath={location.pathname} />
        <Box component="main" style={{ flex: 1, padding: colors.spacing("md") }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
