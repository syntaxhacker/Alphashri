import { useCallback } from "react";
import { Box, Badge, Paper, Stack, Text, Tooltip } from "@/ui";
import type { ScreenerOption } from "../../types";
import { cn } from "@/ui/cn";

function ScreenerNavLabel({ option }: { option: ScreenerOption }) {
  return (
    <span className="flex items-center gap-2 min-w-0">
      <Text component="span" size="xs" truncate>
        {option.label}
      </Text>
      {option.status === "legacy" && (
        <Badge size="xs" color="secondary" variant="light" className="flex-shrink-0">
          L
        </Badge>
      )}
      {option.status === "current" && (
        <Badge size="xs" color="info" variant="light" className="flex-shrink-0">
          N
        </Badge>
      )}
    </span>
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
        <button
          key={option.id}
          type="button"
          role="option"
          aria-selected={active ? true : undefined}
          aria-current={active ? "page" : undefined}
          data-active={active ? "true" : undefined}
          data-testid={`screener-nav-option-${option.id}`}
          className={cn(
            "flex items-center gap-2 rounded-sm px-2 py-2 w-full text-left",
            active ? "bg-fin-surface-alt" : "",
          )}
          onClick={() => onChange(option.id)}
          aria-label={option.description}
        >
          <ScreenerNavLabel option={option} />
        </button>
      );
      if (option.description) {
        return (
          <Tooltip key={option.id} label={option.description} position="right">
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
        className="w-[152px] flex-shrink-0"
      />
    );
  }

  return (
    <Paper
      data-testid="screener-nav"
      id="screener-nav"
      data-options-count={optionList.length}
      w={152}
      className="flex-shrink-0 flex flex-col overflow-hidden border border-fin-border"
    >
      <Box flex={1} p={1} className="overflow-auto">
        <ul className="flex flex-col gap-2 p-0 w-full">
          {current.map(renderItem)}
          {legacy.length > 0 && (
            <Stack gap={1} className="w-full pt-2">
              <Text size="11px" c="dimmed" tt="uppercase" fw={600} className="px-2 pt-1 pb-1">
                Legacy
              </Text>
              <ul className="flex flex-col gap-2 p-0">{legacy.map(renderItem)}</ul>
            </Stack>
          )}
        </ul>
      </Box>
    </Paper>
  );
}
