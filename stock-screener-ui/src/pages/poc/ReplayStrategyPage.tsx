// ReplayStrategyPage — resolves :strategyId and renders the generic ReplayShell.
// Falls back to a default strategy when mounted from the legacy /poc/tick-replay route.
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useParams } from "react-router-dom";
import ReplayShell from "@/components/replay/core/ReplayShell";
import { getStrategy } from "@/components/replay/strategies";

export default function ReplayStrategyPage({ defaultStrategyId }: { defaultStrategyId?: string }) {
  const { strategyId } = useParams();
  const plugin = getStrategy(strategyId ?? defaultStrategyId ?? "");

  if (!plugin) {
    return (
      <Box sx={{ p: 2 }} data-testid="replay-strategy-missing">
        <Typography variant="h6" sx={{ color: "#F87171" }}>Unknown replay strategy</Typography>
        <Typography variant="caption" sx={{ color: "#9CA3AF" }}>
          No plugin registered for “{strategyId ?? defaultStrategyId ?? ""}”.
        </Typography>
      </Box>
    );
  }

  return <ReplayShell key={plugin.id} plugin={plugin} />;
}
