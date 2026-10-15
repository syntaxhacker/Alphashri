import { Alert, Badge, Box, Paper, Skeleton, Text } from "@/ui";
import { BORDER, SURFACE } from "@/ui/palette";
import type { ReportEventKind, ReportEventsResponse } from "../../types/report";

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
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }} data-testid="report-events-loading">
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
      sx={{ minWidth: 0, border: 1, borderColor: BORDER, borderRadius: 2, bgcolor: SURFACE }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, pt: 1 }}>
        <Text size="xs" fw={600} truncate span sx={{ flex: 1, minWidth: 0 }} data-testid="report-events-title">
          Upcoming results & events
        </Text>
        <Badge size="xs" data-testid="report-events-window">
          {data?.from ?? ""} → {data?.to ?? ""}
        </Badge>
        <Badge size="xs" data-testid="report-events-count">
          {events.length}
        </Badge>
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", px: 1, py: 0.5 }} data-testid="report-events-rows">
        {events.map((ev, i) => (
          <Box
            // Same symbol can appear for results + dividend on one date.
            key={`${ev.date}-${ev.symbol}-${ev.kind}-${i}`}
            data-testid={`report-events-row-${ev.symbol}-${ev.kind}`}
            data-symbol={ev.symbol}
            role={onOpenSymbol ? "button" : undefined}
            tabIndex={onOpenSymbol ? 0 : undefined}
            onClick={onOpenSymbol ? () => onOpenSymbol(ev.symbol) : undefined}
            onKeyDown={
              onOpenSymbol
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenSymbol(ev.symbol);
                    }
                  }
                : undefined
            }
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              minWidth: 0,
              py: 0.5,
              borderBottom: 1,
              borderColor: "divider",
              cursor: onOpenSymbol ? "pointer" : "default",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <Text size="xs" c="dimmed" span sx={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
              {ev.date}
            </Text>
            <Text size="xs" fw={700} truncate span title={ev.symbol} sx={{ flexShrink: 0 }}>
              {ev.symbol}
            </Text>
            <Badge size="xs" color={KIND_COLOR[ev.kind]}>
              {KIND_LABEL[ev.kind]}
            </Badge>
            <Text size="xs" c="dimmed" truncate span sx={{ flex: 1, minWidth: 0 }} title={ev.title}>
              {ev.title}
            </Text>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}
