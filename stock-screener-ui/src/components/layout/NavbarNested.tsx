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
} from "@tabler/icons-react";
import { Box, Group, ScrollArea, AppShell, Stack, ActionIcon } from "@mantine/core";
import { useMantineColorScheme } from "@mantine/core";
import { NavbarLinksGroup } from "./NavbarLinksGroup";
import { UserButton } from "./UserButton";
import { useAuth } from "../auth/AuthProvider2";
import classes from "./NavbarNested.module.css";

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
  { label: "Paper Trading", icon: IconChartDots, link: "/paper" },
  { label: "Sector Analysis", icon: IconBuildingFactory, link: "/sector" },
  { label: "Strategies", icon: IconChartBar, link: "/strategies" },
  { label: "Bots", icon: IconRobot, link: "/bots" },
  { label: "Options", icon: IconChartArea, link: "/options" },
  { label: "Settings", icon: IconSettings, link: "/settings" },
  { label: "Admin", icon: IconShield, link: "/admin" },
];

export function NavbarNested({ activePath, collapsed, onToggleCollapse, onMobileNavigate }: NavbarNestedProps) {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
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
    <nav className={classes.navbar} data-testid="sidemenu" id="navbar-nested">
      <AppShell.Section
        grow
        component={ScrollArea}
        className={classes.links}
        id="navbar-links"
        data-testid="navbar-links"
      >
        <Box className={classes.linksInner}>{links}</Box>
      </AppShell.Section>

      <AppShell.Section className={classes.footer} id="navbar-footer" data-testid="navbar-footer">
        <Stack gap="xs">
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
        </Stack>
      </AppShell.Section>
    </nav>
  );
}
