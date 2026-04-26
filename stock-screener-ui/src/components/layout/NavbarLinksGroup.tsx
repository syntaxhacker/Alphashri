import { Box, Flex, Group, ThemeIcon, UnstyledButton, Text, Tooltip } from "@mantine/core";
import { useNavigate } from "react-router-dom";
import classes from "./NavbarLinksGroup.module.css";

interface NavbarLinksGroupProps {
  icon: React.FC<any>;
  label: string;
  link: string;
  active: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}

export function NavbarLinksGroup({
  icon: Icon,
  label,
  link,
  active,
  collapsed,
  onNavigate,
}: NavbarLinksGroupProps) {
  const navigate = useNavigate();

  const content = (
    <UnstyledButton
      onClick={() => {
        navigate(link);
        onNavigate?.();
      }}
      className={classes.control}
      data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-").replace("paper-trading", "paper").replace("sector-analysis", "sector")}`}
      data-active={active || undefined}
      id={`nav-link-${label.toLowerCase().replace(/\s+/g, "-")}`}
      style={{
        backgroundColor: active ? "var(--mantine-color-blue-light)" : undefined,
        color: active ? "var(--mantine-color-blue-filled)" : undefined,
        justifyContent: collapsed ? "center" : "flex-start",
        padding: collapsed
          ? "var(--mantine-spacing-xs)"
          : "var(--mantine-spacing-xs) var(--mantine-spacing-sm)",
      }}
    >
      <Group justify={collapsed ? "center" : "space-between"} gap={4}>
        <Flex align="center">
          <ThemeIcon variant="light" size={26}>
            <Icon size={16} />
          </ThemeIcon>
          {!collapsed && (
            <Box ml="md">
              <Text fw={active ? 600 : 500}>{label}</Text>
            </Box>
          )}
        </Flex>
      </Group>
    </UnstyledButton>
  );

  if (collapsed) {
    return (
      <Tooltip label={label} position="right" transitionProps={{ duration: 0 }}>
        {content}
      </Tooltip>
    );
  }

  return content;
}
