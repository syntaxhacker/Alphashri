// ReplayIndexPage — strategy switcher for /poc/replay. Lists every registered
// replay plugin (label, id, mode, param count) as a clickable card that opens
// the generic /poc/replay/{strategyId} shell. No strategy vocabulary lives here.
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import * as palette from "@/ui/palette";
import { listStrategies } from "@/components/replay/strategies";

export default function ReplayIndexPage() {
  const navigate = useNavigate();
  const strategies = listStrategies();

  return (
    <Box sx={{ p: 2, width: "100%" }} data-testid="replay-index">
      <Typography variant="h6" sx={{ color: palette.TEXT, mb: 0.5 }}>
        Replay strategies
      </Typography>
      <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, display: "block", mb: 2 }}>
        {strategies.length} registered · select one to open its replay
      </Typography>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", alignItems: "stretch" }}>
        {strategies.map((plugin) => (
          <Card
            key={plugin.id}
            elevation={0}
            sx={{ width: 240, bgcolor: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}
          >
            <CardActionArea
              onClick={() => navigate(`/poc/replay/${plugin.id}`)}
              sx={{ p: 1.5, height: "100%", alignItems: "stretch" }}
            >
              <Typography variant="subtitle2" sx={{ color: palette.TEXT }}>
                {plugin.label}
              </Typography>
              <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, display: "block", mb: 1 }}>
                {plugin.id}
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                <Chip
                  size="small"
                  label={plugin.mode}
                  sx={{
                    bgcolor: palette.SURFACE_ALT,
                    color: plugin.mode === "timeline" ? palette.PRIMARY : palette.POSITIVE,
                  }}
                />
                <Chip
                  size="small"
                  label={`${plugin.params.length} params`}
                  sx={{ bgcolor: palette.SURFACE_ALT, color: palette.TEXT_MUTED }}
                />
              </Stack>
            </CardActionArea>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}
