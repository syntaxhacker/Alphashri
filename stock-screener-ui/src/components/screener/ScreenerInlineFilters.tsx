import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import { Text } from "@/ui";
import * as state from "../../state";
import { fetchData } from "../../api";
import * as palette from "@/ui/palette";

export function ScreenerInlineFilters({ activeScreener, embedded = false }: { activeScreener: string; embedded?: boolean }) {
  const profileMeta = (state as any).profileMetaById?.[activeScreener];
  const filters: any[] = profileMeta?.filters || [];
  if (!filters.length) return null;

  const inner = (
    <>
      <Text size="11px" c="dimmed" fw={600} sx={{ color: palette.TEXT_MUTED }}>
        Filters:
      </Text>
      {filters.map((f: any) => (
        <Chip
          key={f.key}
          size="small"
          label={f.label || f.key}
          title={f.label}
          data-testid={`filter-chip-${f.key}`}
          sx={{ fontSize: 11, height: 24, bgcolor: palette.SURFACE_ALT, color: palette.TEXT, border: 1, borderColor: palette.BORDER }}
        />
      ))}
      <Box sx={{ flex: 1 }} />
      <Button
        size="small"
        variant="outlined"
        color="inherit"
        data-testid="apply-filters-btn"
        onClick={() => fetchData("upstox", "intraday", activeScreener, "manual")}
        sx={{ fontSize: 11, height: 24, textTransform: "none" }}
      >
        Apply
      </Button>
    </>
  );

  if (embedded) {
    return (
      <Box
        data-testid="screener-inline-filters"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 1,
          borderBottom: 1,
          borderColor: palette.BORDER,
          bgcolor: palette.SURFACE,
          flexWrap: "wrap",
          flexShrink: 0,
        }}
      >
        {inner}
      </Box>
    );
  }

  return (
    <Paper
      elevation={0}
      data-testid="screener-inline-filters"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1.5,
        py: 1,
        border: 1,
        borderColor: palette.BORDER,
        borderRadius: 2,
        bgcolor: palette.SURFACE,
        flexWrap: "wrap",
        flexShrink: 0,
      }}
    >
      {inner}
    </Paper>
  );
}
