// ReplayStrategyPage — resolves :strategyId and renders the generic ReplayShell.
// Falls back to a default strategy when mounted from the legacy /poc/tick-replay route.
import { Box, Text } from "@/ui";
import { useParams } from "react-router-dom";
import ReplayShell from "@/components/replay/core/ReplayShell";
import { getStrategy } from "@/components/replay/strategies";
import StrategySwitcher from "@/components/replay/strategies/StrategySwitcher";

export default function ReplayStrategyPage({ defaultStrategyId }: { defaultStrategyId?: string }) {
  const { strategyId } = useParams();
  const plugin = getStrategy(strategyId ?? defaultStrategyId ?? "");

  if (!plugin) {
    return (
      <Box className="p-4" data-testid="replay-strategy-missing">
        <Text size="lg" fw={700} style={{ color: "#F87171" }}>
          Unknown replay strategy
        </Text>
        <Text size="xs" style={{ color: "#9CA3AF" }}>
          No plugin registered for “{strategyId ?? defaultStrategyId ?? ""}”.
        </Text>
      </Box>
    );
  }

  return <ReplayShell key={plugin.id} plugin={plugin} headerExtra={<StrategySwitcher currentId={plugin.id} />} />;
}
