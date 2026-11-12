// ReplayIndexPage — strategy switcher for /poc/replay. Lists every registered
// replay plugin (label, id, mode, param count) as a clickable card that opens
// the generic /poc/replay/{strategyId} shell. No strategy vocabulary lives here.
import { useNavigate } from "react-router-dom";
import { Box, Text, Stack, Chip, Card } from "@/ui";
import * as palette from "@/ui/palette";
import { listStrategies } from "@/components/replay/strategies";

export default function ReplayIndexPage() {
  const navigate = useNavigate();
  const strategies = listStrategies();

  return (
    <Box className="p-4 w-full" data-testid="replay-index">
      <Text size="lg" fw={700} style={{ color: palette.TEXT, "margin-bottom": 4 }}>
        Replay strategies
      </Text>
      <Text size="xs" style={{ color: palette.TEXT_MUTED, display: "block", "margin-bottom": 16 }}>
        {strategies.length} registered · select one to open its replay
      </Text>
      <Stack direction="row" spacing={1} className="flex-wrap items-stretch">
        {strategies.map((plugin) => (
          <Card
            key={plugin.id}
            className="w-[240px]"
            style={{
              "background-color": palette.SURFACE,
              border: `1px solid ${palette.BORDER}`,
            }}
          >
            <Box
              className="p-3 h-full flex items-stretch"
              style={{ cursor: "pointer" }}
              onClick={() => navigate(`/poc/replay/${plugin.id}`)}
            >
              <Text size="sm" fw={600} style={{ color: palette.TEXT }}>
                {plugin.label}
              </Text>
              <Text size="xs" style={{ color: palette.TEXT_MUTED, display: "block", "margin-bottom": 8 }}>
                {plugin.id}
              </Text>
              <Stack direction="row" spacing={1} className="flex-wrap">
                <Chip
                  size="sm"
                  label={plugin.mode}
                  style={{
                    "background-color": palette.SURFACE_ALT,
                    color: plugin.mode === "timeline" ? palette.PRIMARY : palette.POSITIVE,
                  }}
                />
                <Chip
                  size="sm"
                  label={`${plugin.params.length} params`}
                  style={{ "background-color": palette.SURFACE_ALT, color: palette.TEXT_MUTED }}
                />
              </Stack>
            </Box>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}
