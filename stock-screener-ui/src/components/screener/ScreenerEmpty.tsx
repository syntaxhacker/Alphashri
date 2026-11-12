import { Box, Text } from "@/ui";
import { IconDatabaseOff } from "./icons";
import type { ScreenerEmptyProps } from "./types";

export function ScreenerEmpty(props: ScreenerEmptyProps) {
  const message = () => props.message ?? "No results found";
  return (
    <Box
      data-testid="screener-empty"
      id="screener-empty"
      className="flex flex-col items-center justify-center gap-1 py-6 px-3"
    >
      <IconDatabaseOff size={18} stroke={1.7} />
      <Text fw={600} size="sm">
        No results found
      </Text>
      <Text size="xs" c="dimmed" ta="center">
        {message()}
      </Text>
    </Box>
  );
}
