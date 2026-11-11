import { Alert, Badge, Box, Paper, Skeleton, Text } from "@/ui";
import type { DeliveryResponse } from "../../types/report";
import { formatCurrency, formatNumber } from "../../utils/ui-helpers";
import { symbolRowCursor, symbolRowProps } from "../../components/common/symbolRowProps";

interface ReportDeliveryStripProps {
  data: DeliveryResponse | null;
  loading: boolean;
  error: string | null;
  onOpenSymbol?: (symbol: string) => void;
}

function formatPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}

export function ReportDeliveryStrip({ data, loading, error, onOpenSymbol }: ReportDeliveryStripProps) {
  if (loading) {
    return (
      <Box className="flex flex-col gap-2" data-testid="report-delivery-loading">
        <Skeleton h={16} />
        <Skeleton h={16} />
      </Box>
    );
  }
  if (error) {
    return (
      <Box data-testid="report-delivery-error">
        <Alert color="error" data-testid="report-delivery-error-alert">
          {error}
        </Alert>
      </Box>
    );
  }
  const rows = data?.rows ?? [];
  if (rows.length === 0) return null;
  return (
    <Paper
      data-testid="report-delivery-strip"
      className="min-w-0 border border-fin-border rounded-[2px] bg-fin-surface"
    >
      <Box className="flex items-center gap-2 px-2 pt-2">
        <Text size="xs" fw={600} truncate span className="flex-1 min-w-0" data-testid="report-delivery-title">
          High delivery %
        </Text>
        <Badge size="xs" data-testid="report-delivery-date">
          {data?.date ?? ""}
        </Badge>
        <Badge size="xs" data-testid="report-delivery-source">
          NSE bhavcopy
        </Badge>
      </Box>
      <Box
        data-testid="report-delivery-rows"
        className="flex gap-2 overflow-x-auto px-2 py-2 tabular-nums"
      >
        {rows.map((row) => (
          <Box
            key={row.symbol}
            data-testid={`report-delivery-row-${row.symbol}`}
            data-symbol={row.symbol}
            {...symbolRowProps(onOpenSymbol, row.symbol)}
            className="flex flex-col gap-0 min-w-[120px] shrink-0 tabular-nums"
            style={{ cursor: symbolRowCursor(onOpenSymbol) }}
          >
            <Text size="xs" fw={700} truncate span title={row.symbol}>
              {row.symbol}
            </Text>
            <Text size="xs" fw={700} span className="tabular-nums">
              {formatPct(row.delivery_pct)}
            </Text>
            <Text size="xs" c="dimmed" span className="tabular-nums">
              {formatNumber(row.delivery_qty)} / {formatNumber(row.traded_qty)}
            </Text>
            <Text size="xs" c="dimmed" span className="tabular-nums">
              {formatCurrency(row.close, 2)}
            </Text>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}
