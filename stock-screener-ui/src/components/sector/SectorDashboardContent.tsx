import { Box, Stack } from "@/ui";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Badge from "@mui/material/Badge";
import { IconBellRinging, IconTrendingUp, IconClock } from "@tabler/icons-react";
import { SectorTable } from "./SectorTable";
import type { SectorResponse } from "../../types/sector";
import { formatPercentage } from "../../utils/ui-helpers";
import { SectorTreemap } from "./SectorHelpers";
import { SectorAlertsList } from "./SectorAlertsList";
import { IntervalMoversTable } from "./IntervalMoversTable";
import type { SectorAlert, InternalStockMover } from "./sectorUtils";

function AlertsAndMovers({
  alerts,
  intervalMovers,
}: {
  alerts: SectorAlert[];
  intervalMovers: InternalStockMover[];
}) {
  return (
    <Stack spacing={1} sx={{ overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
      <Card elevation={1} sx={{ flex: "1 1 50%", display: "flex", flexDirection: "column", p: 1, width: "100%" }} data-testid="sector-alerts-card" id="sector-alerts-card">
        <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, width: "100%", "&:last-child": { pb: 1 } }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
            <Typography variant="h6" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Real-time Alerts</Typography>
            <IconBellRinging size={18} color="var(--mui-palette-warning-main)" />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1, width: "100%", flex: 1, minHeight: 0, overflow: "auto" }}>
            <SectorAlertsList alerts={alerts} />
          </Box>
        </CardContent>
      </Card>

      <Card elevation={1} sx={{ flex: "1 1 50%", display: "flex", flexDirection: "column", p: 1, width: "100%" }} data-testid="sector-interval-movers-card" id="sector-interval-movers-card">
        <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, width: "100%", "&:last-child": { pb: 1 } }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
            <Typography variant="h6" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Interval Movers</Typography>
            <IconTrendingUp size={18} color="var(--mui-palette-primary-main)" />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1, width: "100%", flex: 1, minHeight: 0, overflow: "auto" }}>
            <IntervalMoversTable movers={intervalMovers} />
          </Box>
        </CardContent>
      </Card>
    </Stack>
  );
}

export function DashboardContent({
  data,
  alerts,
  intervalMovers,
}: {
  data: SectorResponse;
  alerts: SectorAlert[];
  intervalMovers: InternalStockMover[];
}) {
  const bottomSector = data.sectors[data.sectors.length - 1];
  const totalAdvances = data.sectors.reduce((acc, s) => acc + s.advances, 0);
  const totalDeclines = data.sectors.reduce((acc, s) => acc + s.declines, 0);

  return (
    <Stack spacing={1} sx={{ p: 1, alignItems: "center", justifyContent: "center" }}>
      <Grid container spacing={1} sx={{ justifyContent: "center", alignItems: "center" }}>
        <Grid size={{ xs: 12, md: 4 }} sx={{ display: "flex", justifyContent: "center" }}>
          <Card elevation={1} sx={{ width: "100%", p: 1 }}>
            <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, gap: 1, "&:last-child": { pb: 1 } }}>
              <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Top Sector</Typography>
              <Typography variant="h6" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{data.sectors[0].sector}</Typography>
              <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{`Avg Change: ${formatPercentage(data.sectors[0].avg_change)}`}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }} sx={{ display: "flex", justifyContent: "center" }}>
          <Card elevation={1} sx={{ width: "100%", p: 1 }}>
            <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, gap: 1, "&:last-child": { pb: 1 } }}>
              <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Market Breadth</Typography>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, bgcolor: "success.light", borderRadius: 1 }}> {totalAdvances} UP</Box>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, bgcolor: "error.light", borderRadius: 1 }}>{totalDeclines} DOWN</Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }} sx={{ display: "flex", justifyContent: "center" }}>
          <Card elevation={1} sx={{ width: "100%", p: 1 }}>
            <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, gap: 1, "&:last-child": { pb: 1 } }}>
              <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Weakest Sector</Typography>
              <Typography variant="h6" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{bottomSector.sector}</Typography>
              <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{`Avg Change: ${formatPercentage(bottomSector.avg_change)}`}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={1} sx={{ justifyContent: "center", alignItems: "stretch", width: "100%" }}>
        <Grid size={{ xs: 12, md: 6 }} sx={{ display: "flex", justifyContent: "center" }}>
          <Card elevation={1} sx={{ width: "100%", p: 1, display: "flex", flexDirection: "column", alignItems: "center" }} data-testid="sector-treemap-container" id="sector-treemap-container">
            <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, width: "100%", "&:last-child": { pb: 1 } }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
                <Typography variant="h6" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Live Sector Map</Typography>
                {data.last_updated && (
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
                    <IconClock size={12} color="var(--mui-palette-text-secondary)" />
                    <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{new Date(data.last_updated).toLocaleTimeString()}</Typography>
                  </Box>
                )}
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1, width: "100%" }}>
                <SectorTreemap sectors={data.sectors} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }} sx={{ display: "flex", justifyContent: "center" }}>
          <Card elevation={1} sx={{ width: "100%", p: 1, display: "flex", flexDirection: "column", alignItems: "center" }} data-testid="sector-table-container" id="sector-table-container">
            <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, width: "100%", "&:last-child": { pb: 1 } }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
                <Typography variant="h6" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Sector Performance</Typography>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1, width: "100%" }}>
                <SectorTable sectors={data.sectors} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12 }} sx={{ display: "flex", justifyContent: "center" }}>
          <Box sx={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
            <AlertsAndMovers alerts={alerts} intervalMovers={intervalMovers} />
          </Box>
        </Grid>
      </Grid>
    </Stack>
  );
}
