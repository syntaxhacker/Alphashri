import * as palette from "@/ui/palette";
// ReplayStrategyPage — resolves :strategyId and renders the generic ReplayShell.
// Falls back to a default strategy when mounted from the legacy /poc/tick-replay route.
import { createMemo, Show } from "solid-js";
import { Box, Text } from "@/ui";
import { useParams } from "@solidjs/router";
import ReplayShell from "@/components/replay/core/ReplayShell";
import { getStrategy } from "@/components/replay/strategies";
import StrategySwitcher from "@/components/replay/strategies/StrategySwitcher";

export default function ReplayStrategyPage(props: { defaultStrategyId?: string }) {
  const params = useParams();
  const plugin = createMemo(() => getStrategy(params.strategyId ?? props.defaultStrategyId ?? ""));

  return (
    <Show
      when={plugin()}
      fallback={
        <Box className="p-4" data-testid="replay-strategy-missing">
          <Text size="lg" fw={700} style={{ color: palette.NEGATIVE_COLOR }}>
            Unknown replay strategy
          </Text>
          <Text size="xs" style={{ color: palette.TEXT_MUTED_COLOR }}>
            No plugin registered for “{params.strategyId ?? props.defaultStrategyId ?? ""}”.
          </Text>
        </Box>
      }
    >
      {(p) => <ReplayShell plugin={p()} headerExtra={<StrategySwitcher currentId={p().id} />} />}
    </Show>
  );
}
