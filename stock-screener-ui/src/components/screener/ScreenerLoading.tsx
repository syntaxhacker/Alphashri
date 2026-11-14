import { Show } from "solid-js";
import { Box, Loader, Text } from "@/ui";
import type { ScreenerLoadingProps } from "./types";

export function ScreenerLoading(props: ScreenerLoadingProps) {
  return (
    <Box
      data-testid="screener-loading"
      id="screener-loading"
      className="flex flex-col items-center justify-center gap-1 py-6 px-3"
    >
      <Loader size="sm" data-testid="screener-loader" />
      <Text fw={600} size="sm">
        Loading screener
      </Text>
      <Show when={props.message}>
        <Text size="xs" c="dimmed" ta="center">
          {props.message}
        </Text>
      </Show>
    </Box>
  );
}
