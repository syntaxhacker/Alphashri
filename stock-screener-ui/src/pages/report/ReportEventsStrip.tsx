import { Alert, Badge, Box, Paper, Skeleton, Text } from "@/ui";
import type { ReportEventKind, ReportEventsResponse } from "../../types/report";
import { symbolRowCursor, symbolRowProps } from "../../components/common/symbolRowProps";

interface ReportEventsStripProps {
  data: ReportEventsResponse | null;
  loading: boolean;
  error: string | null;
  onOpenSymbol?: (symbol: string) => void;
}

const KIND_LABEL: Record<ReportEventKind, string> = {
  results: "Results",
  dividend: "Dividend",
  split: "Split",
};

const KIND_COLOR: Record<ReportEventKind, "info" | "success" | "warning"> = {
  results: "info",
  dividend: "success",
  split: "warning",
};

export function ReportEventsStrip({ data, loading, error, onOpenSymbol }: ReportEventsStripProps) {
  if (loading) {
    return (
      <Box className="flex flex-col gap-2" data-testid="report-events-loading">
        <Skeleton h={16} />
        <Skeleton h={16} />
      </Box>
    );
  }
  if (error) {
    return (
      <Box data-testid="report-events-error">
        <Alert color="error" data-testid="report-events-error-alert">
          {error}
        </Alert>
      </Box>
    );
  }
  const events = data?.events ?? [];
  if (events.length === 0) return null;
  return (
    <Paper
      data-testid="report-events-strip"
      className="min-w-0 border border-fin-border rounded-[2px] bg-fin-surface"
    >
      <Box className="flex items-center gap-2 px-2 pt-2">
        <Text size="xs" fw={600} truncate span className="flex-1 min-w-0" data-testid="report-events-title">
          Upcoming results & events
        </Text>
        <Badge size="xs" data-testid="report-events-window">
          {data?.from ?? ""} → {data?.to ?? ""}
        </Badge>
        <Badge size="xs" data-testid="report-events-count">
          {events.length}
        </Badge>
      </Box>
      <Box className="flex flex-col px-2 py-1" data-testid="report-events-rows">
        {events.map((ev, i) => (
          <Box
            // Same symbol can appear for results + dividend on one date.
            key={`${ev.date}-${ev.symbol}-${ev.kind}-${i}`}
            data-testid={`report-events-row-${ev.symbol}-${ev.kind}`}
            data-symbol={ev.symbol}
            {...symbolRowProps(onOpenSymbol, ev.symbol)}
            className="flex items-center gap-2 min-w-0 py-1 border-b border-fin-border tabular-nums"
            style={{ cursor: symbolRowCursor(onOpenSymbol) }}
          >
            <Text size="xs" c="dimmed" span className="shrink-0 tabular-nums">
              {ev.date}
            </Text>
            <Text size="xs" fw={700} truncate span title={ev.symbol} className="shrink-0">
              {ev.symbol}
            </Text>
            <Badge size="xs" color={KIND_COLOR[ev.kind]}>
              {KIND_LABEL[ev.kind]}
            </Badge>
            <Text size="xs" c="dimmed" truncate span className="flex-1 min-w-0" title={ev.title}>
              {ev.title}
            </Text>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}
