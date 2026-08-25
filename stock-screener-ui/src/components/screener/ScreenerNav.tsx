import { useCallback } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import { Badge, Text, Tooltip } from "@/ui";
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

  const renderItem = useCallback(
    (option: ScreenerOption) => {
      const active = option.id === activeScreener;
      const button = (
        <ListItemButton
          key={option.id}
          selected={active}
          onClick={() => onChange(option.id)}
          sx={{ borderRadius: 1, py: 1, px: 1 }}
          data-testid={`screener-nav-option-${option.id}`}
          data-active={active ? "true" : undefined}
          aria-current={active ? "page" : undefined}
        >
          <ScreenerNavLabel option={option} />
        </ListItemButton>
      );
      if (option.description) {
        return (
          <Tooltip key={option.id} label={option.description} withArrow position="right">
            {button}
          </Tooltip>
        );
      }
      return button;
    },
    [activeScreener, onChange],
  );

  if (optionList.length === 0) {
    return (
      <Box
        data-testid="screener-nav"
        id="screener-nav"
        data-options-count={0}
        sx={{ width: RAIL_WIDTH, flexShrink: 0 }}
      />
    );
  }

  return (
    <Paper
      elevation={1}
      sx={{ width: RAIL_WIDTH, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
      data-testid="screener-nav"
      id="screener-nav"
      data-options-count={optionList.length}
    >
      <Box sx={{ flex: 1, overflow: "auto", p: 1 }}>
        <List sx={{ display: "flex", flexDirection: "column", gap: 1, p: 0, width: "100%" }}>
          {current.map(renderItem)}
          {legacy.length > 0 && (
            <Stack spacing={1} sx={{ width: "100%", gap: 1, pt: 1 }}>
              <Text size="11px" c="dimmed" tt="uppercase" fw={600} sx={{ px: 1, pt: 0.75, pb: 0.25 }}>
                Legacy
              </Text>
              <List sx={{ display: "flex", flexDirection: "column", gap: 1, p: 0 }}>{legacy.map(renderItem)}</List>
            </Stack>
          )}
        </List>
      </Box>
    </Paper>
  );
}
