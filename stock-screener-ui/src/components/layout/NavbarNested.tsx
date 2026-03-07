import {
  IconRocket,
  IconChartLine,
  IconChartDots,
  IconBuildingFactory,
  IconChartBar,
  IconRobot,
  IconSun,
  IconMoon,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";
import { Group, ScrollArea, Text, UnstyledButton, AppShell, Flex } from "@mantine/core";
import { useMantineColorScheme } from "@mantine/core";
import { NavbarLinksGroup } from "./NavbarLinksGroup";
import { UserButton } from "./UserButton";
import classes from "./NavbarNested.module.css";

interface NavbarNestedProps {
  activePath: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const navItems = [
  { label: "Screener", icon: IconRocket, link: "/" },
  { label: "Backtest", icon: IconChartLine, link: "/backtest" },
  { label: "Paper Trading", icon: IconChartDots, link: "/paper" },
  { label: "Sector Analysis", icon: IconBuildingFactory, link: "/sector" },
  { label: "Strategies", icon: IconChartBar, link: "/strategies" },
  { label: "Bots", icon: IconRobot, link: "/bots" },
];

export function NavbarNested({ activePath, collapsed, onToggleCollapse }: NavbarNestedProps) {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();

  const links = navItems.map((item) => (
    <NavbarLinksGroup
      key={item.label}
      icon={item.icon}
      label={item.label}
      link={item.link}
      active={activePath === item.link}
      collapsed={collapsed}
    />
  ));

  return (
    <nav className={classes.navbar} data-testid="sidemenu">
      <AppShell.Section className={classes.header}>
        <Flex justify={collapsed ? "center" : "space-between"} align="center" direction={collapsed ? "column" : "row"} gap={collapsed ? "xs" : 0}>
          {!collapsed ? (
            <Text fw={700} size="lg">
              🚀 Alphashri
            </Text>
          ) : (
            <Text fw={700} size="lg">
              🚀
            </Text>
          )}
          <Group gap="xs">
            {!collapsed && (
              <UnstyledButton onClick={toggleColorScheme}>
                {colorScheme === "dark" ? <IconSun size={20} /> : <IconMoon size={20} />}
              </UnstyledButton>
            )}
            <UnstyledButton onClick={onToggleCollapse}>
              {collapsed ? <IconChevronRight size={20} /> : <IconChevronLeft size={20} />}
            </UnstyledButton>
          </Group>
        </Flex>
      </AppShell.Section>

      <AppShell.Section grow component={ScrollArea} className={classes.links}>
        <div className={classes.linksInner}>{links}</div>
      </AppShell.Section>

      <AppShell.Section className={classes.footer}>
        <UserButton collapsed={collapsed} />
      </AppShell.Section>
    </nav>
  );
}
