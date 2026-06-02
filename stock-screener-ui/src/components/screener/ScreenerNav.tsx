import { Badge, Box, NavLink, ScrollArea, Stack, Text, Tooltip } from "@mantine/core";
import type { ScreenerOption } from "../../types";

const RAIL_WIDTH = 152;

function ScreenerNavLabel({ option }: { option: ScreenerOption }) {
  return (
    <Box component="span" style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
      <Text component="span" size="xs" truncate>
        {option.label}
      </Text>
      {option.status === "legacy" && (
        <Badge size="xs" color="gray" variant="light" style={{ flexShrink: 0 }}>
          L
        </Badge>
      )}
      {option.status === "current" && (
        <Badge size="xs" color="teal" variant="light" style={{ flexShrink: 0 }}>
          N
        </Badge>
      )}
    </Box>
  );
}

interface ScreenerNavProps {
  options: ScreenerOption[];
  activeScreener: string;
  onChange: (id: string) => void;
}

export function ScreenerNav({ options, activeScreener, onChange }: ScreenerNavProps) {
  const optionList = options ?? [];
  const current = optionList.filter((o) => o.status !== "legacy");
  const legacy = optionList.filter((o) => o.status === "legacy");

  if (optionList.length === 0) {
    return (
      <Box
        data-testid="screener-nav"
        id="screener-nav"
        className="screener-nav screener-profile-rail"
        data-options-count={0}
        w={RAIL_WIDTH}
        style={{ flexShrink: 0, borderRight: "1px solid var(--mantine-color-default-border)" }}
      />
    );
  }

  const renderItem = (option: ScreenerOption) => {
    const active = option.id === activeScreener;
    const link = (
      <NavLink
        key={option.id}
        label={<ScreenerNavLabel option={option} />}
        active={active}
        onClick={() => onChange(option.id)}
        py={4}
        px={8}
        data-testid={`screener-nav-option-${option.id}`}
        data-active={active ? "true" : undefined}
        aria-current={active ? "page" : undefined}
      />
    );
    if (option.description) {
      return (
        <Tooltip key={option.id} label={option.description} withArrow position="right">
          {link}
        </Tooltip>
      );
    }
    return link;
  };

  return (
    <ScrollArea
      type="auto"
      offsetScrollbars
      w={RAIL_WIDTH}
      style={{
        flexShrink: 0,
        borderRight: "1px solid var(--mantine-color-default-border)",
        backgroundColor: "var(--mantine-color-body)",
      }}
      data-testid="screener-nav"
      id="screener-nav"
      className="screener-nav screener-profile-rail"
      data-options-count={optionList.length}
    >
      <Stack gap={2} p={6} pb={8}>
        {current.map(renderItem)}
        {legacy.length > 0 && (
          <>
            <Text size="10px" c="dimmed" tt="uppercase" fw={600} px={8} pt={6} pb={2}>
              Legacy
            </Text>
            {legacy.map(renderItem)}
          </>
        )}
      </Stack>
    </ScrollArea>
  );
}