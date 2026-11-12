import { Show } from "solid-js";
import { Box, Paper, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { formatCr, verdictMeta, type PositioningData } from "@/utils/positioning";

interface VerdictBannerProps {
  data: PositioningData;
}

export function VerdictBanner(props: VerdictBannerProps) {
  const meta = () => verdictMeta(props.data.verdict);
  return (
    <Paper
      data-testid="positioning-verdict"
      p="sm"
      radius="sm"
      style={{ border: `1px solid ${palette.BORDER}`, "background-color": meta().tintToken }}
    >
      <Box className="flex flex-col" gap={1}>
        <Text size="lg" fw={700} c={meta().colorToken} data-testid="positioning-verdict-word">
          {meta().icon} {meta().label}
        </Text>
        <Text size="sm" data-testid="positioning-verdict-initiated">
          Today since open {formatCr(props.data.initiated_cr)}
        </Text>
        <Text size="sm" data-testid="positioning-verdict-lean">
          {props.data.lean_pct.toFixed(1)}% of today&apos;s initiated delta since the open leans {props.data.verdict}
        </Text>
        <Show when={props.data.biggest_move}>
          {(biggest) => (
            <Text size="sm" data-testid="positioning-verdict-biggest">
              Biggest move: {biggest().label} · {formatCr(biggest().cr)}
            </Text>
          )}
        </Show>
        <Text size="xs" c="dimmed">
          A read of OI and premium changes, not advice.
        </Text>
      </Box>
    </Paper>
  );
}
