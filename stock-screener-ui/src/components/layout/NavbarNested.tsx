import {
  IconChartLine,
  IconChartDots,
  IconBuildingFactory,
  IconChartBar,
  IconRobot,
  IconChartArea,
  IconSettings,
  IconSun,
  IconMoon,
  IconChevronLeft,
  IconNews,
  IconShield,
  IconPlayerPlay,
  IconLayoutGrid,
  IconAdjustments,
  IconFlask,
} from "@tabler/icons-react";
import { Box, Group, ScrollArea, AppShellSection, Stack, ActionIcon, Divider, useColorScheme } from "@/ui";
import { NavbarLinksGroup } from "./NavbarLinksGroup";
import { UserButton } from "./UserButton";
import { useAuth } from "../auth/AuthProvider2";

interface NavbarNestedProps {
  activePath: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onMobileNavigate?: () => void;
}

const navItems = [
  { label: "Screener", icon: IconChartLine, link: "/" },
  { label: "News", icon: IconNews, link: "/news" },
  { label: "Backtest", icon: IconChartLine, link: "/backtest" },
  { label: "Experiments", icon: IconFlask, link: "/experiments" },
  { label: "Paper Trading", icon: IconChartDots, link: "/paper" },
  { label: "Replay", icon: IconPlayerPlay, link: "/replay" },
  { label: "Strategy Runner", icon: IconAdjustments, link: "/strategy-runner" },
  { label: "Sector Analysis", icon: IconBuildingFactory, link: "/sector" },
  { label: "Heatmap", icon: IconLayoutGrid, link: "/heatmap" },
  { label: "Strategies", icon: IconChartBar, link: "/strategies" },
  { label: "Bots", icon: IconRobot, link: "/bots" },
  { label: "Options", icon: IconChartArea, link: "/options" },
  { label: "Settings", icon: IconSettings, link: "/settings" },
  { label: "Admin", icon: IconShield, link: "/admin" },
];

export function NavbarNested({
  activePath,
  collapsed,
  onToggleCollapse,
  onMobileNavigate,
}: NavbarNestedProps) {
  const { colorScheme, toggleColorScheme } = useColorScheme();
  const { user } = useAuth();

  const visibleNavItems = navItems.filter((item) => item.label !== "Admin" || user?.is_admin);

  const links = visibleNavItems.map((item) => (
    <NavbarLinksGroup
      key={item.label}
      icon={item.icon}
      label={item.label}
      link={item.link}
      active={activePath === item.link}
      collapsed={collapsed}
      onNavigate={onMobileNavigate}
      data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
    />
  ));

  return (
    <Box data-testid="sidemenu" id="navbar-nested" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <AppShellSection grow component={ScrollArea} scrollbars="y" type="scroll" offsetScrollbars id="navbar-links" data-testid="navbar-links">
        <Stack gap={4} p="xs">
          {links}
        </Stack>
      </AppShellSection>

      <Divider />

      <AppShellSection p="xs" id="navbar-footer" data-testid="navbar-footer">
        <Group justify="space-between" px="xs">
          <UserButton collapsed={collapsed} />
          <Group gap={4}>
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={toggleColorScheme}
              aria-label="Toggle color scheme"
              data-testid="theme-toggle-btn"
            >
              {colorScheme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
            </ActionIcon>
            {!collapsed && (
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={onToggleCollapse}
                aria-label="Toggle sidebar"
                data-testid="sidebar-collapse-toggle"
              >
                <IconChevronLeft size={16} />
              </ActionIcon>
            )}
          </Group>
        </Group>
      </AppShellSection>
    </Box>
  );
}
