import { Box, Paper, Text } from "@/ui";
import { formatCr, verdictMeta, type PositioningData } from "@/utils/positioning";

interface VerdictBannerProps {
  data: PositioningData;
}

export function VerdictBanner({ data }: VerdictBannerProps) {
  const meta = verdictMeta(data.verdict);
  return (
    <Paper
      data-testid="positioning-verdict"
      p="sm"
      radius="sm"
      sx={{ border: 1, borderColor: "divider", bgcolor: meta.tintToken }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Text size="lg" fw={700} c={meta.colorToken} data-testid="positioning-verdict-word">
          {meta.icon} {meta.label}
        </Text>
        <Text size="sm" data-testid="positioning-verdict-initiated">
          Today since open {formatCr(data.initiated_cr)}
        </Text>
        <Text size="sm" data-testid="positioning-verdict-lean">
          {data.lean_pct.toFixed(1)}% of today&apos;s initiated delta since the open leans {data.verdict}
        </Text>
        {data.biggest_move && (
          <Text size="sm" data-testid="positioning-verdict-biggest">
            Biggest move: {data.biggest_move.label} · {formatCr(data.biggest_move.cr)}
          </Text>
        )}
        <Text size="xs" c="dimmed">
          A read of OI and premium changes, not advice.
        </Text>
      </Box>
    </Paper>
  );
}
