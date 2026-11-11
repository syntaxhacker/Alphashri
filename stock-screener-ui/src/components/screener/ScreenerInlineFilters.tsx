import { Box, Badge, Button, Paper, Text } from "@/ui";
import * as state from "../../state";
import { fetchData } from "../../api";
import * as palette from "@/ui/palette";

export function ScreenerInlineFilters({ activeScreener, embedded = false }: { activeScreener: string; embedded?: boolean }) {
  const profileMeta = (state as any).profileMetaById?.[activeScreener];
  const filters: any[] = profileMeta?.filters || [];
  if (!filters.length) return null;

  const inner = (
    <>
      <Text size="11px" c="dimmed" fw={600}>
        Filters:
      </Text>
      {filters.map((f: any) => (
        <Badge
          key={f.key}
          size="xs"
          variant="light"
          color="secondary"
          title={f.label}
          data-testid={`filter-chip-${f.key}`}
          style={{
            fontSize: 11,
            height: 24,
            backgroundColor: palette.SURFACE_ALT,
            color: palette.TEXT,
            border: `1px solid ${palette.BORDER}`,
            borderRadius: 0,
          }}
        >
          {f.label || f.key}
        </Badge>
      ))}
      <Box className="flex-1" />
      <Button
        size="xs"
        variant="outline"
        color="inherit"
        data-testid="apply-filters-btn"
        onClick={() => fetchData("upstox", "intraday", activeScreener, "manual")}
        style={{ fontSize: 11, height: 24, textTransform: "none" }}
      >
        Apply
      </Button>
    </>
  );

  const rowClass = "flex items-center gap-2 px-3 py-2 flex-wrap flex-shrink-0 bg-fin-surface";

  if (embedded) {
    return (
      <Box data-testid="screener-inline-filters" className={`${rowClass} border-b border-fin-border`}>
        {inner}
      </Box>
    );
  }

  return (
    <Paper
      elevation={0}
      data-testid="screener-inline-filters"
      className={`${rowClass} border border-fin-border rounded-fin`}
    >
      {inner}
    </Paper>
  );
}
