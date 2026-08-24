import { useCallback } from "react";
import { Badge, Box, NavLink, ScrollArea, Stack, Text, Tooltip } from "@/ui";
import type { ScreenerOption } from "../../types";

const RAIL_WIDTH = 152;

function ScreenerNavLabel({ option }: { option: ScreenerOption }) {
  return (
    <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
      <Text component="span" size="xs" truncate>
        {option.label}
      </Text>
      {option.status === "legacy" && (
        <Badge size="xs" color="secondary" variant="light" sx={{ flexShrink: 0 }}>
          L
        </Badge>
      )}
      {option.status === "current" && (
        <Badge size="xs" color="info" variant="light" sx={{ flexShrink: 0 }}>
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

  const renderItem = useCallback((option: ScreenerOption) => {
    const active = option.id === activeScreener;
    const link = (
      <NavLink
        key={option.id}
        label={<ScreenerNavLabel option={option} />}
        active={active}
        onClick={() => onChange(option.id)}
        sx={{ py: 1, px: 1 }}
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
  }, [activeScreener, onChange]);

  if (optionList.length === 0) {
    return (
      <Box
        data-testid="screener-nav"
        id="screener-nav"
        data-options-count={0}
        w={RAIL_WIDTH}
        sx={{ flexShrink: 0 }}
      />
    );
  }

  return (
    <ScrollArea
      type="auto"
      offsetScrollbars
      w={RAIL_WIDTH}
      sx={{
        flexShrink: 0,
      }}
      data-testid="screener-nav"
      id="screener-nav"
      data-options-count={optionList.length}
    >
      <Stack gap="sm" p="sm">
        {current.map(renderItem)}
        {legacy.length > 0 && (
          <>
            <Text size="11px" c="dimmed" tt="uppercase" fw={600} sx={{ px: 1, pt: 0.75, pb: 0.25 }}>
              Legacy
            </Text>
            {legacy.map(renderItem)}
          </>
        )}
      </Stack>
    </ScrollArea>
  );
}